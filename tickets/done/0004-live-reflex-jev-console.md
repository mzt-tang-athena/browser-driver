---
id: 0004
title: Run the reflex on Jev through the OpenCode Console endpoint
created: 2026-10-20
priority: high
assignee: opencode
pr:
depends: [0001]
---

## Spec

Ticket 0001 built the loop with a fake reflex because the TypeSafe key was
pending. The OpenCode Console already serves the Jev-compatible systemone
endpoint (`https://opencode.ai/inference/systemone/v1/systemone`) with
`jev-1.13` and a free `jev-1.13-free`, and the machine's OpenCode credential
store already holds a Console API key.

Wire the loop's reflex to that live endpoint:

- Rename the reflex provider to `SystemOneReflex` (the contract is
  Jev-compatible systemone, not TypeSafe-specific).
- Resolve the key: `OPENCODE_API_KEY` from the environment or `.env` first,
  then the local OpenCode credential store as a fallback. Never print it.
- Config in `.env.example`: provider switch, model, endpoint, key.
- Run the demo with the live reflex on the hard-coded goal and show the
  step log with real confidences and token counts.

## Acceptance

- [ ] `npm run demo -- --reflex=systemone` runs the goal on the live Jev model
- [ ] The step log shows real probabilities and usage from the endpoint
- [ ] Tests stay green and offline (no network in vitest)
- [ ] ADR records the provider change

## Outcome

Done on 2026-10-20, in one PR.

- The reflex runs the real Jev contract through the OpenCode Console
  endpoint (`https://opencode.ai/inference/systemone/v1/systemone`),
  default model `jev-1.13-free`. The provider class is `SystemOneReflex`.
- The key resolves from `OPENCODE_API_KEY` (env or `.env`) or, as a
  fallback, from the local OpenCode credential store. It is never printed.
- `npm run demo -- --reflex=systemone` runs the goal live: 2 reflex
  calls, about 1.3 seconds, 1109 tokens in and 124 out, cost $0 on the
  free model. Step 1 picks the right button at 100% confidence; after
  the click the done probability is 0.97 and the planner verifies.
- The TypeSafe cloud and a local Ollama (tev1) stay reachable by config
  alone. A chat-model logprob bridge was considered and dropped (ADR 0006).
- Tests stay green and offline: 31 pass. One new test locks the real
  Jev response shape into `answersByName`.
