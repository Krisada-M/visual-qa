---
name: visual-qa
description: Verify Figma-to-runtime UI conformance using Figwright exports, Playwright, uiMatch, and explicit content contracts.
---

# Visual QA — P0 workflow

1. Confirm current repo and route, Figma node ID, exact state, viewport, font,
   locale, and deterministic fixture. If unclear, report BLOCKED.
2. Use the connected Figwright MCP: get_design_context(nodeId), get_screenshot
   or save_screenshots({ nodeIds: [nodeId], outDir: ... , scale: 1 }),
   get_reactions(nodeId) when relevant. Never claim live Figma verification
   from a stale PNG.
3. Create a manifest patterned on experiments/visual-qa/case.example.json;
   set exact copy assertions for FRD-defined text. Mark member names, amounts,
   API data, and volatile clocks as variable; never silently mask those areas.
4. Run from repository root after pnpm build:
   pnpm exec tsx packages/uimatch-cli/src/visual-qa/run.ts <manifest.json>
5. Inspect qa-report.json, uiMatch report.json, reference, runtime, and diff
   images. For dynamic content, the visual comparison is advisory; check
   content constraints separately and return PARTIAL, not VERIFIED.
6. If a deterministic gate fails, provide evidence and hand it to the coding
   agent. QA itself remains read-only; a new QA pass must run after any fix.
7. Do not run against production systems or real personal data without
   explicit authorization. The script defaults to loopback URLs.

This P0 is not full behavioral or accessibility certification. Use existing
Playwright/Cypress functional suites and FRD-based acceptance tests separately.

8. On protected pages use the explicit auth config and a role-specific
   readySelector. A redirect to Login must be BLOCKED, not visually compared.
