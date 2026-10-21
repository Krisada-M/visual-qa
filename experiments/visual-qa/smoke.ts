import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runner = join(repoRoot, 'packages/uimatch-cli/src/visual-qa/run.ts');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
#app { margin: 20px; padding: 24px; width: 292px; box-sizing: border-box;
  border-radius: 12px; border: 1px solid #d0d0d0; background: #fafafa; }
button { padding: 12px 16px; border-radius: 6px; background: #2448a5; color: white; border: 0; }
</style></head><body><main id="app"><h1>Welcome</h1>
<button id="submit">Sign in</button></main></body></html>`;

async function execute(manifest: string): Promise<{ code: number; output: string }> {
  return new Promise((finish, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(command, ['exec', 'tsx', runner, manifest], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => finish({ code: code ?? 2, output }));
  });
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'visual-qa-smoke-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });

  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback address');
    const url = `http://127.0.0.1:${address.port}/`;

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        const page = await context.newPage();
        await page.goto(url);
        await page.locator('#app').screenshot({ path: join(dir, 'reference.png') });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }

    const manifestPath = join(dir, 'case.json');
    const base = {
      id: 'selftest-login',
      figma: { nodeId: 'smoke:1', screenshot: './reference.png' },
      runtime: {
        url,
        selector: '#app',
        viewport: { width: 390, height: 844 },
      },
      content: [{ policy: 'exact', selector: '#submit', expected: 'Sign in' }],
      output: './artifacts',
    };
    await writeFile(manifestPath, JSON.stringify(base));
    const first = await execute(manifestPath);
    const firstReport = JSON.parse(
      await readFile(join(dir, 'artifacts', 'qa-report.json'), 'utf8')
    ) as { verdict: string };
    if (first.code !== 0 || firstReport.verdict !== 'VERIFIED') {
      const full = await readFile(join(dir, 'artifacts', 'qa-report.json'), 'utf8');
      const upstream = await readFile(join(dir, 'artifacts', 'report.json'), 'utf8').catch(
        () => 'no upstream report'
      );
      throw new Error(
        `Expected VERIFIED smoke: ${first.output}\nQA: ${full}\nUIMatch: ${upstream.slice(0, 8000)}`
      );
    }

    await writeFile(
      manifestPath,
      JSON.stringify({
        ...base,
        content: [{ policy: 'dynamic', selector: '#submit' }],
      })
    );
    const second = await execute(manifestPath);
    const secondReport = JSON.parse(
      await readFile(join(dir, 'artifacts', 'qa-report.json'), 'utf8')
    ) as { verdict: string };
    if (second.code === 0 || secondReport.verdict !== 'PARTIAL') {
      throw new Error(`Expected PARTIAL for unaligned dynamic content: ${second.output}`);
    }

    process.stdout.write('Visual QA smoke verified: static VERIFIED; dynamic PARTIAL\n');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
