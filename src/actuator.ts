// The actuator: run one action in the browser. Ported from the work repo (lib/actions.mjs),
// with scroll added and the human-input kind handled by the loop, not the browser.

import type { Page } from "playwright";
import type { Action } from "./types.ts";

export const ACTION_TIMEOUT_MS = 5000;
// Radios and checkboxes that sit visually hidden behind a styled label cannot take a pointer click.
const HIDDEN_INPUT_TIMEOUT_MS = 1500;
const JS_CLICK_ROLES = new Set(["radio", "checkbox", "switch"]);
const SCROLL_PIXELS = 600;

async function click(page: Page, ref: string, role: string | undefined): Promise<void> {
  const locator = page.locator(`aria-ref=${ref}`);
  try {
    await locator.click({ timeout: role && JS_CLICK_ROLES.has(role) ? HIDDEN_INPUT_TIMEOUT_MS : ACTION_TIMEOUT_MS });
  } catch (error) {
    if (!role || !JS_CLICK_ROLES.has(role)) throw error;
    // A hidden radio fails its pointer click, so the JS click fallback should not wait the full timeout.
    await locator.evaluate((element) => element.click(), undefined, { timeout: ACTION_TIMEOUT_MS });
  }
}

/** Runs the browser part of an action. The done, blocked and human-input kinds never reach this. */
export async function execute(page: Page, action: Action): Promise<void> {
  switch (action.kind) {
    case "click":
      return click(page, action.ref, action.role);
    case "type": {
      const locator = page.locator(`aria-ref=${action.ref}`);
      await locator.fill(action.text, { timeout: ACTION_TIMEOUT_MS });
      // Many forms validate on blur and keep the next step disabled until then.
      await locator.blur({ timeout: ACTION_TIMEOUT_MS }).catch(() => {});
      return undefined;
    }
    case "select": {
      const locator = page.locator(`aria-ref=${action.ref}`);
      await locator.selectOption({ label: action.option }, { timeout: ACTION_TIMEOUT_MS });
      return undefined;
    }
    case "goto": {
      const url = new URL(action.url, page.url()).href;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: ACTION_TIMEOUT_MS * 3 });
      return undefined;
    }
    case "scroll": {
      if (action.direction === "up") await page.mouse.wheel(0, -SCROLL_PIXELS);
      else await page.mouse.wheel(0, SCROLL_PIXELS);
      return undefined;
    }
    case "wait":
      return new Promise((resolve) => setTimeout(resolve, 2000));
    case "done":
    case "blocked":
    case "human-input":
      throw new Error(`The "${action.kind}" kind ends the run. The loop handles it, not the actuator.`);
    default: {
      const never: never = action;
      throw new Error(`Unknown action kind "${JSON.stringify(never)}".`);
    }
  }
}

/** Waits for the page to settle after an action. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(250);
}
