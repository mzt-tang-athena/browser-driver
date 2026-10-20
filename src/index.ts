// The proof run for ticket 0001: one hard-coded goal, the loop runs it, the step log
// prints. The reflex is the test fake until the TypeSafe key arrives; with a key, set
// TYPESAFE_API_KEY and TYPESAFE_MODEL in .env and pass --reflex typesafe.

import { chromium } from "playwright";
import { join } from "node:path";
import { observe } from "./eyes.ts";
import { FakePlanner } from "./planner/fake.ts";
import { FakeReflex } from "./reflex/fake.ts";
import { OPENCODE_CONSOLE_ENDPOINT, SystemOneReflex } from "./reflex/systemone.ts";
import { resolveApiKey } from "./reflex/keysource.ts";
import { ReflexLoop } from "./loop.ts";
import { newRunId, printSummary, StepLog } from "./steplog.ts";
import { mkdirSync, readFileSync } from "node:fs";

const GOAL = "Order a latte";

function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(process.cwd(), ".env"), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--reflex=${name}`);
  if (index !== -1) return name;
  const bare = process.argv.indexOf("--reflex");
  if (bare !== -1 && process.argv[bare + 1] === name) return name;
  return null;
}

// The reflex runs live when a key resolves (env, .env, or the local OpenCode
// credential store). The fake stays the default for tests and offline runs.
function makeReflex(env: Record<string, string>): { reflex: FakeReflex | SystemOneReflex; note: string } {
  const wanted = flag("systemone") ?? flag("fake") ?? (env["REFLEX_PROVIDER"] === "systemone" || env["REFLEX_PROVIDER"] === "fake" ? env["REFLEX_PROVIDER"] : null);
  const apiKey = resolveApiKey({ ...process.env, ...env });
  if (wanted === "fake" || (wanted === null && !apiKey)) {
    return {
      reflex: new FakeReflex({
        rules: [
          // The page shows the success state, so the reflex proposes "done" and the planner verifies it.
          { when: /latte ordered/i, done: 0.95 },
          // Otherwise the reflex picks the menu item that orders the latte.
          { pick: /order latte/i },
        ],
      }),
      note: "reflex: test fake (no OPENCODE_API_KEY resolved; force live with --reflex=systemone)",
    };
  }
  if (!apiKey) {
    throw new Error("No reflex key found. Set OPENCODE_API_KEY in .env, or connect OpenCode on this machine, or run the fake with --reflex=fake.");
  }
  const model = env["SYSTEMONE_MODEL"] ?? "jev-1.13-free";
  const endpoint = env["SYSTEMONE_ENDPOINT"] ?? OPENCODE_CONSOLE_ENDPOINT;
  return { reflex: new SystemOneReflex({ apiKey, model, endpoint }), note: `reflex: live Jev at ${endpoint}` };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const { reflex, note } = makeReflex(env);
  const planner = new FakePlanner({
    verify: () => ({ done: true, reason: "the page shows the ordered confirmation for the goal drink" }),
  });

  const runDir = join("runs", newRunId());
  const log = new StepLog({ dir: runDir });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const fixture = new URL("../fixtures/latte.html", import.meta.url).href;
    await page.goto(fixture, { waitUntil: "load" });

    console.log(`goal: ${GOAL}`);
    console.log(note);
    const observation = await observe(page);
    console.log(`start page: ${observation.title} | ${observation.url}`);
    console.log("");
    console.log("step log");

    const loop = new ReflexLoop({ goal: GOAL, reflex, planner, page, log });
    const result = await loop.run();
    printSummary(console.log, result, GOAL);
    if (log.path) console.log(`  step log file: ${log.path}`);
    mkdirSync(runDir, { recursive: true });
    if (result.outcome !== "done") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
