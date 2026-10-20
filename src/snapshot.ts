// Parses the Playwright AI-mode aria snapshot (page.ariaSnapshot({ mode: "ai" })) into a tree.
// Ported from michaeltang-hnry/hnry-drive (lib/snapshot.mjs), with types added.

export interface SnapshotNode {
  role: string;
  name: string;
  attrs: Record<string, string | boolean>;
  ref: string | null;
  value: string | null;
  children: SnapshotNode[];
  depth: number;
}

const LINE = /^(\s*)- (.*)$/;
const NAME = /^"((?:[^"\\]|\\.)*)"/;
// Playwright writes a name that starts and ends with "/" without quotes, for example link /admin/ [ref=e12].
// The name ends at the first "/" that only attributes and an optional value follow.
const SLASH_NAME = /^\/(?:.*?\/)?(?=(?:\s*\[[a-z-]+(?:=[^\]]*)?\])*\s*(?::|$))/;
const ATTR = /^\[([a-z-]+)(?:=([^\]]*))?\]/;

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "spinbutton",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "slider",
  "treeitem",
]);

// Roles whose value Playwright writes after the colon, or as a text child when the field also has a placeholder.
const VALUE_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox"]);

// Wrappers that add nothing to the outline when they have no name of their own.
const TRANSPARENT_ROLES = new Set(["generic", "group", "list", "listitem", "none", "presentation", "rowgroup", "row"]);
const NOISE_ATTRS = new Set(["ref", "cursor", "active"]);

function unquoteYaml(text: string): string {
  // Playwright wraps a line in single quotes when it holds YAML-special characters. '' is an escaped quote.
  if (!text.startsWith("'")) return text;
  let out = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "'" && text[index + 1] === "'") {
      out += "'";
      index += 1;
    } else if (char === "'") {
      return out + text.slice(index + 1);
    } else {
      out += char;
    }
  }
  return out;
}

function unquoteValue(text: string): string {
  const value = text.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return unquoteYaml(value);
}

function parseLine(body: string): Omit<SnapshotNode, "children" | "depth"> {
  const text = unquoteYaml(body);
  if (text.startsWith("text:")) return { role: "text", name: "", attrs: {}, ref: null, value: unquoteValue(text.slice(5)) };
  if (text.startsWith("/")) return { role: "prop", name: "", attrs: {}, ref: null, value: text };

  const role = text.match(/^[a-z][a-zA-Z]*/)?.[0];
  if (!role) return { role: "text", name: "", attrs: {}, ref: null, value: text };
  let rest = text.slice(role.length).trimStart();

  let name = "";
  const nameMatch = rest.match(NAME);
  const slashName = nameMatch ? null : rest.match(SLASH_NAME);
  if (nameMatch) {
    name = JSON.parse(`"${nameMatch[1]}"`) as string;
    rest = rest.slice(nameMatch[0].length).trimStart();
  } else if (slashName) {
    name = slashName[0];
    rest = rest.slice(name.length).trimStart();
  }

  const attrs: Record<string, string | boolean> = {};
  let ref: string | null = null;
  for (let match = rest.match(ATTR); match; match = rest.match(ATTR)) {
    const [whole, key, value] = match as [string, string, string | undefined];
    if (key === "ref") ref = value ?? null;
    else attrs[key] = value ?? true;
    rest = rest.slice(whole.length).trimStart();
  }

  let value: string | null = null;
  if (rest.startsWith(":")) {
    const after = rest.slice(1).trim();
    value = after === "" ? null : unquoteValue(after);
  }
  return { role, name, attrs, ref, value };
}

// A field with a placeholder lists its value as a text child. Without this fold, a filled field looks empty.
function foldFieldValue(node: SnapshotNode): void {
  if (!VALUE_ROLES.has(node.role) || node.value != null) return;
  const index = node.children.findIndex((child) => child.role === "text");
  if (index === -1) return;
  const child = node.children[index];
  if (!child) return;
  node.value = child.value;
  node.children.splice(index, 1);
}

export function parseSnapshot(yaml: string): SnapshotNode {
  const root: SnapshotNode = { role: "root", name: "", attrs: {}, ref: null, value: null, children: [], depth: -1 };
  const stack = [root];
  for (const raw of String(yaml).split("\n")) {
    const match = raw.match(LINE);
    if (!match) continue;
    const depth = (match[1] as string).length / 2;
    const node: SnapshotNode = { ...parseLine(match[2] as string), children: [], depth };
    while (stack.length > 1 && (stack.at(-1) as SnapshotNode).depth >= depth) stack.pop();
    (stack.at(-1) as SnapshotNode).children.push(node);
    stack.push(node);
  }
  walk(root, foldFieldValue);
  return root;
}

export function walk(node: SnapshotNode, visit: (node: SnapshotNode, parent: SnapshotNode | null) => void, parent: SnapshotNode | null = null): void {
  visit(node, parent);
  for (const child of node.children) walk(child, visit, node);
}

