// The browser boundary. The loop talks to this port, never to Playwright.
// The Playwright driver implements it today. The HTTP driver client for the
// service (ticket 0003) will implement the same three methods.

import type { BrowserAction, Observation } from "../types.ts";

export interface Driver {
  /** Read the page: elements, menu, outline, fingerprint. */
  observe(): Promise<Observation>;
  /** Run one browser action. Run-ending kinds never reach this call. */
  execute(action: BrowserAction): Promise<void>;
  /** Wait for the page to settle after an action. */
  settle(): Promise<void>;
}
