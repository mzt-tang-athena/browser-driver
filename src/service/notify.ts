// ntfy notifications: a push to a phone when a run needs a human and when it
// ends. Off unless NTFY_TOPIC is set. A failed push never fails a run.

import type { Notifier } from "./runs.ts";

export interface NtfyOptions {
  baseUrl?: string;
  topic: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export function createNtfyNotifier(options: NtfyOptions): Notifier {
  const baseUrl = (options.baseUrl ?? "https://ntfy.sh").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function publish(title: string, message: string, priority: number, tags: string): Promise<void> {
    const response = await fetchImpl(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify({ topic: options.topic, title, message, priority, tags: tags.split(",") }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`ntfy answered ${response.status}.`);
  }

  return {
    approvalNeeded: (input) =>
      publish(
        "Browser driver needs approval",
        `${input.question}\n${input.url}\nrun ${input.runId}`,
        4,
        "warning",
      ),
    runFinished: (input) =>
      publish(
        `Browser driver: ${input.outcome}`,
        `${input.reason ?? "no reason given"}\nrun ${input.runId}`,
        input.outcome === "done" ? 3 : 4,
        input.outcome === "done" ? "white_check_mark" : "warning",
      ),
  };
}

/** Reads the ntfy settings. Returns null when no topic is set. */
export function ntfyFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Notifier | null {
  const topic = env["NTFY_TOPIC"];
  if (!topic) return null;
  return createNtfyNotifier({
    topic,
    baseUrl: env["NTFY_URL"] ?? undefined,
    token: env["NTFY_TOKEN"] ?? undefined,
    fetchImpl,
  });
}
