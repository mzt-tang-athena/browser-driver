// Builders for fake page observations in loop tests.

import type { ElementKind, MenuItem, Observation, PageElement } from "../../src/types.ts";

export const el = (ref: string, role: string, name: string, kind: ElementKind = "click", extra: Partial<PageElement> = {}): PageElement => ({
  ref,
  role,
  name,
  kind,
  options: [],
  value: null,
  url: null,
  disabled: false,
  checked: null,
  ...extra,
});

export const item = (element: PageElement, label?: string): MenuItem => ({
  id: element.ref,
  ref: element.ref,
  role: element.role,
  label: label ?? `click ${element.role} "${element.name}"`,
});

export function observation(init: {
  fingerprint: string;
  title?: string;
  path?: string;
  outline?: string;
  elements?: PageElement[];
  menu?: MenuItem[];
  messages?: string[];
}): Observation {
  const outline = init.outline ?? init.menu?.map((entry) => `${entry.id}: ${entry.label}`).join("\n") ?? "";
  const path = init.path ?? "/test";
  return {
    url: `https://example.test${path}`,
    path,
    title: init.title ?? "Test page",
    outline,
    fullOutline: outline,
    elements: init.elements ?? [],
    menu: init.menu ?? [],
    messages: init.messages ?? [],
    fingerprint: init.fingerprint,
  };
}
