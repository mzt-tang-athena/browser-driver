---
id: 0007
title: Guardrails: allowlist, approval gate, caps, log redaction
created: 2026-10-28
priority: high
assignee:
pr:
depends: [0002]
---

## Spec

The loop can act, but nothing bounds it yet. Add the guardrails the
review flagged, plus the ones the original 0002 carried.

1. Domain allowlist: the loop refuses navigation outside the list. A
   click that navigates away ends the run with a clear reason.
2. Irreversible-action gate: before publish, pay, send, or delete, ask
   the reflex a yes/no question. On yes, pause and request approval.
3. Step cap and cost cap per run.
4. Log redaction: typed values and page text stay out of the step log, or
   are redacted, before the first real login. Decide the rule here and
   record it as an ADR.

## Acceptance

- [ ] A run cannot leave the allowlist
- [ ] An irreversible action pauses for approval
- [ ] Step and cost caps stop a run
- [ ] The log redaction rule is decided and applied
- [ ] Tests cover each guardrail

## Outcome

(filled in before moving to done/)
