// Tests for the reflex loop. The browser is a scripted FakeDriver, so these
// tests are fast and need no Chromium. PlaywrightDriver has its own browser test.

import { describe, expect, it } from "vitest";
import type { Driver } from "../src/driver/driver.ts";
import { ReflexLoop } from "../src/loop.ts";
import type { LoopOptions } from "../src/loop.ts";
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
  outline: '- button "Order latte" [ref=e4]',
  elements: [orderButton],
  menu: [item(orderButton)],
});

const donePage = observation({
  fingerprint: "done",
  outline: '- button "Order latte" [ref=e4]\n- status: Latte ordered. Thank you!',
  elements: [orderButton],
  menu: [item(orderButton)],
});

// A page with a field, for the tests that type outside the field phase.
const cooldownStart = observation({
  fingerprint: "start",
  outline: '- button "Order latte" [ref=e4]\n- textbox "Your name" [ref=e7]',
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
    elements: [{ ...nameField, value: text }],
  });

async function run(
  driver: Driver,
  reflex: ReflexProvider,
  planner: Planner,
  options: Partial<Pick<LoopOptions, "maxSteps" | "fillFields" | "allowlist" | "gate" | "costCapUsd">> = {},
): Promise<{ result: RunResult; log: CaptureLog }> {
  const log = new CaptureLog();
  const loop = new ReflexLoop({
    goal: "Order a latte",
    reflex,
    planner,
    driver,
    log,
    maxSteps: options.maxSteps,
    fillFields: options.fillFields,
    allowlist: options.allowlist,
    gate: options.gate,
    costCapUsd: options.costCapUsd,
  });
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
    const { result, log } = await run(driver, reflex, planner, { maxSteps: 3, fillFields: false });

    expect(result.outcome).toBe("max-steps");
    expect(log.records.filter((record) => record.kind === "action")).toHaveLength(3);
  });

  it("waits 3 steps between two verify tries", async () => {
    const driver = new FakeDriver(cooldownStart, (action) => (action.kind === "type" ? typed(action.text) : cooldownStart));
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
    const { result, log } = await run(driver, reflex, planner, { fillFields: false });

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
      fill: async () => ({ fields: [], reason: "none", ms: 0, usage: null, costUsd: null }),
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
      fill: async () => ({ fields: [], reason: "none", ms: 0, usage: null, costUsd: null }),
    };
    const { result } = await run(driver, reflex, pricey, { maxSteps: 2, fillFields: false });

    expect(result.outcome).toBe("max-steps");
    expect(result.stats.planner.calls).toBe(2);
    expect(result.stats.planner.costUsd).toBeCloseTo(0.5);
  });
});

