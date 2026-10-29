# 0009. Step logs mask the values a run types

- **Status:** accepted
- **Date:** 2026-10-29

## Context

The step log writes what the run did and what the page showed. A review
found that passwords and personal data land in `runs/`. The log is useful
for debugging, so dropping all of it costs a lot.

We weighed three rules:

1. Mask the values the run types.
2. Drop all free page text from the log.
3. Keep everything and treat `runs/` as sensitive.

The user chose the first rule.

## Decision

The step log masks every value the run types. It masks the action line, the
step result, and any page outline that echoes the value. Select labels and
other page text stay.

The models still read the real values. Only the log masks them. `runs/`
stays local and gitignored.

## Consequences

The log keeps the shape of the run: pages, elements, actions, costs. A
typed secret does not reach the log.

Page text can still hold personal data from the site. Treat `runs/` as
sensitive. A value that the page shows and that the run did not type stays
in the log.
