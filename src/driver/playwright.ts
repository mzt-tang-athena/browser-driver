// The Playwright driver: the one place that owns a Page.
// It wraps the eyes and the actuator behind the Driver port.

import type { Page } from "playwright";
import { execute, settle } from "../actuator.ts";
import { observe } from "../eyes.ts";
import type { Action, Observation } from "../types.ts";
import type { Driver } from "./driver.ts";

export class PlaywrightDriver implements Driver {
  constructor(private readonly page: Page) {}

  observe(): Promise<Observation> {
    return observe(this.page);
  }

  execute(action: Action): Promise<void> {
    return execute(this.page, action);
  }

  settle(): Promise<void> {
    return settle(this.page);
  }
}
