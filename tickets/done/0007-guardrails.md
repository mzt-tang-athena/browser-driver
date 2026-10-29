---
id: 0007
title: Guardrails: allowlist, approval gate, caps, log redaction
created: 2026-10-28
priority: high
assignee: opencode
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

Done on 2026-10-29.

- Allowlist: a run may visit named hosts, plus `file` for local pages. A
  goto outside the list is refused with a `guard` record. An action that
  navigates out stops the run after the fact, with the page in the log.
- Approval gate: opt-in. For an irreversible word (publish, pay, send,
  delete, and the like), the loop asks the reflex a yes/no question. On a
  likely yes it asks the human through a callback, then runs or blocks the
  action. Gate records carry the question, the probability, and the answer.
- Caps: the step cap already existed. A cost cap now pauses the run at the
  next step boundary.
- Log masking: every value the run types is masked as `***` in the action,
  the result, and any outline that echoes it. Select labels and page text
  stay. The models still see real values; only the log masks them (ADR 0009).
- 65 tests pass, 7/7 evals, and the demo finishes done with fakes and live.
- The gate and the allowlist are off unless configured. Ticket 0003 will
  set both for each service run.
