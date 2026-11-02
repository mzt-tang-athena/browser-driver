---
id: 0012
title: Add the worktree setup contract
created: 2026-11-02
priority: normal
assignee: opencode
pr:
depends: []
---

## Spec

The repo moved to `~/code/browser-driver/main`, but it has no worktree setup.
A new worktree starts with no `node_modules` and no `.env`, and every
worktree would use the same service port.

Add the harness-independent setup script:

- copy `.env` from the main checkout;
- install dependencies with `npm ci` when they are missing;
- assign a free port in 3100-3899;
- write `.worktree.env`;
- set `BROWSER_DRIVER_PORT` in `.env` to the assigned port.

Commit `.openchamber/project.json` so OpenChamber runs the script.

## Acceptance

- [x] the script refuses to run in the main checkout
- [x] a new worktree gets `node_modules`, `.env`, and a unique port
- [x] a second run changes nothing
- [x] shellcheck and `make lint` pass

## Outcome

Merged 2026-11-02.
A new worktree installs dependencies, gets its own port, and the service
reads that port from `.env`.
