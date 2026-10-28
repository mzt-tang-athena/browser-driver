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

- [ ] No name of the private work repo anywhere in the repo
- [ ] No secrets in the working tree or the history
- [ ] The repository is public
- [ ] CI checks run and pass on the open PRs
- [ ] The open PRs merge

## Outcome

Done on 2026-10-28, in one PR.

- The private work repo's name is gone from the README, the ADRs, the
  tickets, and the code comments. They say "the work repo" instead.
- The history holds no secrets. The two 48-character strings in
  `package-lock.json` are npm sha512 integrity hashes. The commit email
  already appears on the owner's public GitHub profile.
- The repository is public. Standard runners are free and unlimited, so
  the org's exhausted Actions minutes no longer block CI.
- CI on PR #3 passed after the flip: checks in 42-46 seconds (typecheck,
  Chromium, 36 tests) and docs in 6-8 seconds. PR #3 merged.
- Why private CI broke: the org used 2,253 minutes in October, mostly on
  `athena-infra`, past the 2,000 included minutes. Paid minutes were
  blocked by the spending limit or a failed payment.
