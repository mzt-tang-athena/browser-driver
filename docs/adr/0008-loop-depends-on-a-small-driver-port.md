# 0008. The loop depends on a small Driver port

- **Status:** accepted
- **Date:** 2026-10-29

## Context

The loop called Playwright directly. Playwright is the browser library that
clicks and types. Every loop test started a browser, about fourteen seconds.

Ticket 0003 adds a service. A service needs a clean seam. A remote client
must implement the same calls as the local browser.

## Decision

The loop depends on a `Driver` port with three methods: observe, execute,
and settle. `PlaywrightDriver` implements it. The loop imports no Playwright.

The port accepts browser actions only. The run-ending kinds, done, blocked,
and human-input, never cross it.

## Consequences

Loop tests run in 20 milliseconds without a browser. The service client in
ticket 0003 and the command line client in ticket 0009 can implement the
same port.

The port adds one indirection. A remote driver pays one round trip per call.
We keep the port small for that reason.
