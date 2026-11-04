---
id: 0014
title: Keep the package token out of the repo
created: 2026-11-04
priority: high
assignee: opencode
pr: 17
depends: []
---

## Spec

The install path told people to use `gh auth token` as the package token.
That token can carry `repo`, `admin:org`, and `write:packages` access.
A package read needs only `read:packages`.

The repo `.npmrc` also held an `_authToken` line that named an
environment variable. When the variable is unset, npm sends the literal
text, so a token in the user config never applies.

Remove the token line from `.npmrc`.
Read the token from the user-level `~/.npmrc`.
Make CI write the `VALE_RULES_TOKEN` secret into the runner's npm config.

## Acceptance

- [x] `.npmrc` names the registry and holds no token line
- [x] `README.md` points at the user-level `~/.npmrc`
- [x] both CI jobs authenticate from `VALE_RULES_TOKEN`

## Outcome

Pull request [#17](https://github.com/mzt-tang-athena/browser-driver/pull/17) carries the change.