describe("the field phase", () => {
  const sizeSelect = el("e8", "combobox", "Size", "select", { options: ["Small", "Large"], value: "Small" });
  const placeButton = el("e9", "button", "Place order");

  const form = (name: string, size: string, placed = false) =>
    observation({
      fingerprint: `form-${name}-${size}-${placed}`,
      outline: [
        `- textbox "Your name" [ref=e7]${name ? ` = "${name}"` : ""}`,
        `- combobox "Size" [ref=e8] = "${size}" options: Small | Large`,
        '- button "Place order" [ref=e9]',
        placed ? `- status: Order placed for ${name} (${size})` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      elements: [{ ...nameField, value: name || null }, { ...sizeSelect, value: size }, placeButton],
      menu: [item(placeButton)],
    });

  it("fills an empty field and a select before the click, once", async () => {
    let name = "";
    let size = "Small";
    const driver = new FakeDriver(form("", "Small"), (action) => {
      if (action.kind === "type") name = action.text;
      if (action.kind === "select") size = action.option;
      if (action.kind === "click") return form(name, size, true);
      return form(name, size);
    });
    const reflex = new FakeReflex({ rules: [{ when: /order placed/i, done: 0.95 }, { pick: /place order/i }] });
    const planner = new FakePlanner({
      fill: (input) =>
        input.fields.map((field) =>
          field.name === "Your name" ? { ref: field.ref, value: "Jane" } : field.name === "Size" ? { ref: field.ref, value: "Large" } : { ref: field.ref, value: null },
        ),
      verify: (input) => ({ done: /order placed/i.test(input.observation.fullOutline), reason: "checked" }),
    });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(log.records.map((record) => record.kind)).toEqual(["field", "action", "action", "action", "verify"]);
    expect(driver.actions.map((action) => action.kind)).toEqual(["type", "select", "click"]);
    // The fields are filled once, not on every step.
    expect(driver.actions.filter((action) => action.kind === "type")).toHaveLength(1);
    // The typed value is masked in the log; the select label stays.
    expect(log.records[0]?.result).toContain('"***"');
    expect(log.records[0]?.result).toContain('"Large"');
  });

  it("leaves a field alone when the planner says null", async () => {
    const driver = new FakeDriver(form("", "Small"), (action) => (action.kind === "click" ? form("", "Small", true) : form("", "Small")));
    const reflex = new FakeReflex({ rules: [{ when: /order placed/i, done: 0.95 }, { pick: /place order/i }] });
    const planner = new FakePlanner({ verify: () => ({ done: true, reason: "confirmed" }) });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("done");
    expect(log.records.map((record) => record.kind)).toEqual(["field", "action", "verify"]);
    expect(log.records[0]?.result).toContain("left alone");
    expect(driver.actions.map((action) => action.kind)).toEqual(["click"]);
  });

  it("counts a fill failure as an idle answer", async () => {
    const driver = new FakeDriver(form("", "Small"));
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({
      fill: () => {
        throw new Error("the model answered nonsense");
      },
    });
    const { result, log } = await run(driver, reflex, planner);

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("could not run");
    const idles = log.records.filter((record) => record.kind === "idle");
    expect(idles).toHaveLength(3);
    expect(idles[0]?.text).toContain("fill failed");
  });
});

describe("guardrails", () => {
  const placeButton = el("e5", "button", "Place order");
  const placePage = observation({
    fingerprint: "place",
    outline: '- button "Place order" [ref=e5]',
    elements: [placeButton],
    menu: [item(placeButton)],
  });

  it("refuses a goto outside the allowlist", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: () => ({ kind: "goto", url: "https://evil.test/x", label: "https://evil.test/x" }) });
    const { result, log } = await run(driver, reflex, planner, { allowlist: ["example.test"] });

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain("outside the allowlist");
    expect(driver.actions).toHaveLength(0);
    expect(log.records.at(-1)?.kind).toBe("guard");
  });

  it("stops when an action leaves the allowlist", async () => {
    const escaped = { ...donePage, url: "https://evil.test/x", path: "/x", fingerprint: "escaped" };
    const driver = new FakeDriver(startPage, () => escaped);
    const reflex = new FakeReflex({ rules: [{ pick: /order latte/i }] });
    const planner = new FakePlanner({});
    const { result } = await run(driver, reflex, planner, { allowlist: ["example.test"] });

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain("left the allowlist");
    expect(driver.actions).toHaveLength(1);
  });

  it("asks the human before an irreversible action and runs it on approval", async () => {
    const driver = new FakeDriver(placePage);
    const reflex = new FakeReflex({ rules: [{ pick: /place order/i }], askNoul: () => 0.9 });
    const planner = new FakePlanner({});
    const asked: string[] = [];
    const { result, log } = await run(driver, reflex, planner, {
      maxSteps: 1,
      gate: {
        approve: async (request) => {
          asked.push(request.question);
          return true;
        },
      },
    });

    expect(result.outcome).toBe("max-steps");
    expect(driver.actions).toHaveLength(1);
    expect(asked[0]).toContain('click button "Place order"');
    expect(log.records.some((record) => record.kind === "gate" && record.result.startsWith("approved"))).toBe(true);
  });

  it("stops when the human denies", async () => {
    const driver = new FakeDriver(placePage);
    const reflex = new FakeReflex({ rules: [{ pick: /place order/i }], askNoul: () => 0.9 });
    const planner = new FakePlanner({});
    const { result, log } = await run(driver, reflex, planner, { gate: { approve: async () => false } });

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain("denied");
    expect(driver.actions).toHaveLength(0);
    expect(log.records.at(-1)?.result).toContain("denied");
  });

  it("does not gate a reversible action", async () => {
    const driver = new FakeDriver(startPage);
    const reflex = new FakeReflex({ rules: [{ pick: /order latte/i }], askNoul: () => 0.9 });
    const planner = new FakePlanner({});
    const { result, log } = await run(driver, reflex, planner, { maxSteps: 1, gate: { approve: async () => false } });

    expect(result.outcome).toBe("max-steps");
    expect(driver.actions).toHaveLength(1);
    expect(log.records.some((record) => record.kind === "gate")).toBe(false);
  });

  it("stops at the cost cap", async () => {
    const driver = new FakeDriver(formPage, (action) => (action.kind === "type" ? typed(action.text) : formPage));
    const reflex = new FakeReflex({});
    let calls = 0;
    const pricey: Planner = {
      name: "pricey-planner",
      decide: async () => {
        calls += 1;
        return { action: { kind: "type", ref: "e7", text: `x${calls}`, label: "type into the name field" }, reason: "type", ms: 0, usage: null, costUsd: 0.25 };
      },
      verify: async () => ({ done: false, reason: "no", ms: 0, usage: null, costUsd: null }),
      fill: async () => ({ fields: [], reason: "none", ms: 0, usage: null, costUsd: null }),
    };
    const { result } = await run(driver, reflex, pricey, { costCapUsd: 0.5, fillFields: false });

    expect(result.outcome).toBe("paused");
    expect(result.reason).toContain("cost cap");
    expect(result.stats.planner.calls).toBe(2);
  });

  it("masks typed values in the step log", async () => {
    const driver = new FakeDriver(formPage, (action) => (action.kind === "type" ? typed(action.text) : formPage));
    const reflex = new FakeReflex({});
    const planner = new FakePlanner({ decide: () => ({ kind: "type", ref: "e7", text: "hunter2-secret", label: "type into the name field" }) });
    const { result, log } = await run(driver, reflex, planner, { maxSteps: 1, fillFields: false });

    expect(result.outcome).toBe("max-steps");
    expect(driver.actions[0]?.kind === "type" && driver.actions[0].text).toBe("hunter2-secret");
    const logged = JSON.stringify(log.records);
    expect(logged).not.toContain("hunter2-secret");
    expect(logged).toContain("***");
    // The internal records keep the real value for repeat detection.
    expect(JSON.stringify(result.steps)).toContain("hunter2-secret");
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
