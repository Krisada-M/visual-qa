import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runner = join(root, 'packages/uimatch-cli/src/visual-qa/run.ts');
const suiteRunner = join(root, 'packages/uimatch-cli/src/visual-qa/suite.ts');
const markup = `<!doctype html><html><head><style>
body { margin: 0; font-family: Arial, sans-serif; background: #fff; }
#app { box-sizing: border-box; width: 320px; margin: 20px; padding: 24px;
  border: 1px solid #ddd; background: #fafafa; }
</style></head><body><main id="app"><h1 id="member-root">Member dashboard</h1>
<p id="member-name">Test Member</p></main></body></html>`;
const loginHtml = `<!doctype html><html><body><form action="/login" method="post">
<input id="user" name="user"><input id="pass" type="password" name="pass">
<button id="submit" type="submit">Sign in</button></form></body></html>`;

function isMember(request: IncomingMessage): boolean {
  return request.headers.cookie?.split(';').some((s) => s.trim() === 'qa_auth=member') ?? false;
}

async function runCase(
  path: string,
  env: Record<string, string> = {},
  script: string = runner
): Promise<{ code: number; output: string }> {
  return new Promise((done, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['exec', 'tsx', script, path],
      {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => done({ code: code ?? 2, output }));
  });
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'visual-qa-p1-'));
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/login' && request.method === 'POST') {
      let input = '';
      request.setEncoding('utf8');
      request.on('data', (part: string) => {
        input += part;
      });
      request.on('end', () => {
        const form = new URLSearchParams(input);
        if (form.get('user') === 'qa-member' && form.get('pass') === 'test-only') {
          response.writeHead(303, {
            location: '/member',
            'set-cookie': 'qa_auth=member; Path=/; HttpOnly; SameSite=Lax',
          });
        } else {
          response.writeHead(303, { location: '/login' });
        }
        response.end();
      });
      return;
    }
    if (path === '/member') {
      if (!isMember(request)) {
        response.writeHead(302, { location: '/login' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(markup);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(loginHtml);
  });

  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const origin = `http://127.0.0.1:${address.port}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      });
      try {
        await context.addCookies([
          {
            name: 'qa_auth',
            value: 'member',
            url: origin,
            httpOnly: true,
            sameSite: 'Lax',
          },
        ]);
        const page = await context.newPage();
        await page.goto(`${origin}/member`);
        await page.locator('#app').screenshot({ path: join(directory, 'reference.png') });
        await context.storageState({ path: join(directory, 'authenticated-state.json') });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }

    const casePath = join(directory, 'case.json');
    const expected = {
      id: 'auth-member-smoke',
      figma: { nodeId: 'fixture:1', screenshot: './reference.png' },
      runtime: {
        url: `${origin}/member`,
        selector: '#app',
        viewport: { width: 390, height: 844 },
      },
      content: [
        { policy: 'exact', selector: '#member-root', expected: 'Member dashboard' },
        { policy: 'exact', selector: '#member-name', expected: 'Test Member' },
      ],
      output: './artifacts',
    };

    await writeFile(
      casePath,
      JSON.stringify({
        ...expected,
        auth: {
          kind: 'storage-state',
          role: 'member',
          path: './authenticated-state.json',
          readySelector: '#member-root',
        },
      })
    );
    const reused = await runCase(casePath);
    const report = JSON.parse(
      await readFile(join(directory, 'artifacts/qa-report.json'), 'utf8')
    ) as {
      verdict: string;
      auth?: { role: string };
    };
    if (reused.code !== 0 || report.verdict !== 'VERIFIED' || report.auth?.role !== 'member') {
      throw new Error(`StorageState reuse should VERIFIED: ${reused.output}`);
    }

    await writeFile(
      casePath,
      JSON.stringify({
        ...expected,
        auth: {
          kind: 'ui-login',
          role: 'member',
          loginUrl: `${origin}/login`,
          usernameSelector: '#user',
          passwordSelector: '#pass',
          submitSelector: '#submit',
          readySelector: '#member-root',
          usernameEnv: 'QA_TEST_USERNAME',
          passwordEnv: 'QA_TEST_PASSWORD',
        },
      })
    );
    const loggedIn = await runCase(casePath, {
      QA_TEST_USERNAME: 'qa-member',
      QA_TEST_PASSWORD: 'test-only',
    });
    const loginReport = JSON.parse(
      await readFile(join(directory, 'artifacts/qa-report.json'), 'utf8')
    ) as {
      verdict: string;
      auth?: { kind: string };
    };
    if (
      loggedIn.code !== 0 ||
      loginReport.verdict !== 'VERIFIED' ||
      loginReport.auth?.kind !== 'ui-login'
    ) {
      throw new Error(`UI login should VERIFIED: ${loggedIn.output}`);
    }
    const serializedReport = await readFile(join(directory, 'artifacts/qa-report.json'), 'utf8');
    if (serializedReport.includes('test-only') || serializedReport.includes('qa_auth')) {
      throw new Error('QA report exposed auth material');
    }

    // P2: suite preflight checks confirmed frame/state mapping, snapshot hash,
    // freshness, then repeats the authenticated P1 comparison.
    const suitePath = join(directory, 'suite.json');
    const imageDigest = createHash('sha256')
      .update(await readFile(join(directory, 'reference.png')))
      .digest('hex');
    const suiteCase = {
      name: 'Member authenticated default',
      manifest: './case.json',
      mapping: {
        confirmed: true,
        figmaNodeId: 'fixture:1',
        runtimePath: '/member',
        state: 'default',
      },
      snapshot: {
        source: 'approved-fixture',
        exportedAt: new Date().toISOString(),
        sha256: imageDigest,
        maxAgeHours: 12,
      },
    };
    const suiteData = {
      version: 1,
      name: 'P2 authenticated visual regression',
      cases: [suiteCase],
    };
    await writeFile(suitePath, JSON.stringify(suiteData));
    const checked = await runCase(
      suitePath,
      {
        QA_TEST_USERNAME: 'qa-member',
        QA_TEST_PASSWORD: 'test-only',
      },
      suiteRunner
    );
    const suiteReport = JSON.parse(
      await readFile(join(directory, 'suite-artifacts/suite-report.json'), 'utf8')
    ) as { verdict: string };
    if (checked.code !== 0 || suiteReport.verdict !== 'VERIFIED') {
      throw new Error(`Expected confirmed authenticated suite VERIFIED: ${checked.output}`);
    }

    await writeFile(
      suitePath,
      JSON.stringify({
        ...suiteData,
        cases: [{ ...suiteCase, snapshot: { ...suiteCase.snapshot, sha256: 'a'.repeat(64) } }],
      })
    );
    const tampered = await runCase(suitePath, {}, suiteRunner);
    if (tampered.code !== 2 || !tampered.output.includes('BLOCKED')) {
      throw new Error(`Tampered snapshot must BLOCK: ${tampered.output}`);
    }

    await writeFile(join(directory, 'expired.json'), JSON.stringify({ cookies: [], origins: [] }));
    await writeFile(
      casePath,
      JSON.stringify({
        ...expected,
        auth: {
          kind: 'storage-state',
          role: 'member',
          path: './expired.json',
          readySelector: '#member-root',
        },
      })
    );
    const expired = await runCase(casePath);
    if (expired.code !== 2 || !expired.output.includes('Visual QA BLOCKED')) {
      throw new Error(`Unauthenticated redirect must BLOCK, got: ${expired.output}`);
    }

    process.stdout.write(
      'P2 smoke passed: storageState, UI login, versioned suite VERIFIED; tampered/expired BLOCKED\n'
    );
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
