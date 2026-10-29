// The CLI: a thin client over the driver HTTP API. No browser code, no
// model code. Every command prints JSON, so a shell agent can pipe it to jq.
// Exit codes: 0 done, 1 error, 2 paused or needs-human-input, 3 blocked,
// 4 max-steps.

import { pathToFileURL } from "node:url";
import type { Action } from "./types.ts";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const EXIT = { done: 0, error: 1, paused: 2, "needs-human-input": 2, blocked: 3, "max-steps": 4 } as const;

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Progress lines while a run waits. Off with --quiet. */
  progress?: (line: string) => void;
}

type CliEnv = Record<string, string | undefined>;

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

interface Parsed {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(["follow", "wait", "headed", "yes", "no", "quiet", "help"]);

export function parseCli(argv: string[]): Parsed {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token.startsWith("--")) {
      const [rawName, inline] = token.slice(2).split("=", 2) as [string, string | undefined];
      const name = rawName === "no-wait" ? "wait" : rawName;
      if (rawName === "no-wait") {
        flags.set(name, "false");
        continue;
      }
      if (inline != null) {
        flags.set(name, inline);
        continue;
      }
      if (BOOLEAN_FLAGS.has(name)) {
        flags.set(name, true);
        continue;
      }
      const next = argv[index + 1];
      if (next == null || next.startsWith("--")) throw new CliError(`--${name} needs a value.`);
      flags.set(name, next);
      index += 1;
      continue;
    }
    if (command === "") command = token;
    else positionals.push(token);
  }
  return { command, positionals, flags };
}

const USAGE = `browser-driver - a thin client over the driver HTTP API

usage:
  browser-driver run --goal "Order a latte" [--url URL] [--profile NAME]
                    [--allowlist host,file] [--cost-cap 0.5] [--max-steps 12]
                    [--headed] [--no-wait] [--quiet]
  browser-driver status <run-id>
  browser-driver events <run-id> [--follow] [--after N] [--timeout SECONDS]
  browser-driver approve <run-id> (--yes | --no)
  browser-driver stop <run-id>
  browser-driver observe <run-id>
  browser-driver act <run-id> --action '{"kind":"click","ref":"e4","label":"..."}'

config:
  --base-url URL            default http://127.0.0.1:8787, or BROWSER_DRIVER_URL
  --token TOKEN             or BROWSER_DRIVER_TOKEN

exit codes: 0 done, 1 error, 2 paused or needs-human-input, 3 blocked, 4 max-steps`;

