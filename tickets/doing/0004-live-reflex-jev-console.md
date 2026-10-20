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

(filled in before moving to done/)
