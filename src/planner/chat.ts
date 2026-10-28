// The planner: a general chat model on an OpenAI-compatible endpoint (ADR 0003).
// It steps in when the reflex is unsure, stuck, or repeating, and it verifies the
// goal. Every answer is one JSON object. A bad answer gets one retry, then the
// caller sees an error and counts it as an idle answer.

import { buildState } from "../state.ts";
import type { Action, Observation, PageElement, Planner, PlannerDecision, PlannerVerify, Usage } from "../types.ts";

export const OPENCODE_CHAT_BASE_URL = "https://opencode.ai/inference/openai/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 800;

// OpenCode Console list prices, per million tokens (console/models, October 2026).
const CHAT_PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "glm-5.3-flash": { inputPerMTok: 0.15, outputPerMTok: 0.5 },
  "glm-5.3-flash-free": { inputPerMTok: 0, outputPerMTok: 0 },
  "glm-5.3": { inputPerMTok: 1.4, outputPerMTok: 4.4 },
};

export interface ChatPlannerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Prices per million tokens. Without them the cost logs as unknown. */
  pricing?: { inputPerMTok: number; outputPerMTok: number };
}

const SYSTEM =
  "You drive one browser session for a single goal. You see the page outline and a list of clickable items. " +
  "Answer with one JSON object and nothing else. Never invent an element ref. Do not repeat an action that did not help.";

const ACTION_RULES = [
  "Choose the next action. Answer with one JSON object in one of these shapes:",
  '{"action":"click","ref":"e4","reason":"..."}',
  '{"action":"type","ref":"e7","value":"Jane","reason":"..."}',
  '{"action":"select","ref":"e9","option":"Large","reason":"..."}',
  '{"action":"goto","url":"https://example.com/page","reason":"..."}',
  '{"action":"scroll","direction":"down","reason":"..."}',
  '{"action":"wait","reason":"..."}',
  '{"action":"done","reason":"..."}',
  '{"action":"blocked","reason":"..."}',
  '{"action":"human-input","question":"...","reason":"..."}',
  "Rules: click only a ref from the clickable list. Type into a textbox ref. Select an option label that the element lists. " +
    "Use goto for a URL the goal names. Do not repeat an action the recent actions show had no effect. Keep reason to one short sentence.",
].join("\n");

type ChatMessage = { role: "system" | "user"; content: string };

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

// Models sometimes wrap JSON in prose or a code fence. Take the first object.
function parseJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the answer holds no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function labelOf(element: PageElement): string {
  return `${element.role} "${element.name}"`;
}

function parseAction(value: unknown, observation: Observation): Action {
  const answer = asRecord(value);
  const kind = asString(answer.action);
  const reason = asString(answer.reason) ?? "";
  switch (kind) {
    case "click": {
      const ref = asString(answer.ref);
      const element = ref ? observation.elements.find((candidate) => candidate.ref === ref) : undefined;
      if (!element) throw new Error(`click needs a ref from the page, and "${ref ?? ""}" is not on it`);
      const item = observation.menu.find((candidate) => candidate.id === ref);
      if (!item) throw new Error(`"${ref}" is not in the clickable list`);
      return { kind: "click", ref: item.ref, role: element.role, label: item.label };
    }
    case "type": {
      const ref = asString(answer.ref);
      const element = ref ? observation.elements.find((candidate) => candidate.ref === ref) : undefined;
      if (!element) throw new Error(`type needs a ref from the page, and "${ref ?? ""}" is not on it`);
      if (element.kind !== "type") throw new Error(`"${ref}" is not a text field`);
      const text = asString(answer.value);
      if (!text) throw new Error("type needs a non-empty value");
      return { kind: "type", ref: element.ref, text, label: labelOf(element) };
    }
    case "select": {
      const ref = asString(answer.ref);
      const element = ref ? observation.elements.find((candidate) => candidate.ref === ref) : undefined;
      if (!element) throw new Error(`select needs a ref from the page, and "${ref ?? ""}" is not on it`);
      if (element.kind !== "select") throw new Error(`"${ref}" is not a select field`);
      const option = asString(answer.option);
      if (!option) throw new Error("select needs an option label");
      if (element.options.length > 0 && !element.options.includes(option)) {
        throw new Error(`"${option}" is not an option of "${element.name}"; it lists: ${element.options.join(", ")}`);
      }
      return { kind: "select", ref: element.ref, option, label: labelOf(element) };
    }
    case "goto": {
      const target = asString(answer.url);
      if (!target) throw new Error("goto needs a URL");
      let url: URL;
      try {
        url = new URL(target, observation.url);
      } catch {
        throw new Error(`"${target}" is not a URL`);
      }
      if (!["http:", "https:", "file:"].includes(url.protocol)) throw new Error(`"${target}" is not an http, https, or file URL`);
      return { kind: "goto", url: url.href, label: url.href };
    }
    case "scroll": {
      const direction = asString(answer.direction);
      if (direction !== "up" && direction !== "down") throw new Error('scroll needs "direction": "up" or "down"');
      return { kind: "scroll", direction, label: `scroll ${direction}` };
    }
    case "wait":
      return { kind: "wait", label: "wait for the page to settle" };
    case "done":
      return { kind: "done", reason: reason || "the planner says the goal is reached" };
    case "blocked":
      return { kind: "blocked", reason: reason || "the planner says the run cannot go on" };
    case "human-input": {
      const ask = asString(answer.question) ?? reason;
      if (!ask) throw new Error("human-input needs a question");
      return { kind: "human-input", ask };
    }
    default:
      throw new Error(`unknown action "${kind ?? ""}"; use one of the listed shapes`);
  }
}

