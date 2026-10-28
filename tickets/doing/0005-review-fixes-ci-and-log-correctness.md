---
id: 0005
title: Fix the review findings: CI checks and log correctness
created: 2026-10-28
priority: high
assignee: opencode
pr:
depends: [0001, 0004]
---

## Spec

The Oct 28 review found gaps in the build that do not need new product
decisions. Fix them here:

1. CI runs only the prose linter. Add a job that typechecks, installs
   Chromium, and runs the test suite on every push.
2. Verify and finish records reuse the last action's step number, so the
   log shows the same step twice. Give every record its own sequence number.
3. Planner answers that the loop cannot run leave no record. Log them as
   idle records.
4. A reflex response that is not JSON fails with an opaque error. Guard the
   parse and name the status and body.
5. The key store needs Node's built-in sqlite. State Node 24 as the floor.
6. The repeat limits (escalate 3, pause 5) have no direct test. Add one.

Not here, because they need decisions or belong to a queued ticket: the
real planner and guardrails (ticket 0002), the service and event schema
(ticket 0003), select and goto actions, and the log redaction policy.

## Acceptance

- [ ] CI runs typecheck and tests, and a red test fails the PR
- [ ] Every step log record has a unique sequence number
- [ ] Unrunnable planner answers appear in the step log
- [ ] A non-JSON reflex response fails with a clear message
- [ ] `engines` says Node 24 or newer
- [ ] A test covers repeat escalation and the repeat pause
- [ ] All tests, typecheck, and prose lint pass

## Outcome

(filled in before moving to done/)