export async function runCli(argv: string[], env: CliEnv = process.env, io: CliIo = defaultIo()): Promise<number> {
  try {
    const parsed = parseCli(argv);
    if (parsed.flags.has("help") || parsed.command === "help" || parsed.command === "") {
      io.out(USAGE);
      return 0;
    }
    const client = new Client({
      baseUrl: flag(parsed, "base-url") ?? env["BROWSER_DRIVER_URL"] ?? DEFAULT_BASE_URL,
      token: flag(parsed, "token") ?? env["BROWSER_DRIVER_TOKEN"] ?? "",
    });
    return await dispatch(parsed, client, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`error: ${error.message}`);
      return error.exitCode;
    }
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function dispatch(parsed: Parsed, client: Client, io: CliIo): Promise<number> {
  const id = parsed.positionals[0];
  switch (parsed.command) {
    case "run":
      return commandRun(parsed, client, io);
    case "status":
      return commandStatus(requireId(parsed), client, io);
    case "events":
      return commandEvents(parsed, client, io);
    case "approve":
      return commandApprove(parsed, client, io);
    case "stop":
      io.out(JSON.stringify(await client.post(`/runs/${encodeURIComponent(requireId(parsed))}/stop`), null, 2));
      return 0;
    case "observe":
      io.out(JSON.stringify(await client.get(`/runs/${encodeURIComponent(requireId(parsed))}/observe`), null, 2));
      return 0;
    case "act":
      return commandAct(parsed, client, io);
    default:
      if (id) throw new CliError(`No command "${parsed.command}". Run browser-driver help.`);
      throw new CliError(`No command. Run browser-driver help.`);
  }
}

async function commandRun(parsed: Parsed, client: Client, io: CliIo): Promise<number> {
  const goal = flag(parsed, "goal");
  if (!goal) throw new CliError("run needs --goal.");

  const body: Record<string, unknown> = { goal };
  const url = flag(parsed, "url");
  if (url) body.url = url;
  const profile = flag(parsed, "profile");
  if (profile) body.profile = profile;
  const allowlist = flag(parsed, "allowlist");
  if (allowlist) body.allowlist = allowlist.split(",").map((entry) => entry.trim()).filter(Boolean);
  const costCap = flag(parsed, "cost-cap");
  if (costCap) body.costCapUsd = Number(costCap);
  const maxSteps = flag(parsed, "max-steps");
  if (maxSteps) body.maxSteps = Number(maxSteps);
  if (parsed.flags.has("headed")) body.headed = true;

  const started = (await client.post("/runs", body)) as { run: RunView };
  const run = started.run;
  if (parsed.flags.get("wait") === "false") {
    io.out(JSON.stringify({ run }, null, 2));
    return exitFor(run);
  }

  const progress = parsed.flags.has("quiet") ? undefined : (io.progress ?? io.err);
  progress?.(`run ${run.id} started: ${run.goal}`);
  let cursor = 0;
  for (;;) {
    const page = (await client.get(`/runs/${encodeURIComponent(run.id)}/events?after=${cursor}&follow=1&timeout=20000`)) as {
      events: RunEvent[];
      next: number;
    };
    for (const event of page.events) {
      if (event.type === "step") progress?.(`step ${event.seq}: ${String(event.data.text ?? "")}`);
      else if (event.type === "approval.needed") progress?.(`approval needed: ${String(event.data.question ?? "")}`);
      else if (event.type === "decision" && event.data.by === "human") progress?.(`human decision: ${String(event.data.reason ?? "")}`);
    }
    cursor = page.next;
    if (page.events.some((event) => event.type === "run.finished")) {
      const final = ((await client.get(`/runs/${encodeURIComponent(run.id)}`)) as { run: RunView }).run;
      io.out(JSON.stringify({ run: final }, null, 2));
      if (final.reason) progress?.(`${final.status}: ${final.reason}`);
      return exitFor(final);
    }
  }
}

async function commandStatus(id: string, client: Client, io: CliIo): Promise<number> {
  const run = ((await client.get(`/runs/${encodeURIComponent(id)}`)) as { run: RunView }).run;
  io.out(JSON.stringify({ run }, null, 2));
  return exitFor(run);
}

async function commandEvents(parsed: Parsed, client: Client, io: CliIo): Promise<number> {
  const id = requireId(parsed);
  const follow = parsed.flags.has("follow");
  const after = Number(flag(parsed, "after") ?? "0");
  const timeout = Number(flag(parsed, "timeout") ?? "25");
  let cursor = after;
  for (;;) {
    const page = (await client.get(
      `/runs/${encodeURIComponent(id)}/events?after=${cursor}${follow ? `&follow=1&timeout=${Math.max(0, timeout) * 1000}` : ""}`,
    )) as { events: RunEvent[]; next: number };
    for (const event of page.events) io.out(JSON.stringify(event));
    cursor = page.next;
    if (!follow) return 0;
    if (page.events.some((event) => event.type === "run.finished")) return 0;
  }
}

async function commandApprove(parsed: Parsed, client: Client, io: CliIo): Promise<number> {
  const yes = parsed.flags.has("yes");
  const no = parsed.flags.has("no");
  if (yes === no) throw new CliError("approve needs one of --yes or --no.");
  const id = requireId(parsed);
  io.out(JSON.stringify(await client.post(`/runs/${encodeURIComponent(id)}/approve`, { approved: yes }), null, 2));
  return 0;
}

async function commandAct(parsed: Parsed, client: Client, io: CliIo): Promise<number> {
  const id = requireId(parsed);
  const raw = flag(parsed, "action");
  if (!raw) throw new CliError("act needs --action with a JSON action.");
  let action: Action;
  try {
    action = JSON.parse(raw) as Action;
  } catch {
    throw new CliError("--action must be valid JSON.");
  }
  io.out(JSON.stringify(await client.post(`/runs/${encodeURIComponent(id)}/act`, { action }), null, 2));
  return 0;
}

function requireId(parsed: Parsed): string {
  const id = parsed.positionals[0];
  if (!id) throw new CliError(`${parsed.command} needs a run id.`);
  return id;
}

function flag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function exitFor(run: RunView): number {
  if (run.outcome) return EXIT[run.outcome];
  return 0;
}

interface RunView {
  id: string;
  status: string;
  goal: string;
  outcome: keyof typeof EXIT | null;
  reason: string | null;
}

interface RunEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

class Client {
  constructor(private readonly options: { baseUrl: string; token: string }) {
    if (!options.token) throw new CliError("No token. Set BROWSER_DRIVER_TOKEN or pass --token.");
  }

  get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new CliError(`The service at ${this.options.baseUrl} did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      throw new CliError(`The service answered ${response.status} with something that is not JSON.`);
    }
    if (!response.ok) {
      const message = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
      throw new CliError(message);
    }
    return json;
  }
}

function defaultIo(): CliIo {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    progress: (line) => console.error(line),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
