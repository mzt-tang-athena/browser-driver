---
id: 0011
title: Driver port: the loop stops depending on Playwright
created: 2026-10-29
priority: high
assignee:
pr:
depends: [0002]
---

## Spec

`ReflexLoop` takes a Playwright `Page` and calls `observe` and `execute`
directly. That ties the loop to Playwright and makes every loop test start
a browser. Split the browser behind a small port.

1. Define a `Driver` interface in `src/driver/driver.ts`:
   - `observe(): Promise<Observation>`
   - `execute(action: Action): Promise<void>`
   - `settle(): Promise<void>`
2. `PlaywrightDriver` wraps a `Page` and owns the eyes and the actuator.
3. The loop takes `driver: Driver`. `loop.ts` imports no Playwright.
4. A `FakeDriver` for tests: scripted observations, recorded actions, no
   browser.
5. Keep one real-browser test for `PlaywrightDriver`.
6. The demo uses `PlaywrightDriver`.
7. Later, the HTTP driver client in ticket 0003 implements the same port.

## Acceptance

- [ ] `loop.ts` has no Playwright import
- [ ] `FakeDriver` covers done, stuck, repeat, idle, and verify paths
      without Chromium
- [ ] One real-browser test still covers eyes, actuator, and settle
- [ ] The demo behaves the same
- [ ] All tests pass

## Outcome

(filled in before moving to done/)
