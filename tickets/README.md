# Tickets

Tickets are markdown files. They are the single work queue for humans and
agents. Any harness can claim work by moving files; no app runs the loop.

## States

The folder is the state:

- `open/` - ready to be claimed
- `doing/` - claimed, work in progress
- `done/` - finished, outcome recorded

## File format

Name: `NNNN-short-title.md`, next free number, zero padded.

```markdown
---
id: NNNN
title: Short title
created: YYYY-MM-DD
priority: high | normal | low
assignee:            # empty = unclaimed; agent or harness name when claimed
pr:                  # PR number once opened
depends: []          # ids of tickets that must finish first
---

## Spec
What and why. Concrete enough that a fresh agent with no context could do it.

## Acceptance
- [ ] one observable done condition per line

## Outcome
(filled in before moving to done/)
```

## Rules

1. Claim = `git mv` to `doing/` and fill `assignee`, one commit.
2. One ticket, one branch, one PR. A repo that pushes straight to main
   may instead close a ticket with a direct push.
3. Finish = write `Outcome`, attach `pr`, `git mv` to `done/`.
4. Tickets are never deleted. They are the project's history.
5. State lives in the folder, not in a duplicate property. Folders are
   scannable with plain `ls`.
6. Bigger than one ticket? Split it into child tickets and link them with
   `depends`. Group child tickets under a section in `README.md`. Add a
   `milestone:` property only when release grouping becomes real.
