// Test fake for the Planner interface (ADR 0003). You inject plain functions for the
// decide and verify roles. Without a script it answers so the loop can notice.

import type { Action, FieldAnswer, FieldOffer, Observation, Planner, PlannerDecision, PlannerFill, PlannerVerify } from "../types.ts";

export interface FakePlannerOptions {
  name?: string;
  decide?: (input: { goal: string; observation: Observation; recentSteps: string[]; reason: string }) => Action | Promise<Action>;
  decideReason?: string;
  verify?: (input: { goal: string; observation: Observation }) => { done: boolean; reason: string } | Promise<{ done: boolean; reason: string }>;
  fill?: (input: { goal: string; observation: Observation; recentSteps: string[]; fields: FieldOffer[] }) => FieldAnswer[] | Promise<FieldAnswer[]>;
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

  async fill(input: { goal: string; observation: Observation; recentSteps: string[]; fields: FieldOffer[] }): Promise<PlannerFill> {
    const fields = this.options.fill ? await this.options.fill(input) : [];
    return { fields, reason: fields.length > 0 ? "the fake planner filled the fields" : "the fake planner left the fields alone", ms: 0, usage: null, costUsd: 0 };
  }
}
