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

(filled in before moving to done/)
