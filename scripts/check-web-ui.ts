// @ts-nocheck
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.WEB_UI_CHECK_PORT || "8795");
const baseUrl = `http://127.0.0.1:${port}`;
const stateDir = join(process.cwd(), ".tmp", "web-ui-check");
const serverPath = join(process.cwd(), ".tmp", "tsc", "scripts", "local-dev-server.js");

if (!existsSync(serverPath)) {
  throw new Error("Expected compiled local-dev-server.js. Run npm run build:ts first.");
}

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });

const server = spawn(process.execPath, [serverPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    LOCAL_STATE_DIR: stateDir,
    OPENAI_API_KEY: undefined,
    TAVILY_API_KEY: undefined,
    EXA_API_KEY: undefined
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    browserErrors.push(error.message);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await expectText(page.locator("h1"), "Agent Platform");
  await expectText(page.locator("#runtime-status"), "本機");
  await expectText(page.locator("#run h2"), "執行研究流程");

  await page.locator(".language-switcher select").selectOption("en");
  await expectText(page.locator("#run h2"), "Run research workflow");
  await expectText(page.locator("button[type='submit']"), "Start run");

  await page.locator("#topic-input").fill("open source local-first agent workflows");
  await page.locator("button[type='submit']").click();

  await page.locator(".history-item", { hasText: "open source local-first agent workflows" }).waitFor({ timeout: 5000 });
  await page.locator("#timeline .timeline li", { hasText: "Export artifacts" }).waitFor({ timeout: 8000 });
  await page.locator("#artifacts .card", { hasText: "Deep Research Report" }).waitFor({ timeout: 8000 });
  await page.locator("#evidence .card").first().waitFor({ timeout: 8000 });

  const downloadHref = await page.locator("#artifacts a.button-link").first().getAttribute("href");
  if (!downloadHref || !downloadHref.includes("/api/runs/")) {
    throw new Error(`Expected artifact download link to target the local API, got ${downloadHref}`);
  }

  if (browserErrors.length > 0) {
    throw new Error(`Browser console errors:\n${browserErrors.join("\n")}`);
  }

  console.log("web ui check passed");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await waitForExit(server);
  rmSync(stateDir, { recursive: true, force: true });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    if (server.exitCode !== null) {
      throw new Error(`local dev server exited early:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep polling until the server binds the port.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for local dev server:\n${output}`);
}

async function expectText(locator, expected: string) {
  await locator.waitFor({ timeout: 5000 });
  const text = await locator.textContent();
  if (!text?.includes(expected)) {
    throw new Error(`Expected text "${expected}", got "${text}"`);
  }
}

async function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    child.once("exit", (code) => resolve(code));
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
