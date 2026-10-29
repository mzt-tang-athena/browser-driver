# Evals

The evals run whole goals in a real browser. They answer one question: does
the loop finish the goal, at what cost, and in how many steps?

Unit tests prove mechanics. These scenarios prove behavior.

## Run

```
npm run eval          # scripted models, deterministic, runs in CI
npm run eval -- --live  # real Jev and planner, for a manual check
```

The deterministic run uses the test fakes from `src/`. It needs no key and no
network. It runs on every push and fails the build when a scenario's outcome
changes.

The live run uses the real models. It needs `OPENCODE_API_KEY`, or a connected
OpenCode on the machine. Live outcomes are informational: the runner prints
the table but does not fail. It prints `DIFF` where the real models reach a
different outcome than the scripted ones.

Two differences are known and expected:

- `repeat`: the real model reads the page and says the goal is done. The
  scripted run forces the stuck limit. Both are correct for their setup.
- `goto`: the goal does not name a URL, so the real planner asks for one.
  The scripted run knows the target URL.

## Scenarios

| Scenario | Page | What it proves |
|---|---|---|
| `click-through` | one button | The reflex picks the action and the planner verifies done |
| `form` | name, size, place order | The planner types, selects, clicks, and finishes |
| `select` | shipping select | An option is chosen and saved |
| `dialog` | a modal | The menu follows the page into a dialog |
| `error` | an alert | The planner blocks on a broken page |
| `repeat` | a button with no handler | A no-op button ends in a pause, not an endless loop |
| `goto` | a page with no controls | The planner opens another page |

## Metrics

- `outcome`: done, blocked, paused, max-steps, or error.
- `steps`: browser actions the loop ran.
- `reflex`, `planner`: model calls.
- `cost`: dollars, from the provider prices. Scripted models are free.
- `ms`: wall time for the scenario, including the page load.

## Add a scenario

1. Add a page under `evals/fixtures/`.
2. Add an entry in `evals/scenarios.ts` with a goal, the fixture, the expected
   outcome, and the scripted models.
3. Run `npm run eval` and check the row.

Keep the page local and free of personal data. A scenario must not need the
network.

## Results

Each run writes `evals/runs/<stamp>/`:

- `results.json`: the table as data.
- `<scenario>.jsonl`: the full step records.

Both are gitignored. On a failure, the console prints the scenario, the
expected and actual outcomes, and the step log path.

## What it cannot catch

- Pages that need vision: canvas, images without roles, and closed shadow DOM.
- Real-site variation: network latency, A/B pages, and bot checks.
- Prompt or model regressions unless you run `--live`.
- One-off flake: a deterministic run hides timing bugs that a live model meets.
