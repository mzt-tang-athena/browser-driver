// The eval scenarios. Each one is a goal, a local page, and a scripted pair of
// models. The real models run the same scenarios with --live.

import { FakePlanner } from "../src/planner/fake.ts";
import { FakeReflex } from "../src/reflex/fake.ts";
import type { Outcome, Planner, ReflexProvider } from "../src/types.ts";

export interface ScenarioModels {
  reflex: ReflexProvider;
  planner: Planner;
}

export interface EvalScenario {
  name: string;
  goal: string;
  fixture: string;
  /** The outcome the deterministic run must reach. */
  expect: Outcome;
  maxSteps?: number;
  /** The deterministic models. Live models come from the runner. */
  fake: () => ScenarioModels;
}

const clickThroughPage = new URL("./fixtures/click-through.html", import.meta.url).href;

const says = (observation: { fullOutline: string }, pattern: RegExp): boolean => pattern.test(observation.fullOutline);

export const scenarios: EvalScenario[] = [
  {
    name: "click-through",
    goal: "Order a latte",
    fixture: "click-through.html",
    expect: "done",
    fake: () => ({
      reflex: new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] }),
      planner: new FakePlanner({
        verify: (input) => ({
          done: says(input.observation, /latte ordered/i),
          reason: says(input.observation, /latte ordered/i) ? "the order confirmation is on the page" : "the order is not confirmed",
        }),
      }),
    }),
  },
  {
    name: "form",
    goal: "Order a large latte for Jane",
    fixture: "form.html",
    expect: "done",
    fake: () => ({
      // The field phase fills the form, then the reflex clicks the button.
      reflex: new FakeReflex({ rules: [{ when: /order placed/i, done: 0.95 }, { pick: /place order/i }] }),
      planner: new FakePlanner({
        fill: (input) =>
          input.fields.map((field) =>
            field.name === "Your name" ? { ref: field.ref, value: "Jane" } : field.name === "Size" ? { ref: field.ref, value: "Large" } : { ref: field.ref, value: null },
          ),
        verify: (input) => ({
          done: says(input.observation, /order placed for jane \(large\)/i),
          reason: says(input.observation, /order placed for jane \(large\)/i) ? "the order is placed" : "the order is not placed",
        }),
      }),
    }),
  },
  {
    name: "select",
    goal: "Use express shipping",
    fixture: "select.html",
    expect: "done",
    fake: () => ({
      reflex: new FakeReflex({ rules: [{ when: /shipping: express/i, done: 0.95 }, { pick: /save/i }] }),
      planner: new FakePlanner({
        fill: (input) => input.fields.map((field) => (field.name === "Shipping" ? { ref: field.ref, value: "Express" } : { ref: field.ref, value: null })),
        verify: (input) => ({
          done: says(input.observation, /shipping: express/i),
          reason: says(input.observation, /shipping: express/i) ? "express shipping is saved" : "express shipping is not saved",
        }),
      }),
    }),
  },
  {
    name: "dialog",
    goal: "Turn on notifications",
    fixture: "dialog.html",
    expect: "done",
    fake: () => ({
      reflex: new FakeReflex({
        rules: [{ when: /notifications enabled/i, done: 0.95 }, { pick: /enable notifications/i }, { pick: /open settings/i }],
      }),
      planner: new FakePlanner({
        verify: (input) => ({
          done: says(input.observation, /notifications enabled/i),
          reason: says(input.observation, /notifications enabled/i) ? "the page confirms notifications are on" : "notifications are not on yet",
        }),
      }),
    }),
  },
  {
    name: "error",
    goal: "Finish the checkout",
    fixture: "error.html",
    expect: "blocked",
    fake: () => ({
      reflex: new FakeReflex({}),
      planner: new FakePlanner({
        decide: () => ({ kind: "blocked", reason: "the page shows a service error" }),
        verify: () => ({ done: false, reason: "the checkout did not complete" }),
      }),
    }),
  },
  {
    name: "repeat",
    goal: "Read the whole story",
    fixture: "repeat.html",
    expect: "paused",
    fake: () => ({
      reflex: new FakeReflex({ rules: [{ pick: /read more/i, confidence: 0.9 }] }),
      planner: new FakePlanner({
        decide: (input) => {
          const button = input.observation.menu.find((entry) => /read more/i.test(entry.label));
          return button ? { kind: "click", ref: button.ref, label: button.label } : { kind: "wait", label: "wait" };
        },
        verify: () => ({ done: false, reason: "nothing changed" }),
      }),
    }),
  },
  {
    name: "goto",
    goal: "Order a latte from the other page",
    fixture: "goto.html",
    expect: "done",
    fake: () => ({
      reflex: new FakeReflex({ rules: [{ when: /latte ordered/i, done: 0.95 }, { pick: /order latte/i }] }),
      planner: new FakePlanner({
        decide: (input) =>
          input.observation.url.includes("click-through")
            ? { kind: "blocked", reason: "the order page did not load" }
            : { kind: "goto", url: clickThroughPage, label: clickThroughPage },
        verify: (input) => ({
          done: says(input.observation, /latte ordered/i),
          reason: says(input.observation, /latte ordered/i) ? "the order confirmation is on the page" : "the order is not confirmed",
        }),
      }),
    }),
  },
];
