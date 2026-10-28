---
id: 0006
title: Prepare the repo to be public
created: 2026-10-28
priority: high
assignee: opencode
pr:
depends: [0005]
---

## Spec

The org's Actions minutes ran out, so private CI needs paid minutes and the
spending limit blocks it. A public repo gets free unlimited standard runners.

Before the visibility change:

1. Remove the private work repo's name from the README, the ADRs, the
   tickets, and the code comments. Say "a private work repo" instead.
2. Confirm the history holds no secrets and no new personal data. The
   profile already publishes the commit email.
3. Flip the repository to public.
4. Let CI run on the open PRs and merge when green.

## Acceptance

- [ ] No `hnry-drive` or `michaeltang-hnry` string in the repo
- [ ] No secrets in the working tree or the history
- [ ] The repository is public
- [ ] CI checks run and pass on the open PRs
- [ ] The open PRs merge

## Outcome

(filled in before moving to done/)
