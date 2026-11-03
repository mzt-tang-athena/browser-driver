---
id: 0013
title: Use the shared Vale rules package
created: 2026-11-03
priority: normal
assignee: opencode
pr: 16
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

- [x] `@mzt-tang-athena/vale-rules@0.1.0` is a dev dependency
- [x] `.npmrc` names the GitHub Packages registry and reads `NODE_AUTH_TOKEN`
- [x] the local `MyRules` copy and `Readability/LIX.yml` are gone
- [x] `make lint` and the CI docs job run `npx vale-rules sync` before Vale
- [x] the same file set gives 0 errors and the warning delta is recorded
- [x] the repo checks pass
- [x] one PR links back to `contracts` ticket 0005

## Outcome

Done. The repo uses `@mzt-tang-athena/vale-rules@0.1.0` from GitHub
Packages. This is the browser-driver step of `contracts` ticket 0005.

`make lint` and the CI docs job run `npx vale-rules sync` before Vale.
The CI docs job now installs with `npm ci` first. Both CI jobs pass
`secrets.VALE_RULES_TOKEN` as `NODE_AUTH_TOKEN`. That is an organization
secret with visibility all, which carries a token with `read:packages`.
The `write-good` clone and the `.vale.ini` overrides stay. The synced
rule files are ignored by git. ADR 0011 records the decision.

Parity on the same tracked markdown file set (29 files):

| Run | Errors | Warnings |
| --- | --- | --- |
| Before, local rules | 0 | 1 |
| After sync, no prose edits | 0 | 6 |
| After prose edits, plus ADR 0011 and ticket 0013 | 0 | 0 |

The one before warning was `write-good.TooWordy`. The pack added 5:
1 `Antithesis` and 4 `SentenceLength`. One more `SentenceLength` showed
up on `AGENTS.md` after the first split. The prose edits fix all 6.

`npm run typecheck`, `npm test` (102 tests), `npm run eval` (7/7),
`make lint`, and a clean `npm ci` then `npx vale-rules sync` pass.
PR 16.
