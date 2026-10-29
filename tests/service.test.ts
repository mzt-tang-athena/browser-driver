// The HTTP service, tested end to end on a real socket with fake models and a
// fake browser. No Chromium, no network.

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { FakeDriver } from "./helpers/fake-driver.ts";
import { el, item, observation } from "./helpers/observations.ts";
import { FakePlanner } from "../src/planner/fake.ts";
import { FakeReflex } from "../src/reflex/fake.ts";
import { RUN_EVENT_SCHEMA } from "../src/service/events.ts";
import { RunManager } from "../src/service/runs.ts";
import type { Models, Notifier, StartRunRequest } from "../src/service/runs.ts";
import { createServer } from "../src/service/server.ts";
import type { Driver } from "../src/driver/driver.ts";


const TOKEN = "test-token";
const orderButton = el("e4", "button", "Order latte");
const placeButton = el("e5", "button", "Place order");

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

const placePage = observation({
  fingerprint: "place",
  outline: '- button "Place order" [ref=e5]',
  elements: [placeButton],
  menu: [item(placeButton)],
});

const placedPage = observation({
  fingerprint: "placed",
  outline: '- button "Place order" [ref=e5]\n- status: Order placed. Thank you!',
  elements: [placeButton],
  menu: [item(placeButton)],
});

const servers: Array<ReturnType<typeof createServer>> = [];
const managers: RunManager[] = [];

function doneModels(): Models {
  return {
    reflex: new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] }),
    planner: new FakePlanner({ verify: (input) => ({ done: /latte ordered/i.test(input.observation.fullOutline), reason: "checked" }) }),
  };
}

async function start(options: {
  models?: Models;
  driver?: (request: StartRunRequest) => Driver;
  notifier?: Notifier;
  approvalTimeoutMs?: number;
  maxRuns?: number;
}): Promise<{ base: string; manager: RunManager; post: (path: string, body?: unknown) => Promise<{ status: number; json: any }>; get: (path: string) => Promise<{ status: number; json: any }> }> {
  const manager = new RunManager({
    createDriver: async () => {
      const driver = options.driver ? options.driver({ goal: "x" }) : new FakeDriver(startPage, (action) => (action.kind === "click" && action.label.includes("Place") ? placedPage : donePage));
      return { driver, close: async () => undefined };
    },
    createModels: () => options.models ?? doneModels(),
    notifier: options.notifier ?? null,
    approvalTimeoutMs: options.approvalTimeoutMs ?? 1000,
    maxRuns: options.maxRuns,
  });
  managers.push(manager);
  const server = createServer({ manager, token: TOKEN });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };

  return {
    base,
    manager,
    post: (path, body) => call("POST", path, body),
    get: (path) => call("GET", path),
  };
}

async function until<T>(check: () => Promise<T | null>, timeoutMs = 3000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() - started > timeoutMs) throw new Error("the condition did not become true in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const manager of managers.splice(0)) await manager.closeAll();
});