function attrText(attrs: Record<string, string | boolean>): string {
  const parts = Object.entries(attrs)
    .filter(([key]) => !NOISE_ATTRS.has(key))
    .map(([key, value]) => (value === true ? key : `${key}=${value}`));
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function optionChildren(node: SnapshotNode): SnapshotNode[] {
  return node.children.filter((child) => child.role === "option");
}

// The /url prop of a link, for example "/settings". Absolute URLs keep their host.
function linkUrl(node: SnapshotNode): string | null {
  const prop = node.children.find((child) => child.role === "prop" && child.value !== null && child.value.startsWith("/url:"));
  if (!prop) return null;
  const raw = (prop.value as string).slice("/url:".length).trim();
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

// A link or button that holds only an image, such as a logo, takes the image's name.
function imageName(node: SnapshotNode): string {
  return node.children.find((child) => child.role === "img" && child.name)?.name ?? "";
}

export function selectedOption(node: SnapshotNode): string | null {
  return optionChildren(node).find((child) => child.attrs.selected)?.name ?? null;
}

export interface InteractiveElement {
  ref: string;
  role: string;
  name: string;
  url: string | null;
  attrs: Record<string, string | boolean>;
  value: string | null;
  options: string[];
  disabled: boolean;
  checked: boolean | null;
}

// Every interactive node that has a ref, in page order. Native select options have no ref and stay inside their combobox.
export function interactiveElements(tree: SnapshotNode): InteractiveElement[] {
  const elements: InteractiveElement[] = [];
  walk(tree, (node) => {
    if (!node.ref || !INTERACTIVE_ROLES.has(node.role)) return;
    const options = optionChildren(node).map((child) => child.name);
    elements.push({
      ref: node.ref,
      role: node.role,
      name: node.name || imageName(node),
      url: linkUrl(node),
      attrs: node.attrs,
      value: node.role === "combobox" && options.length > 0 ? selectedOption(node) : node.value,
      options,
      disabled: Boolean(node.attrs.disabled),
      checked: node.attrs.checked === true ? true : node.attrs.checked === false ? false : null,
    });
  });
  return elements;
}

export function describeElement(element: { role: string; name: string; url?: string | null; value?: string | null; attrs?: Record<string, string | boolean> }): string {
  const name = element.name ? ` "${element.name}"` : "";
  const value = element.value ? ` = "${String(element.value).slice(0, 60)}"` : "";
  const target = element.url ? ` to ${String(element.url).slice(0, 80)}` : "";
  return `${element.role}${name}${attrText(element.attrs ?? {})}${value}${target}`;
}

function textOf(node: SnapshotNode): string {
  if (node.value && typeof node.value === "string") return node.value;
  return node.name;
}

// A compact outline: headings, text and every interactive element with its ref. Long pages are cut at maxChars.
export function outline(tree: SnapshotNode, maxChars: number): string {
  const lines: string[] = [];
  const visit = (node: SnapshotNode, depth: number): void => {
    let nextDepth = depth;
    if (node.role === "root") {
      // The root only holds children.
    } else if (node.role === "prop") {
      return;
    } else if (node.ref && INTERACTIVE_ROLES.has(node.role)) {
      const element = {
        ...node,
        name: node.name || imageName(node),
        url: linkUrl(node),
        value: node.role === "combobox" && optionChildren(node).length > 0 ? selectedOption(node) : node.value,
      };
      const options = optionChildren(node);
      const optionText =
        options.length > 0
          ? ` options: ${options.map((child) => child.name).slice(0, 12).join(" | ")}${options.length > 12 ? " | ..." : ""}`
          : "";
      lines.push(`${"  ".repeat(depth)}[${node.ref}] ${describeElement(element)}${optionText}`);
      if (node.role === "combobox" && options.length > 0) return;
      nextDepth = depth + 1;
    } else if (node.role === "heading") {
      lines.push(`${"  ".repeat(depth)}# ${node.name || textOf(node)}`);
      return;
    } else if (TRANSPARENT_ROLES.has(node.role) && !node.name && !node.value) {
      nextDepth = depth;
    } else {
      const text = textOf(node);
      const label = node.role === "text" || node.role === "paragraph" ? "" : `${node.role}${node.name ? ` "${node.name}"` : ""}`;
      const body = node.role === "text" || node.role === "paragraph" ? text : node.value && typeof node.value === "string" ? node.value : "";
      const line = [label, body].filter(Boolean).join(": ");
      if (line) lines.push(`${"  ".repeat(depth)}${line}`);
      nextDepth = depth + 1;
    }
    for (const child of node.children) visit(child, nextDepth);
  };
  visit(tree, 0);
  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... (page cut at ${maxChars} characters)` : text;
}

// Text that tells the agent something went wrong or right: alerts, status regions and toasts.
export function messages(tree: SnapshotNode): string[] {
  const found: string[] = [];
  walk(tree, (node) => {
    if (node.role !== "alert" && node.role !== "status" && node.role !== "alertdialog") return;
    const parts: string[] = [];
    walk(node, (child) => {
      const text = child.role === "text" || child.role === "paragraph" ? textOf(child) : child === node ? textOf(child) : "";
      if (text) parts.push(text);
    });
    const joined = parts.join(" ").replace(/\s+/g, " ").trim();
    if (joined) found.push(`${node.role}: ${joined.slice(0, 200)}`);
  });
  return found;
}

// The page's own headings, in page order.
export function headings(tree: SnapshotNode): string[] {
  const found: string[] = [];
  walk(tree, (node) => {
    if (node.role === "heading" && node.name) found.push(node.name);
  });
  return found;
}
