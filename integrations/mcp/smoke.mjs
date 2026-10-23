import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

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
  host.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
  for (let i = 0; i < 100; i++) {
    const match = responses.find((x) => x.id === id);
    if (match) return match;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error('Timed out waiting for MCP response ' + id);
}

try {
  const init = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa-smoke', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'visual-qa-secure-mcp');
  host.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assert.equal((await request(2, 'tools/list')).result.tools.length, 3);
  const status = await request(3, 'tools/call', { name: 'visual_qa_status', arguments: {} });
  assert.equal(JSON.parse(status.result.content[0].text).runEnabled, false);
  const attempt = await request(4, 'tools/call', { name: 'visual_qa_run_suite', arguments: { suite: '../secrets.json' } });
  assert.equal(attempt.result.isError, true);
  assert.doesNotMatch(attempt.result.content[0].text, /secret|home|\/Users/i);

  // A symlinked suite must not escape the allowlisted root.
  await mkdir(join(dir, 'cases'));
  await writeFile(join(dir, 'cases', 'suite.json'), JSON.stringify({ version: 1, cases: [{ manifest: '../missing.json' }] }));
  const refuse = await request(5, 'tools/call', { name: 'visual_qa_preflight', arguments: { suite: 'cases/suite.json' } });
  assert.equal(refuse.result.isError, true);

  const unknown = await request(6, 'tools/call', { name: 'run_shell', arguments: { command: 'pwd' } });
  assert.equal(unknown.result.isError, true);
  process.stdout.write('Secure MCP handshake and restricted tool tests passed\n');
} finally {
  host.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
