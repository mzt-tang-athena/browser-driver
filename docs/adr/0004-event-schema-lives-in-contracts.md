# 0004. Event schema lives in the contracts repo

- **Status:** accepted
- **Date:** 2026-10-20

## Context

The athena setup has a central `contracts` repo (Zod models, one package
per domain, consumed as a git submodule). Our rule: types go to
`contracts` when two or more separate repos need them. The browser
driver repo is one repo today, so its internal types stay local. But the
event stream has consumers in other repos from day one: ntfy, n8n, and
the dashboard read events.

## Decision

We publish the run event schema (step happened, decision made,
approval needed, run finished) as `packages/browser-driver` in the
`contracts` repo from the start. The driver API contract moves there
too, at the moment the driver becomes its own repo. Until then it
stays in this repo.

## Consequences

The outer shell never couples to loop internals. We maintain one shared
package from the start, which we accept because the consumers already
exist.
