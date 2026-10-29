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
      // The reflex declines, so the planner does all the work.
      reflex: new FakeReflex({}),
      planner: new FakePlanner({
        decide: (input) => {
          const { observation } = input;
          if (says(observation, /order placed for jane \(large\)/i)) return { kind: "done", reason: "the order is placed" };
          const name = observation.elements.find((element) => element.name === "Your name");
          const size = observation.elements.find((element) => element.name === "Size");
          const place = observation.menu.find((entry) => /place order/i.test(entry.label));
          if (name && !/= "Jane"/.test(observation.fullOutline)) return { kind: "type", ref: name.ref, text: "Jane", label: 'textbox "Your name"' };
          if (size && !/= "Large"/.test(observation.fullOutline)) return { kind: "select", ref: size.ref, option: "Large", label: 'combobox "Size"' };
          if (place) return { kind: "click", ref: place.ref, label: place.label };
          return { kind: "blocked", reason: "the form has no place button" };
        },
        verify: () => ({ done: false, reason: "the planner finishes this run itself" }),
      }),
    }),
  },
  {
    name: "select",
    goal: "Use express shipping",
    fixture: "select.html",
    expect: "done",
    fake: () => ({
      reflex: new FakeReflex({}),
      planner: new FakePlanner({
        decide: (input) => {
          const { observation } = input;
          if (says(observation, /shipping: express/i)) return { kind: "done", reason: "express shipping is saved" };
          const field = observation.elements.find((element) => element.name === "Shipping");
          const save = observation.menu.find((entry) => /save/i.test(entry.label));
          if (field && !/= "Express"/.test(observation.fullOutline)) return { kind: "select", ref: field.ref, option: "Express", label: 'combobox "Shipping"' };
          if (save) return { kind: "click", ref: save.ref, label: save.label };
          return { kind: "blocked", reason: "the shipping form is incomplete" };
        },
        verify: () => ({ done: false, reason: "the planner finishes this run itself" }),
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
