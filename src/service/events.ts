// The run event schema: the contract between the driver and every consumer
// (the CLI, ntfy, n8n, the dashboard). Mirrors the published package
// `@mzt-tang-athena/browser-driver@0.1.0` in the `contracts` repo (ADR 0004).
// Change one and change the other in the same day.

import { z } from "zod";

/** The actions the browser can run. Matches `browserAction` in the package. */
export const BROWSER_ACTION_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ref: z.string(), role: z.string().optional(), label: z.string() }),
  z.object({ kind: z.literal("type"), ref: z.string(), text: z.string(), label: z.string() }),
  z.object({ kind: z.literal("select"), ref: z.string(), option: z.string(), label: z.string() }),
  z.object({ kind: z.literal("goto"), url: z.string(), label: z.string() }),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]), label: z.string() }),
  z.object({ kind: z.literal("wait"), label: z.string() }),
]);

/** The actions that end a run. Matches `runEnd` in the package. */
const RUN_END_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done"), reason: z.string() }),
  z.object({ kind: z.literal("blocked"), reason: z.string() }),
  z.object({ kind: z.literal("human-input"), ask: z.string() }),
]);

/** Every action a run can log. Matches `runAction` in the package. */
export const ACTION_SCHEMA = z.union([BROWSER_ACTION_SCHEMA, RUN_END_SCHEMA]);

export const OUTCOME_SCHEMA = z.enum(["done", "blocked", "needs-human-input", "paused", "max-steps", "error"]);

export const RUN_STATUS_SCHEMA = z.enum(["running", "waiting-approval", "done", "blocked", "needs-human-input", "paused", "max-steps", "error"]);

export const RUN_STATS_SCHEMA = z.object({
  reflex: z.object({
    calls: z.number().int().nonnegative(),
    ms: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().nullable(),
  }),
  planner: z.object({
    calls: z.number().int().nonnegative(),
    ms: z.number().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
});

const base = {
  v: z.literal(1),
  id: z.string(),
  runId: z.string(),
  seq: z.number().int().positive(),
  ts: z.string(),
};

export const RUN_EVENT_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("run.started"),
    data: z.object({
      goal: z.string(),
      url: z.string().nullable(),
      profile: z.string().nullable(),
      allowlist: z.array(z.string()),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("run.finished"),
    data: z.object({
      outcome: OUTCOME_SCHEMA,
      reason: z.string().nullable(),
      stats: RUN_STATS_SCHEMA,
    }),
  }),
  z.object({
    ...base,
    type: z.literal("step"),
    data: z.object({
      seq: z.number().int().positive(),
      step: z.number().int().nonnegative(),
      kind: z.enum(["action", "verify", "idle", "field", "guard", "gate"]),
      source: z.string(),
      probability: z.number().min(0).max(1).nullable(),
      action: ACTION_SCHEMA.nullable(),
      text: z.string(),
      result: z.string(),
      url: z.string(),
      ms: z.number().nonnegative(),
      costUsd: z.number().nonnegative().nullable(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("decision"),
    data: z.object({
      step: z.number().int().nonnegative(),
      by: z.string(),
      kind: z.enum(["action", "verify", "idle", "field", "guard", "gate"]),
      action: ACTION_SCHEMA.nullable(),
      probability: z.number().min(0).max(1).nullable(),
      reason: z.string(),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("approval.needed"),
    data: z.object({
      action: BROWSER_ACTION_SCHEMA,
      question: z.string(),
      probability: z.number().min(0).max(1),
      url: z.string(),
      timeoutMs: z.number().int().positive(),
    }),
  }),
]);

export type RunEvent = z.output<typeof RUN_EVENT_SCHEMA>;
export type StepEvent = Extract<RunEvent, { type: "step" }>;
export type ActionWire = z.output<typeof ACTION_SCHEMA>;
export type OutcomeWire = z.output<typeof OUTCOME_SCHEMA>;
export type RunStatsWire = z.output<typeof RUN_STATS_SCHEMA>;
export type RunStatus = z.output<typeof RUN_STATUS_SCHEMA>;
