// The in-memory run manager: one browser and one loop per run, a growing event
// list per run, and the approval handshake between the loop and a human.
// Nothing is persisted. A run lives as long as the service process.

import { randomUUID } from "node:crypto";
import { ReflexLoop } from "../loop.ts";
import type { Driver } from "../driver/driver.ts";
import type { ApprovalRequest, BrowserAction, Observation, Outcome, Planner, ReflexProvider, RunStats, StepRecord } from "../types.ts";
import { BROWSER_ACTION_SCHEMA, RUN_EVENT_SCHEMA } from "./events.ts";
import type { RunEvent, RunStatus, RunStatsWire } from "./events.ts";

export interface StartRunRequest {
  goal: string;
  /** Page to open before the first step. */
  url?: string;
  /** Name of a persistent profile under the profiles dir. Null uses a fresh browser. */
  profile?: string;
  /** Hosts the run may visit. "file" allows local files. */
  allowlist?: string[];
  costCapUsd?: number;
  maxSteps?: number;
  /** Show the browser window. Use with Xvfb and a VNC server (docs/live-view.md). */
  headed?: boolean;
}

export interface RunDriver {
  driver: Driver;
  close: () => Promise<void>;
}

export interface Models {
  reflex: ReflexProvider;
  planner: Planner;
}

export type DriverFactory = (request: StartRunRequest) => Promise<RunDriver>;
export type ModelFactory = (request: StartRunRequest) => Models;

export interface Notifier {
  approvalNeeded(input: { runId: string; question: string; url: string }): Promise<void>;
  runFinished(input: { runId: string; outcome: Outcome; reason: string | null }): Promise<void>;
}

export interface RunManagerOptions {
  createDriver: DriverFactory;
  createModels: ModelFactory;
  notifier?: Notifier | null;
  /** How long an approval request waits for a human. Default 5 minutes. */
  approvalTimeoutMs?: number;
  /** Finished runs kept in memory. The oldest goes first. Default 100. */
  maxRuns?: number;
  now?: () => Date;
}

export interface RunView {
  id: string;
  status: RunStatus;
  goal: string;
  url: string | null;
  profile: string | null;
  allowlist: string[];
  createdAt: string;
  finishedAt: string | null;
  outcome: Outcome | null;
  reason: string | null;
  stats: RunStats | null;
  currentUrl: string | null;
  steps: number;
}

export interface EventPage {
  events: RunEvent[];
  next: number;
}

