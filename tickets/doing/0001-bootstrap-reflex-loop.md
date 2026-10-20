---
id: 0001
title: Bootstrap the reflex loop
created: 2026-10-20
priority: high
assignee: opencode
pr:                  # PR number once opened
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