describe("the driver service", () => {
  it("rejects a request without the bearer token", async () => {
    const { base } = await start({});
    const response = await fetch(`${base}/runs`);
    expect(response.status).toBe(401);
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it("runs a goal to done and streams the events", async () => {
    const { post, get } = await start({});
    const created = await post("/runs", { goal: "Order a latte", url: "https://example.test/", allowlist: ["example.test"] });
    expect(created.status).toBe(202);
    expect(created.json.run.status).toBe("running");

    const id = created.json.run.id as string;
    const finished = await until(async () => {
      const page = await get(`/runs/${id}/events?after=0&follow=1&timeout=2`);
      return page.json.events.find((event: { type: string }) => event.type === "run.finished") ?? null;
    });
    expect(finished.data.outcome).toBe("done");

    const run = await get(`/runs/${id}`);
    expect(run.json.run.status).toBe("done");
    expect(run.json.run.steps).toBeGreaterThan(0);

    const all = await get(`/runs/${id}/events?after=0`);
    const types = all.json.events.map((event: { type: string }) => event.type);
    expect(types[0]).toBe("run.started");
    expect(types).toContain("step");
    expect(types).toContain("decision");
    expect(types.at(-1)).toBe("run.finished");
    for (const event of all.json.events) expect(RUN_EVENT_SCHEMA.safeParse(event).success).toBe(true);

    // The cursor returns only what came after it.
    const tail = await get(`/runs/${id}/events?after=${all.json.next - 1}`);
    expect(tail.json.events).toHaveLength(1);
    expect(tail.json.next).toBe(all.json.next);
  });

  it("asks a human before an irreversible action and runs it on approval", async () => {
    const asked: string[] = [];
    const { post, get } = await start({
      driver: () => new FakeDriver(placePage, () => placedPage),
      models: {
        reflex: new FakeReflex({ rules: [{ when: /thank you/i, done: 0.95 }, { pick: /place order/i }], askNoul: () => 0.9 }),
        planner: new FakePlanner({ verify: (input) => ({ done: /thank you/i.test(input.observation.fullOutline), reason: "checked" }) }),
      },
      notifier: {
        approvalNeeded: async (input) => {
          asked.push(input.question);
        },
        runFinished: async () => undefined,
      },
    });

    const created = await post("/runs", { goal: "Place an order" });
    const id = created.json.run.id as string;
    const waiting = await until(async () => {
      const run = await get(`/runs/${id}`);
      return run.json.run.status === "waiting-approval" ? run.json.run : null;
    });
    expect(waiting.status).toBe("waiting-approval");
    expect(asked[0]).toContain("Place order");

    const events = await get(`/runs/${id}/events?after=0`);
    const approval = events.json.events.find((event: { type: string }) => event.type === "approval.needed");
    expect(approval.data.question).toContain("Place order");
    expect(approval.data.probability).toBe(0.9);

    const approved = await post(`/runs/${id}/approve`, { approved: true });
    expect(approved.status).toBe(200);

    const finished = await until(async () => {
      const run = await get(`/runs/${id}`);
      return run.json.run.status === "done" ? run.json.run : null;
    });
    expect(finished.outcome).toBe("done");
  });

  it("stops when the human denies", async () => {
    const { post, get } = await start({
      driver: () => new FakeDriver(placePage, () => placedPage),
      models: {
        reflex: new FakeReflex({ rules: [{ pick: /place order/i }], askNoul: () => 0.9 }),
        planner: new FakePlanner({}),
      },
    });
    const created = await post("/runs", { goal: "Place an order" });
    const id = created.json.run.id as string;
    await until(async () => ((await get(`/runs/${id}`)).json.run.status === "waiting-approval" ? true : null));

    await post(`/runs/${id}/approve`, { approved: false });
    const finished = await until(async () => {
      const run = await get(`/runs/${id}`);
      return run.json.run.status === "blocked" ? run.json.run : null;
    });
    expect(finished.reason).toContain("denied");
  });

  it("times an approval request out", async () => {
    const { post, get } = await start({
      driver: () => new FakeDriver(placePage, () => placedPage),
      approvalTimeoutMs: 30,
      models: {
        reflex: new FakeReflex({ rules: [{ pick: /place order/i }], askNoul: () => 0.9 }),
        planner: new FakePlanner({}),
      },
    });
    const created = await post("/runs", { goal: "Place an order" });
    const id = created.json.run.id as string;
    const finished = await until(async () => {
      const run = await get(`/runs/${id}`);
      return run.json.run.status === "blocked" ? run.json.run : null;
    });
    expect(finished.reason).toContain("timed out");
  });

  it("stops a running run at the next step", async () => {
    let release: () => void = () => undefined;
    let releaseNow: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const atGate = new Promise<void>((resolve) => (releaseNow = resolve));
    const driver: Driver = {
      observe: async () => startPage,
      execute: async () => {
        releaseNow();
        await gate;
      },
      settle: async () => undefined,
    };
    const { post, get } = await start({
      driver: () => driver,
      models: {
        reflex: new FakeReflex({ rules: [{ pick: /order latte/i }], askNoul: () => 0 }),
        planner: new FakePlanner({}),
      },
    });
    const created = await post("/runs", { goal: "Order a latte" });
    const id = created.json.run.id as string;
    await atGate;

    const stopped = await post(`/runs/${id}/stop`);
    expect(stopped.status).toBe(200);
    release();

    const finished = await until(async () => {
      const run = await get(`/runs/${id}`);
      return run.json.run.status === "paused" ? run.json.run : null;
    });
    expect(finished.reason).toContain("Stopped by the client");
  });

  it("observes and acts on a run that waits for a human", async () => {
    const driver = new FakeDriver(startPage, () => donePage);
    const { post, get } = await start({
      driver: () => driver,
      models: {
        reflex: new FakeReflex({}),
        planner: new FakePlanner({ decide: () => ({ kind: "human-input", ask: "Please log in." }) }),
      },
    });
    const created = await post("/runs", { goal: "Order a latte" });
    const id = created.json.run.id as string;
    await until(async () => ((await get(`/runs/${id}`)).json.run.status === "needs-human-input" ? true : null));

    const seen = await get(`/runs/${id}/observe`);
    expect(seen.status).toBe(200);
    expect(seen.json.observation.title).toBe("Test page");

    const acted = await post(`/runs/${id}/act`, { action: { kind: "click", ref: "e4", label: 'click button "Order latte"' } });
    expect(acted.status).toBe(200);
    expect(driver.actions).toHaveLength(1);

    const events = await get(`/runs/${id}/events?after=0`);
    expect(events.json.events.some((event: { type: string; data: { source?: string } }) => event.type === "step" && event.data.source === "client")).toBe(true);

    await post(`/runs/${id}/stop`);
    const closed = await get(`/runs/${id}/observe`);
    expect(closed.status).toBe(409);
  });

  it("refuses to touch the browser while the loop runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const driver: Driver = {
      observe: async () => startPage,
      execute: async () => gate,
      settle: async () => undefined,
    };
    const { post, get } = await start({
      driver: () => driver,
      models: { reflex: new FakeReflex({ rules: [{ pick: /order latte/i }] }), planner: new FakePlanner({}) },
    });
    const created = await post("/runs", { goal: "Order a latte" });
    const id = created.json.run.id as string;
    await until(async () => ((await get(`/runs/${id}/observe`)).status === 409 ? true : null));
    await post(`/runs/${id}/stop`);
    release();
    await until(async () => ((await get(`/runs/${id}`)).json.run.status === "paused" ? true : null));
  });

  it("evicts the oldest finished run when it holds too many", async () => {
    const { post, get } = await start({ maxRuns: 1 });
    const first = await post("/runs", { goal: "Order a latte" });
    const firstId = first.json.run.id as string;
    await until(async () => ((await get(`/runs/${firstId}`)).json.run.status === "done" ? true : null));

    const second = await post("/runs", { goal: "Order a latte" });
    expect((await get(`/runs/${firstId}`)).status).toBe(404);
    expect((await get(`/runs/${second.json.run.id as string}`)).status).toBe(200);
  });

  it("rejects bad input and unknown runs", async () => {
    const { post, get } = await start({});
    expect((await post("/runs", {})).status).toBe(400);
    expect((await post("/runs", { goal: "x", profile: "../etc" })).status).toBe(400);
    expect((await post("/runs", { goal: "x", maxSteps: 0 })).status).toBe(400);
    expect((await post("/runs", { goal: "x", url: "javascript:alert(1)" })).status).toBe(400);
    expect((await get("/runs/run_missing")).status).toBe(404);
    expect((await post("/runs/run_missing/approve", { approved: true })).status).toBe(404);
    expect((await get("/nope")).status).toBe(404);
  });

  it("rejects an action that the browser cannot run", async () => {
    const { post } = await start({});
    const created = await post("/runs", { goal: "Order a latte" });
    const id = created.json.run.id as string;
    const response = await post(`/runs/${id}/act`, { action: { kind: "done", reason: "x" } });
    expect(response.status).toBe(400);
  });
});