/** An error a client can act on. The server turns the status into the HTTP code. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

interface RunState {
  id: string;
  request: StartRunRequest;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  outcome: Outcome | null;
  reason: string | null;
  stats: RunStats | null;
  currentUrl: string | null;
  steps: number;
  events: RunEvent[];
  eventSeq: number;
  waiters: Array<() => void>;
  driver: Driver | null;
  close: (() => Promise<void>) | null;
  stopRequested: boolean;
  approval: PendingApproval | null;
  approvalTimer: NodeJS.Timeout | null;
  overrideReason: string | null;
  inspecting: boolean;
  manualStep: number;
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function parseStartRunRequest(body: unknown): StartRunRequest {
  if (body == null || typeof body !== "object" || Array.isArray(body)) throw new ServiceError(400, "The body must be a JSON object.");
  const input = body as Record<string, unknown>;
  const goal = input.goal;
  if (typeof goal !== "string" || goal.trim() === "") throw new ServiceError(400, "goal must be a non-empty string.");
  if (goal.length > 2000) throw new ServiceError(400, "goal must be at most 2000 characters.");

  const request: StartRunRequest = { goal: goal.trim() };

  if (input.url != null) {
    if (typeof input.url !== "string") throw new ServiceError(400, "url must be a string.");
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new ServiceError(400, "url must be an absolute URL.");
    }
    if (!["http:", "https:", "file:"].includes(parsed.protocol)) throw new ServiceError(400, "url must be http, https, or file.");
    request.url = input.url;
  }

  if (input.profile != null) {
    if (typeof input.profile !== "string" || !PROFILE_NAME.test(input.profile)) {
      throw new ServiceError(400, "profile must be 1-64 lowercase letters, digits, dashes, or underscores.");
    }
    request.profile = input.profile;
  }

  if (input.allowlist != null) {
    if (!Array.isArray(input.allowlist) || input.allowlist.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      throw new ServiceError(400, "allowlist must be an array of host names.");
    }
    request.allowlist = input.allowlist.map((entry) => (entry as string).trim().toLowerCase());
  }

  if (input.costCapUsd != null) {
    if (typeof input.costCapUsd !== "number" || !Number.isFinite(input.costCapUsd) || input.costCapUsd < 0) {
      throw new ServiceError(400, "costCapUsd must be a number of zero or more.");
    }
    request.costCapUsd = input.costCapUsd;
  }

  if (input.maxSteps != null) {
    if (typeof input.maxSteps !== "number" || !Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 100) {
      throw new ServiceError(400, "maxSteps must be an integer from 1 to 100.");
    }
    request.maxSteps = input.maxSteps;
  }

  if (input.headed != null) {
    if (typeof input.headed !== "boolean") throw new ServiceError(400, "headed must be true or false.");
    request.headed = input.headed;
  }

  return request;
}

export function parseBrowserAction(body: unknown): BrowserAction {
  if (body == null || typeof body !== "object" || Array.isArray(body)) throw new ServiceError(400, "The body must be a JSON object with an action.");
  const action = (body as Record<string, unknown>).action;
  const parsed = BROWSER_ACTION_SCHEMA.safeParse(action);
  if (!parsed.success) throw new ServiceError(400, "action must be one of click, type, select, goto, scroll, or wait.");
  return parsed.data;
}

type RunEventInput = RunEvent extends unknown ? Omit<RunEvent, "v" | "id" | "runId" | "seq" | "ts"> : never;

export class RunManager {
  private readonly runs = new Map<string, RunState>();
  private readonly options: RunManagerOptions;

  constructor(options: RunManagerOptions) {
    this.options = options;
  }

  start(request: StartRunRequest): RunView {
    const now = this.options.now?.() ?? new Date();
    const run: RunState = {
      id: `run_${randomUUID().slice(0, 12)}`,
      request,
      status: "running",
      createdAt: now.toISOString(),
      finishedAt: null,
      outcome: null,
      reason: null,
      stats: null,
      currentUrl: request.url ?? null,
      steps: 0,
      events: [],
      eventSeq: 0,
      waiters: [],
      driver: null,
      close: null,
      stopRequested: false,
      approval: null,
      approvalTimer: null,
      overrideReason: null,
      inspecting: false,
      manualStep: 0,
    };
    this.runs.set(run.id, run);
    this.evict();
    this.emit(run, {
      type: "run.started",
      data: {
        goal: request.goal,
        url: request.url ?? null,
        profile: request.profile ?? null,
        allowlist: request.allowlist ?? [],
      },
    });
    void this.execute(run);
    return this.view(run);
  }

  list(): RunView[] {
    return [...this.runs.values()].map((run) => this.view(run));
  }

  get(id: string): RunView {
    return this.view(this.require(id));
  }

  async events(id: string, options: { after?: number; follow?: boolean; timeoutMs?: number } = {}): Promise<EventPage> {
    const run = this.require(id);
    const after = options.after ?? 0;
    if (!Number.isInteger(after) || after < 0) throw new ServiceError(400, "after must be zero or a positive integer.");
    if (options.follow && !run.events.some((event) => event.seq > after)) {
      await this.waitForEvent(run, options.timeoutMs ?? 25_000);
    }
    const events = run.events.filter((event) => event.seq > after);
    return { events, next: events.at(-1)?.seq ?? after };
  }

  approve(id: string, approved: boolean): RunView {
    const run = this.require(id);
    if (!run.approval) throw new ServiceError(409, "This run is not waiting for an approval.");
    const pending = run.approval;
    run.approval = null;
    if (run.approvalTimer) clearTimeout(run.approvalTimer);
    run.approvalTimer = null;
    run.status = "running";
    pending.resolve(approved);
    this.emit(run, {
      type: "decision",
      data: {
        step: run.steps,
        by: "human",
        kind: "gate",
        action: null,
        probability: null,
        reason: approved ? "approved by a human" : "denied by a human",
      },
    });
    return this.view(run);
  }

  async stop(id: string): Promise<RunView> {
    const run = this.require(id);
    run.stopRequested = true;
    if (run.approval) {
      const pending = run.approval;
      run.approval = null;
      if (run.approvalTimer) clearTimeout(run.approvalTimer);
      run.approvalTimer = null;
      pending.resolve(false);
    }
    // A finished run keeps its browser for inspection. Stop is the way to close it.
    if (run.driver && this.isTerminal(run)) {
      await this.closeBrowser(run);
    }
    return this.view(run);
  }

  async observe(id: string): Promise<Observation> {
    const run = this.requireOpenBrowser(id);
    if (run.inspecting) throw new ServiceError(409, "Another client action is running on this browser.");
    run.inspecting = true;
    try {
      return await (run.driver as Driver).observe();
    } finally {
      run.inspecting = false;
    }
  }

  async act(id: string, action: BrowserAction): Promise<Observation> {
    const run = this.requireOpenBrowser(id);
    if (action.kind === "goto" && run.request.allowlist && run.request.allowlist.length > 0) {
      const host = hostOf(action.url);
      if (!host || !run.request.allowlist.includes(host)) throw new ServiceError(400, `The host ${host ?? "?"} is outside the allowlist.`);
    }
    if (run.inspecting) throw new ServiceError(409, "Another client action is running on this browser.");
    run.inspecting = true;
    try {
      const driver = run.driver as Driver;
      await driver.execute(action);
      await driver.settle();
      const observation = await driver.observe();
      run.currentUrl = observation.url;
      run.manualStep += 1;
      const text = `${action.kind} by client`;
      this.emit(run, {
        type: "step",
        data: {
          seq: run.manualStep,
          step: run.manualStep,
          kind: "action",
          source: "client",
          probability: null,
          action,
          text,
          result: `now on ${observation.path}`,
          url: observation.url,
          ms: 0,
          costUsd: null,
        },
      });
      return observation;
    } finally {
      run.inspecting = false;
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.runs.values()].map((run) => this.closeBrowser(run)));
  }

  private async execute(run: RunState): Promise<void> {
    let result: Awaited<ReturnType<ReflexLoop["run"]>>;
    try {
      const models = this.options.createModels(run.request);
      const launched = await this.options.createDriver(run.request);
      run.driver = launched.driver;
      run.close = launched.close;
      const first = await launched.driver.observe();
      run.currentUrl = first.url;

      const loop = new ReflexLoop({
        goal: run.request.goal,
        reflex: models.reflex,
        planner: models.planner,
        driver: launched.driver,
        log: { write: (record) => this.record(run, record) },
        maxSteps: run.request.maxSteps,
        allowlist: run.request.allowlist,
        costCapUsd: run.request.costCapUsd,
        shouldStop: () => run.stopRequested,
        gate: {
          approve: (request) => this.waitForApproval(run, request),
        },
      });
      result = await loop.run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = this.options.now?.() ?? new Date();
      run.status = "error";
      run.outcome = "error";
      run.reason = message;
      run.finishedAt = now.toISOString();
      run.stats = null;
      this.emit(run, { type: "run.finished", data: { outcome: "error", reason: message, stats: emptyStats() } });
      void this.options.notifier?.runFinished({ runId: run.id, outcome: "error", reason: message }).catch(() => undefined);
      await this.closeBrowser(run);
      return;
    }

    this.finish(run, result);
    const keepOpen = run.outcome === "paused" || run.outcome === "needs-human-input";
    if (!keepOpen) await this.closeBrowser(run);
  }

  private finish(run: RunState, result: Awaited<ReturnType<ReflexLoop["run"]>>): void {
    const now = this.options.now?.() ?? new Date();
    const stopped = run.stopRequested;
    const outcome: Outcome = stopped ? "paused" : result.outcome;
    const reason = stopped ? "Stopped by the client." : (run.overrideReason ?? result.reason);
    run.status = outcome;
    run.outcome = outcome;
    run.reason = reason;
    run.finishedAt = now.toISOString();
    run.stats = result.stats;
    run.steps = result.steps.length;
    this.emit(run, { type: "run.finished", data: { outcome, reason, stats: asWireStats(result.stats) } });
    void this.options.notifier?.runFinished({ runId: run.id, outcome, reason }).catch(() => undefined);
  }

  private record(run: RunState, record: StepRecord): void {
    run.steps = record.seq;
    run.currentUrl = record.pageAfter.url;
    this.emit(run, {
      type: "step",
      data: {
        seq: record.seq,
        step: record.step,
        kind: record.kind,
        source: record.source,
        probability: record.probability,
        action: record.action,
        text: record.text,
        result: record.result,
        url: record.pageAfter.url,
        ms: record.ms,
        costUsd: record.costUsd ?? null,
      },
    });
    this.emit(run, {
      type: "decision",
      data: {
        step: record.step,
        by: record.source,
        kind: record.kind,
        action: record.action,
        probability: record.probability,
        reason: record.result,
      },
    });
  }

  private waitForApproval(run: RunState, request: ApprovalRequest): Promise<boolean> {
    if (run.stopRequested) return Promise.resolve(false);
    const timeoutMs = this.options.approvalTimeoutMs ?? 300_000;
    run.status = "waiting-approval";
    this.emit(run, { type: "approval.needed", data: { action: request.action, question: request.question, probability: request.probability, url: request.url, timeoutMs } });
    void this.options.notifier?.approvalNeeded({ runId: run.id, question: request.question, url: request.url }).catch(() => undefined);
    return new Promise<boolean>((resolve) => {
      const settle = (approved: boolean): void => {
        if (run.approvalTimer) clearTimeout(run.approvalTimer);
        run.approvalTimer = null;
        run.approval = null;
        run.status = "running";
        resolve(approved);
      };
      run.approval = { resolve: settle };
      run.approvalTimer = setTimeout(() => {
        if (!run.approval) return;
        run.overrideReason = `The approval request timed out after ${Math.round(timeoutMs / 1000)} s.`;
        settle(false);
      }, timeoutMs);
      run.approvalTimer.unref?.();
    });
  }

  // A long-lived service must not grow without limit. Old finished runs go
  // first, and a run that is still working is never evicted.
  private evict(): void {
    const max = this.options.maxRuns ?? 100;
    if (this.runs.size <= max) return;
    for (const [id, run] of this.runs) {
      if (this.runs.size <= max) return;
      if (run.outcome === null) continue;
      this.runs.delete(id);
      void this.closeBrowser(run);
    }
  }

  private async closeBrowser(run: RunState): Promise<void> {
    const close = run.close;
    run.driver = null;
    run.close = null;
    if (!close) return;
    try {
      await close();
    } catch {
      // The browser is already gone. Nothing else to close.
    }
  }

  private require(id: string): RunState {
    const run = this.runs.get(id);
    if (!run) throw new ServiceError(404, `No run ${id}.`);
    return run;
  }

  private requireOpenBrowser(id: string): RunState {
    const run = this.require(id);
    if (run.status === "running" || run.status === "waiting-approval") {
      throw new ServiceError(409, "The run is using the browser. Stop it first.");
    }
    if (!run.driver) throw new ServiceError(409, "This run has no open browser.");
    return run;
  }

  private isTerminal(run: RunState): boolean {
    return run.outcome !== null;
  }

  private view(run: RunState): RunView {
    return {
      id: run.id,
      status: run.status,
      goal: run.request.goal,
      url: run.request.url ?? null,
      profile: run.request.profile ?? null,
      allowlist: run.request.allowlist ?? [],
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      outcome: run.outcome,
      reason: run.reason,
      stats: run.stats,
      currentUrl: run.currentUrl,
      steps: run.steps,
    };
  }

  private emit(run: RunState, event: RunEventInput): void {
    run.eventSeq += 1;
    const full = {
      v: 1,
      id: `${run.id}.${run.eventSeq}`,
      runId: run.id,
      seq: run.eventSeq,
      ts: (this.options.now?.() ?? new Date()).toISOString(),
      ...event,
    } as RunEvent;
    // The schema is the contract. A bad event is a bug, and it must not reach a consumer.
    RUN_EVENT_SCHEMA.parse(full);
    run.events.push(full);
    const waiters = run.waiters.splice(0);
    for (const wake of waiters) wake();
  }

  private waitForEvent(run: RunState, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const index = run.waiters.indexOf(wake);
        if (index !== -1) run.waiters.splice(index, 1);
        resolve();
      };
      const wake = (): void => done();
      const timer = setTimeout(done, Math.max(1, Math.min(timeoutMs, 60_000)));
      timer.unref?.();
      run.waiters.push(wake);
    });
  }
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? "file" : parsed.hostname;
  } catch {
    return null;
  }
}

function emptyStats(): RunStatsWire {
  return {
    reflex: { calls: 0, ms: 0, inputTokens: 0, outputTokens: 0, costUsd: null },
    planner: { calls: 0, ms: 0, costUsd: 0 },
  };
}

function asWireStats(stats: RunStats): RunStatsWire {
  return {
    reflex: { ...stats.reflex },
    planner: { ...stats.planner },
  };
}


