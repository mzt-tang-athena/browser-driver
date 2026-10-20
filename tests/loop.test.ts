// Tests for the reflex loop: the done path, every escalation constant, and the
// full step record (ticket 0001 steps 6 to 8).

import { chromium, type Browser, type Page } from "playwright";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakePlanner } from "../src/planner/fake.ts";
import { FakeReflex } from "../src/reflex/fake.ts";
import { ReflexLoop } from "../src/loop.ts";
import type { Action, Observation, RunResult, StepRecord } from "../src/types.ts";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

async function freshPage(): Promise<Page> {
  const page = await browser.newPage();
  const fixture = new URL("../fixtures/latte.html", import.meta.url).href;
  await page.goto(fixture, { waitUntil: "load" });
  return page;
}

class CaptureLog {
  readonly records: StepRecord[] = [];
  write(record: StepRecord): void {
    this.records.push(record);
  }
}

async function run(page: Page, reflex: FakeReflex, planner: FakePlanner, maxSteps?: number): Promise<{ result: RunResult; log: CaptureLog }> {
  const log = new CaptureLog();
  const loop = new ReflexLoop({ goal: "Order a latte", reflex, planner, page, log, maxSteps });
  return { result: await loop.run(), log };
}

const nameRef = (observation: Observation): string => {
  const ref = observation.elements.find((element) => element.name === "Your name")?.ref;
  if (!ref) throw new Error("the name field is missing from the observation");
  return ref;
};

describe("the done path", () => {
  it("clicks, then verifies through the planner, and logs every step fully", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] });
    const planner = new FakePlanner({ verify: () => ({ done: true, reason: "the page shows the ordered confirmation" }) });
    const { result, log } = await run(page, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(result.reason).toBe("the page shows the ordered confirmation");
    expect(log.records.map((record) => record.kind)).toEqual(["action", "verify"]);
    expect(log.records[0]?.source).toBe("fake-reflex");
    expect(log.records[0]?.probability).toBeGreaterThan(0.9);
    expect(log.records[1]?.source).toBe("fake-planner");

    const first = log.records[0] as StepRecord;
    expect(first.elements.length).toBeGreaterThan(0);
    expect(first.menu.some((item) => item.label.includes("Order latte"))).toBe(true);
    expect(Object.keys(first.questions ?? {})).toEqual(["next_1", "goal_done"]);
    expect(first.action?.kind).toBe("click");
    expect(first.pageAfter.title).toBe("Bean Counter Cafe");
    expect(first.pageAfter.outline).toContain("Latte ordered");
    expect(first.options[0]?.label).toContain("Order latte");

    expect(result.stats.reflex.calls).toBe(2);
    expect(result.stats.planner.calls).toBe(1);
  });
});

describe("escalation constants", () => {
  it("pauses after 4 stuck steps and escalates to the planner after 2", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({ rules: [{ pick: /read our story/i, confidence: 0.9 }] });
    const planner = new FakePlanner({ decide: () => ({ kind: "wait", label: "wait" }) });
    const { result } = await run(page, reflex, planner);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("stuck");
    expect(result.stats.reflex.calls).toBe(2); // steps 1 and 2, then the planner decides
    // 4 planner calls, not 2: the planner's repeated "wait" is challenged once (hnry-drive's
    // repeat challenge) and trusted on its second try, and every answer is one call.
    expect(result.stats.planner.calls).toBe(4);
  });

  it("pauses after 3 planner answers in a row that run nothing", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "click", ref: "e999", label: "click a button that is not there" }) });
    const { result } = await run(page, reflex, planner);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("could not run");
    expect(result.stats.planner.calls).toBe(3);
  });

  it("ends with needs-human-input when the planner asks a person", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "human-input", ask: "Please solve the CAPTCHA." }) });
    const { result, log } = await run(page, reflex, planner);

    expect(result.outcome).toBe("needs-human-input");
    expect(result.reason).toContain("CAPTCHA");
    expect(log.records.at(-1)?.action).toEqual({ kind: "human-input", ask: "Please solve the CAPTCHA." });
  });

  it("ends with blocked when the planner says so", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "blocked", reason: "the checkout is down" }) });
    const { result } = await run(page, reflex, planner);

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("the checkout is down");
  });

  it("stops at the step limit while the planner keeps changing the page", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({});
    let calls = 0;
    const planner = new FakePlanner({
      decide: (input): Action => {
        calls += 1;
        const text = calls % 2 === 1 ? "x" : "y";
        return { kind: "type", ref: nameRef(input.observation), text, label: "type into the name field" };
      },
    });
    const { result, log } = await run(page, reflex, planner, 3);

    expect(result.outcome).toBe("max-steps");
    expect(log.records.filter((record) => record.kind === "action")).toHaveLength(3);
  });

  it("waits 3 steps between two verify tries", async () => {
    const page = await freshPage();
    const reflex = new FakeReflex({ rules: [{ when: /order latte/i, done: 0.95 }] });
    let verifies = 0;
    let decides = 0;
    const planner = new FakePlanner({
      verify: () => {
        verifies += 1;
        return verifies === 1 ? { done: false, reason: "nothing is ordered yet" } : { done: true, reason: "confirmed now" };
      },
      decide: (input): Action => {
        decides += 1;
        const text = decides % 2 === 1 ? "x" : "y";
        return { kind: "type", ref: nameRef(input.observation), text, label: "type into the name field" };
      },
    });
    const { result, log } = await run(page, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(verifies).toBe(2);
    // The cooldown steps need at least one planner answer each; the repeat challenge can add more.
    expect(decides).toBeGreaterThanOrEqual(3);
    expect(log.records.filter((record) => record.kind === "verify").map((record) => record.result)).toEqual(["not yet: nothing is ordered yet", "done: confirmed now"]);
  });
});
