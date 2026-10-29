// The HTTP face of the driver. One small JSON API, a bearer token, and no
// framework. The CLI and the MCP adapter both speak this (ADR 0002).

import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { parseBrowserAction, parseStartRunRequest, RunManager, ServiceError } from "./runs.ts";

export interface ServerOptions {
  manager: RunManager;
  token: string;
  /** Largest accepted request body. Default 1 MB. */
  maxBodyBytes?: number;
}

const MAX_BODY_BYTES = 1024 * 1024;

export function createServer(options: ServerOptions): Server {
  if (!options.token) throw new Error("The service needs a token.");
  return createHttpServer((request, response) => {
    void handle(options, request, response).catch((error) => {
      if (error instanceof ServiceError) {
        sendJson(response, error.status, { error: { message: error.message } });
        return;
      }
      console.error(error);
      sendJson(response, 500, { error: { message: "Internal error." } });
    });
  });
}

async function handle(options: ServerOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method ?? "GET";

  if (path === "/health" && method === "GET") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!authorized(request, options.token)) {
    response.setHeader("www-authenticate", "Bearer");
    sendJson(response, 401, { error: { message: "Send Authorization: Bearer <token>." } });
    return;
  }

  if (path === "/runs" && method === "POST") {
    const body = await readJson(request, options.maxBodyBytes ?? MAX_BODY_BYTES);
    const run = options.manager.start(parseStartRunRequest(body));
    sendJson(response, 202, { run });
    return;
  }

  if (path === "/runs" && method === "GET") {
    sendJson(response, 200, { runs: options.manager.list() });
    return;
  }

  const match = /^\/runs\/([^/]+)(?:\/(events|approve|stop|observe|act))?$/.exec(path);
  if (!match) {
    sendJson(response, 404, { error: { message: `No route for ${method} ${path}.` } });
    return;
  }
  const id = decodeURIComponent(match[1] as string);
  const action = match[2] ?? null;

  if (action === null && method === "GET") {
    sendJson(response, 200, { run: options.manager.get(id) });
    return;
  }

  if (action === "events" && method === "GET") {
    const after = numberParam(url.searchParams.get("after"), 0);
    const follow = url.searchParams.get("follow") === "1" || url.searchParams.get("follow") === "true";
    const timeoutMs = numberParam(url.searchParams.get("timeout"), 25_000);
    sendJson(response, 200, await options.manager.events(id, { after, follow, timeoutMs }));
    return;
  }

  if (action === "approve" && method === "POST") {
    const body = (await readJson(request, 4096)) as Record<string, unknown> | null;
    const approved = body?.approved;
    if (typeof approved !== "boolean") throw new ServiceError(400, "approved must be true or false.");
    sendJson(response, 200, { run: options.manager.approve(id, approved) });
    return;
  }

  if (action === "stop" && method === "POST") {
    sendJson(response, 200, { run: await options.manager.stop(id) });
    return;
  }

  if (action === "observe" && method === "GET") {
    sendJson(response, 200, { observation: await options.manager.observe(id) });
    return;
  }

  if (action === "act" && method === "POST") {
    const body = await readJson(request, options.maxBodyBytes ?? MAX_BODY_BYTES);
    sendJson(response, 200, { observation: await options.manager.act(id, parseBrowserAction(body)) });
    return;
  }

  response.setHeader("allow", allowedMethods(action));
  sendJson(response, 405, { error: { message: `${method} is not allowed on ${path}.` } });
}

function allowedMethods(action: string | null): string {
  if (action === "events" || action === "observe") return "GET";
  if (action === "approve" || action === "stop" || action === "act") return "POST";
  return "GET";
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function numberParam(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new ServiceError(413, `The body is larger than ${limit} bytes.`);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError(400, "The body is not valid JSON.");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  const text = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", Buffer.byteLength(text));
  response.end(text);
}
