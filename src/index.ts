// The proof run for ticket 0001: one hard-coded goal, the loop runs it, the step log
// prints. The reflex is the test fake until the TypeSafe key arrives; with a key, set
// TYPESAFE_API_KEY and TYPESAFE_MODEL in .env and pass --reflex typesafe.

import { chromium } from "playwright";
import { join } from "node:path";
import { observe } from "./eyes.ts";
import { FakePlanner } from "./planner/fake.ts";
import { FakeReflex } from "./reflex/fake.ts";
import { TypeSafeReflex } from "./reflex/typesafe.ts";
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

function makeReflex(env: Record<string, string>): { reflex: FakeReflex | TypeSafeReflex; note: string } {
  if (process.argv.some((arg) => arg === "--reflex=typesafe" || (arg === "--reflex" && process.argv[process.argv.indexOf(arg) + 1] === "typesafe"))) {
    const apiKey = env["TYPESAFE_API_KEY"];
    const model = env["TYPESAFE_MODEL"];
    if (!apiKey || apiKey.startsWith("placeholder")) throw new Error("The TypeSafe reflex needs a real TYPESAFE_API_KEY in .env. The demo runs the fake without one.");
    if (!model) throw new Error("Set TYPESAFE_MODEL in .env, for example TYPESAFE_MODEL=tev1.");
    const endpoint = env["TYPESAFE_ENDPOINT"];
    return { reflex: new TypeSafeReflex({ apiKey, model, endpoint }), note: "reflex: TypeSafe cloud" };
  }
  return {
    reflex: new FakeReflex({
      rules: [
        // The page shows the success state, so the reflex proposes "done" and the planner verifies it.
        { when: /latte ordered/i, done: 0.95 },
        // Otherwise the reflex picks the menu item that orders the latte.
        { pick: /order latte/i },
      ],
    }),
    note: "reflex: test fake (no TYPESAFE_API_KEY, or --reflex not set to typesafe)",
  };
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
