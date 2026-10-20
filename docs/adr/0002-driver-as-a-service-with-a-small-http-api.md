# 0002. Driver as a service with a small HTTP API

- **Status:** accepted
- **Date:** 2026-10-20

## Context

The loop, the driver, and the web UI live in one repo for now. Agent
harnesses (OpenCode, pi, others) should also use the driver as a tool.
We need one integration point that survives repo splits and harness
changes.

## Decision

We build the driver as a long-running service with a small HTTP API:
observe a page, execute an action. The MCP adapter is a thin layer on
top of that API. MCP is not the core interface.

## Consequences

The loop and any harness speak to the same driver. If we later split
the driver into its own repo, the API contract moves to the `contracts`
repo and nothing else changes. We keep more moving parts than a simple
in-process library call, which we accept for the reuse.
