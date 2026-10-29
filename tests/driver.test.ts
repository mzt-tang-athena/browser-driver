// The one real-browser test for the Driver port. Eyes, actuator, and settle
// are covered through PlaywrightDriver.

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightDriver } from "../src/driver/playwright.ts";

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(new URL("../fixtures/latte.html", import.meta.url).href, { waitUntil: "load" });
});

afterAll(async () => {
  await browser.close();
});

describe("PlaywrightDriver", () => {
  it("observes, executes, and settles through the port", async () => {
    const driver = new PlaywrightDriver(page);
    const before = await driver.observe();
    const ref = before.elements.find((element) => element.name === "Order latte")?.ref;
    expect(ref).toBeTruthy();

    await driver.execute({ kind: "click", ref: ref as string, role: "button", label: 'click button "Order latte"' });
    await driver.settle();
    const after = await driver.observe();

    expect(after.fullOutline).toContain("Latte ordered. Thank you!");
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.messages.join(" ")).toContain("Latte ordered");
  });
});
