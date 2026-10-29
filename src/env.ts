// Reads a local .env file. Keys come from the environment first; this only
// fills the gaps for the demo and the evals. Never logs a value.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(join(process.cwd(), ".env"), "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "" && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}
