import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'visual-qa-mcp-'));
const script = fileURLToPath(new URL('./server.mjs', import.meta.url));
const host = spawn(process.execPath, [script], {
  env: { ...process.env, VISUAL_QA_CASES_ROOT: dir, VISUAL_QA_TUNNEL_ALLOW_RUN: 'false' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const responses = [];
const readers = createInterface({ input: host.stdout });
readers.on('line', (line) => responses.push(JSON.parse(line)));

async function request(id, method, params) {
  host.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n'
  );
  for (let i = 0; i < 100; i++) {
    const match = responses.find((x) => x.id === id);
    if (match) return match;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('Timed out waiting for MCP response ' + id);
}

try {
  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'qa-smoke', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'visual-qa-secure-mcp');
  host.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assert.equal((await request(2, 'tools/list')).result.tools.length, 3);
  const status = await request(3, 'tools/call', { name: 'visual_qa_status', arguments: {} });
  assert.equal(JSON.parse(status.result.content[0].text).runEnabled, false);
  const attempt = await request(4, 'tools/call', {
    name: 'visual_qa_run_suite',
    arguments: { suite: '../secrets.json' },
  });
  assert.equal(attempt.result.isError, true);
  assert.doesNotMatch(attempt.result.content[0].text, /secret|home|\/Users/i);

  // A symlinked suite must not escape the allowlisted root.
  await mkdir(join(dir, 'cases'));
  await writeFile(
    join(dir, 'cases', 'suite.json'),
    JSON.stringify({ version: 1, cases: [{ manifest: '../missing.json' }] })
  );
  const refuse = await request(5, 'tools/call', {
    name: 'visual_qa_preflight',
    arguments: { suite: 'cases/suite.json' },
  });
  assert.equal(refuse.result.isError, true);

  const unknown = await request(6, 'tools/call', {
    name: 'run_shell',
    arguments: { command: 'pwd' },
  });
  assert.equal(unknown.result.isError, true);

  // A valid allowlisted suite is accepted for path preflight without running.
  const png = join(dir, 'cases', 'figma.png');
  await writeFile(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const manifest = {
    id: 'mcp-smoke',
    figma: { nodeId: '1:2', screenshot: './figma.png' },
    runtime: { url: 'http://127.0.0.1:3000/member', selector: '#app',
      viewport: { width: 390, height: 844 } },
    output: './artifacts',
  };
  await writeFile(join(dir, 'cases', 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'cases', 'suite.json'), JSON.stringify({
    version: 1, cases: [{ manifest: 'manifest.json' }],
  }));
  const permitted = await request(7, 'tools/call', {
    name: 'visual_qa_preflight', arguments: { suite: 'cases/suite.json' },
  });
  assert.equal(JSON.parse(permitted.result.content[0].text).permitted, true);

  const runDenied = await request(8, 'tools/call', {
    name: 'visual_qa_run_suite', arguments: { suite: 'cases/suite.json' },
  });
  assert.equal(runDenied.result.isError, true);
  assert.equal(runDenied.result.content[0].text, 'REMOTE_RUN_DISABLED');

  const outside = await mkdtemp(join(tmpdir(), 'visual-qa-mcp-outside-'));
  try {
    await symlink(outside, join(dir, 'cases', 'suite-artifacts'), 'dir');
    const escaped = await request(9, 'tools/call', {
      name: 'visual_qa_preflight', arguments: { suite: 'cases/suite.json' },
    });
    assert.equal(escaped.result.isError, true);
    assert.equal(escaped.result.content[0].text, 'UNSAFE_OUTPUT_PATH');
  } finally {
    await rm(outside, { recursive: true, force: true });
  }

  process.stdout.write('Secure MCP handshake, authorization and filesystem boundary tests passed\n');
} finally {
  host.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
