# 0007. Evals run the real browser with scripted models

- **Status:** accepted
- **Date:** 2026-10-29

## Context

The unit tests prove the loop mechanics. They do not say whether a goal
finishes. We need a signal on every change. A wrong signal is worse than
none.

We weighed three shapes. A fake browser is fast, but it never touches the
eyes or the actuator. Real models are slow, random, and cost money on every
run. The real browser with scripted models sits between them.

CI is the automatic check on every push.

## Decision

Each eval scenario uses a local page, a real Chromium browser, and scripted
model fakes. Chromium is the browser that Playwright drives. The suite is
deterministic, runs offline, and runs in CI. A live mode swaps in the real
models for a manual check. A live failure does not fail the build.

## Consequences

The suite catches the eyes, the actuator, and the loop together. It takes
about four seconds. It needs no key and no network. It cannot judge model
quality. It cannot catch real-site changes. A fixture text change needs a
scenario update. That cost is small and visible.
