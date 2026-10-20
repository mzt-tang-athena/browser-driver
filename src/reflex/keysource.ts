// Resolves the reflex API key. The OpenCode Console key is preferred: it is what the
// user already connected. The key never gets printed or logged.

import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";

const PLACEHOLDER = /placeholder|changeme|your[-_]?key/i;

/** The key from the environment, or from the local OpenCode credential store. */
export function resolveApiKey(env: Record<string, string | undefined>): string | null {
  const fromEnv = env["OPENCODE_API_KEY"];
  if (fromEnv && !PLACEHOLDER.test(fromEnv)) return fromEnv;
  return fromCredentialStore();
}

function fromCredentialStore(): string | null {
  try {
    const db = new DatabaseSync(homedir() + "/.local/share/opencode/opencode.db", { readOnly: true });
    const row = db.prepare("SELECT value FROM credential WHERE integration_id = 'opencode' AND active = 1 ORDER BY time_updated DESC LIMIT 1").get() as { value: string } | undefined;
    if (!row) return null;
    const stored = JSON.parse(row.value) as { type?: string; key?: string };
    return typeof stored.key === "string" && stored.key !== "" ? stored.key : null;
  } catch {
    // No store, no sqlite, or a schema we do not know. The env var is the fallback path.
    return null;
  }
}
