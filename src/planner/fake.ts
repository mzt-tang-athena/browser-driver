// Test fake for the Planner interface (ADR 0003). You inject plain functions for the
// decide and verify roles. Without a script it answers so the loop can notice.

import type { Action, Observation, Planner, PlannerDecision, PlannerVerify } from "../types.ts";

export interface FakePlannerOptions {
  name?: string;
  decide?: (input: { goal: string; observation: Observation; recentSteps: string[]; reason: string }) => Action | Promise<Action>;
  decideReason?: string;
  verify?: (input: { goal: string; observation: Observation }) => { done: boolean; reason: string } | Promise<{ done: boolean; reason: string }>;
}

export class FakePlanner implements Planner {
  readonly name: string;
  private readonly options: FakePlannerOptions;

  constructor(options: FakePlannerOptions = {}) {
    this.options = options;
    this.name = options.name ?? "fake-planner";
  }

  async decide(input: { goal: string; observation: Observation; recentSteps: string[]; reason: string }): Promise<PlannerDecision> {
    const action: Action = this.options.decide ? await this.options.decide(input) : { kind: "blocked", reason: "the fake planner has no decide script" };
    return { action, reason: this.options.decideReason ?? "the fake planner decided", ms: 0, usage: null, costUsd: 0 };
  }

  async verify(input: { goal: string; observation: Observation }): Promise<PlannerVerify> {
    if (!this.options.verify) return { done: false, reason: "the fake planner has no verify script", ms: 0, usage: null, costUsd: 0 };
    const answer = await this.options.verify(input);
    return { ...answer, ms: 0, usage: null, costUsd: 0 };
  }
}
