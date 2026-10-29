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
- `npm run eval` runs seven goal scenarios in a real browser with scripted
  models. The run is deterministic and runs in CI. Add `--live` to use the
  real models for a manual check (see `evals/README.md`)
- `npm run demo` runs one hard-coded goal on a local fixture page and
  prints the step log. The reflex runs the live Jev model and the planner
  runs a live chat model through the OpenCode Console when a key resolves:
  `OPENCODE_API_KEY` in `.env`, or the local OpenCode credential store
  (see `.env.example` and ADR 0006). Without a key both run as test fakes
- `--reflex=fake` and `--planner=fake` force either fake
- The loop has guardrails. An allowlist bounds navigation, an approval gate
  pauses before an irreversible action, and step and cost caps stop a run.
  The step log masks typed values (ADR 0009). The service in ticket 0003
  turns on the gate and the allowlist
- Real goals need the service (ticket 0003) and the CLI (ticket 0009)

## Decisions

See `docs/adr/`. Start with 0001 (TypeScript), 0002 (driver as a
service), 0003 (reflex and planner roles), 0004 (event schema in the
contracts repo). Read 0005 for the loop's ported limits and the
human-input action. Read 0006 for where the live reflex runs. Read 0007
for the eval shape and 0008 for the driver port. Read 0009 for the log
masking rule.

## Related

- `mzt-tang-athena/contracts`: shared schemas, one package per domain
- A private work repo: the work sibling. We port its tested constants
  and patterns: menu chunking at 24 options, escalation thresholds, flow
  recording with stable locators, per-run stats
