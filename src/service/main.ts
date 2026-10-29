// The service entry point: one process, one port, a bearer token, and a
// running browser per run. Configure it from the environment (see README).

import { join } from "node:path";
import { loadEnv } from "../env.ts";
import { createDriverFactory } from "./browser.ts";
import { createModelFactory } from "./models.ts";
import { ntfyFromEnv } from "./notify.ts";
import { RunManager } from "./runs.ts";
import { createServer } from "./server.ts";

const env = loadEnv();
const read = (name: string, fallback?: string): string | undefined => process.env[name] ?? env[name] ?? fallback;

const token = read("BROWSER_DRIVER_TOKEN");
if (!token) {
  console.error("BROWSER_DRIVER_TOKEN is not set. The service refuses to start without a token.");
  process.exit(1);
}

const host = read("BROWSER_DRIVER_HOST", "127.0.0.1") as string;
const port = Number(read("BROWSER_DRIVER_PORT", "8787"));
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`BROWSER_DRIVER_PORT must be a port number, not ${port}.`);
  process.exit(1);
}

const profilesDir = read("BROWSER_DRIVER_PROFILES", join(process.cwd(), "profiles")) as string;
const approvalTimeoutMs = Number(read("APPROVAL_TIMEOUT_MS", "300000"));
const maxRuns = Number(read("BROWSER_DRIVER_MAX_RUNS", "100"));

const manager = new RunManager({
  createDriver: createDriverFactory({ profilesDir }),
  createModels: createModelFactory(env),
  notifier: ntfyFromEnv({ ...process.env, ...env }),
  approvalTimeoutMs: Number.isFinite(approvalTimeoutMs) && approvalTimeoutMs > 0 ? approvalTimeoutMs : 300_000,
  maxRuns: Number.isInteger(maxRuns) && maxRuns > 0 ? maxRuns : 100,
});

const server = createServer({ manager, token });
server.listen(port, host, () => {
  console.log(`browser driver listening on http://${host}:${port}`);
  console.log(`profiles: ${profilesDir}`);
  console.log(`ntfy: ${process.env.NTFY_TOPIC ?? env["NTFY_TOPIC"] ? "on" : "off"}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: closing ${manager.list().length} run(s)`);
  server.close();
  await manager.closeAll();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
