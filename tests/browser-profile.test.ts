// Persistent profiles in a real browser. A local HTTP server sets a cookie on
// one page. A second launch of the same profile must still see the session.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDriverFactory } from "../src/service/browser.ts";

const pages: Record<string, string> = {
  "/login": `<!doctype html><html><head><title>Sign in</title></head><body>
    <button id="login">Log in</button>
    <script>document.getElementById("login").onclick = () => { document.cookie = "session=abc; path=/"; location.href = "/home"; }</script>
  </body></html>`,
  "/home": `<!doctype html><html><head><title>Home</title></head><body>
    <h1 id="greeting">Welcome back</h1><p id="status" role="status">Your session is active.</p>
  </body></html>`,
};

let server: ReturnType<typeof createServer>;
let base = "";
let profilesDir = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    const signedIn = /session=abc/.test(request.headers.cookie ?? "");
    const html = request.url === "/home" ? pages[request.url] : request.url === "/login" && !signedIn ? pages["/login"] : pages["/home"];
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  profilesDir = mkdtempSync(join(tmpdir(), "browser-driver-profiles-"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(profilesDir, { recursive: true, force: true });
});

describe("persistent profiles", () => {
  it("keeps a cookie between two launches", async () => {
    const factory = createDriverFactory({ profilesDir });

    const first = await factory({ goal: "Sign in", url: `${base}/login`, profile: "work", allowlist: ["127.0.0.1"] });
    try {
      const login = await first.driver.observe();
      const button = login.elements.find((element) => element.name === "Log in");
      expect(button).toBeDefined();
      await first.driver.execute({ kind: "click", ref: button?.ref as string, label: 'click button "Log in"' });
      await first.driver.settle();
      const home = await first.driver.observe();
      expect(home.fullOutline).toContain("Welcome back");
    } finally {
      await first.close();
    }

    const second = await factory({ goal: "Read the page", url: `${base}/home`, profile: "work", allowlist: ["127.0.0.1"] });
    try {
      const again = await second.driver.observe();
      expect(again.fullOutline).toContain("Welcome back");
    } finally {
      await second.close();
    }
  }, 30_000);
});
