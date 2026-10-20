// The reflex loop: observe, ask the reflex, act, escalate to the planner, verify.
// Ported from michaeltang-hnry/hnry-drive (lib/agent.mjs takeStep, act, record),
// with the hnry-drive escalation constants from src/limits.ts.

import { execute, settle } from "./actuator.ts";
import { observe } from "./eyes.ts";
import { CONFIDENCE_THRESHOLD, DONE_PROBABILITY, IDLE_ANSWERS_PAUSE, MAX_STEPS, REPEAT_ESCALATE, REPEAT_PAUSE, REPEAT_WINDOW, STUCK_ESCALATE, STUCK_PAUSE, VERIFY_COOLDOWN_STEPS } from "./limits.ts";
import type { Action, Observation, Planner, ReflexDecision, ReflexProvider, RunResult, RunStats, StepRecord } from "./types.ts";

export interface LoopOptions {
  goal: string;
  reflex: ReflexProvider;
  planner: Planner;
  page: import("playwright").Page;
  log: StepLogSink;
  maxSteps?: number;
  confidenceThreshold?: number;
  doneThreshold?: number;
}

/** The loop hands every record to the sink. The sink prints it, stores it, or both. */
export interface StepLogSink {
  write(record: StepRecord): void;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const firstLine = (text: string): string => String(text).split("\n")[0] as string;

export function describeAction(action: Action): string {
  switch (action.kind) {
    case "type":
      return `type "${action.text}" into ${action.label}`;
    case "scroll":
      return `scroll ${action.direction}`;
    case "wait":
      return "wait for the page to settle";
    case "done":
      return "declared the goal reached";
    case "blocked":
      return `blocked: ${action.reason}`;
    case "human-input":
      return `asked for human input: ${action.ask}`;
    case "click":
      return action.label;
  }
}

export class ReflexLoop {
  private readonly options: LoopOptions;
  private readonly steps: StepRecord[] = [];
  private readonly history: Array<{ step: number; text: string; result: string }> = [];
  private readonly stats: RunStats = {
    reflex: { calls: 0, ms: 0, inputTokens: 0, outputTokens: 0, costUsd: null },
    planner: { calls: 0, ms: 0, costUsd: 0 },
  };
  private step = 0;
  private noChange = 0;
  private idleAnswers = 0;
  private verifyCooldown = 0;
  private forcedReason: string | null = null;
  private challengedRepeat: string | null = null;
  private outcome: RunResult["outcome"] | null = null;
  private outcomeReason: string | null = null;

  constructor(options: LoopOptions) {
    this.options = options;
  }

  async run(): Promise<RunResult> {
    while (this.outcome === null) {
      if (this.step >= (this.options.maxSteps ?? MAX_STEPS)) {
        this.finish("max-steps", `Reached the step limit of ${this.options.maxSteps ?? MAX_STEPS}.`);
        break;
      }
      try {
        await this.takeStep();
      } catch (error) {
        this.finish("error", firstLine(error instanceof Error ? error.message : String(error)));
      }
    }
    return { outcome: this.outcome as RunResult["outcome"], reason: this.outcomeReason, steps: this.steps, stats: this.stats };
  }

  private finish(outcome: RunResult["outcome"], reason: string): void {
    this.outcome ??= outcome;
    this.outcomeReason ??= reason;
  }

  private recentSteps(): string[] {
    return this.history.map((entry) => `${entry.step}. ${entry.text} -> ${entry.result}`);
  }

  // True when the same action was already run from the same page state. Running it again cannot help.
  private triedFrom(observation: Observation, text: string): boolean {
    return this.steps.some((entry) => entry.kind === "action" && entry.fingerprint === observation.fingerprint && entry.text === text);
  }

