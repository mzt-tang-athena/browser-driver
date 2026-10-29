// ntfy payloads, with fetch stubbed. No network.

import { describe, expect, it } from "vitest";
import { createNtfyNotifier, ntfyFromEnv } from "../src/service/notify.ts";

const capture = () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
};

describe("the ntfy notifier", () => {
  it("publishes an approval request as JSON", async () => {
    const { calls, fetchImpl } = capture();
    const notifier = createNtfyNotifier({ topic: "driver", baseUrl: "https://ntfy.example/", token: "secret", fetchImpl });
    await notifier.approvalNeeded({ runId: "run_1", question: "Approve this action: click button", url: "https://example.test/" });

    expect(calls[0]?.url).toBe("https://ntfy.example/");
    expect(calls[0]?.init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer secret" });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      topic: "driver",
      title: "Browser driver needs approval",
      message: "Approve this action: click button\nhttps://example.test/\nrun run_1",
      priority: 4,
      tags: ["warning"],
    });
  });

  it("publishes a run end with a matching priority", async () => {
    const { calls, fetchImpl } = capture();
    const notifier = createNtfyNotifier({ topic: "driver", fetchImpl });
    await notifier.runFinished({ runId: "run_1", outcome: "done", reason: "the goal is reached" });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.title).toBe("Browser driver: done");
    expect(body.priority).toBe(3);
    expect(body.tags).toEqual(["white_check_mark"]);
  });

  it("fails loudly on a bad answer so the caller can ignore it", async () => {
    const notifier = createNtfyNotifier({
      topic: "driver",
      fetchImpl: (async () => new Response("no", { status: 500 })) as typeof fetch,
    });
    await expect(notifier.runFinished({ runId: "run_1", outcome: "error", reason: null })).rejects.toThrow("500");
  });

  it("is off without a topic", () => {
    expect(ntfyFromEnv({})).toBeNull();
    expect(ntfyFromEnv({ NTFY_TOPIC: "driver" })).not.toBeNull();
  });
});
