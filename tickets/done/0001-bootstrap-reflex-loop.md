---
id: 0001
title: Bootstrap the reflex loop
created: 2026-10-20
priority: high
assignee: opencode
pr: 1
depends: []
---

# 0001. Bootstrap the reflex loop

Build the first end-to-end loop and prove it on one simple goal.

Steps:

1. Set up the TypeScript project: `pnpm` or `npm`, strict tsconfig, vitest.
2. Write the `ReflexProvider` and `Planner` interfaces, plus a test fake
   for each.
3. Implement the TypeSafe cloud reflex provider
   (`POST https://api.typesafe.ai/v1/systemone`).
4. Implement the eyes: Playwright accessibility snapshot to a numbered
   element list. Follow the hnry-drive limits: max 24 options per choice
   question, labels truncated at 90 chars, escape option per chunk.
5. Implement the actuator: click, type, scroll, wait, done, blocked,
   human-input (new action type).
6. Wire the loop with the hnry-drive constants: escalate after 2 stuck
   steps, repeat window 10, idle answers pause after 3, verify cooldown
   3 steps.
7. Log every step fully: element list, questions, answers, confidences,
   action, page after.
8. One simple hard-coded goal to prove the loop. Log the decider versus
   planner counts and cost.

## Outcome

Done on 2026-10-20, in one PR. All eight steps are in.

- Project: npm, strict TypeScript (`noUncheckedIndexedAccess` on), vitest.
  30 tests pass, including real-browser tests for the eyes and the loop.
- Interfaces: `ReflexProvider` and `Planner` in `src/types.ts`, with a rule
  based reflex fake and an injectable planner fake.
- Reflex: `TypeSafeReflex` posts to `https://api.typesafe.ai/v1/systemone`
  with a bearer key. The key is pending, so `.env.example` holds a
  placeholder and the demo runs the fake. The live API path is untested
  until the key arrives.
- Eyes: AI-mode aria snapshot parser (ported from hnry-drive), numbered
  element list, click menu with the 24-option chunk limit, the "other"
  escape option, and 90-char labels.
- Actuator: click, type, scroll, wait, done, blocked, and the new
  human-input kind, which ends the run with `needs-human-input` (ADR 0005).
- Loop: the ported constants (stuck 2 and 4, repeat window 10 with
  escalate 3 and pause 5, idle pause 3, verify cooldown 3) plus the
  one-chance repeat challenge for planner answers.
- Step log: every step prints fully (element list, questions, answers,
  confidences, action, page after) and lands in `runs/<id>/steps.jsonl`.
- Proof: `npm run demo` runs the goal "Order a latte" on
  `fixtures/latte.html`. Outcome done: 2 reflex calls, 1 planner call,
  full step log printed.

Decisions of the day are in ADR 0005.
