// The real browser behind a run. A named profile keeps cookies and logins
// between runs. Headed mode needs a display: Xvfb plus VNC (docs/live-view.md).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { PlaywrightDriver } from "../driver/playwright.ts";
import type { DriverFactory, RunDriver, StartRunRequest } from "./runs.ts";

export interface BrowserOptions {
  /** Where named profiles live. One directory per profile. */
  profilesDir: string;
}

const VIEWPORT = { width: 1280, height: 800 };

export function createDriverFactory(options: BrowserOptions): DriverFactory {
  return async (request: StartRunRequest): Promise<RunDriver> => {
    const headless = !request.headed;
    if (request.profile) {
      const dir = join(options.profilesDir, request.profile);
      mkdirSync(dir, { recursive: true });
      const context = await chromium.launchPersistentContext(dir, { headless, viewport: VIEWPORT });
      try {
        const page = context.pages()[0] ?? (await context.newPage());
        if (request.url) await page.goto(request.url, { waitUntil: "load" });
        return { driver: new PlaywrightDriver(page), close: () => context.close() };
      } catch (error) {
        await context.close();
        throw error;
      }
    }

    const browser = await chromium.launch({ headless });
    try {
      const page = await browser.newPage({ viewport: VIEWPORT });
      if (request.url) await page.goto(request.url, { waitUntil: "load" });
      return { driver: new PlaywrightDriver(page), close: () => browser.close() };
    } catch (error) {
      await browser.close();
      throw error;
    }
  };
}
