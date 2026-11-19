---
title: Pin the write-good style clone
created: 2026-11-19
priority: high
assignee: pstack
pr: 
depends: []
---

## Spec

Both fetch sites clone `errata-ai/write-good` at HEAD, unpinned. Upstream
commit `533ce6e` on 2026-11-19 regenerated its rule lists and raises about
650 alerts on our docs, so every docs lint broke at once.

Pin both sites to `c9ceca7f574248a201d5524b001099c5626c7519` (2025-05-23),
the last good commit. A depth-1 clone cannot check out an old commit, so
`git init` and fetch the exact SHA instead. The flatten and `extends` filter
steps stay as they are.

## Acceptance

- [x] `ensure-styles` fetches the pinned SHA, then flattens and filters as before.
- [x] The CI "Fetch write-good styles" step fetches the same SHA.
- [x] With `.vale/styles/write-good` deleted, `make lint` fetches `c9ceca7` and passes.
- [x] `scripts/gate.sh fast` passes on the PR head.

## Outcome
