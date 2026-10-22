import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SuiteSchema, preflight, suiteVerdict, type CaseVerdict } from './suite-core.js';

interface SuiteResult {
  name: string;
  state: string;
  verdict: CaseVerdict;
  reason?: string;
}

async function execute(manifestPath: string): Promise<number> {
  const runner = fileURLToPath(new URL('./run.ts', import.meta.url));
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  return await new Promise<number>((resolveResult) => {
    const child = spawn(command, ['exec', 'tsx', runner, manifestPath], {
      // Never copy child stdout/stderr (which may contain URLs or test secrets)
      stdio: 'ignore',
    });
    let settled = false;
    const settle = (value: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(2);
    }, 180_000);
    child.on('error', () => settle(2));
    child.on('close', (code) => settle(code ?? 2));
  });
}

async function readVerdict(path: string): Promise<CaseVerdict | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || !('verdict' in raw)) return undefined;
    const value = raw.verdict;
    if (value === 'VERIFIED' || value === 'FAILED' || value === 'PARTIAL' || value === 'BLOCKED') {
      return value;
    }
  } catch {
    // A runner that cannot report its state is BLOCKED, never VERIFIED.
  }
  return undefined;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: pnpm exec tsx packages/uimatch-cli/src/visual-qa/suite.ts <suite.json>');
  const suitePath = resolve(input);
  const suite = SuiteSchema.parse(JSON.parse(await readFile(suitePath, 'utf8')) as unknown);
  const outputDir = resolve(dirname(suitePath), 'suite-artifacts');
  await mkdir(outputDir, { recursive: true });

  const results: SuiteResult[] = [];
  const usedManifests = new Set<string>();
  const usedOutputs = new Set<string>();

  for (const item of suite.cases) {
    let verdict: CaseVerdict = 'BLOCKED';
    let reason: string | undefined;
    try {
      const check = await preflight(suitePath, item);
      if (!check.ok) reason = check.reason ?? 'PREFLIGHT_FAILED';
      else if (usedManifests.has(check.manifestPath) || (check.outputPath && usedOutputs.has(check.outputPath))) {
        reason = 'DUPLICATE_CASE_OR_OUTPUT';
      } else {
        usedManifests.add(check.manifestPath);
        if (check.outputPath) usedOutputs.add(check.outputPath);
        const exit = await execute(check.manifestPath);
        const candidate = await readVerdict(resolve(check.outputPath ?? outputDir, 'qa-report.json'));
        if (exit === 0 && candidate === 'VERIFIED') verdict = 'VERIFIED';
        else if (exit === 1 && (candidate === 'FAILED' || candidate === 'PARTIAL')) verdict = candidate;
        else reason = 'RUNNER_BLOCKED_OR_INCONSISTENT';
      }
    } catch {
      reason = 'PREFLIGHT_FAILED';
    }

    const row: SuiteResult = {
      name: item.name,
      state: item.mapping.state,
      verdict,
      ...(reason ? { reason } : {}),
    };
    results.push(row);
    process.stdout.write(`${row.verdict} | ${row.name} | ${row.state}\n`);
  }

  const verdict = suiteVerdict(results.map((row) => row.verdict));
  const summary = {
    schemaVersion: 1,
    name: suite.name,
    verdict,
    cases: results,
    counts: Object.fromEntries(
      (['VERIFIED', 'FAILED', 'PARTIAL', 'BLOCKED'] as const).map((status) => [
        status,
        results.filter((row) => row.verdict === status).length,
      ])
    ),
  };
  const reportPath = resolve(outputDir, 'suite-report.json');
  await writeFile(reportPath, JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(`Suite: ${verdict} | ${reportPath}\n`);
  process.exitCode = verdict === 'VERIFIED' ? 0 : verdict === 'BLOCKED' ? 2 : 1;
}

main().catch(() => {
  // Avoid printing full manifest contents or sensitive runtime URLs.
  process.stderr.write('Visual QA suite BLOCKED: invalid or missing suite manifest\n');
  process.exitCode = 2;
});
