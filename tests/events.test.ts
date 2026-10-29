// The event schema is the contract with every consumer. These tests pin the
// shape that the service emits and the CLI prints.

import { describe, expect, it } from "vitest";
import { RUN_EVENT_SCHEMA } from "../src/service/events.ts";

const base = { v: 1, id: "run_1.1", runId: "run_1", seq: 1, ts: "2026-10-29T00:00:00.000Z" };

const samples = [
  { ...base, type: "run.started", data: { goal: "Order a latte", url: "https://example.test/", profile: null, allowlist: ["example.test"] } },
  {
    ...base,
    type: "step",
    data: { seq: 1, step: 1, kind: "action", source: "systemone", probability: 0.92, action: { kind: "click", ref: "e4", label: 'click button "Order latte"' }, text: "click", result: "page changed", url: "https://example.test/", ms: 40, costUsd: 0.0001 },
  },
  {
    ...base,
    type: "decision",
    data: { step: 1, by: "systemone", kind: "action", action: { kind: "click", ref: "e4", label: "click" }, probability: 0.92, reason: "page changed" },
  },
  {
    ...base,
    type: "approval.needed",
    data: { action: { kind: "click", ref: "e5", label: 'click button "Place order"' }, question: "Approve this action?", probability: 0.9, url: "https://example.test/", timeoutMs: 300000 },
  },
  {
    ...base,
    type: "run.finished",
    data: { outcome: "done", reason: "the goal is reached", stats: { reflex: { calls: 1, ms: 40, inputTokens: 10, outputTokens: 2, costUsd: 0.0001 }, planner: { calls: 0, ms: 0, costUsd: 0 } } },
  },
];

describe("the run event schema", () => {
  it("accepts one sample of every event type", () => {
    for (const sample of samples) expect(RUN_EVENT_SCHEMA.safeParse(sample).success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    expect(RUN_EVENT_SCHEMA.safeParse({ ...base, type: "run.exploded", data: {} }).success).toBe(false);
  });

  it("rejects a probability outside 0 and 1", () => {
    const bad = { ...samples[1], data: { ...(samples[1] as { data: object }).data, probability: 1.5 } };
    expect(RUN_EVENT_SCHEMA.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown action kind", () => {
    const bad = { ...samples[1], data: { ...(samples[1] as { data: object }).data, action: { kind: "fly", ref: "e1" } } };
    expect(RUN_EVENT_SCHEMA.safeParse(bad).success).toBe(false);
  });
});