  private async takeStep(): Promise<void> {
    const observation = await observe(this.options.page);
    let decision: ReflexDecision | null = null;

    if (!this.forcedReason) {
      decision = await this.options.reflex.decide({ goal: this.options.goal, observation, recentSteps: this.recentSteps() });
      this.trackReflex(decision);
      if (this.verifyCooldown > 0) {
        this.verifyCooldown -= 1;
      } else if (decision.doneProbability >= (this.options.doneThreshold ?? DONE_PROBABILITY)) {
        await this.verify(observation, decision);
        if (this.outcome) return;
      }
      const choice = decision.choice;
      const item = choice ? observation.menu.find((candidate) => candidate.id === choice.id) : undefined;
      const repeated = item ? this.triedFrom(observation, item.label) : false;
      if (item && choice && !repeated && choice.probability >= (this.options.confidenceThreshold ?? CONFIDENCE_THRESHOLD)) {
        const action: Action = { kind: "click", ref: item.ref, role: item.role, label: item.label };
        return this.act(observation, action, decision, this.options.reflex.name, choice.probability);
      }
      if (repeated && item) this.forcedReason = `The reflex chose "${item.label}" again, but that was already done from this page state and did not help.`;
      else if (item && choice) this.forcedReason = `The reflex was unsure: its top choice "${item.label}" had ${pct(choice.probability)}.`;
      else this.forcedReason = observation.menu.length > 0 ? "The reflex found no fitting action." : "The page has nothing to click.";
    }

    const reason = this.forcedReason ?? "The planner decides this run.";
    this.forcedReason = null;
    const pick = await this.options.planner.decide({ goal: this.options.goal, observation, recentSteps: this.recentSteps(), reason });
    this.stats.planner.calls += 1;
    this.stats.planner.ms += pick.ms;

    if (pick.action.kind === "done") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "goal reached", pick.action.reason);
    if (pick.action.kind === "blocked") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "blocked", pick.action.reason);
    if (pick.action.kind === "human-input") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "needs human input", pick.action.ask);

    // A click or type on an element that is not on the page runs nothing. That is an idle answer.
    const refOk = (action: Action): boolean => {
      if (action.kind !== "click" && action.kind !== "type") return true;
      return observation.elements.some((element) => element.ref === action.ref);
    };
    if (!refOk(pick.action)) {
      this.idle(pick.action, `The planner answered with something the agent could not run (${JSON.stringify(pick.action)}).`);
      return;
    }

    // The planner gets one chance to change its mind about a repeat. If it insists, the loop trusts it.
    const text = describeAction(pick.action);
    const repeatKey = `${observation.fingerprint}|${text}`;
    if (this.triedFrom(observation, text) && this.challengedRepeat !== repeatKey) {
      this.challengedRepeat = repeatKey;
      this.forcedReason = `You chose "${text}", which was already done from this page state and did not help. Choose something else, or choose it again only if you are sure it is right now.`;
      this.idle(pick.action, "The planner repeated an action that did not help. Asking again.");
      return;
    }
    await this.act(observation, pick.action, decision, this.options.planner.name, null);
  }

  // A planner answer that runs nothing moves the run nowhere. A few in a row need a human.
  private idle(action: Action, note: string): void {
    this.idleAnswers += 1;
    this.history.push({ step: this.step, text: describeAction(action), result: note });
    if (this.idleAnswers < IDLE_ANSWERS_PAUSE) return;
    this.finish("paused", `The planner gave ${this.idleAnswers} answers in a row that the agent could not run.`);
    this.idleAnswers = 0;
  }

  private async verify(observation: Observation, decision: ReflexDecision): Promise<void> {
    const answer = await this.options.planner.verify({ goal: this.options.goal, observation });
    this.stats.planner.calls += 1;
    this.stats.planner.ms += answer.ms;
    const record: StepRecord = {
      step: this.step,
      kind: "verify",
      goal: this.options.goal,
      source: this.options.planner.name,
      probability: decision.doneProbability,
      path: observation.path,
      fingerprint: observation.fingerprint,
      elements: observation.elements,
      menu: observation.menu,
      questions: decision.request.questions,
      answers: decision.answers,
      options: decision.options,
      action: null,
      text: "checked if the goal is reached",
      result: answer.done ? `done: ${answer.reason}` : `not yet: ${answer.reason}`,
      pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
      ms: answer.ms,
    };
    this.steps.push(record);
    this.options.log.write(record);
    if (answer.done) {
      this.finish("done", answer.reason);
      return;
    }
    this.verifyCooldown = VERIFY_COOLDOWN_STEPS;
    this.history.push({ step: this.step, text: "checked if the goal is reached", result: `not yet: ${answer.reason}` });
  }

  private finishWithRecord(observation: Observation, decision: ReflexDecision | null, action: Action, source: string, result: string, reason: string): void {
    const record: StepRecord = {
      step: this.step,
      kind: "action",
      goal: this.options.goal,
      source,
      probability: null,
      path: observation.path,
      fingerprint: observation.fingerprint,
      elements: observation.elements,
      menu: observation.menu,
      questions: decision?.request.questions ?? null,
      answers: decision?.answers ?? null,
      options: decision?.options ?? [],
      action,
      text: describeAction(action),
      result: `${result}: ${reason}`,
      pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
      ms: 0,
    };
    this.steps.push(record);
    this.options.log.write(record);
    this.history.push({ step: this.step, text: describeAction(action), result });
    this.finish(action.kind === "done" ? "done" : action.kind === "blocked" ? "blocked" : "needs-human-input", reason);
  }

  private async act(observation: Observation, action: Action, decision: ReflexDecision | null, source: string, probability: number | null): Promise<void> {
    const started = Date.now();
    this.step += 1;
    let failure: string | null = null;
    try {
      await execute(this.options.page, action);
    } catch (error) {
      failure = firstLine(error instanceof Error ? error.message : String(error));
    }
    await settle(this.options.page);
    const after = await observe(this.options.page);
    const changed = after.fingerprint !== observation.fingerprint;
    const text = describeAction(action);
    const result = changed
      ? after.path !== observation.path
        ? `now on ${after.path}`
        : "page changed"
      : failure
        ? `failed: ${failure}`
        : "no visible change";

    // A failed action or a no-op cannot have moved the goal forward.
    const stuck = result === "no visible change" || result.startsWith("failed");
    this.noChange = stuck ? this.noChange + 1 : 0;
    if (this.noChange >= STUCK_PAUSE) this.finish("paused", `The agent is stuck: the last ${this.noChange} actions changed nothing.`);
    else if (this.noChange >= STUCK_ESCALATE) this.forcedReason = `The last ${this.noChange} actions changed nothing. Try a different approach.`;

    // Repeats are counted separately from stuck steps: a page can change on every try.
    // The count includes the action just run, like hnry-drive counts after it pushed the step.
    const windowStart = Math.max(0, this.steps.length - REPEAT_WINDOW + 1);
    const repeats = this.steps.slice(windowStart).filter((entry) => entry.kind === "action" && entry.path === observation.path && entry.text === text).length + 1;
    if (repeats >= REPEAT_PAUSE) this.finish("paused", `The agent is looping: it did "${text}" ${repeats} times on ${observation.path}.`);
    else if (repeats >= REPEAT_ESCALATE) this.forcedReason ??= `"${text}" was done ${repeats} times on this page without reaching the goal. Do something different, or ask for human input.`;

    const record: StepRecord = {
      step: this.step,
      kind: "action",
      goal: this.options.goal,
      source,
      probability,
      path: observation.path,
      fingerprint: observation.fingerprint,
      elements: observation.elements,
      menu: observation.menu,
      questions: decision?.request.questions ?? null,
      answers: decision?.answers ?? null,
      options: decision?.options ?? [],
      action,
      text,
      result,
      pageAfter: { url: after.url, title: after.title, outline: after.outline },
      ms: Date.now() - started,
    };
    this.steps.push(record);
    this.options.log.write(record);
    this.history.push({ step: this.step, text, result });
    this.idleAnswers = 0;
  }

  private trackReflex(decision: ReflexDecision): void {
    this.stats.reflex.calls += 1;
    this.stats.reflex.ms += decision.ms;
    this.stats.reflex.inputTokens += decision.usage?.input_tokens ?? 0;
    this.stats.reflex.outputTokens += decision.usage?.output_tokens ?? 0;
    if (decision.costUsd != null) {
      this.stats.reflex.costUsd ??= 0;
      this.stats.reflex.costUsd += decision.costUsd;
    }
  }
}
