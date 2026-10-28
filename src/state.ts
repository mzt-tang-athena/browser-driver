// The text a model reads about the page. The reflex and the planner share it, so
// both see the same facts in the same order. Ported from the work repo's decider state.

import { HISTORY_FOR_REFLEX, REFLEX_LINE_CHARS } from "./limits.ts";
import type { Observation } from "./types.ts";

const shorten = (text: string, size: number): string => (text.length > size ? `${text.slice(0, size)}…` : text);

/** Goal, page, recent actions. The page comes before the history. */
export function buildState(goal: string, observation: Observation, recentSteps: string[]): string {
  const pageText = [
    `Page: ${observation.title || "(no title)"} | ${observation.path}`,
    observation.messages.length > 0 ? `Messages on the page:\n${observation.messages.map((message) => `- ${message}`).join("\n")}` : "",
    `Page outline ([eN] marks an element the agent can use):\n${observation.outline}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const recent = recentSteps.slice(-HISTORY_FOR_REFLEX).map((line) => shorten(line, REFLEX_LINE_CHARS)).join("\n");
  return [`Goal: ${goal}`, pageText, recent ? `Recent actions (oldest first):\n${recent}` : ""].filter(Boolean).join("\n\n");
}

export function cutOutline(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf("\n")))}\n... (page cut to fit the model's context)`;
}
