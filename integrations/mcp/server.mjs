import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, isAbsolute, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const name = 'visual-qa-secure-mcp';
const version = '1.0.0';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suiteRunner = resolve(repoRoot, 'packages/uimatch-cli/src/visual-qa/suite.ts');
const ALLOWED_TOOL_NAMES = ['visual_qa_status', 'visual_qa_preflight', 'visual_qa_run_suite'];
const suiteInput = {
  type: 'object',
  properties: {
    suite: { type: 'string', description: 'Relative path to a suite.json within VISUAL_QA_CASES_ROOT' },
  },
  required: ['suite'],
  additionalProperties: false,
};
const tools = [
  {
    name: ALLOWED_TOOL_NAMES[0],
    description: 'Report whether the Visual QA MCP adapter is configured. No filesystem contents or secrets are disclosed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: ALLOWED_TOOL_NAMES[1],
    description: 'Validate one allowlisted suite and its manifest path boundaries; do not execute the browser.',
    inputSchema: suiteInput,
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  {
    name: ALLOWED_TOOL_NAMES[2],
    description: 'Execute a local-loopback Visual QA suite and return only verdict/exit status. Requires explicit VISUAL_QA_TUNNEL_ALLOW_RUN=true.',
    inputSchema: suiteInput,
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

function allowedInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

async function allowedSuite(input) {
  const rootVar = process.env.VISUAL_QA_CASES_ROOT;
  if (!rootVar) throw new Error('CASES_ROOT_NOT_CONFIGURED');
  const root = await realpath(resolve(rootVar));
  if (typeof input !== 'string' || input.length === 0 || isAbsolute(input)) {
    throw new Error('SUITE_PATH_MUST_BE_RELATIVE');
  }
  const suite = resolve(root, input);
  if (!allowedInside(root, suite) || !suite.endsWith('.json')) {
    throw new Error('SUITE_OUTSIDE_ALLOWLIST');
  }
  const actual = await realpath(suite);
  if (!allowedInside(root, actual)) throw new Error('SUITE_OUTSIDE_ALLOWLIST');
  const suiteStats = await stat(actual);
  if (!suiteStats.isFile() || suiteStats.size > 1024 * 1024) throw new Error('INVALID_SUITE');
  const data = JSON.parse(await readFile(actual, 'utf8'));
  if (data?.version !== 1 || !Array.isArray(data.cases) || data.cases.length < 1 || data.cases.length > 100) {
    throw new Error('INVALID_SUITE');
  }
  for (const item of data.cases) {
    if (!item || typeof item.manifest !== 'string' || isAbsolute(item.manifest)) {
      throw new Error('UNSAFE_MANIFEST_PATH');
    }
    const manifestPath = await realpath(resolve(dirname(actual), item.manifest));
    if (!allowedInside(root, manifestPath)) throw new Error('UNSAFE_MANIFEST_PATH');
    const raw = await readFile(manifestPath, 'utf8');
    if (raw.length > 1024 * 1024) throw new Error('INVALID_MANIFEST');
    const manifest = JSON.parse(raw);
    if (!manifest?.figma?.screenshot || !manifest?.runtime?.url || !manifest?.output) {
      throw new Error('INVALID_MANIFEST');
    }
    const figmaPath = await realpath(resolve(dirname(manifestPath), manifest.figma.screenshot));
    if (!allowedInside(root, figmaPath)) throw new Error('UNSAFE_SCREENSHOT_PATH');
    const outPath = resolve(dirname(manifestPath), manifest.output);
    // The suite writer must never write outside the allowlisted tree.
    if (!allowedInside(root, outPath)) throw new Error('UNSAFE_OUTPUT_PATH');
    const outParent = await realpath(dirname(outPath));
    if (!allowedInside(root, outParent) && outParent !== root) throw new Error('UNSAFE_OUTPUT_PATH');
    if (manifest.auth?.kind === 'storage-state') {
      const statePath = await realpath(resolve(dirname(manifestPath), manifest.auth.path));
      if (!allowedInside(root, statePath)) throw new Error('UNSAFE_AUTH_STATE_PATH');
    }
    if (manifest.auth?.kind === 'ui-login') {
      const loginUrl = new URL(manifest.auth.loginUrl);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(loginUrl.hostname)) {
        throw new Error('REMOTE_LOGIN_NOT_ALLOWED');
      }
    }
    const runtimeUrl = new URL(manifest.runtime.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(runtimeUrl.hostname)) {
      throw new Error('REMOTE_RUNTIME_NOT_ALLOWED');
    }
  }
  return { root, suite: actual, count: data.cases.length };
}

async function runSuite(suitePath, root) {
  // The child cannot elevate remote access via this connector.
  const childEnv = {
    ...process.env,
    VISUAL_QA_ALLOW_REMOTE: 'false',
  };
  return await new Promise((resolveRun) => {
    const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
      'exec', 'tsx', suiteRunner, suitePath,
    ], { cwd: repoRoot, env: childEnv, stdio: 'ignore' });
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveRun({ exitCode: code, verdict: code === 0 ? 'VERIFIED' : code === 1 ? 'FAILED_OR_PARTIAL' : 'BLOCKED' });
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(2);
    }, 120_000);
    child.on('error', () => finish(2));
    child.on('close', (code) => finish(code ?? 2));
  });
}

