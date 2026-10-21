import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ContentRuleSchema,
  ManifestSchema,
  decideVerdict,
  evaluateContent,
  type ContentFinding,
  type ContentObservation,
} from './contract.js';

function targetUrlAllowed(raw: string): boolean {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  return process.env.VISUAL_QA_ALLOW_REMOTE === 'true' && url.protocol === 'https:';
}

async function runCompare(
  url: string,
  selector: string,
  viewport: string,
  figmaPath: string,
  outDir: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const cli = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
  await stat(cli);
  const argv = [
    cli,
    'compare',
    'figma=figwright:1-1',
    `story=${url}`,
    `selector=${selector}`,
    `viewport=${viewport}`,
    'size=strict',
    'dpr=1',
    'profile=component/dev',
    `outDir=${outDir}`,
  ];

  return new Promise((ok, reject) => {
    const child = spawn(process.execPath, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, UIMATCH_FIGMA_PNG_B64: '', UIMATCH_FIGMA_PNG_PATH: figmaPath },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-4096);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      ok({ exitCode: code ?? 2, stderr, stdout });
    });
  });
}

async function main(): Promise<void> {
  const manifestArg = process.argv[2];
  if (!manifestArg)
    throw new Error(
      'Usage: pnpm exec tsx packages/uimatch-cli/src/visual-qa/run.ts <manifest.json>'
    );
  const manifestPath = resolve(manifestArg);
  const manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!targetUrlAllowed(manifest.runtime.url)) {
    throw new Error(
      'Runtime URL must be loopback HTTP(S); allow remote HTTPS explicitly with VISUAL_QA_ALLOW_REMOTE=true'
    );
  }
  const base = dirname(manifestPath);
  const figmaPath = isAbsolute(manifest.figma.screenshot)
    ? manifest.figma.screenshot
    : resolve(base, manifest.figma.screenshot);
  const outDir = resolve(base, manifest.output);
  await stat(figmaPath);
  await mkdir(outDir, { recursive: true });

  const findings: ContentFinding[] = [];
  let visual: 'PASS' | 'FAIL' | 'BLOCKED' = 'BLOCKED';
  let diagnostic = '';
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: manifest.runtime.viewport,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.goto(manifest.runtime.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const target = page.locator(manifest.runtime.selector);
      await target.waitFor({ state: 'visible', timeout: 10_000 });
      await target.screenshot({ path: resolve(outDir, 'runtime.png'), animations: 'disabled' });
      for (const rule of manifest.content.map((item) => ContentRuleSchema.parse(item))) {
        const locator = page.locator(rule.selector);
        const matches = await locator.count();
        let observation: ContentObservation = { matches, text: '', overflow: false };
        if (matches === 1 && rule.policy !== 'volatile' && rule.policy !== 'optional') {
          const item = locator.first();
          observation = {
            matches,
            text: (await item.innerText()).trim(),
            overflow: await item.evaluate(
              (element) =>
                element.scrollWidth > element.clientWidth + 1 ||
                element.scrollHeight > element.clientHeight + 1
            ),
          };
        }
        findings.push(evaluateContent(rule, observation));
      }
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  try {
    const compared = await runCompare(
      manifest.runtime.url,
      manifest.runtime.selector,
      `${manifest.runtime.viewport.width}x${manifest.runtime.viewport.height}`,
      figmaPath,
      outDir
    );
    visual = compared.exitCode === 0 ? 'PASS' : compared.exitCode === 1 ? 'FAIL' : 'BLOCKED';
    diagnostic = `${compared.stderr}\n${compared.stdout}`.trim();
  } catch (error) {
    diagnostic = error instanceof Error ? error.message : String(error);
  }

  const hasVariableContent = manifest.content.some(
    (rule) => rule.policy === 'dynamic' || rule.policy === 'volatile' || rule.policy === 'optional'
  );
  const verdict = decideVerdict(visual, findings, hasVariableContent);
  const report = {
    schemaVersion: 1,
    caseId: manifest.id,
    figmaNodeId: manifest.figma.nodeId,
    runtime: { url: manifest.runtime.url, viewport: manifest.runtime.viewport },
    verdict,
    gates: {
      visual,
      content: findings.some((finding) => finding.status === 'FAIL') ? 'FAIL' : 'PASS',
      pixelParityComparable: !hasVariableContent,
    },
    findings,
    notes: hasVariableContent
      ? [
          'Pixel gate advisory only: variable content requires aligned fixtures or explicit verified masking.',
        ]
      : [],
    diagnostic: visual !== 'PASS' ? diagnostic : undefined,
    artifacts: { figma: figmaPath, runtime: resolve(outDir, 'runtime.png'), uimatch: outDir },
  };
  await writeFile(resolve(outDir, 'qa-report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${verdict} | ${manifest.id} | ${resolve(outDir, 'qa-report.json')}\n`);
  if (verdict !== 'VERIFIED') process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Visual QA BLOCKED: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 2;
});
