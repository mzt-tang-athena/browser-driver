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

(filled in before moving to done/)
