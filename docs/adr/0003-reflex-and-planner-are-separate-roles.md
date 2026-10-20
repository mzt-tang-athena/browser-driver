# 0003. Reflex and planner are separate roles behind separate interfaces

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Routine decisions ("which button to click") are frequent, cheap, and
narrow. Planning, writing text, and verifying the goal are rare, costly,
and open-ended. One model for both is slow and costly. Jev (TypeSafe
API) fits the reflex role. A general model fits the planner role. The
work repo hnry-drive already runs a Jev-compatible endpoint on Ollama,
so the reflex API shape has a local implementation too.

## Decision

We define one `ReflexProvider` interface and one `Planner` interface.
The first reflex implementation calls the TypeSafe cloud API. The first
planner implementation calls an OpenAI-compatible endpoint. Both swap by
config, not by code change. Every reflex decision returns a confidence
score. Below the threshold, the loop escalates to the planner.

## Consequences

A local Ollama model can replace the cloud reflex later by config. The
planner stays model agnostic. We keep two interfaces where one model
call could do both, because the roles differ in cost and latency. We
add a test fake for each interface from day one, so one implementation
never stands alone as proof of the contract.

## Amendment 2026-10-20

The first live reflex runs through the OpenCode Console systemone endpoint,
not the TypeSafe cloud directly. The Console serves the same Jev contract
and the key was already connected. See ADR 0006. TypeSafe's cloud stays
reachable by config, with one endpoint and key change.
