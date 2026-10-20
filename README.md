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
- Loop: observe, ask the reflex, act, escalate to the planner, verify.
  The loop exists and runs one proof goal (`npm run demo`). The service,
  the web UI, and the voice parts come later
- Web UI (later): goal input, run log, live view, approvals
- Voice (later): capture on the client, goal text on the server

## Run it

- `npm install`, then `npm test` for the unit and browser tests
- `npm run demo` runs one hard-coded goal on a local fixture page and
  prints the step log. It uses the reflex test fake until the user
  sets the TypeSafe key in `.env` (see `.env.example`)
- The planner is a test fake. The real planner lands with its ticket

## Decisions

See `docs/adr/`. Start with 0001 (TypeScript), 0002 (driver as a
service), 0003 (reflex and planner roles), 0004 (event schema in the
contracts repo). Read 0005 for the loop's ported limits and the
human-input action.

## Related

- `mzt-tang-athena/contracts`: shared schemas, one package per domain
- `michaeltang-hnry/hnry-drive`: the work sibling. We port its tested
  constants and patterns: menu chunking at 24 options, escalation
  thresholds, flow recording with stable locators, per-run stats
