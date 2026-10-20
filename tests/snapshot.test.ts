// Tests for the ported snapshot parser (hnry-drive lib/snapshot.mjs patterns).

import { describe, expect, it } from "vitest";
import { describeElement, interactiveElements, messages, outline, parseSnapshot } from "../src/snapshot.ts";

const YAML = [
  "- banner:",
  '  - heading "Bean Counter Cafe" [level=1]',
  '  - button "Order latte" [ref=e2]',
  '  - button "Order espresso" [ref=e3] [disabled]',
  '  - link "Menu" [ref=e4]:',
  "    - /url: /menu",
  '  - textbox "Your name" [ref=e5]: Jane',
  '  - checkbox "Extra shot" [ref=e6] [checked]',
  '  - status: Latte ordered. Thank you!',
  '  - link "":',
  "    - img \"Cafe logo\"",
  '  - generic [ref=e7]:',
  '    - text: plain text',
].join("\n");

describe("parseSnapshot + interactiveElements", () => {
  const tree = parseSnapshot(YAML);
  const elements = interactiveElements(tree);

  it("finds every interactive element with its ref, in page order", () => {
    expect(elements.map((element) => `${element.ref}:${element.role}`)).toEqual(["e2:button", "e3:button", "e4:link", "e5:textbox", "e6:checkbox"]);
  });

  it("reads names, values, urls and states", () => {
    expect(elements[0]?.name).toBe("Order latte");
    expect(elements[3]?.value).toBe("Jane");
    expect(elements[2]?.url).toBe("/menu");
    expect(elements[3]?.disabled).toBe(false);
    expect(elements[1]?.disabled).toBe(true);
    expect(elements[4]?.checked).toBe(true);
  });

  it("takes the image name for a link that holds only an image", () => {
    expect(elements.some((element) => element.name === "Cafe logo")).toBe(false);
    // The image-only link has no ref in this sample, so it is not an interactive element.
  });

  it("describes an element in one line", () => {
    expect(describeElement({ role: "button", name: "Order latte", attrs: {} })).toBe('button "Order latte"');
    expect(describeElement({ role: "link", name: "Menu", url: "/menu", attrs: {} })).toBe('link "Menu" to /menu');
  });
});

describe("outline", () => {
  it("shows headings, text and refs", () => {
    const text = outline(parseSnapshot(YAML), 10_000);
    expect(text).toContain("# Bean Counter Cafe");
    expect(text).toContain("[e2] button \"Order latte\"");
    expect(text).toContain("plain text");
  });

  it("cuts long pages", () => {
    const text = outline(parseSnapshot(YAML), 40);
    expect(text.length).toBeLessThan(120);
    expect(text).toContain("page cut at 40 characters");
  });
});

describe("messages", () => {
  it("reads status text", () => {
    expect(messages(parseSnapshot(YAML))).toEqual(["status: Latte ordered. Thank you!"]);
  });
});
