# Local Visual QA P0 — OMP integration

This repository currently includes the uiMatch monorepo as its baseline.
The additions under `packages/uimatch-cli/src/visual-qa/` and
`experiments/visual-qa/` are the first project-specific extensions.

## OMP setup

Copy `integrations/omp/agents/ui-qa.md` to `~/.omp/agent/agents/ui-qa.md`.
Copy `integrations/omp/skills/visual-qa/SKILL.md` to
`~/.omp/agent/skills/visual-qa/SKILL.md`.

The agent references `@advisor`, so no new model role is needed for P0.
You can later map `modelRoles.qa` and switch the agent model to `@qa`
once evaluation demonstrates a need for independent routing.

The agent/skill files only guide the model; no tool permissions or
read-only enforcement is installed by copying them. Restrict the runtime
and credentials independently. This phase does not create a slash command
or automatically invoke Figwright from the CLI.

## Scope / acceptance

First validate one screen, state, and viewport with a Figwright export and
loopback runtime app. Assert known-good and deliberately mutated fixtures.
Do not call the engine VERIFIED if it only returns a score with unaligned
dynamic content. An implementation-versus-Figma style audit requires
get_design_context evidence in addition to PNG pixels.

See [experiment README](../../experiments/visual-qa/README.md) for run steps.
