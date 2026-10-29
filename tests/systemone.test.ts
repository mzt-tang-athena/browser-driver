// Tests for the live reflex client's error paths. No network: fetch is stubbed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemOneReflex } from "../src/reflex/systemone.ts";
import type { Observation } from "../src/types.ts";

const observation: Observation = {
  url: "https://example.test/",
  path: "/",
  title: "Test page",
  outline: '- button "Go" [ref=e1]',
  fullOutline: '- button "Go" [ref=e1]',
  elements: [{ ref: "e1", role: "button", name: "Go", kind: "click", options: [], value: null, url: null, disabled: false, checked: null }],
  menu: [{ id: "e1", label: 'click button "Go"', ref: "e1", role: "button" }],
  messages: [],
  fingerprint: "abc",
};

const reflex = (): SystemOneReflex => new SystemOneReflex({ apiKey: "test-key", model: "jev-test", endpoint: "https://example.invalid/v1/systemone" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SystemOneReflex errors", () => {
  it("names a non-JSON body instead of failing on the parse", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>maintenance</html>", { status: 200 }));
    await expect(reflex().decide({ goal: "go", observation, recentSteps: [] })).rejects.toThrow(/not JSON/);
  });

  it("names the HTTP status of an error response", async () => {
    vi.stubGlobal("fetch", async () => new Response("upstream down", { status: 502 }));
    await expect(reflex().decide({ goal: "go", observation, recentSteps: [] })).rejects.toThrow(/HTTP 502/);
  });

  it("reads a real-shaped answer and prices the call", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            model: "jev-test",
            answers: { next_1: { choice: "e1", probabilities: { e1: 0.9, other: 0.1 } }, goal_done: { noul: 0.1 } },
            usage: { input_tokens: 1000, output_tokens: 100 },
          }),
          { status: 200 },
        ),
    );
    const decision = await reflex().decide({ goal: "go", observation, recentSteps: [] });
    expect(decision.choice).toEqual({ id: "e1", label: 'click button "Go"', probability: 0.9 });
    expect(decision.doneProbability).toBe(0.1);
    // Unknown model means unknown price. The real models carry their Console price.
    expect(decision.costUsd).toBeNull();
  });
});
