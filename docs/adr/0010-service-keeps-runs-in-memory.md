# 0010. The service keeps runs in memory, one browser per run

- **Status:** accepted
- **Date:** 2026-10-29

## Context

Ticket 0003 turns the loop into a service. A run holds a browser, a loop,
an event stream, and sometimes a waiting human. The service can be small
or it can be a queue with a database and workers. We need the smallest
shape that serves one host, the CLI, and a phone.

## Decision

The service keeps runs in one process, in memory. Each run owns one
browser, or one persistent context when it names a profile. A restart
loses the runs.

A finished run keeps its browser open only when it ends `paused` or
`needs-human-input`. A client can then observe and act on the page, and
`stop` closes the browser. Every other outcome closes it at once.

`observe` and `act` answer 409 while the loop is using the browser. The
alternative, a shared lock, lets two clients drive one page and makes a
stuck lock likely. A clear refusal is easier to reason about.

An approval request waits 5 minutes, then counts as a denial. A future
ticket can resume runs. Until then, a run that waits forever holds a
browser.

The service keeps the last 100 finished runs and drops the oldest. A
running run is never dropped. Without this, events and browsers grow with
uptime.

Every request needs a bearer token. The service binds to loopback by
default. The event schema is mirrored from
`@mzt-tang-athena/browser-driver@0.1.0` until the package can be
installed with a GitHub token.

## Consequences

The service fits a single user, a laptop, and a phone. It has no resume,
no horizontal scale, and no history after a restart. Each of those needs
a real consumer before it earns the extra parts.

The browser per run costs memory. The approval timeout and the run cap
bound that cost.

One API serves the CLI, the future MCP adapter, and the dashboard. A new
client does not touch the loop.
