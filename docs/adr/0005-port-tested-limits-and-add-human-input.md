# 0005. The loop ports hnry-drive's tested limits and gains a human-input action

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Ticket 0001 bootstraps the reflex loop. The work repo `michaeltang-hnry/hnry-drive`
runs a similar loop in production. Its constants are tested: at most 24 options
per choice question, menu parts with an escape option, labels cut at 90
characters, stuck escalate at 2 and pause at 4, repeat window 10 with escalate
at 3 and pause at 5, idle planner answers pause at 3, verify cooldown 3 steps.

We had to decide how much of that to port on day one, and what to do when the
agent cannot go on. The planner is a test fake for now, and the reflex runs the
TypeSafe cloud API once the key arrives.

## Decision

We port the tested limits as one constants block in `src/limits.ts`, and the
loop logic around them from `lib/agent.mjs`: stuck steps, repeat counting, the
one-chance repeat challenge for planner answers, and the verify cooldown.

The eyes use Playwright's AI-mode aria snapshot. The actuator locates elements
with the snapshot refs (`aria-ref=e12`). We port the parser from hnry-drive.

We add one action kind hnry-drive does not have: `human-input`. When the agent
needs a person, the loop logs the request and ends the run with the outcome
`needs-human-input`. We reject blocking and polling for now, because no
interactive harness exists yet.

The reflex only picks menu items, so it can only produce clicks. The planner
writes all text. We defer hnry-drive's field-value questions (`mapFields`),
because the bootstrap has no test values to offer the model.

The reflex state cuts the page outline once, to a character budget from the
8192-token context guess. We defer hnry-drive's per-question token fitting and
retry, until we know the cloud API's usage reporting.

## Consequences

The loop starts with limits that already work elsewhere, not with guesses. The
constants live in one file, so a future ADR can tune them in one place. A run
that needs a person stops cleanly and says why in the log. When the driver
service grows a UI, `human-input` turns into a paused run that waits for an
answer; the action shape does not change.
