// Tests for the reflex loop. The browser is a scripted FakeDriver, so these
// tests are fast and need no Chromium. PlaywrightDriver has its own browser test.

import { describe, expect, it } from "vitest";
import type { Driver } from "../src/driver/driver.ts";
import { ReflexLoop } from "../src/loop.ts";
import { FakePlanner } from "../src/planner/fake.ts";
import { FakeReflex } from "../src/reflex/fake.ts";
import type { Action, Planner, ReflexProvider, RunResult, StepRecord } from "../src/types.ts";
import { FakeDriver } from "./helpers/fake-driver.ts";
import { el, item, observation } from "./helpers/observations.ts";

class CaptureLog {
  readonly records: StepRecord[] = [];
  write(record: StepRecord): void {
    this.records.push(record);
  }
}

const orderButton = el("e4", "button", "Order latte");
const nameField = el("e7", "textbox", "Your name", "type");

const startPage = observation({
  fingerprint: "start",
  outline: '- button "Order latte" [ref=e4]\n- textbox "Your name" [ref=e7]',
  elements: [orderButton, nameField],
  menu: [item(orderButton)],
});

const donePage = observation({
  fingerprint: "done",
  outline: '- button "Order latte" [ref=e4]\n- textbox "Your name" [ref=e7]\n- status: Latte ordered. Thank you!',
  elements: [orderButton, nameField],
  menu: [item(orderButton)],
});

const formPage = observation({
  fingerprint: "form",
  outline: '- textbox "Your name" [ref=e7]',
  elements: [nameField],
});

const typed = (text: string) =>
  observation({
    fingerprint: `after-${text}`,
    outline: `- textbox "Your name" [ref=e7]: ${text}`,
    elements: [nameField],
  });

async function run(driver: Driver, reflex: ReflexProvider, planner: Planner, maxSteps?: number): Promise<{ result: RunResult; log: CaptureLog }> {
  const log = new CaptureLog();
  const loop = new ReflexLoop({ goal: "Order a latte", reflex, planner, driver, log, maxSteps });
  return { result: await loop.run(), log };
}

describe("the done path", () => {
  it("clicks, then verifies through the planner, and logs every step fully", async () => {
    const driver = new FakeDriver(startPage, (action) => (action.kind === "click" ? donePage : startPage));
    const reflex = new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] });
    const planner = new FakePlanner({ verify: () => ({ done: true, reason: "the page shows the ordered confirmation" }) });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(result.reason).toBe("the page shows the ordered confirmation");
    expect(log.records.map((record) => record.kind)).toEqual(["action", "verify"]);
    expect(log.records[0]?.source).toBe("fake-reflex");
    expect(log.records[0]?.probability).toBeGreaterThan(0.9);
    expect(log.records[1]?.source).toBe("fake-planner");

    const first = log.records[0] as StepRecord;
    expect(first.elements.length).toBeGreaterThan(0);
    expect(first.menu.some((entry) => entry.label.includes("Order latte"))).toBe(true);
    expect(Object.keys(first.questions ?? {})).toEqual(["next_1", "goal_done"]);
    expect(first.action?.kind).toBe("click");
    expect(first.pageAfter.title).toBe("Test page");
    expect(first.pageAfter.outline).toContain("Latte ordered");
    expect(first.options[0]?.label).toContain("Order latte");

    expect(driver.actions).toHaveLength(1);
    expect(driver.actions[0]?.kind).toBe("click");
    expect(result.stats.reflex.calls).toBe(2);
    expect(result.stats.planner.calls).toBe(1);
  });
});

