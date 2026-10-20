// Tests for the ported question building (hnry-drive lib/systemone.mjs patterns):
// max 24 options per choice question, menu chunking with an "other" escape option,
// 90 char label truncation.

import { describe, expect, it } from "vitest";
import { LABEL_CHARS, MAX_OPTIONS } from "../src/limits.ts";
import { allOptions, answersByName, nextActionQuestions, pickBest, probabilityOf } from "../src/reflex/questions.ts";
import type { MenuItem, ReflexAnswers } from "../src/types.ts";

const item = (id: string, label: string): MenuItem => ({ id, label, ref: id, role: "button" });

describe("nextActionQuestions", () => {
  it("asks one choice question plus the goal question for a short menu", () => {
    const questions = nextActionQuestions([item("e1", "click button \"A\""), item("e2", "click button \"B\"")]);
    expect(Object.keys(questions)).toEqual(["next_1", "goal_done"]);
    expect(questions["next_1"]?.criteria).toEqual({ e1: 'click button "A"', e2: 'click button "B"' });
    // A short menu gets no escape option.
    expect(questions["next_1"]?.criteria["other"]).toBeUndefined();
    expect(questions["goal_done"]?.type).toBe("noul");
  });

  it("truncates labels at 90 chars", () => {
    const long = `click button "${"x".repeat(200)}"`;
    const questions = nextActionQuestions([item("e1", long), item("e2", "click button \"B\"")]);
    const label = questions["next_1"]?.criteria["e1"] as string;
    expect(label.length).toBe(LABEL_CHARS + 1); // + the ellipsis character
    expect(label.endsWith("…")).toBe(true);
  });

  it("chunks a long menu and gives every part an escape option", () => {
    const menu = Array.from({ length: 30 }, (_, index) => item(`e${index + 1}`, `click button "B${index}"`));
    const questions = nextActionQuestions(menu);
    expect(Object.keys(questions).filter((name) => name.startsWith("next_"))).toEqual(["next_1", "next_2"]);
    expect(Object.keys(questions["next_1"]?.criteria ?? {})).toHaveLength(MAX_OPTIONS); // 23 items + other
    expect(Object.keys(questions["next_2"]?.criteria ?? {})).toHaveLength(8); // 7 items + other
    expect(questions["next_1"]?.criteria["other"]).toBe("none of the actions in this list");
    expect(questions["next_2"]?.criteria["other"]).toBe("none of the actions in this list");
  });

  it("gives a one-item menu an escape option, because a choice needs two options", () => {
    const questions = nextActionQuestions([item("e1", "click button \"A\"")]);
    expect(questions["next_1"]?.criteria["other"]).toBe("none of the actions in this list");
  });

  it("rejects a menu too long for the part limit", () => {
    const menu = Array.from({ length: 50 }, (_, index) => item(`e${index + 1}`, `click button "B${index}"`));
    expect(() => nextActionQuestions(menu)).toThrow(/more than the/);
  });
});

describe("answers", () => {
  it("reads answers keyed by name or as an ordered list", () => {
    const names = ["next_1", "goal_done"];
    const keyed = answersByName({ answers: { next_1: { choice: "e1" }, goal_done: { noul: 0.5 } } }, names);
    expect(keyed["next_1"]?.choice).toBe("e1");
    const listed = answersByName({ answers: [{ choice: "e1" }, { noul: 0.5 }] }, names);
    expect(listed["goal_done"]?.noul).toBe(0.5);
  });

  it("picks the best non-escape choice across parts", () => {
    const answers: ReflexAnswers = {
      next_1: { choice: "e1", probabilities: { e1: 0.4, other: 0.6 } },
      next_2: { choice: "e9", probabilities: { e9: 0.8, other: 0.2 } },
      goal_done: { noul: 0.1 },
    };
    expect(pickBest(answers)).toEqual({ id: "e9", probability: 0.8 });
    expect(probabilityOf(answers["next_1"], "e1")).toBe(0.4);
    expect(probabilityOf(undefined, "e1")).toBe(0);
    expect(allOptions(answers).map((option) => option.id)).toEqual(["e9", "e1"]);
    // The escape option never wins and never appears as an action option.
    expect(allOptions(answers).some((option) => option.id === "other")).toBe(false);
  });
});
