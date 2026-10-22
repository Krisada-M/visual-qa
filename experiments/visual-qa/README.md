# Figwright → Visual QA (P0 experiment)

This is an **experimental local harness**, not a verified production QA system.
It extends the existing uiMatch comparison engine; it does not replace it.

## Design evidence

1. Open the target Figma file with the Figwright plugin connected.
2. Inspect `get_design_context` and export the **same frame** with
   `save_screenshots({nodeIds: ["<node-id>"], outDir: "<local-path>", scale: 1})`.
3. Put the exported PNG at the path named by `figma.screenshot` in the case manifest.
4. Use `get_reactions` and FRD to write explicit content/interaction test contracts.
   This first experiment does not automatically infer them.

The PNG is passed through `UIMATCH_FIGMA_PNG_PATH` (file input). This avoids the
size limit of `UIMATCH_FIGMA_PNG_B64` environment variables. Figma REST tokens
are not required for this path.

## Run (from repository root)

Requirements: Node 22.12+, pnpm 9.15+, installed dependencies, and Playwright Chromium.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run build
cp experiments/visual-qa/case.example.json experiments/visual-qa/case.json
# Edit nodeId, screenshot path, route, selectors, and fixture data first.
pnpm exec tsx packages/uimatch-cli/src/visual-qa/run.ts experiments/visual-qa/case.json
```

Results: `runtime.png`, uiMatch artifacts (`figma.png`, `impl.png`,
`diff.png`, `report.json`), and `qa-report.json`.

`VERIFIED` requires matching exact content and a successful visual gate with
**no variable-content policies**. `FAILED` means a deterministic assertion
failed. `PARTIAL` means dynamic/volatile/optional text has made pixel equality
not a valid acceptance gate. `BLOCKED` means the comparison could not run.

**Limitations:**

- This P0 captures content and comparison in separate browser contexts. An
  authenticated/stateful page must be prepared consistently; otherwise no PASS.
- Dynamic content is **not masked yet**. All visual findings in that case are
  advisory, never interpreted as parity PASS, even if the pixel ratio is small.
- No automatic Figwright MCP connection, semantic matching, axe, or functional
  E2E assertions in this prototype.
- CLI is local-loopback-only by default to avoid accidental production testing;
  remote HTTPS requires explicit `VISUAL_QA_ALLOW_REMOTE=true`.
- Do not commit screenshots containing personal data. Run only on
  disposable/staging fixtures you are authorized to inspect.
- Pin viewport, browser version, fonts, OS, and Figma export scale for reliable
  pixel comparisons. File-image bypass provides pixels, not Figma style metadata.

## P1 — Authenticated Visual QA

- `storage-state`: point `auth.path` at a Playwright storageState JSON file
  created by an authorized test login. Never commit this file.
- `ui-login`: configure test-only login URL and form selectors, referencing
  credentials by environment-variable name (not values). The runner logs in,
  verifies the protected route and role-specific landmark, creates a temporary
  storageState file, and deletes it after the comparison.
- See `auth.example.json` and test with
  `UIMATCH_CHROME_CHANNEL=chrome pnpm exec tsx experiments/visual-qa/auth-smoke.ts`.

The same storageState file is used independently by Playwright content capture
and uiMatch comparison. A route guard rejects silent redirects to login.
`UIMATCH_STORAGE_STATE_PATH`, `UIMATCH_EXPECTED_URL`, and
`UIMATCH_READY_SELECTOR` are internal bridge environment variables.

**Limits:** storageState does not capture sessionStorage, and session expiry
between captures is possible. No authenticated BP Member/Staff/Admin test has
been performed. Run only with disposable QA accounts; never commit credentials,
cookies, screenshots containing personal data, or storageState artifacts.
