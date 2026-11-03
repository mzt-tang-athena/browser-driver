---
id: 0013
title: Use the shared Vale rules package
created: 2026-11-03
priority: normal
assignee: opencode
pr:
depends: []
---

## Spec

The prose rules live in two places. This repo keeps a copy under
`.vale/styles/MyRules/` and `Readability/LIX.yml`. The shared package
`@mzt-tang-athena/vale-rules` holds the same rules, plus `Antithesis`,
`Plain`, and `SentenceLength`. Two copies drift apart.

Switch this repo to the package. This is the browser-driver step of
`contracts` ticket 0005, the rollout of the shared pack.

Add the package from GitHub Packages as a dev dependency. Commit a
`.npmrc` that reads the token from `NODE_AUTH_TOKEN`. Run
`npx vale-rules sync` before Vale in `make lint` and in the CI docs job.
Keep the `write-good` clone, because the pack does not ship it.

Delete the local `MyRules` files and `Readability/LIX.yml`. Keep the
repo-specific `.vale.ini` overrides. The pack owns the rule files, not
the config.

The new rules may warn on prose that passed before. Errors must stay at
zero. Split sentences or adjust prose where the meaning allows.

## Acceptance

- [ ] `@mzt-tang-athena/vale-rules@0.1.0` is a dev dependency
- [ ] `.npmrc` names the GitHub Packages registry and reads `NODE_AUTH_TOKEN`
- [ ] the local `MyRules` copy and `Readability/LIX.yml` are gone
- [ ] `make lint` and the CI docs job run `npx vale-rules sync` before Vale
- [ ] the same file set gives 0 errors and the warning delta is recorded
- [ ] the repo checks pass
- [ ] one PR links back to `contracts` ticket 0005

## Outcome

(filled in before moving to done/)
