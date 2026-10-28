// The reflex implementation: the Jev-compatible /v1/systemone contract (ADR 0003).
// A decision model only picks from the options it is given and returns a probability
// for each option. Ported from the work repo's client. Runs against the TypeSafe cloud,
// a local Ollama, or the OpenCode Console endpoint, by config alone.

import { CHARS_PER_TOKEN, CONTEXT_MARGIN, MIN_OUTLINE_CHARS, REFLEX_CONTEXT_TOKENS } from "../limits.ts";
import { buildState, cutOutline } from "../state.ts";
import type { MenuItem, Observation, ReflexAnswer, ReflexAnswers, ReflexDecision, ReflexProvider, ReflexQuestions, Usage } from "../types.ts";
import { allOptions, answersByName, nextActionQuestions, pickBest } from "./questions.ts";

export interface SystemOneOptions {
  apiKey: string;
  model: string;
  endpoint?: string;
  timeoutMs?: number;
  /** Prices per million tokens. Without them the cost logs as unknown. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

/** TypeSafe's cloud endpoint. OpenCode Console and a local Ollama serve the same contract. */
export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const OPENCODE_CONSOLE_ENDPOINT = "https://opencode.ai/inference/systemone/v1/systemone";
const DEFAULT_TIMEOUT_MS = 120_000;

// OpenCode Console list prices, per million tokens (console/models, October 2026).
// Output is free on both Jev models today.
const JEV_PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "jev-1.13": { inputPerMTok: 0.042, outputPerMTok: 0 },
  "jev-1.13-free": { inputPerMTok: 0, outputPerMTok: 0 },
};

// The outline is cut so the state and the longest question fit the model's context.
// Each question runs as its own sequence, so the longest question counts, not all of them together.
// The goal comes first and is never cut. Ported from the work repo's fittedDeciderState.
function fittedState(goal: string, observation: Observation, recentSteps: string[], questions: ReflexQuestions): string {
  const questionLengths = Object.values(questions).map((question) => JSON.stringify(question).length);
  const budget = Math.floor(REFLEX_CONTEXT_TOKENS * CHARS_PER_TOKEN * CONTEXT_MARGIN);
  const fixed = Math.max(0, ...questionLengths) + buildState(goal, { ...observation, outline: "" }, recentSteps).length;
  const room = Math.max(MIN_OUTLINE_CHARS, budget - fixed);
  return buildState(goal, { ...observation, outline: cutOutline(observation.outline, room) }, recentSteps);
}

export class SystemOneReflex implements ReflexProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly pricing: { inputPerMTok: number; outputPerMTok: number } | null;

  constructor(options: SystemOneOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.endpoint = options.endpoint ?? TYPESAFE_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pricing = options.pricing ?? JEV_PRICES[options.model] ?? null;
    this.name = `systemone:${options.model}`;
  }

  private async ask(state: string, questions: ReflexQuestions): Promise<{ answers: ReflexAnswers; usage: Usage | null; ms: number }> {
    const started = Date.now();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, state, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TypeSafe ${this.model} answered HTTP ${response.status}: ${text.slice(0, 300)}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // A proxy or a maintenance page can answer 200 with HTML. Name it instead of failing on the parse.
      throw new Error(`TypeSafe ${this.model} answered with a body that is not JSON: ${text.slice(0, 200)}`);
    }
    return { answers: answersByName(body, Object.keys(questions)), usage: (body as { usage?: Usage }).usage ?? null, ms: Date.now() - started };
  }

  async decide(input: { goal: string; observation: Observation; recentSteps: string[] }): Promise<ReflexDecision> {
    const { observation } = input;
    const menu = observation.menu;
    const questions = nextActionQuestions(menu);
    const state = fittedState(input.goal, observation, input.recentSteps, questions);
    const { answers, usage, ms } = await this.ask(state, questions);
    const done = answers["goal_done"];
    const best = pickBest(answers);
    const item: MenuItem | undefined = best ? menu.find((candidate) => candidate.id === best.id) : undefined;
    const costUsd = this.pricing && usage ? ((usage.input_tokens ?? 0) / 1e6) * this.pricing.inputPerMTok + ((usage.output_tokens ?? 0) / 1e6) * this.pricing.outputPerMTok : null;
    return {
      choice: best && item ? { id: best.id, label: item.label, probability: best.probability } : null,
      options: allOptions(answers).map((option) => {
        const candidate = menu.find((entry) => entry.id === option.id);
        return { ...option, label: candidate?.label ?? null };
      }),
      doneProbability: typeof (done as ReflexAnswer | undefined)?.noul === "number" ? (done as { noul: number }).noul : 0,
      ms,
      usage,
      costUsd,
      request: { state, questions },
      answers,
    };
  }
}
