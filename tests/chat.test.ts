// Tests for the chat planner. fetch is stubbed, so no network and no model.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPlanner } from "../src/planner/chat.ts";
import type { Observation } from "../src/types.ts";

const observation: Observation = {
  url: "https://example.test/order",
  path: "/order",
  title: "Order",
  outline: '- textbox "Name" [ref=e1]\n- combobox "Size" [ref=e2] options: Small | Large\n- button "Go" [ref=e3]',
  fullOutline: '- textbox "Name" [ref=e1]\n- combobox "Size" [ref=e2] options: Small | Large\n- button "Go" [ref=e3]',
  elements: [
    { ref: "e1", role: "textbox", name: "Name", kind: "type", options: [], value: null, url: null, disabled: false, checked: null },
    { ref: "e2", role: "combobox", name: "Size", kind: "select", options: ["Small", "Large"], value: "Small", url: null, disabled: false, checked: null },
    { ref: "e3", role: "button", name: "Go", kind: "click", options: [], value: null, url: null, disabled: false, checked: null },
  ],
  menu: [{ id: "e3", label: 'click button "Go"', ref: "e3", role: "button" }],
  messages: [],
  fingerprint: "abc",
};

const planner = (): ChatPlanner => new ChatPlanner({ apiKey: "test-key", model: "glm-5.3-flash", baseUrl: "https://example.invalid/v1" });

const answer = (content: string, promptTokens = 100, completionTokens = 10): Response =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }), { status: 200 });

const input = (reason = "the reflex was unsure") => ({ goal: "Order a large coffee for Jane", observation, recentSteps: [], reason });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPlanner.decide", () => {
  it("parses a click, the menu label, and the cost", async () => {
    vi.stubGlobal("fetch", async () => answer('{"action":"click","ref":"e3","reason":"the order button moves the flow"}'));
    const decision = await planner().decide(input());
    expect(decision.action).toEqual({ kind: "click", ref: "e3", role: "button", label: 'click button "Go"' });
    expect(decision.reason).toContain("order button");
    // 100 input tokens at $0.15/1M plus 10 output tokens at $0.50/1M.
    expect(decision.costUsd).toBeCloseTo(0.00002, 8);
  });

  it("parses type, select, and goto with the right element", async () => {
    vi.stubGlobal("fetch", async () => answer('{"action":"type","ref":"e1","value":"Jane","reason":"the goal names Jane"}'));
    expect((await planner().decide(input())).action).toEqual({ kind: "type", ref: "e1", text: "Jane", label: 'textbox "Name"' });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => answer('{"action":"select","ref":"e2","option":"Large","reason":"the goal asks for large"}'));
    expect((await planner().decide(input())).action).toEqual({ kind: "select", ref: "e2", option: "Large", label: 'combobox "Size"' });

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => answer('{"action":"goto","url":"/menu","reason":"the menu is the next page"}'));
    expect((await planner().decide(input())).action).toEqual({ kind: "goto", url: "https://example.test/menu", label: "https://example.test/menu" });
  });

  it("retries once on a bad answer and keeps the total cost", async () => {
    const replies = [answer('{"action":"fly","reason":"no"}'), answer('{"action":"click","ref":"e3","reason":"ok"}')];
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      calls.push(init.body);
      const next = replies.shift() as Response;
      return next;
    });
    const decision = await planner().decide(input());
    expect(decision.action.kind).toBe("click");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("could not be used");
    // Two calls, so twice the tokens and twice the cost.
    expect(decision.costUsd).toBeCloseTo(0.00004, 8);
  });

  it("stops after two bad answers", async () => {
    vi.stubGlobal("fetch", async () => answer('{"action":"fly","reason":"no"}'));
    await expect(planner().decide(input())).rejects.toThrow(/twice/);
  });

  it("rejects an option the field does not list", async () => {
    vi.stubGlobal("fetch", async () => answer('{"action":"select","ref":"e2","option":"Huge","reason":"no"}'));
    await expect(planner().decide(input())).rejects.toThrow(/not an option/);
  });

  it("parses the simple actions", async () => {
    const cases: Array<[string, unknown]> = [
      ['{"action":"scroll","direction":"up","reason":"r"}', { kind: "scroll", direction: "up", label: "scroll up" }],
      ['{"action":"wait","reason":"r"}', { kind: "wait", label: "wait for the page to settle" }],
      ['{"action":"done","reason":"r"}', { kind: "done", reason: "r" }],
      ['{"action":"blocked","reason":"r"}', { kind: "blocked", reason: "r" }],
      ['{"action":"human-input","question":"Solve the CAPTCHA","reason":"r"}', { kind: "human-input", ask: "Solve the CAPTCHA" }],
    ];
    for (const [content, expected] of cases) {
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", async () => answer(content));
      expect((await planner().decide(input())).action).toEqual(expected);
    }
  });

  it("names a non-JSON body", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>maintenance</html>", { status: 200 }));
    await expect(planner().decide(input())).rejects.toThrow(/not JSON/);
  });

  it("names the HTTP status", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    await expect(planner().decide(input())).rejects.toThrow(/HTTP 503/);
  });
});

describe("ChatPlanner.verify", () => {
  it("reads a done verdict and its cost", async () => {
    vi.stubGlobal("fetch", async () => answer('{"done": true, "reason": "the page shows the order confirmation"}'));
    const verdict = await planner().verify({ goal: "Order a latte", observation });
    expect(verdict.done).toBe(true);
    expect(verdict.reason).toContain("confirmation");
    expect(verdict.costUsd).toBeCloseTo(0.00002, 8);
  });

  it("needs a boolean done", async () => {
    vi.stubGlobal("fetch", async () => answer('{"done": "yes", "reason": "no"}'));
    await expect(planner().verify({ goal: "Order a latte", observation })).rejects.toThrow(/done/);
  });
});

describe("ChatPlanner.fill", () => {
  const fields = [
    { ref: "e1", role: "textbox", name: "Name", kind: "type" as const, value: null, options: [] },
    { ref: "e2", role: "combobox", name: "Size", kind: "select" as const, value: "Small", options: ["Small", "Large"] },
  ];
  const fillInput = { goal: "Order a large coffee for Jane", observation, recentSteps: [], fields };

  it("reads values and computes the cost", async () => {
    vi.stubGlobal("fetch", async () => answer('{"fields":[{"ref":"e1","value":"Jane"},{"ref":"e2","value":"Large"}],"reason":"the goal names both"}'));
    const fill = await planner().fill(fillInput);
    expect(fill.fields).toEqual([{ ref: "e1", value: "Jane" }, { ref: "e2", value: "Large" }]);
    expect(fill.costUsd).toBeCloseTo(0.00002, 8);
  });

  it("keeps a null value", async () => {
    vi.stubGlobal("fetch", async () => answer('{"fields":[{"ref":"e1","value":null}],"reason":"no name needed"}'));
    expect((await planner().fill(fillInput)).fields).toEqual([{ ref: "e1", value: null }]);
  });

  it("rejects a ref that was not offered", async () => {
    vi.stubGlobal("fetch", async () => answer('{"fields":[{"ref":"e9","value":"x"}]}'));
    await expect(planner().fill(fillInput)).rejects.toThrow(/not a field/);
  });

  it("rejects an option the select does not list", async () => {
    vi.stubGlobal("fetch", async () => answer('{"fields":[{"ref":"e2","value":"Huge"}]}'));
    await expect(planner().fill(fillInput)).rejects.toThrow(/not an option/);
  });
});
