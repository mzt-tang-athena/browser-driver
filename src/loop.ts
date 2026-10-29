// The reflex loop: observe, ask the reflex, act, escalate to the planner, verify.
// Ported from the work repo (lib/agent.mjs takeStep, act, record),
// with the work repo escalation constants from src/limits.ts.

import type { Driver } from "./driver/driver.ts";
import { CONFIDENCE_THRESHOLD, DONE_PROBABILITY, IDLE_ANSWERS_PAUSE, MAX_STEPS, REPEAT_ESCALATE, REPEAT_PAUSE, REPEAT_WINDOW, STUCK_ESCALATE, STUCK_PAUSE, VERIFY_COOLDOWN_STEPS } from "./limits.ts";
import { buildState } from "./state.ts";
import type { Action, ApprovalRequest, BrowserAction, FieldOffer, NoulAnswer, Observation, PageElement, Planner, PlannerDecision, PlannerFill, ReflexDecision, ReflexProvider, RunResult, RunStats, StepRecord } from "./types.ts";

export interface LoopOptions {
  goal: string;
  reflex: ReflexProvider;
  planner: Planner;
  driver: Driver;
  log: StepLogSink;
  maxSteps?: number;
  confidenceThreshold?: number;
  doneThreshold?: number;
  /** Fill empty fields and selects before choosing an action. Default true. */
  fillFields?: boolean;
  /** Most fields to offer the planner in one step. Default 6. */
  maxFields?: number;
  /** Hosts the run may visit. Undefined or empty means no limit. "file" allows file URLs. */
  allowlist?: string[];
  /** Ask a human before an irreversible action. Off when absent. */
  gate?: { approve: (request: ApprovalRequest) => Promise<boolean>; threshold?: number };
  /** Stop the run when the model cost reaches this many dollars. */
  costCapUsd?: number;
}

/** The loop hands every record to the sink. The sink prints it, stores it, or both. */
export interface StepLogSink {
  write(record: StepRecord): void;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const firstLine = (text: string): string => String(text).split("\n")[0] as string;
const fieldKey = (path: string, element: PageElement): string => `${path}|${element.ref}|${element.name}`;
const fieldLabel = (element: PageElement): string => `${element.role} "${element.name}"`;

// Words that mark an action as hard to undo. The gate asks the reflex only for these.
const IRREVERSIBLE = /\b(publish|pay|payment|send|delete|remove|transfer|purchase|buy|checkout|place order|submit order|confirm (order|payment|purchase))\b/i;
const GATE_INSTRUCTIONS = "Is this action irreversible, or does it move money or data in a way a person cannot undo?";

const GATE_THRESHOLD = 0.5;
const hostAllowed = (url: string, allowlist: string[] | undefined): boolean => {
  if (!allowlist || allowlist.length === 0) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" ? allowlist.includes("file") : allowlist.includes(parsed.hostname);
  } catch {
    return false;
  }
};

