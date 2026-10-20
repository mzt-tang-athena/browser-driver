# Notes for agents working in this repo

Read `README.md` first. The ADRs in `docs/adr/` are the
decision record. The tickets in `tickets/` are the work queue.

## Rules for any change

0. Workflow: do not push to main. Work on a branch, open a PR, wait for
   CI, and squash-merge when green. Branch protection is not available on
   the free plan, so this rule is convention, not enforcement.
1. All work starts as a ticket. Claim one by moving it to `tickets/doing/`
   and filling `assignee` in the same commit. The rules live in
   `tickets/README.md`.
2. Write an ADR the same day a decision carries a trade-off: an
   alternative existed, and a future agent could plausibly reopen it.
   Copy `docs/adr/adr-template.md`, take the next free number, and record
   later changes as dated amendments at the bottom of the same file
   (never rewrite the original decision). Adjustments with no real
   alternative only need a commit.
3. Write docs in the ADR template's plain style: short sentences, active
   voice, plain words, no em dashes.
4. Keep `README.md` current. It is the source of truth for what this
   project is and what comes next.
5. Never run sudo. Never commit secrets or tokens.
