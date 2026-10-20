# 0006. The reflex runs Jev through the OpenCode Console endpoint

- **Status:** accepted
- **Date:** 2026-10-20

## Context

ADR 0003 named the TypeSafe cloud API as the first reflex host, and ticket
0001 shipped the loop with a fake reflex because that key was still pending.
The user asked whether the already-connected OpenCode key could serve the
reflex instead. The answer turned out to be yes, but not through the Go plan:
the Go endpoint serves chat models only. OpenCode's Console provider serves
the real Jev contract at `https://opencode.ai/inference/systemone/v1/systemone`
with `jev-1.13` (paid) and `jev-1.13-free` (limited time). A Console API key
is already stored on this machine by OpenCode's `/connect`.

We also weighed a chat-model bridge: send the choice questions as a prompt and
read per-option probabilities from answer-letter logprobs. We dropped it. The
Console endpoint returns the real contract with calibrated probabilities, so
the bridge adds a weaker copy of a thing we can call directly.

## Decision

The first live reflex calls the OpenCode Console systemone endpoint with
`jev-1.13-free` by default. The provider class is `SystemOneReflex`, named for
the contract, not for a vendor. Any host that serves the same contract works
by config: TypeSafe's cloud, a local Ollama with tev1, or the Console.

The key resolves in this order: `OPENCODE_API_KEY` from the environment or
`.env` first, then the local OpenCode credential store, read read-only from
OpenCode's sqlite database. The key is never printed or logged.

## Consequences

The loop runs against a real decision model today, with no new account and no
new key. The demo costs nothing on the free model, and the summary logs token
counts and the Console list price. The cost is a local dependency on
OpenCode's internal credential schema; the env var is the escape hatch when
that schema changes or when the driver runs on a machine without OpenCode.
The TypeSafe key, when it arrives, is one `.env` line: a different endpoint
and key, same code.
