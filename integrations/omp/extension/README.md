# OMP visual-qa command

The optional thin OMP adapter registers `/ui-qa <suite.json>`. It sends a
request to the active coding agent to apply the Visual QA skill and run the
portable CLI. The adapter does not execute shell commands, install packages,
change files or bypass authentication itself.

Start `omp` from your visual-qa working tree:

```fish
omp --extension ./integrations/omp/extension/index.js
```

In OMP, run:

```text
/ui-qa experiments/visual-qa/suite.json
```

Alternatively copy the extension folder into
`~/.omp/agent/extensions/visual-qa` and restart OMP.

This follows the documented `pi.registerCommand` API. CI runs a registration
mock, not a live OMP launch or compatibility test against your exact OMP
installation. Confirm the command registers after installation before relying
on it for a release gate. The underlying suite remains available even if the
extension is incompatible with a particular OMP version.
