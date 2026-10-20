# browser-driver

A browser driver service for agents that browse and act on the web.
Playwright does the acting. A reflex model (Jev API) makes the routine
decisions. A planner model handles hard steps, writes text, and verifies
the goal.

## Why

Agents that drive a browser with a big model alone are slow and costly.
Most browsing decisions are small. A cheap reflex model answers them,
and the planner only steps in when needed. That split makes browser
agents faster and cheaper by about ten times.

## Parts

- Driver service: Playwright, persistent browser profiles, a small HTTP
  API, and an MCP adapter
- Loop: observe, ask the reflex, act, escalate to the planner, verify
- Web UI (later): goal input, run log, live view, approvals
- Voice (later): capture on the client, goal text on the server

## Decisions

See `docs/adr/`. Start with 0001 (TypeScript), 0002 (driver as a
service), 0003 (reflex and planner roles), 0004 (event schema in the
contracts repo).

## Related

- `mzt-tang-athena/contracts`: shared schemas, one package per domain
- `michaeltang-hnry/hnry-drive`: the work sibling. We port its tested
  constants and patterns: menu chunking at 24 options, escalation
  thresholds, flow recording with stable locators, per-run stats
