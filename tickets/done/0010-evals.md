---
id: 0010
title: Evals: measure whether real goals finish
created: 2026-10-29
priority: high
assignee: opencode
pr:
depends: [0011]
---

## Spec

Unit tests prove mechanics. Nothing measures whether a goal finishes, at
what cost, or whether a prompt change made things worse. Add a small eval
suite.

1. Scenarios on local fixture pages, with a real browser and fake models:
   click-through, form fill, select, dialog, error page, repeat trap, and
   a goto.
2. One runner: `npm run eval`. Deterministic by default. `--live` runs the
   real models for a manual check.
3. Metrics per scenario: outcome, steps, reflex calls, planner calls,
   cost, and wall time.
4. Pass or fail each scenario against an expected outcome.
5. Save the JSON under `evals/runs/` (gitignored) and print a table.
6. CI runs the deterministic suite.

## Acceptance

- [ ] Six or more scenarios
- [ ] The deterministic suite passes in CI with no network
- [ ] The table shows the metrics
- [ ] Docs explain how to add a scenario and how to run live
- [ ] A failure names the scenario and the expected and actual outcome

## Outcome

Done on 2026-10-29.

- Seven scenarios: click-through, form, select, dialog, error, repeat, goto.
  Each uses a local page, a real browser, and scripted models.
- `npm run eval` is deterministic and offline. Three runs in a row passed
  7/7 with no flake; the suite takes about 4 seconds.
- `--live` swaps in the real Jev and planner. It prints the table and does
  not fail the run. Form and select need ticket 0008 before they pass live.
- Metrics per scenario: outcome, action steps, reflex calls, planner calls,
  cost, and wall time. A failure prints the scenario, the expected and
  actual outcomes, and the step log path.
- Results go to `evals/runs/<stamp>/` as `results.json` plus one step log
  per scenario. The folder is gitignored.
- CI runs the deterministic suite after the tests.
- Docs are in `evals/README.md`, with how to add a scenario and what the
  suite cannot catch. README lists the command.
- 51 tests, typecheck, prose lint, and the eval suite pass.
