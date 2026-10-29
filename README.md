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

- Driver service: Playwright, persistent browser profiles, and a small
  HTTP API
- Loop: observe, ask the reflex, act, escalate to the planner, verify
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
  The step log masks typed values (ADR 0009). The service sets the gate and
  the allowlist for each run
- `npm run service` starts the driver service (see below)

## Service

The service runs the loop behind a small HTTP API. It needs a bearer token
and binds to loopback by default.

```sh
# shell 1
export BROWSER_DRIVER_TOKEN="$(openssl rand -hex 16)"
npm run service

# shell 2
export BROWSER_DRIVER_TOKEN="<the same token>"
curl -s -X POST http://127.0.0.1:8787/runs \
  -H "authorization: Bearer $BROWSER_DRIVER_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"goal\":\"Order a latte\",\"url\":\"file://$PWD/fixtures/latte.html\",\"allowlist\":[\"file\"]}"
```

The answer carries the run id. Read the event stream with
`GET /runs/<id>/events?follow=1`. The stream ends with `run.finished`.

| Setting | Default | Purpose |
|---|---|---|
| `BROWSER_DRIVER_TOKEN` | none, required | Bearer token for every request |
| `BROWSER_DRIVER_HOST` | `127.0.0.1` | Bind address |
| `BROWSER_DRIVER_PORT` | `8787` | Port |
| `BROWSER_DRIVER_PROFILES` | `./profiles` | Named browser profiles |
| `APPROVAL_TIMEOUT_MS` | `300000` | How long an approval waits |
| `BROWSER_DRIVER_MAX_RUNS` | `100` | Finished runs kept in memory |
| `NTFY_TOPIC` | off | Push approvals and run ends to ntfy |
| `NTFY_URL` | `https://ntfy.sh` | ntfy server |
| `NTFY_TOKEN` | none | ntfy access token |

The API is `POST /runs`, `GET /runs`, `GET /runs/:id`,
`GET /runs/:id/events`, `POST /runs/:id/approve`, `POST /runs/:id/stop`,
`GET /runs/:id/observe`, and `POST /runs/:id/act`. `GET /health` needs no
token.

A browser stays open for a run that ends `paused` or `needs-human-input`.
A client can then `observe` and `act`, and `stop` closes it. The other
outcomes close the browser at once.

### Profiles and a manual login

Pass `"profile": "work"` in the run request to keep cookies and logins in
`profiles/work`. To log in once by hand, start a headed run on the login
page (`"headed": true`). The loop asks for a human, the window stays open,
and you log in. Then `POST /runs/<id>/stop`. The profile keeps the session
for every later run.

### Live view

Headless is the default. A headed browser needs a display and a VNC
server. `docs/live-view.md` shows the Xvfb and noVNC setup for a PC and a
phone.

## Decisions

See `docs/adr/`. Start with 0001 (TypeScript), 0002 (driver as a
service), 0003 (reflex and planner roles), 0004 (event schema in the
contracts repo). Read 0005 for the loop's ported limits and the
human-input action. Read 0006 for where the live reflex runs. Read 0007
for the eval shape and 0008 for the driver port. Read 0009 for the log
masking rule, and 0010 for how the service keeps runs.

## Related

- `mzt-tang-athena/contracts`: shared schemas, one package per domain
- A private work repo: the work sibling. We port its tested constants
  and patterns: menu chunking at 24 options, escalation thresholds, flow
  recording with stable locators, per-run stats
