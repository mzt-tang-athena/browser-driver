// A driver for loop tests: no browser. Tests script the page transition and
// read back the actions the loop ran.

import type { Driver } from "../../src/driver/driver.ts";
import type { Action, Observation } from "../../src/types.ts";

export type Transition = (action: Action, current: Observation) => Observation;

export class FakeDriver implements Driver {
  readonly actions: Action[] = [];
  private current: Observation;
  private readonly transition: Transition;

  constructor(start: Observation, transition: Transition = (_action, current) => current) {
    this.current = start;
    this.transition = transition;
  }

  async observe(): Promise<Observation> {
    return this.current;
  }

  async execute(action: Action): Promise<void> {
    this.actions.push(action);
    this.current = this.transition(action, this.current);
  }

  async settle(): Promise<void> {
    // No browser to settle.
  }
}
