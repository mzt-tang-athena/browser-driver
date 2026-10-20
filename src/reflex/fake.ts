// Test fake for the ReflexProvider interface (ADR 0003: one implementation never stands
// alone as proof of the contract). It follows rules instead of a model.

import type { Observation, ReflexDecision, ReflexProvider, ReflexQuestions } from "../types.ts";
import { nextActionQuestions } from "./questions.ts";

/** A "when" rule answers the goal question when the page text matches. */
export type FakeRule =
  | { when: RegExp; done: number }
  | { pick: RegExp; confidence?: number };

export interface FakeReflexOptions {
  rules?: FakeRule[];
  name?: string;
}

const DEFAULT_CONFIDENCE = 0.92;

export class FakeReflex implements ReflexProvider {
  readonly name: string;
  private readonly rules: FakeRule[];

  constructor(options: FakeReflexOptions = {}) {
    this.rules = options.rules ?? [];
    this.name = options.name ?? "fake-reflex";
  }

  async decide(input: { goal: string; observation: Observation; recentSteps: string[] }): Promise<ReflexDecision> {
    const observation = input.observation;
    const menu = observation.menu;
    const pageText = `${observation.title}\n${observation.fullOutline}`;
    const doneRule = this.rules.find((rule): rule is Extract<FakeRule, { when: RegExp }> => "when" in rule && rule.when.test(pageText));
    const pickRule = doneRule ? undefined : this.rules.find((rule): rule is Extract<FakeRule, { pick: RegExp }> => "pick" in rule && menu.some((item) => rule.pick.test(item.label)));
    const item = pickRule ? menu.find((candidate) => (pickRule as Extract<FakeRule, { pick: RegExp }>).pick.test(candidate.label)) : undefined;
    const questions: ReflexQuestions = nextActionQuestions(menu);
    return {
      choice: item ? { id: item.id, label: item.label, probability: pickRule?.confidence ?? DEFAULT_CONFIDENCE } : null,
      options: item ? [{ id: item.id, label: item.label, probability: pickRule?.confidence ?? DEFAULT_CONFIDENCE, part: "next_1" }] : [],
      doneProbability: doneRule?.done ?? 0,
      ms: 0,
      usage: null,
      costUsd: null,
      request: { state: `FakeReflex read:\n${pageText}`, questions },
      answers: {},
    };
  }
}
