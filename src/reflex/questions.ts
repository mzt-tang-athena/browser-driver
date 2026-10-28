// Builds the choice questions the reflex answers, and reads its answers back.
// Ported from the work repo (lib/systemone.mjs), with types added.

import { LABEL_CHARS, MAX_MENU_PARTS, MAX_OPTIONS, OTHER } from "../limits.ts";
import type { MenuItem, ReflexAnswer, ReflexAnswers, ReflexQuestions } from "../types.ts";

const NEXT_INSTRUCTIONS =
  "Which action should the browser agent take next to move toward the goal? Prefer the main action that moves the flow forward. Do not pick an action that the recent actions show had no effect.";
const DONE_INSTRUCTIONS = "Is the goal fully reached on the page shown right now?";
const DONE_CRITERIA: Record<string, string> = {
  true: "the page clearly shows the success state that the goal describes",
  false: "the flow still has steps left, the page asks for more input, or the page shows an error",
};

const shortLabel = (label: string): string => (label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS)}…` : label);

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Answers may come back keyed by question name or as an ordered list. */
export function answersByName(body: unknown, questionNames: string[]): ReflexAnswers {
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (Array.isArray(answers)) {
    return Object.fromEntries(answers.map((answer, index) => [(answer as { name?: string })?.name ?? questionNames[index], (answer ?? {}) as ReflexAnswer]));
  }
  return (answers as ReflexAnswers | undefined) ?? {};
}

export function probabilityOf(answer: ReflexAnswer | undefined, option: string): number {
  const probability = answer?.probabilities?.[option];
  return typeof probability === "number" ? probability : 0;
}

/**
 * One choice question per menu part, plus the goal question.
 * Long menus are split, and every part needs an escape option.
 */
export function nextActionQuestions(menu: MenuItem[]): ReflexQuestions {
  const questions: ReflexQuestions = {};
  const size = menu.length > MAX_OPTIONS ? MAX_OPTIONS - 1 : MAX_OPTIONS;
  if (menu.length > size * MAX_MENU_PARTS) {
    throw new Error(`The menu has ${menu.length} actions, more than the ${size * MAX_MENU_PARTS} that a decision model rates quickly.`);
  }
  // An empty menu gets only the goal question.
  chunk(menu, size).forEach((items, index) => {
    const criteria: Record<string, string> = Object.fromEntries(items.map((item) => [item.id, shortLabel(item.label)]));
    // Long menus are split. Every part needs an escape option, and a choice needs at least two options.
    if (menu.length > MAX_OPTIONS || items.length < 2) criteria[OTHER] = "none of the actions in this list";
    questions[`next_${index + 1}`] = { type: "choice", instructions: NEXT_INSTRUCTIONS, criteria };
  });
  questions["goal_done"] = { type: "noul", instructions: DONE_INSTRUCTIONS, criteria: DONE_CRITERIA };
  return questions;
}

/** Every menu option with its probability, highest first. Options from different parts are not strictly comparable. */
export function allOptions(answers: ReflexAnswers): Array<{ id: string; probability: number; part: string }> {
  const options: Array<{ id: string; probability: number; part: string }> = [];
  for (const [name, answer] of Object.entries(answers)) {
    if (!name.startsWith("next_")) continue;
    for (const [id, probability] of Object.entries(answer?.probabilities ?? {})) {
      if (id !== OTHER) options.push({ id, probability, part: name });
    }
  }
  return options.sort((a, b) => b.probability - a.probability);
}

/** The best non-escape choice across all menu parts. */
export function pickBest(answers: ReflexAnswers): { id: string; probability: number } | null {
  let best: { id: string; probability: number } | null = null;
  for (const [name, answer] of Object.entries(answers)) {
    if (!name.startsWith("next_") || !answer?.choice || answer.choice === OTHER) continue;
    const probability = probabilityOf(answer, answer.choice);
    if (!best || probability > best.probability) best = { id: answer.choice, probability };
  }
  return best;
}
