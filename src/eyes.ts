// The eyes: a Playwright accessibility snapshot turned into a numbered element list,
// a menu of click choices for the reflex, and a page outline for the state text.

import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { LABEL_CHARS } from "./limits.ts";
import { describeElement, interactiveElements, messages, outline, parseSnapshot } from "./snapshot.ts";
import type { ElementKind, MenuItem, Observation, PageElement } from "./types.ts";

const OUTLINE_CHARS = 15_000;

const CLICK_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "treeitem", "slider"]);
const TYPE_ROLES = new Set(["textbox", "searchbox", "spinbutton"]);

export function kindOf(role: string): ElementKind {
  if (TYPE_ROLES.has(role)) return "type";
  if (role === "combobox") return "select";
  return "click";
}

const VERBS: Record<string, string> = {
  button: "click",
  link: "follow",
  checkbox: "toggle",
  radio: "choose",
  switch: "toggle",
  tab: "open",
  option: "pick",
  menuitem: "pick",
};

function verb(element: PageElement): string {
  return VERBS[element.role] ?? "click";
}

const shortLabel = (label: string): string => (label.length > LABEL_CHARS ? `${label.slice(0, LABEL_CHARS)}…` : label);

// Clicking a radio that is already chosen does nothing, so it only distracts the model.
// A mailto link opens a mail client, so it never helps the run. Ported from hnry-drive.
function excluded(element: PageElement): boolean {
  if (element.disabled) return true;
  if (element.kind !== "click") return true;
  if (element.role === "radio" && element.checked === true) return true;
  return element.role === "link" && (element.url?.startsWith("mailto:") ?? false);
}

// The click menu. Typing and selects are planner work, so they are not menu items yet.
export function buildMenu(elements: PageElement[]): MenuItem[] {
  return elements.filter((element) => !excluded(element)).map((element) => ({
    id: element.ref,
    ref: element.ref,
    role: element.role,
    label: shortLabel(`${verb(element)} ${describeElement({ role: element.role, name: element.name, url: element.url, attrs: {} })}`),
  }));
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export async function observe(page: Page): Promise<Observation> {
  const url = page.url();
  const yaml = await page.locator("body").ariaSnapshot({ mode: "ai" });
  const tree = parseSnapshot(yaml);
  const elements: PageElement[] = interactiveElements(tree).map((element) => ({
    ref: element.ref,
    role: element.role,
    name: shortLabel(element.name),
    kind: kindOf(element.role),
    url: element.url,
    disabled: element.disabled,
    checked: element.checked,
  }));
  const menu = buildMenu(elements);
  const fullOutline = outline(tree, OUTLINE_CHARS);
  const title = await page.title();
  const fingerprint = createHash("sha1").update(`${url}\n${fullOutline}`).digest("hex");
  return {
    url,
    path: pathOf(url),
    title,
    outline: fullOutline,
    fullOutline,
    elements,
    menu,
    messages: messages(tree),
    fingerprint,
  };
}
