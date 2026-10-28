---
id: 0002
title: Real planner and the actions it needs
created: 2026-10-20
priority: high
assignee: opencode
pr:
depends: [0001]
---

## Spec

The planner is a test fake. Build the real one, on an OpenAI-compatible
chat endpoint. This ticket covers the planner and the browser actions it
needs. The guardrails move to ticket 0007.

1. Chat planner client: base URL, key, and model from config. The first
   target is the OpenCode Console chat endpoint, so it reuses the same
   account as the reflex.
2. The planner handles low confidence, blocked pages, text to type, an
   option to select, a URL to open, and the done verification.
3. Add the `select` and `goto` action kinds. The actuator runs both.
4. Done verification: the planner checks the page against the goal. The
   run stops only on a confirmed done.
5. Every planner answer is typed and validated. A malformed answer gets
   one retry, then counts as an idle answer.
6. Planner calls log their token use and cost, like the reflex.

## Acceptance

- [ ] `npm run demo` runs the goal with the real planner verifying
- [ ] The planner can click, type, select, open a URL, scroll, wait,
      finish, block, and ask for a person
- [ ] A malformed planner answer is retried once, then logged as idle
- [ ] The step log shows planner cost and tokens
- [ ] Tests stay green and offline
- [ ] README and the env example list the planner config

## Outcome

Done on 2026-10-28, in one PR.

- `ChatPlanner` runs on an OpenAI-compatible chat endpoint. The default is
  the OpenCode Console chat model `glm-5.3-flash`, so it uses the same key
  as the reflex.
- Answers are one JSON object. Each action is validated against the page:
  the ref must exist, a click must be in the menu, a select option must be
  listed, a URL must resolve. A bad answer gets one retry, then counts as
  an idle answer.
- The planner handles click, type, select, goto, scroll, wait, done,
  blocked, and human-input.
- New `select` and `goto` action kinds. The actuator runs both, and the
  eyes now carry select options.
- Done verification is real. The demo finishes only after the chat model
  confirms the success state.
- Planner tokens and cost are logged. The live demo: 1 verify call,
  5079 ms, $0.0001.
- A planner failure or a failed verify is an idle answer, not the end of
  the run. Three in a row pause the run.
- 49 tests pass, with offline tests for every action shape and the error
  paths.
- Gap: the loop asks the planner only on low confidence, stuck, or repeat.
  Proactive field filling needs its own phase, now ticket 0008.
