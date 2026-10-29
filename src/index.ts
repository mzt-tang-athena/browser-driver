// The proof run: one hard-coded goal, the loop runs it, the step log prints.
// The reflex (Jev) and the planner (a chat model) both run live when a key
// resolves. Without a key, both run as test fakes.

import { chromium } from "playwright";
import { join } from "node:path";
import { PlaywrightDriver } from "./driver/playwright.ts";
import { ChatPlanner, OPENCODE_CHAT_BASE_URL } from "./planner/chat.ts";
import { FakePlanner } from "./planner/fake.ts";
import { FakeReflex } from "./reflex/fake.ts";
import { OPENCODE_CONSOLE_ENDPOINT, SystemOneReflex } from "./reflex/systemone.ts";
import { resolveApiKey } from "./reflex/keysource.ts";
import { ReflexLoop } from "./loop.ts";
import { newRunId, printSummary, StepLog } from "./steplog.ts";
import { loadEnv } from "./env.ts";

const GOAL = "Order a latte";

function arg(name: string): string | null {
  const equals = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (equals) return equals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

// The reflex runs live when a key resolves (env, .env, or the local OpenCode
// credential store). The fake stays the default for tests and offline runs.
function makeReflex(env: Record<string, string>, apiKey: string | null): { reflex: FakeReflex | SystemOneReflex; note: string } {
  const wanted = arg("reflex") ?? env["REFLEX_PROVIDER"] ?? null;
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
      note: "reflex: test fake (no key resolved; force live with --reflex=systemone)",
    };
  }
  if (!apiKey) throw new Error("No reflex key found. Set OPENCODE_API_KEY in .env, or connect OpenCode on this machine, or run the fake with --reflex=fake.");
  const model = env["SYSTEMONE_MODEL"] ?? "jev-1.13-free";
  const endpoint = env["SYSTEMONE_ENDPOINT"] ?? OPENCODE_CONSOLE_ENDPOINT;
  return { reflex: new SystemOneReflex({ apiKey, model, endpoint }), note: `reflex: live Jev (${model}) at ${endpoint}` };
}

// The planner runs live on the same account when a key resolves. Its fake
// approves whatever the reflex proposes, so a demo without a key proves only the loop.
function makePlanner(env: Record<string, string>, apiKey: string | null): { planner: FakePlanner | ChatPlanner; note: string } {
  const wanted = arg("planner") ?? env["PLANNER_PROVIDER"] ?? null;
  if (wanted === "fake" || (wanted === null && !apiKey)) {
    return {
      planner: new FakePlanner({ verify: () => ({ done: true, reason: "the fake planner approves the goal" }) }),
      note: "planner: test fake (no key resolved; force live with --planner=chat)",
    };
  }
  if (!apiKey) throw new Error("No planner key found. Set OPENCODE_API_KEY in .env, or connect OpenCode on this machine, or run the fake with --planner=fake.");
  const model = env["PLANNER_MODEL"] ?? "glm-5.3-flash";
  const baseUrl = env["PLANNER_BASE_URL"] ?? OPENCODE_CHAT_BASE_URL;
  return { planner: new ChatPlanner({ apiKey, model, baseUrl }), note: `planner: live chat model (${model}) at ${baseUrl}` };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const apiKey = resolveApiKey({ ...process.env, ...env });
  const { reflex, note: reflexNote } = makeReflex(env, apiKey);
  const { planner, note: plannerNote } = makePlanner(env, apiKey);

  const runDir = join("runs", newRunId());
  const log = new StepLog({ dir: runDir });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const fixture = new URL("../fixtures/latte.html", import.meta.url).href;
    await page.goto(fixture, { waitUntil: "load" });
    const driver = new PlaywrightDriver(page);

    console.log(`goal: ${GOAL}`);
    console.log(reflexNote);
    console.log(plannerNote);
    const observation = await driver.observe();
    console.log(`start page: ${observation.title} | ${observation.url}`);
    console.log("");
    console.log("step log");

    const loop = new ReflexLoop({ goal: GOAL, reflex, planner, driver, log });
    const result = await loop.run();
    printSummary(console.log, result, GOAL);
    if (log.path) console.log(`  step log file: ${log.path}`);
    if (result.outcome !== "done") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