describe("escalation constants", () => {
  it("pauses after 4 stuck steps and escalates to the planner after 2", async () => {
    const noop = el("e6", "button", "Read our story");
    const stuckPage = observation({ fingerprint: "stuck", outline: '- button "Read our story" [ref=e6]', elements: [noop], menu: [item(noop)] });
    const driver = new FakeDriver(stuckPage);
    const reflex = new FakeReflex({ rules: [{ pick: /read our story/i, confidence: 0.9 }] });
    const planner = new FakePlanner({ decide: () => ({ kind: "wait", label: "wait" }) });
    const { result } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("stuck");
    expect(result.stats.reflex.calls).toBe(2); // steps 1 and 2, then the planner decides
    // 4 planner calls, not 2: the planner's repeated "wait" is challenged once
    // and trusted on its second try, and every answer is one call.
    expect(result.stats.planner.calls).toBe(4);
  });

  it("pauses after 3 planner answers in a row that run nothing", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "click", ref: "e999", label: "click a button that is not there" }) });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("could not run");
    expect(result.stats.planner.calls).toBe(3);
    // The dead ends are in the step log too, not only in the history.
    const idles = log.records.filter((record) => record.kind === "idle");
    expect(idles).toHaveLength(3);
    expect(idles[0]?.result).toContain("could not run");
  });

  it("ends with needs-human-input when the planner asks a person", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "human-input", ask: "Please solve the CAPTCHA." }) });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("needs-human-input");
    expect(result.reason).toContain("CAPTCHA");
    expect(log.records.at(-1)?.action).toEqual({ kind: "human-input", ask: "Please solve the CAPTCHA." });
  });

  it("ends with blocked when the planner says so", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "blocked", reason: "the checkout is down" }) });
    const { result } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toBe("the checkout is down");
  });

  it("stops at the step limit while the planner keeps changing the page", async () => {
    const driver = new FakeDriver(formPage, (action) => (action.kind === "type" ? typed(action.text) : formPage));
    const reflex = new FakeReflex({});
    let calls = 0;
    const planner = new FakePlanner({
      decide: (): Action => {
        calls += 1;
        return { kind: "type", ref: "e7", text: calls % 2 === 1 ? "x" : "y", label: "type into the name field" };
      },
    });
    const { result, log } = await run(driver, reflex, planner, 3);

    expect(result.outcome).toBe("max-steps");
    expect(log.records.filter((record) => record.kind === "action")).toHaveLength(3);
  });

  it("waits 3 steps between two verify tries", async () => {
    const driver = new FakeDriver(startPage, (action) => (action.kind === "type" ? typed(action.text) : startPage));
    // The title matches on every page, so the reflex proposes done at every check.
    const reflex = new FakeReflex({ rules: [{ when: /test page/i, done: 0.95 }] });
    let verifies = 0;
    let decides = 0;
    const planner = new FakePlanner({
      verify: () => {
        verifies += 1;
        return verifies === 1 ? { done: false, reason: "nothing is ordered yet" } : { done: true, reason: "confirmed now" };
      },
      decide: (): Action => {
        decides += 1;
        return { kind: "type", ref: "e7", text: `x${decides}`, label: "type into the name field" };
      },
    });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(verifies).toBe(2);
    // One planner answer per cooldown step. The unique text avoids the repeat challenge.
    expect(decides).toBe(4);
    expect(log.records.filter((record) => record.kind === "verify").map((record) => record.result)).toEqual(["not yet: nothing is ordered yet", "done: confirmed now"]);
  });

  it("escalates repeats to the planner, then pauses when the same action keeps coming", async () => {
    const checkbox = el("e9", "checkbox", "Extra shot");
    const pageA = observation({ fingerprint: "a", outline: '- checkbox "Extra shot" [ref=e9]', elements: [checkbox], menu: [item(checkbox, 'toggle checkbox "Extra shot"')] });
    const pageB = observation({
      fingerprint: "b",
      outline: '- checkbox "Extra shot" [ref=e9] [checked]',
      elements: [{ ...checkbox, checked: true }],
      menu: [item(checkbox, 'toggle checkbox "Extra shot"')],
    });
    const driver = new FakeDriver(pageA, (_action, current) => (current.fingerprint === "a" ? pageB : pageA));
    const reflex = new FakeReflex({ rules: [{ pick: /extra shot/i, confidence: 0.95 }] });
    const planner = new FakePlanner({ decide: (): Action => ({ kind: "click", ref: "e9", role: "checkbox", label: 'toggle checkbox "Extra shot"' }) });
    const { result, log } = await run(driver, reflex, planner);

    // The checkbox toggles, so the page changes every time and the stuck limits never fire.
    // Only the repeat window can catch this loop.
    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("looping");
    expect(log.records.filter((record) => record.kind === "action")).toHaveLength(5);
    expect(result.stats.planner.calls).toBeGreaterThanOrEqual(4);
  });

  it("counts a planner failure as an idle answer", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({});
    const failing: Planner = {
      name: "failing-planner",
      decide: async () => {
        throw new Error("the model answered nonsense");
      },
      verify: async () => ({ done: false, reason: "no", ms: 0, usage: null, costUsd: null }),
    };
    const { result, log } = await run(driver, reflex, failing);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("could not run");
    const idles = log.records.filter((record) => record.kind === "idle");
    expect(idles).toHaveLength(3);
    expect(idles[0]?.text).toContain("planner failed");
    expect(idles[0]?.action).toBeNull();
  });

  it("adds planner calls to the cost", async () => {
    const driver = new FakeDriver(formPage, (action) => (action.kind === "type" ? typed(action.text) : formPage));
    const reflex = new FakeReflex({});
    let calls = 0;
    const pricey: Planner = {
      name: "pricey-planner",
      decide: async () => {
        calls += 1;
        return { action: { kind: "type", ref: "e7", text: `x${calls}`, label: "type into the name field" }, reason: "type", ms: 1, usage: null, costUsd: 0.25 };
      },
      verify: async () => ({ done: false, reason: "no", ms: 0, usage: null, costUsd: 0.5 }),
    };
    const { result } = await run(driver, reflex, pricey, 2);

    expect(result.outcome).toBe("max-steps");
    expect(result.stats.planner.calls).toBe(2);
    expect(result.stats.planner.costUsd).toBeCloseTo(0.5);
  });
});

describe("the step log", () => {
  it("gives every record its own sequence number", async () => {
    const driver = new FakeDriver(startPage, (action) => (action.kind === "click" ? donePage : startPage));
    const reflex = new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] });
    const planner = new FakePlanner({ verify: () => ({ done: true, reason: "confirmed" }) });
    const { log } = await run(driver, reflex, planner);

    const seqs = log.records.map((record) => record.seq);
    expect(seqs).toEqual([1, 2]);
    expect(log.records[0]?.step).toBe(1);
    expect(log.records[1]?.step).toBe(1); // the verify belongs to the step it checked
    expect(log.records[1]?.kind).toBe("verify");
  });
});
