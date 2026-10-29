#!/usr/bin/env node
// The installed entry. Node runs the TypeScript CLI through tsx, which the
// package installs as a dependency. The CLI stays a thin HTTP client.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsx = import.meta.resolve("tsx");
const child = spawn(process.execPath, ["--import", tsx, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
