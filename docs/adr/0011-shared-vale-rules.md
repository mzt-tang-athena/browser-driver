# 0011. Use the shared Vale rules package

- **Status:** accepted
- **Date:** 2026-11-03

## Context

This repo kept its own copy of the `MyRules` styles and
`Readability/LIX`. The package `@mzt-tang-athena/vale-rules` now holds
the same rules. Two copies drift apart. A rule fix in one place leaves
the other behind.

## Decision

The repo installs `@mzt-tang-athena/vale-rules` as a dev dependency,
with a range of `^0.1.0`. `npx vale-rules sync` copies the pack into
`.vale/styles/` before Vale runs. That happens in `make lint` and in the
CI docs job. The copied files stay out of git.

We keep the `write-good` clone, because the pack does not ship it. We
keep the repo-specific overrides in `.vale.ini`, because the pack owns
the rule files, not the config.

We rejected a committed copy. A committed copy drifts from the pack, and
the drift is invisible. We rejected a git submodule. A submodule hides
its version from `package.json`.

## Consequences

One source feeds the prose rules for every repo. A rule change reaches
this repo through a package update and a sync.

A fresh clone runs `npm ci` and `npx vale-rules sync` before Vale. The
install needs a token with the `read:packages` scope. CI uses the
organization secret `VALE_RULES_TOKEN`.

The pack adds `Antithesis`, `Plain`, and `SentenceLength`. Prose that
passed before can now warn. We split the long sentences, so the tracked
markdown keeps 0 errors and 0 warnings.

## Amendment, 2026-11-12

The 0 warnings above held only for root files. `.vale.ini` used
`[**.md]`, and Vale skipped every file in a subdirectory. The glob is now
`[*.md]`. The ADRs and docs now show 24 warnings. Warnings do not fail
the lint, so they stay until someone edits those files.
