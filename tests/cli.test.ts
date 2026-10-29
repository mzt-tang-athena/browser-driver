// The CLI, tested against a stub HTTP server. No browser, no service code.

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseCli, runCli } from "../src/cli.ts";

interface StubRequest {
  method: string;
  path: string;
  body: unknown;
  auth: string | undefined;
}

interface Stub {
  base: string;
  requests: StubRequest[];
  close: () => Promise<void>;
}

const servers: Server[] = [];

async function stub(handler: (request: StubRequest, index: number) => { status?: number; body: unknown }): Promise<Stub> {
  const requests: StubRequest[] = [];
  const server = createServer(async (incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    const entry: StubRequest = {
      method: incoming.method ?? "GET",
      path: incoming.url ?? "/",
      body: text === "" ? null : JSON.parse(text),
      auth: incoming.headers.authorization,
    };
    requests.push(entry);
    const answer = handler(entry, requests.length - 1);
    response.statusCode = answer.status ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(answer.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function cli(argv: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { BROWSER_DRIVER_TOKEN: "token", ...env }, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err };
}

const started = { id: "run_1", status: "running", goal: "Order a latte", outcome: null, reason: null };
const finished = { ...started, status: "done", outcome: "done", reason: "the goal is reached" };

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the CLI", () => {
  it("parses values, booleans, and --no-wait", () => {
    const parsed = parseCli(["run", "--goal", "Order a latte", "--headed", "--no-wait", "--max-steps=3"]);
    expect(parsed.command).toBe("run");
    expect(parsed.flags.get("goal")).toBe("Order a latte");
    expect(parsed.flags.get("headed")).toBe(true);
    expect(parsed.flags.get("wait")).toBe("false");
    expect(parsed.flags.get("max-steps")).toBe("3");
  });

  it("prints usage", async () => {
    const { code, out } = await cli(["help"]);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("browser-driver run");
  });

  it("needs a token", async () => {
    const { code, err } = await cli(["status", "run_1"], { BROWSER_DRIVER_TOKEN: undefined });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("No token");
  });

  it("starts a run, waits for the finish, and prints one JSON object", async () => {
    const server = await stub((request) => {
      if (request.path === "/runs" && request.method === "POST") return { status: 202, body: { run: started } };
      if (request.path.includes("/events")) {
        const after = Number(new URL(request.path, "http://x").searchParams.get("after"));
        if (after === 0) return { body: { events: [{ seq: 1, type: "run.started", data: {} }], next: 1 } };
        return { body: { events: [{ seq: 2, type: "step", data: { text: "click" } }, { seq: 3, type: "run.finished", data: { outcome: "done" } }], next: 3 } };
      }
      return { body: { run: finished } };
    });

    const { code, out, err } = await cli(
      ["run", "--goal", "Order a latte", "--url", "https://example.test/", "--profile", "work", "--allowlist", "example.test,file", "--cost-cap", "0.5", "--max-steps", "3", "--headed"],
      { BROWSER_DRIVER_URL: server.base },
    );

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] as string).run.outcome).toBe("done");
    expect(err.join("\n")).toContain("done: the goal is reached");

    const post = server.requests.find((request) => request.method === "POST");
    expect(post?.body).toEqual({ goal: "Order a latte", url: "https://example.test/", profile: "work", allowlist: ["example.test", "file"], costCapUsd: 0.5, maxSteps: 3, headed: true });
    expect(post?.auth).toBe("Bearer token");
    // The wait follows with a cursor. It does not ask for every event again on each poll.
    const eventPaths = server.requests.filter((request) => request.path.includes("/events")).map((request) => request.path);
    expect(eventPaths[0]).toBe("/runs/run_1/events?after=0&follow=1&timeout=20000");
    expect(eventPaths[1]).toBe("/runs/run_1/events?after=1&follow=1&timeout=20000");
  });

  it("does not wait with --no-wait", async () => {
    const server = await stub(() => ({ status: 202, body: { run: started } }));
    const { code, out } = await cli(["run", "--goal", "x", "--no-wait"], { BROWSER_DRIVER_URL: server.base });
    expect(code).toBe(0);
    expect(JSON.parse(out[0] as string).run.status).toBe("running");
    expect(server.requests).toHaveLength(1);
  });

  it.each([
    ["blocked", 3],
    ["paused", 2],
    ["needs-human-input", 2],
    ["max-steps", 4],
    ["error", 1],
    ["done", 0],
  ])("exits %s as %i", async (outcome, expected) => {
    const server = await stub(() => ({ body: { run: { ...finished, status: outcome, outcome } } }));
    const { code, out } = await cli(["status", "run_1"], { BROWSER_DRIVER_URL: server.base });
    expect(code).toBe(expected);
    expect(JSON.parse(out[0] as string).run.outcome).toBe(outcome);
  });

  it("follows the event stream", async () => {
    let page = 0;
    const server = await stub(() => {
      page += 1;
      if (page === 1) return { body: { events: [{ seq: 1, type: "run.started", data: {} }], next: 1 } };
      if (page === 2) return { body: { events: [{ seq: 2, type: "step", data: {} }], next: 2 } };
      return { body: { events: [{ seq: 3, type: "run.finished", data: { outcome: "done" } }], next: 3 } };
    });

    const { code, out } = await cli(["events", "run_1", "--follow", "--timeout", "1"], { BROWSER_DRIVER_URL: server.base });
    expect(code).toBe(0);
    expect(out.map((line) => JSON.parse(line).type)).toEqual(["run.started", "step", "run.finished"]);
    expect(server.requests[0]?.path).toBe("/runs/run_1/events?after=0&follow=1&timeout=1000");
  });

  it("sends an approval answer", async () => {
    const server = await stub(() => ({ body: { run: { ...finished, status: "blocked", outcome: "blocked" } } }));
    const { code } = await cli(["approve", "run_1", "--no"], { BROWSER_DRIVER_URL: server.base });
    expect(code).toBe(0);
    expect(server.requests[0]?.body).toEqual({ approved: false });
  });

  it("needs exactly one of --yes and --no", async () => {
    const server = await stub(() => ({ body: {} }));
    expect((await cli(["approve", "run_1"], { BROWSER_DRIVER_URL: server.base })).code).toBe(1);
    expect((await cli(["approve", "run_1", "--yes", "--no"], { BROWSER_DRIVER_URL: server.base })).code).toBe(1);
  });

  it("observes and acts", async () => {
    const server = await stub((request) =>
      request.path.endsWith("/observe") ? { body: { observation: { title: "Test page" } } } : { body: { observation: { title: "After" } } },
    );
    const seen = await cli(["observe", "run_1"], { BROWSER_DRIVER_URL: server.base });
    expect(seen.code).toBe(0);
    expect(JSON.parse(seen.out[0] as string).observation.title).toBe("Test page");

    const acted = await cli(["act", "run_1", "--action", '{"kind":"click","ref":"e4","label":"click button"}'], { BROWSER_DRIVER_URL: server.base });
    expect(acted.code).toBe(0);
    expect(JSON.parse(acted.out[0] as string).observation.title).toBe("After");
    expect(server.requests.at(-1)?.body).toEqual({ action: { kind: "click", ref: "e4", label: "click button" } });
  });

  it("reports a service error as JSON on stderr", async () => {
    const server = await stub(() => ({ status: 404, body: { error: { message: "No run run_1." } } }));
    const { code, err } = await cli(["status", "run_1"], { BROWSER_DRIVER_URL: server.base });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("No run run_1.");
  });
});