async function handleCall(params) {
  const tool = params?.name;
  if (!ALLOWED_TOOL_NAMES.includes(tool)) throw new Error('UNKNOWN_TOOL');
  if (tool === ALLOWED_TOOL_NAMES[0]) {
    return { configured: Boolean(process.env.VISUAL_QA_CASES_ROOT), runEnabled: process.env.VISUAL_QA_TUNNEL_ALLOW_RUN === 'true', tunnelConnected: 'not-checkable-from-mcp', capabilities: ALLOWED_TOOL_NAMES };
  }
  const arg = params?.arguments;
  if (!arg || Object.keys(arg).some((key) => key !== 'suite')) throw new Error('INVALID_ARGS');
  const permitted = await allowedSuite(arg.suite);
  if (tool === ALLOWED_TOOL_NAMES[1]) {
    return { permitted: true, cases: permitted.count, note: 'Path/scheme validation only; run suite for SHA-256/Figma snapshot preflight.' };
  }
  if (process.env.VISUAL_QA_TUNNEL_ALLOW_RUN !== 'true') throw new Error('REMOTE_RUN_DISABLED');
  return await runSuite(permitted.suite, permitted.root);
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function dispatch(message) {
  if (!message || message.jsonrpc !== '2.0' || !('method' in message)) return;
  const id = message.id;
  if (id === undefined) return; // notifications
  const respond = (payload) => send({ jsonrpc: '2.0', id, ...payload });
  try {
    if (message.method === 'initialize') {
      respond({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name, version }, instructions: 'Tools are limited to a single allowlisted Visual QA cases root. Remote execution is opt-in.' } });
    } else if (message.method === 'ping') {
      respond({ result: {} });
    } else if (message.method === 'tools/list') {
      respond({ result: { tools } });
    } else if (message.method === 'tools/call') {
      const result = await handleCall(message.params);
      respond({ result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } });
    } else {
      respond({ error: { code: -32601, message: 'Method not found' } });
    }
  } catch (error) {
    // Only report whitelisted category identifiers: do not disclose paths,
    // URLs, files, input details, credentials or browser stderr.
    const known = [
      'CASES_ROOT_NOT_CONFIGURED', 'SUITE_PATH_MUST_BE_RELATIVE', 'SUITE_OUTSIDE_ALLOWLIST',
      'INVALID_SUITE', 'INVALID_MANIFEST', 'UNSAFE_MANIFEST_PATH', 'UNSAFE_SCREENSHOT_PATH',
      'UNSAFE_OUTPUT_PATH', 'UNSAFE_AUTH_STATE_PATH', 'REMOTE_LOGIN_NOT_ALLOWED',
      'REMOTE_RUNTIME_NOT_ALLOWED', 'REMOTE_RUN_DISABLED', 'UNKNOWN_TOOL', 'INVALID_ARGS',
    ];
    const code = known.includes(error?.message) ? error.message : 'UNAVAILABLE_OR_INVALID_INPUT';
    respond({ result: { isError: true, content: [{ type: 'text', text: code }] } });
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (line.length > 1024 * 1024) return;
  try {
    const parsed = JSON.parse(line);
    void dispatch(parsed);
  } catch {
    // Invalid JSON: do not echo submitted input into stdout or stderr.
  }
});
