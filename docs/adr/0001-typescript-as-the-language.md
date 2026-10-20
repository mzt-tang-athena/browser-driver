# 0001. TypeScript as the language

- **Status:** accepted
- **Date:** 2026-10-20

## Context

We build a browser driver service plus an agent loop. The driver needs mature
Playwright bindings. The loop talks to a reflex model API and a planner model
API. We also want a small web UI later. We weighed TypeScript, Python, F#,
Go, Rust, and Elixir.

## Decision

We write the whole project in TypeScript with strict types. Playwright and
MCP SDKs are first-party in TypeScript. The PWA shares the language. The
ecosystem examples we want to copy live in TypeScript first.

## Consequences

We do not learn a new language on this project. We considered F# for
functional practice, but its community is small and the agentic examples
are thin. We considered Elixir for OTP and LiveView, but it has no mature
Playwright binding, so it needs a Node sidecar anyway. Rust has no solid
Playwright binding. Python was close, but weaker typing and no first-party
MCP SDK for our use.
