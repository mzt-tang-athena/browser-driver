// The live models behind a run: Jev for the reflex, a chat model for the
// planner. The key comes from the environment or a local OpenCode install.

import { ChatPlanner, OPENCODE_CHAT_BASE_URL } from "../planner/chat.ts";
import { resolveApiKey } from "../reflex/keysource.ts";
import { OPENCODE_CONSOLE_ENDPOINT, SystemOneReflex } from "../reflex/systemone.ts";
import type { ModelFactory } from "./runs.ts";

export function createModelFactory(env: Record<string, string>): ModelFactory {
  return () => {
    const apiKey = resolveApiKey({ ...process.env, ...env });
    if (!apiKey) throw new Error("No model key found. Set OPENCODE_API_KEY, or connect OpenCode on this machine.");

    const reflexModel = process.env.SYSTEMONE_MODEL ?? env["SYSTEMONE_MODEL"] ?? "jev-1.13-free";
    const reflexEndpoint = process.env.SYSTEMONE_ENDPOINT ?? env["SYSTEMONE_ENDPOINT"] ?? OPENCODE_CONSOLE_ENDPOINT;
    const plannerModel = process.env.PLANNER_MODEL ?? env["PLANNER_MODEL"] ?? "glm-5.3-flash";
    const plannerBaseUrl = process.env.PLANNER_BASE_URL ?? env["PLANNER_BASE_URL"] ?? OPENCODE_CHAT_BASE_URL;

    return {
      reflex: new SystemOneReflex({ apiKey, model: reflexModel, endpoint: reflexEndpoint }),
      planner: new ChatPlanner({ apiKey, model: plannerModel, baseUrl: plannerBaseUrl }),
    };
  };
}
