# project-template

Skeleton for new mzt-tang-athena projects. Create a repo with
"Use this template", rename the title lines, and start.

## What is inside

- `README.md` - what the project is, and what comes next (the plan)
- `AGENTS.md` - rules for agents: PR flow, tickets, ADRs
- `docs/adr/` - decision record; copy `adr-template.md` per decision
- `tickets/` - the work queue; the rules live in `tickets/README.md`
- `.github/workflows/ci.yml` - prose lint for README and ADRs
- `.vale.ini` and `.vale/styles/` - the writing rules

## Conventions

Decisions with trade-offs get an ADR the same day. All work starts as a
ticket. Agent rules enforce both, not tooling. When a rule keeps getting
missed, add a CI check for it then.

## Plan

One paragraph: what this project is and who it serves. Then the phases:

1. Phase one, one line.
2. Phase two, one line.

Tickets queue the work: `tickets/open/`.
