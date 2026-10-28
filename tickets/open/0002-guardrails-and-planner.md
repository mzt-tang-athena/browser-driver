# 0002. Guardrails and the planner

Depends on 0001.

1. Domain allowlist: the loop refuses navigation outside the list.
2. Irreversible-action gate: before publish, pay, send, or delete, ask
   the reflex a yes/no question. On yes, pause and request approval.
3. Step cap and cost cap per run.
4. Log redaction: typed values and page text stay out of the step log, or
   are redacted, before the first real login. Decide the rule here.
5. Planner implementation on an OpenAI-compatible endpoint. Config holds
   base URL, key, and model name. The planner handles: low confidence,
   blocked pages, text to type, an option to select, a URL to open, and
   the done verification.
6. Done verification: the planner checks the page state against the
   goal. The agent stops only on a confirmed done.