export function describeAction(action: Action): string {
  switch (action.kind) {
    case "type":
      return `type "${action.text}" into ${action.label}`;
    case "select":
      return `select "${action.option}" in ${action.label}`;
    case "goto":
      return `open ${action.url}`;
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
  private seq = 0;
  private noChange = 0;
  private readonly handledFields = new Set<string>();
  /** Values typed during the run. The step log masks every one of them. */
  private readonly typedValues = new Set<string>();
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
      if (this.options.costCapUsd != null && this.costTotal() >= this.options.costCapUsd) {
        this.finish("paused", `Reached the cost cap of $${this.options.costCapUsd.toFixed(4)}.`);
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

  // Every logged event gets its own record number. A verify or an idle answer can
  // share the current action step, so the step number alone is not unique.
  private write(record: Omit<StepRecord, "seq">): void {
    this.seq += 1;
    const entry: StepRecord = { seq: this.seq, ...record };
    this.steps.push(entry);
    this.options.log.write(this.redact(entry));
  }

  // The log keeps the run's shape but not the text the run typed. Typed values
  // are masked everywhere: the action, the step lines, and any page outline
  // that echoes them. Select labels and other page text stay.
  private redact(record: StepRecord): StepRecord {
    const mask = (text: string): string => {
      let out = text;
      for (const value of this.typedValues) {
        if (value === "") continue;
        out = out.split(value).join("***");
      }
      return out;
    };
    const action = record.action?.kind === "type" ? { ...record.action, text: "***" } : record.action;
    return {
      ...record,
      action,
      text: mask(record.text),
      result: mask(record.result),
      elements: record.elements.map((element) => ({ ...element, value: element.value && this.typedValues.has(element.value) ? "***" : element.value })),
      pageAfter: { ...record.pageAfter, outline: mask(record.pageAfter.outline) },
    };
  }

  private costTotal(): number {
    return (this.stats.reflex.costUsd ?? 0) + this.stats.planner.costUsd;
  }

  private recentSteps(): string[] {
    return this.history.map((entry) => `${entry.step}. ${entry.text} -> ${entry.result}`);
  }

  // True when the same action was already run from the same page state. Running it again cannot help.
  private triedFrom(observation: Observation, text: string): boolean {
    return this.steps.some((entry) => entry.kind === "action" && entry.fingerprint === observation.fingerprint && entry.text === text);
  }

  private async takeStep(): Promise<void> {
    const observation = await this.options.driver.observe();
    if (!hostAllowed(observation.url, this.options.allowlist)) {
      this.finish("blocked", `The page is outside the allowlist: ${observation.url}`);
      return;
    }
    // Fields first: the planner writes text before the loop chooses a click.
    if ((this.options.fillFields ?? true) && (await this.fillFields(observation))) return;
    let decision: ReflexDecision | null = null;

    if (!this.forcedReason) {
      decision = await this.options.reflex.decide({ goal: this.options.goal, observation, recentSteps: this.recentSteps() });
      this.trackReflex(decision);
      if (this.verifyCooldown > 0) {
        this.verifyCooldown -= 1;
      } else if (decision.doneProbability >= (this.options.doneThreshold ?? DONE_PROBABILITY)) {
        try {
          await this.verify(observation, decision);
        } catch (error) {
          // A verify that cannot run is an idle answer, not the end of the run.
          const text = `verify failed: ${firstLine(error instanceof Error ? error.message : String(error))}`;
          this.idle(observation, decision, null, text, "The planner could not verify the goal. Asking again.");
          return;
        }
        if (this.outcome) return;
      }
      const choice = decision.choice;
      const item = choice ? observation.menu.find((candidate) => candidate.id === choice.id) : undefined;
      const repeated = item ? this.triedFrom(observation, item.label) : false;
      if (item && choice && !repeated && choice.probability >= (this.options.confidenceThreshold ?? CONFIDENCE_THRESHOLD)) {
        const action: BrowserAction = { kind: "click", ref: item.ref, role: item.role, label: item.label };
        return this.act(observation, action, decision, this.options.reflex.name, choice.probability);
      }
      if (repeated && item) this.forcedReason = `The reflex chose "${item.label}" again, but that was already done from this page state and did not help.`;
      else if (item && choice) this.forcedReason = `The reflex was unsure: its top choice "${item.label}" had ${pct(choice.probability)}.`;
      else this.forcedReason = observation.menu.length > 0 ? "The reflex found no fitting action." : "The page has nothing to click.";
    }

    const reason = this.forcedReason ?? "The planner decides this run.";
    this.forcedReason = null;
    let pick: PlannerDecision;
    try {
      pick = await this.options.planner.decide({ goal: this.options.goal, observation, recentSteps: this.recentSteps(), reason });
    } catch (error) {
      // A model or format failure is an idle answer, not the end of the run.
      const text = `planner failed: ${firstLine(error instanceof Error ? error.message : String(error))}`;
      this.idle(observation, decision, null, text, "The planner failed. Asking again.");
      return;
    }
    this.stats.planner.calls += 1;
    this.stats.planner.ms += pick.ms;
    this.stats.planner.costUsd += pick.costUsd ?? 0;

    if (pick.action.kind === "done") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "goal reached", pick.action.reason);
    if (pick.action.kind === "blocked") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "blocked", pick.action.reason);
    if (pick.action.kind === "human-input") return this.finishWithRecord(observation, decision, pick.action, this.options.planner.name, "needs human input", pick.action.ask);

    // A click, type, or select on an element that is not on the page runs nothing. That is an idle answer.
    const refOk = (action: Action): boolean => {
      if (action.kind !== "click" && action.kind !== "type" && action.kind !== "select") return true;
      return observation.elements.some((element) => element.ref === action.ref);
    };
    if (!refOk(pick.action)) {
      this.idle(observation, decision, pick.action, describeAction(pick.action), `The planner answered with something the agent could not run (${JSON.stringify(pick.action)}).`);
      return;
    }

    // The planner gets one chance to change its mind about a repeat. If it insists, the loop trusts it.
    const text = describeAction(pick.action);
    const repeatKey = `${observation.fingerprint}|${text}`;
    if (this.triedFrom(observation, text) && this.challengedRepeat !== repeatKey) {
      this.challengedRepeat = repeatKey;
      this.forcedReason = `You chose "${text}", which was already done from this page state and did not help. Choose something else, or choose it again only if you are sure it is right now.`;
      this.idle(observation, decision, pick.action, text, "The planner repeated an action that did not help. Asking again.");
      return;
    }
    await this.act(observation, pick.action, decision, this.options.planner.name, null);
  }

  // The field phase: ask the planner for values before the loop chooses an action.
  // Empty text fields and selects are offered once. A field the planner leaves
  // alone stays alone, so the loop does not ask again for it.
  private async fillFields(observation: Observation): Promise<boolean> {
    const candidates = observation.elements
      .filter((element) => !element.disabled)
      .filter((element) => (element.kind === "type" && (element.value == null || element.value === "")) || element.kind === "select")
      .filter((element) => !this.handledFields.has(fieldKey(observation.path, element)))
      .slice(0, this.options.maxFields ?? 6);
    if (candidates.length === 0) return false;

    const offers: FieldOffer[] = candidates.map((element) => ({
      ref: element.ref,
      role: element.role,
      name: element.name,
      kind: element.kind === "select" ? "select" : "type",
      value: element.value,
      options: element.options,
    }));

    let fill: PlannerFill;
    try {
      fill = await this.options.planner.fill({ goal: this.options.goal, observation, recentSteps: this.recentSteps(), fields: offers });
    } catch (error) {
      const text = `fill failed: ${firstLine(error instanceof Error ? error.message : String(error))}`;
      this.idle(observation, null, null, text, "The planner could not fill the fields. Asking again.");
      return true;
    }
    this.stats.planner.calls += 1;
    this.stats.planner.ms += fill.ms;
    this.stats.planner.costUsd += fill.costUsd ?? 0;
    for (const element of candidates) this.handledFields.add(fieldKey(observation.path, element));

    const actions: BrowserAction[] = [];
    for (const answer of fill.fields) {
      const element = candidates.find((candidate) => candidate.ref === answer.ref);
      if (!element || answer.value == null || answer.value === "") continue;
      if (element.kind === "select") {
        if (element.options.length > 0 && !element.options.includes(answer.value)) continue;
        actions.push({ kind: "select", ref: element.ref, option: answer.value, label: fieldLabel(element) });
      } else {
        actions.push({ kind: "type", ref: element.ref, text: answer.value, label: fieldLabel(element) });
      }
    }

    const filled = actions.map((action) => (action.kind === "type" ? `${action.label}="${action.text}"` : action.kind === "select" ? `${action.label}="${action.option}"` : action.label));
    // Register the typed values before the field record is written, so the log masks them too.
    for (const action of actions) if (action.kind === "type") this.typedValues.add(action.text);
    this.write({
      step: this.step,
      kind: "field",
      goal: this.options.goal,
      source: this.options.planner.name,
      probability: null,
      path: observation.path,
      fingerprint: observation.fingerprint,
      elements: observation.elements,
      menu: observation.menu,
      questions: null,
      answers: null,
      options: [],
      action: null,
      text: `fill ${offers.length} field(s)`,
      result: actions.length > 0 ? `filled ${filled.join(", ")}` : `left alone: ${offers.map((offer) => offer.name).join(", ")}`,
      pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
      ms: fill.ms,
      costUsd: fill.costUsd,
    });

    for (const action of actions) await this.act(observation, action, null, this.options.planner.name, null);
    return actions.length > 0;
  }

  // A planner answer that runs nothing moves the run nowhere. A few in a row need a human.
  // Every idle answer is logged, so the step log shows the dead ends too.
  private idle(observation: Observation, decision: ReflexDecision | null, action: Action | null, text: string, note: string): void {
    this.idleAnswers += 1;
    this.write({
      step: this.step,
      kind: "idle",
      goal: this.options.goal,
      source: this.options.planner.name,
      probability: null,
      path: observation.path,
      fingerprint: observation.fingerprint,
      elements: observation.elements,
      menu: observation.menu,
      questions: decision?.request.questions ?? null,
      answers: decision?.answers ?? null,
      options: decision?.options ?? [],
      action,
      text,
      result: note,
      pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
      ms: 0,
    });
    this.history.push({ step: this.step, text, result: note });
    if (this.idleAnswers < IDLE_ANSWERS_PAUSE) return;
    this.finish("paused", `The planner gave ${this.idleAnswers} answers in a row that the agent could not run.`);
    this.idleAnswers = 0;
  }

  private async verify(observation: Observation, decision: ReflexDecision): Promise<void> {
    const answer = await this.options.planner.verify({ goal: this.options.goal, observation });
    this.stats.planner.calls += 1;
    this.stats.planner.ms += answer.ms;
    this.stats.planner.costUsd += answer.costUsd ?? 0;
    this.write({
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
    });
    if (answer.done) {
      this.finish("done", answer.reason);
      return;
    }
    this.verifyCooldown = VERIFY_COOLDOWN_STEPS;
    this.history.push({ step: this.step, text: "checked if the goal is reached", result: `not yet: ${answer.reason}` });
  }

  private finishWithRecord(observation: Observation, decision: ReflexDecision | null, action: Action, source: string, result: string, reason: string): void {
    this.write({
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
    });
    this.history.push({ step: this.step, text: describeAction(action), result });
    this.finish(action.kind === "done" ? "done" : action.kind === "blocked" ? "blocked" : "needs-human-input", reason);
  }

  private async act(observation: Observation, action: BrowserAction, decision: ReflexDecision | null, source: string, probability: number | null): Promise<void> {
    const text = describeAction(action);

    // Never leave the allowlist, even when the planner names the URL.
    if (action.kind === "goto" && !hostAllowed(action.url, this.options.allowlist)) {
      this.write({
        step: this.step,
        kind: "guard",
        goal: this.options.goal,
        source: "guard",
        probability: null,
        path: observation.path,
        fingerprint: observation.fingerprint,
        elements: observation.elements,
        menu: observation.menu,
        questions: null,
        answers: null,
        options: [],
        action,
        text,
        result: `refused: the URL is outside the allowlist`,
        pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
        ms: 0,
      });
      this.finish("blocked", `Refused to open ${action.url}: it is outside the allowlist.`);
      return;
    }

    // Ask the reflex whether the action is hard to undo. A likely yes asks the human.
    if (this.options.gate && IRREVERSIBLE.test(text)) {
      let answer;
      try {
        answer = await this.options.reflex.askNoul({
          state: `${buildState(this.options.goal, observation, this.recentSteps())}\n\nAction: ${text}`,
          instructions: GATE_INSTRUCTIONS,
        });
      } catch (error) {
        this.finish("blocked", `The approval gate could not ask the reflex: ${firstLine(error instanceof Error ? error.message : String(error))}`);
        return;
      }
      this.trackNoul(answer);
      if (answer.probability >= (this.options.gate.threshold ?? GATE_THRESHOLD)) {
        const approved = await this.options.gate.approve({ action, question: `Approve this action: ${text}`, probability: answer.probability, url: observation.url, fingerprint: observation.fingerprint });
        this.write({
          step: this.step,
          kind: "gate",
          goal: this.options.goal,
          source: this.options.reflex.name,
          probability: answer.probability,
          path: observation.path,
          fingerprint: observation.fingerprint,
          elements: observation.elements,
          menu: observation.menu,
          questions: null,
          answers: null,
          options: [],
          action,
          text: `approval gate: ${text}`,
          result: approved ? `approved (reflex ${pct(answer.probability)})` : `denied (reflex ${pct(answer.probability)})`,
          pageAfter: { url: observation.url, title: observation.title, outline: observation.outline },
          ms: answer.ms,
          costUsd: answer.costUsd,
        });
        if (!approved) {
          this.finish("blocked", "The human denied the action.");
          return;
        }
      }
    }

    const started = Date.now();
    this.step += 1;
    if (action.kind === "type") this.typedValues.add(action.text);
    let failure: string | null = null;
    try {
      await this.options.driver.execute(action);
    } catch (error) {
      failure = firstLine(error instanceof Error ? error.message : String(error));
    }
    await this.options.driver.settle();
    const after = await this.options.driver.observe();
    const escaped = !hostAllowed(after.url, this.options.allowlist);
    const changed = after.fingerprint !== observation.fingerprint;
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
    // The count includes the action just run, like the work repo counts after it pushed the step.
    const windowStart = Math.max(0, this.steps.length - REPEAT_WINDOW + 1);
    const repeats = this.steps.slice(windowStart).filter((entry) => entry.kind === "action" && entry.path === observation.path && entry.text === text).length + 1;
    if (repeats >= REPEAT_PAUSE) this.finish("paused", `The agent is looping: it did "${text}" ${repeats} times on ${observation.path}.`);
    else if (repeats >= REPEAT_ESCALATE) this.forcedReason ??= `"${text}" was done ${repeats} times on this page without reaching the goal. Do something different, or ask for human input.`;

    this.write({
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
    });
    this.history.push({ step: this.step, text, result });
    this.idleAnswers = 0;
    if (escaped) this.finish("blocked", `The action left the allowlist: ${after.url}`);
  }

  private trackNoul(answer: NoulAnswer): void {
    this.stats.reflex.calls += 1;
    this.stats.reflex.ms += answer.ms;
    this.stats.reflex.inputTokens += answer.usage?.input_tokens ?? 0;
    this.stats.reflex.outputTokens += answer.usage?.output_tokens ?? 0;
    if (answer.costUsd != null) {
      this.stats.reflex.costUsd ??= 0;
      this.stats.reflex.costUsd += answer.costUsd;
    }
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
