// The eval runner: run every scenario in a real browser and report what
// happened. The models are scripted by default, so the result is deterministic.
// `--live` swaps in the real reflex and planner for a manual check.

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlaywrightDriver } from "../src/driver/playwright.ts";
import { loadEnv } from "../src/env.ts";
import { ReflexLoop } from "../src/loop.ts";
import { ChatPlanner, OPENCODE_CHAT_BASE_URL } from "../src/planner/chat.ts";
import { OPENCODE_CONSOLE_ENDPOINT, SystemOneReflex } from "../src/reflex/systemone.ts";
import { resolveApiKey } from "../src/reflex/keysource.ts";
import type { Outcome, StepRecord } from "../src/types.ts";
import { scenarios, type ScenarioModels } from "./scenarios.ts";

interface ScenarioResult {
  name: string;
  expected: Outcome;
  outcome: Outcome;
  pass: boolean;
  reason: string | null;
  steps: number;
  reflexCalls: number;
  plannerCalls: number;
  costUsd: number;
  ms: number;
  log: string;
}

class Collector {
  readonly records: StepRecord[] = [];
  write(record: StepRecord): void {
    this.records.push(record);
  }
}

function liveModels(apiKey: string): ScenarioModels {
  const reflexModel = process.env["SYSTEMONE_MODEL"] ?? "jev-1.13-free";
  const reflexEndpoint = process.env["SYSTEMONE_ENDPOINT"] ?? OPENCODE_CONSOLE_ENDPOINT;
  const plannerModel = process.env["PLANNER_MODEL"] ?? "glm-5.3-flash";
  const plannerBase = process.env["PLANNER_BASE_URL"] ?? OPENCODE_CHAT_BASE_URL;
  return {
    reflex: new SystemOneReflex({ apiKey, model: reflexModel, endpoint: reflexEndpoint }),
    planner: new ChatPlanner({ apiKey, model: plannerModel, baseUrl: plannerBase }),
  };
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = join("evals", "runs", stamp);
mkdirSync(runDir, { recursive: true });

function printTable(rows: ScenarioResult[], mode: string): void {
  const headers = ["scenario", "expected", "outcome", "steps", "reflex", "planner", "cost", "ms", "ok"];
  const body = rows.map((row) => [
    row.name,
    row.expected,
    row.outcome,
    String(row.steps),
    String(row.reflexCalls),
    String(row.plannerCalls),
    `$${row.costUsd.toFixed(4)}`,
    String(row.ms),
    row.pass ? "yes" : "NO",
  ]);
  const widths = headers.map((header, column) => Math.max(header.length, ...body.map((row) => (row[column] as string).length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column] as number)).join("  ").trimEnd();
  console.log(`evals: ${rows.length} scenarios, mode ${mode}`);
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of body) console.log(line(row));
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const env = loadEnv();
  const apiKey = resolveApiKey({ ...process.env, ...env });
  if (live && !apiKey) {
    console.error("--live needs a key: set OPENCODE_API_KEY, or connect OpenCode on this machine.");
    process.exitCode = 2;
    return;
  }

  console.log(live ? "live mode: real models, outcomes are informational" : "deterministic mode: scripted models, no network");
  const browser = await chromium.launch();
  const results: ScenarioResult[] = [];
  try {
    for (const scenario of scenarios) {
      const page = await browser.newPage();
      const started = Date.now();
      const logPath = join(runDir, `${scenario.name}.jsonl`);
      try {
        await page.goto(new URL(`./fixtures/${scenario.fixture}`, import.meta.url).href, { waitUntil: "load" });
        const driver = new PlaywrightDriver(page);
        const models = live ? liveModels(apiKey as string) : scenario.fake();
        const collector = new Collector();
        const loop = new ReflexLoop({ goal: scenario.goal, reflex: models.reflex, planner: models.planner, driver, log: collector, maxSteps: scenario.maxSteps });
        const result = await loop.run();
        writeFileSync(logPath, collector.records.map((record) => JSON.stringify(record)).join("\n"));
        results.push({
          name: scenario.name,
          expected: scenario.expect,
          outcome: result.outcome,
          pass: result.outcome === scenario.expect,
          reason: result.reason,
          steps: result.steps.filter((record) => record.kind === "action").length,
          reflexCalls: result.stats.reflex.calls,
          plannerCalls: result.stats.planner.calls,
          costUsd: (result.stats.reflex.costUsd ?? 0) + result.stats.planner.costUsd,
          ms: Date.now() - started,
          log: logPath,
        });
      } catch (error) {
        results.push({
          name: scenario.name,
          expected: scenario.expect,
          outcome: "error",
          pass: false,
          reason: error instanceof Error ? error.message : String(error),
          steps: 0,
          reflexCalls: 0,
          plannerCalls: 0,
          costUsd: 0,
          ms: Date.now() - started,
          log: logPath,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  printTable(results, live ? "live" : "fake");
  const passed = results.filter((result) => result.pass).length;
  console.log(`${passed}/${results.length} passed`);
  for (const failure of results.filter((result) => !result.pass)) {
    console.log(`FAIL ${failure.name}: expected ${failure.expected}, got ${failure.outcome}${failure.reason ? ` - ${failure.reason}` : ""}`);
    console.log(`  step log: ${failure.log}`);
  }
  const resultsPath = join(runDir, "results.json");
  writeFileSync(resultsPath, JSON.stringify({ mode: live ? "live" : "fake", startedAt: stamp, results }, null, 2));
  console.log(`results: ${resultsPath}`);
  if (live) console.log("live mode does not fail the run; read the table.");
  else if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
