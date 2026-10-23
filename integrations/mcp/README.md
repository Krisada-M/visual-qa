# Secure MCP Tunnel integration

The MCP server is deliberately a narrow, local tool interface. It is not a
remote shell, full-filesystem server, deployment agent or code editor.

## Capabilities

- `visual_qa_status`: configuration and opt-in readiness, no files returned
- `visual_qa_preflight`: validate suite path containment, manifests, screenshot
  and runtime origins (local-only), with no browser execution
- `visual_qa_run_suite`: run the existing suite CLI when
  `VISUAL_QA_TUNNEL_ALLOW_RUN=true`; return only a verdict/exit classification

No raw logs, cookies, storageState, screenshot contents, source code or
credentials are returned over MCP. Screenshot evidence remains on your machine.
The root must be a dedicated, non-sensitive QA cases directory, not your home
directory or entire project checkout.

## Local self-test

```sh
node integrations/mcp/smoke.mjs
```

The server uses newline-delimited MCP JSON-RPC over **stdio**, with a deliberately
small method surface (initialize, ping, tools/list, tools/call). It does not
support arbitrary dynamic resources or prompts. A generic MCP client should be
tested before deployment, because host-specific protocol extensions may vary.

## Mac / WSL2

Use the official **OpenAI tunnel-client**, not a third-party desktop app that
may not yet have a public download. Check prerequisites and permissions at
https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

On macOS:

```sh
brew install openai/tools/tunnel-client
tunnel-client --version
tunnel-client help quickstart
```

In Fish, after cloning and building Visual QA locally, configure a dedicated
cases directory:

```fish
set -gx VISUAL_QA_CASES_ROOT (realpath ./experiments/visual-qa)
set -gx VISUAL_QA_TUNNEL_ALLOW_RUN false
node integrations/mcp/server.mjs
```

The last command is a stdio server and will not print a startup banner. It is
intended for a supervising MCP client; use the smoke test rather than leaving
it connected to a terminal.

Once your Platform organization has created a tunnel ID and a **restricted**
runtime key with Tunnels Read + Use, configure a local stdio profile following
the CLI's *live* quickstart help (replace the placeholder ID and absolute path):

```text
tunnel-client init --sample sample_mcp_stdio_local --profile visual-qa --tunnel-id <TUNNEL_ID> --mcp-command "node /ABS/PATH/visual-qa/integrations/mcp/server.mjs"
tunnel-client doctor --profile visual-qa --explain
tunnel-client run --profile visual-qa
```

These are commands to run on the local host, **not** values to paste into
ChatGPT. Configure the restricted runtime key in your local environment or
supported keychain. Do not paste credentials into chat, commit them, or put them
in CLI arguments. Avoid concurrent tunnel-client instances for the same
stdio tunnel ID.

Only after the local doctor/run is healthy, in ChatGPT choose Plugins →
Add custom MCP server → Tunnel, associate the same tunnel ID with the
authorized workspace, then make a safe `visual_qa_status` call.

An MCP adapter passing its own smoke test does **not** prove that your account
has tunnel entitlements or that ChatGPT can see this connection.

## Permissions

Use a new dedicated tunnel and the narrowest ChatGPT tool approvals. Keep
`VISUAL_QA_TUNNEL_ALLOW_RUN=false` until you explicitly authorize browser QA
execution. Run test-only pages on loopback; no remote URLs are permitted by
this bridge. Use `visual_qa_preflight` before enabling writes to QA artifact
directories. Do not expose the repository's production secrets, health data,
browser profiles or other workspace folders.