function decidePrompt(input: { goal: string; observation: Observation; recentSteps: string[]; reason: string }, failure: string | null): string {
  const menu = input.observation.menu.map((item) => `${item.id}: ${item.label}`).join("\n") || "(empty)";
  return [
    buildState(input.goal, input.observation, input.recentSteps),
    `Clickable items:\n${menu}`,
    `Why you are asked: ${input.reason}`,
    ACTION_RULES,
    failure ? `Your last answer could not be used: ${failure}. Answer again.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function verifyPrompt(goal: string, observation: Observation, failure: string | null): string {
  return [
    buildState(goal, observation, []),
    'Question: is the goal fully reached on the page shown right now? Answer with one JSON object: {"done": true or false, "reason": "one short sentence"}. done is true only when the page clearly shows the success state the goal describes.',
    failure ? `Your last answer could not be used: ${failure}. Answer again.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface ChatAnswer {
  content: string;
  usage: Usage;
  ms: number;
}

export class ChatPlanner implements Planner {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pricing: { inputPerMTok: number; outputPerMTok: number } | null;

  constructor(options: ChatPlannerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? OPENCODE_CHAT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pricing = options.pricing ?? CHAT_PRICES[options.model] ?? null;
    this.name = `chat:${options.model}`;
  }

  async decide(input: { goal: string; observation: Observation; recentSteps: string[]; reason: string }): Promise<PlannerDecision> {
    const started = Date.now();
    const totals = { input: 0, output: 0 };
    let failure: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const answer = await this.complete([
        { role: "system", content: SYSTEM },
        { role: "user", content: decidePrompt(input, failure) },
      ]);
      totals.input += answer.usage.input_tokens ?? 0;
      totals.output += answer.usage.output_tokens ?? 0;
      try {
        const parsed = parseJson(answer.content);
        const action = parseAction(parsed, input.observation);
        return {
          action,
          reason: asString(asRecord(parsed).reason) ?? "the planner decided",
          ms: Date.now() - started,
          usage: { input_tokens: totals.input, output_tokens: totals.output },
          costUsd: this.cost(totals),
        };
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (attempt === 2) throw new Error(`The planner answered twice with an action that cannot run: ${failure}`);
      }
    }
    throw new Error("The planner made no answer.");
  }

  async verify(input: { goal: string; observation: Observation }): Promise<PlannerVerify> {
    const started = Date.now();
    const totals = { input: 0, output: 0 };
    let failure: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const answer = await this.complete([
        { role: "system", content: SYSTEM },
        { role: "user", content: verifyPrompt(input.goal, input.observation, failure) },
      ]);
      totals.input += answer.usage.input_tokens ?? 0;
      totals.output += answer.usage.output_tokens ?? 0;
      try {
        const parsed = asRecord(parseJson(answer.content));
        if (typeof parsed.done !== "boolean") throw new Error('the answer needs "done": true or false');
        return {
          done: parsed.done,
          reason: asString(parsed.reason) ?? (parsed.done ? "the planner confirmed the goal" : "the planner says the goal is not reached"),
          ms: Date.now() - started,
          usage: { input_tokens: totals.input, output_tokens: totals.output },
          costUsd: this.cost(totals),
        };
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        if (attempt === 2) throw new Error(`The planner could not verify the goal: ${failure}`);
      }
    }
    throw new Error("The planner gave no verdict.");
  }

  private cost(totals: { input: number; output: number }): number | null {
    if (!this.pricing) return null;
    return (totals.input / 1e6) * this.pricing.inputPerMTok + (totals.output / 1e6) * this.pricing.outputPerMTok;
  }

  private async complete(messages: ChatMessage[]): Promise<ChatAnswer> {
    const started = Date.now();
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, response_format: { type: "json_object" } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`The planner model ${this.model} answered HTTP ${response.status}: ${text.slice(0, 300)}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`The planner model ${this.model} answered with a body that is not JSON: ${text.slice(0, 200)}`);
    }
    const choice = asRecord((asRecord(body).choices as unknown[] | undefined)?.[0]);
    const content = asString(asRecord(choice.message).content);
    if (!content) throw new Error(`The planner model ${this.model} answered with no text`);
    const usage = asRecord(asRecord(body).usage);
    return {
      content,
      usage: { input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0, output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0 },
      ms: Date.now() - started,
    };
  }
}
