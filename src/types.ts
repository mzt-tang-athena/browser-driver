// Core types shared by the eyes, the reflex, the planner, and the loop.

export type ElementKind = "click" | "type" | "select";

export interface PageElement {
  /** Playwright aria ref, for example "e12". The actuator locates the element with aria-ref=<ref>. */
  ref: string;
  /** ARIA role from the snapshot. */
  role: string;
  /** Accessible name, truncated at LABEL_CHARS. */
  name: string;
  /** How the actuator can use the element. */
  kind: ElementKind;
  /** Options of a select element, in page order. Empty for other roles. */
  options: string[];
  /** Link target, for links. */
  url: string | null;
  disabled: boolean;
  /** Checkbox and radio state. Null for every other role. */
  checked: boolean | null;
}

/** One choice the reflex can pick. The id is the element ref. */
export interface MenuItem {
  id: string;
  label: string;
  ref: string;
  role: string;
}

export interface Observation {
  url: string;
  path: string;
  title: string;
  /** Page outline cut to fit the reflex context. */
  outline: string;
  fullOutline: string;
  elements: PageElement[];
  menu: MenuItem[];
  /** Text from alert and status regions on the page. */
  messages: string[];
  /** The same fingerprint twice means the page did not change. */
  fingerprint: string;
}

/**
 * Every action the actuator or the planner can run. The reflex only picks menu items,
 * so it can only produce clicks. The planner produces every kind.
 * "human-input" is our own kind: the loop stops and asks a person to act in the browser.
 */
export type Action =
  | { kind: "click"; ref: string; role?: string; label: string }
  | { kind: "type"; ref: string; text: string; label: string }
  | { kind: "select"; ref: string; option: string; label: string }
  | { kind: "goto"; url: string; label: string }
  | { kind: "scroll"; direction: "up" | "down"; label: string }
  | { kind: "wait"; label: string }
  | { kind: "done"; reason: string }
  | { kind: "blocked"; reason: string }
  | { kind: "human-input"; ask: string };

export type Outcome = "done" | "blocked" | "needs-human-input" | "paused" | "max-steps" | "error";

// --- Reflex questions and answers, in the Jev-compatible systemone shape ---

export interface ReflexQuestion {
  type: "choice" | "noul";
  instructions: string;
  criteria: Record<string, string>;
}

export type ReflexQuestions = Record<string, ReflexQuestion>;

export interface ReflexAnswer {
  choice?: string;
  probabilities?: Record<string, number>;
  noul?: number;
}

export type ReflexAnswers = Record<string, ReflexAnswer>;

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

// --- The two role interfaces from ADR 0003 ---

export interface ReflexInput {
  goal: string;
  observation: Observation;
  /** Recent actions as one-line strings, oldest first. */
  recentSteps: string[];
}

export interface ReflexChoice {
  /** Menu item id, which is an element ref. */
  id: string;
  label: string;
  /** Confidence between 0 and 1. Every reflex decision carries one. */
  probability: number;
}

export interface ReflexDecision {
  choice: ReflexChoice | null;
  /** Every menu option with its probability, highest first. Options from different parts are not strictly comparable. */
  options: Array<{ id: string; label: string | null; probability: number; part: string }>;
  /** The reflex answer to "is the goal fully reached on this page?". */
  doneProbability: number;
  ms: number;
  usage: Usage | null;
  /** Known cost of this call in US dollars. Null when the pricing is unknown. */
  costUsd: number | null;
  /** What the model read, kept so the log shows why it chose what it chose. */
  request: { state: string; questions: ReflexQuestions };
  answers: ReflexAnswers;
}

export interface ReflexProvider {
  readonly name: string;
  decide(input: ReflexInput): Promise<ReflexDecision>;
}

export interface PlannerInput {
  goal: string;
  observation: Observation;
  recentSteps: string[];
  /** Why the planner is asked: the reflex was unsure, stuck, or repeated itself. */
  reason: string;
}

export interface PlannerDecision {
  action: Action;
  reason: string;
  ms: number;
  usage: Usage | null;
  /** Known cost of this call in US dollars. Null when the pricing is unknown. */
  costUsd: number | null;
}

export interface PlannerVerify {
  done: boolean;
  reason: string;
  ms: number;
  usage: Usage | null;
  costUsd: number | null;
}

export interface Planner {
  readonly name: string;
  decide(input: PlannerInput): Promise<PlannerDecision>;
  verify(input: { goal: string; observation: Observation }): Promise<PlannerVerify>;
}

// --- The step log ---

/**
 * The full record of one step: what the agent saw, what it asked, what came back,
 * what it did, and what the page looked like after.
 */
export interface StepRecord {
  /** Monotonic record number. Unique per run, one per logged event. */
  seq: number;
  /** The action step this record belongs to. Verify and idle records share the current step. */
  step: number;
  /** "action" is a browser action. "verify" is a planner verify call. "idle" is an answer the loop could not run. */
  kind: "action" | "verify" | "idle";
  goal: string;
  /** Reflex or planner name that decided the step. */
  source: string;
  probability: number | null;
  /** The page the step was decided on. */
  path: string;
  fingerprint: string | null;
  elements: PageElement[];
  menu: MenuItem[];
  questions: ReflexQuestions | null;
  answers: ReflexAnswers | null;
  /** Every offered option with its confidence. */
  options: Array<{ id: string; label: string | null; probability: number; part: string }>;
  /** Null for verify records. */
  action: Action | null;
  /** Short action text, for the history and repeat detection. */
  text: string;
  result: string;
  pageAfter: { url: string; title: string; outline: string };
  ms: number;
}

export interface RunStats {
  reflex: { calls: number; ms: number; inputTokens: number; outputTokens: number; costUsd: number | null };
  planner: { calls: number; ms: number; costUsd: number };
}

export interface RunResult {
  outcome: Outcome;
  reason: string | null;
  steps: StepRecord[];
  stats: RunStats;
}
