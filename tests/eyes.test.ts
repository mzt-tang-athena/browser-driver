// Tests for the eyes and the actuator, against a real browser page.

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, settle } from "../src/actuator.ts";
import { buildMenu, kindOf, observe } from "../src/eyes.ts";

const PAGE_HTML = [
  "<button id='go' name='go'>Order latte</button>",
  `<button id='long'>${"Click ".repeat(30)}now</button>`,
  "<button id='off' disabled>Disabled button</button>",
  "<input id='name' placeholder='Your name' />",
  "<select id='drink'><option value=''>Pick</option><option>Latte</option><option>Tea</option></select>",
  "<a id='mail' href='mailto:cafe@example.com'>Mail us</a>",
  "<a id='home' href='/elsewhere'>Home</a>",
  "<p id='status' role='status'></p>",
].join("\n");

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(`${PAGE_HTML}<script>document.getElementById("go").addEventListener("click", () => { document.getElementById("status").textContent = "Order placed. Thank you!"; });</script>`);
});

afterAll(async () => {
  await browser.close();
});

describe("observe", () => {
  it("numbers every interactive element and truncates long names at 90 chars", async () => {
    const observation = await observe(page);
    const refs = observation.elements.map((element) => element.ref);
    expect(refs.length).toBeGreaterThanOrEqual(6);
    const long = observation.elements.find((element) => element.name.startsWith("Click"));
    expect(long?.name.length).toBe(91); // 90 chars + the ellipsis
    expect(long?.name.endsWith("…")).toBe(true);
  });

  it("maps roles to kinds", () => {
    expect(kindOf("button")).toBe("click");
    expect(kindOf("link")).toBe("click");
    expect(kindOf("textbox")).toBe("type");
    expect(kindOf("combobox")).toBe("select");
  });

  it("builds a click menu without fields, disabled or mailto entries", async () => {
    const observation = await observe(page);
    const labels = observation.menu.map((item) => item.label);
    expect(labels.some((label) => label.includes("Order latte"))).toBe(true);
    expect(labels.some((label) => label.toLowerCase().includes("your name"))).toBe(false);
    expect(labels.some((label) => label.includes("Disabled button"))).toBe(false);
    expect(labels.some((label) => label.toLowerCase().includes("mail us"))).toBe(false);
  });

  it("keeps the fingerprint stable while the page is still, and changes it when the page changes", async () => {
    const first = await observe(page);
    const second = await observe(page);
    expect(second.fingerprint).toBe(first.fingerprint);
    await page.locator("#go").click();
    const third = await observe(page);
    expect(third.fingerprint).not.toBe(first.fingerprint);
    expect(third.messages.join(" ")).toContain("status");
  });

  it("builds the same menu by hand as the observation holds", async () => {
    const observation = await observe(page);
    expect(buildMenu(observation.elements).map((item) => item.id)).toEqual(observation.menu.map((item) => item.id));
  });
});

describe("execute", () => {
  it("clicks by aria ref", async () => {
    const ref = (await observe(page)).elements.find((element) => element.name === "Order latte")?.ref as string;
    await execute(page, { kind: "click", ref, label: "click button \"Order latte\"" });
    expect(await page.locator("#status").textContent()).toBe("Order placed. Thank you!");
  });

  it("types into a field and blurs it", async () => {
    const ref = (await observe(page)).elements.find((element) => element.name === "Your name")?.ref as string;
    await execute(page, { kind: "type", ref, text: "Jane", label: "type into textbox" });
    expect(await page.locator("#name").inputValue()).toBe("Jane");
  });

  it("scrolls and waits", async () => {
    await execute(page, { kind: "scroll", direction: "down", label: "scroll down" });
    await execute(page, { kind: "scroll", direction: "up", label: "scroll up" });
    await execute(page, { kind: "wait", label: "wait" });
    await settle(page);
  });

  it("selects an option by label", async () => {
    const ref = (await observe(page)).elements.find((element) => element.role === "combobox")?.ref as string;
    await execute(page, { kind: "select", ref, option: "Latte", label: "combobox" });
    expect(await page.locator("#drink").inputValue()).toBe("Latte");
  });

  it("opens a URL", async () => {
    const other = await browser.newPage();
    await other.goto("about:blank");
    await execute(other, { kind: "goto", url: "data:text/html,<p>hello</p>", label: "open the page" });
    expect(other.url()).toContain("data:text/html");
    await other.close();
  });

  it("refuses the run-ending kinds", async () => {
    await expect(execute(page, { kind: "done", reason: "no" })).rejects.toThrow(/ends the run/);
    await expect(execute(page, { kind: "human-input", ask: "no" })).rejects.toThrow(/ends the run/);
  });
});
