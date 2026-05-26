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

  await page.locator("a[href='#define']").click();
  await page.locator("#define", { hasText: "Arbitrary Flow Builder" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Create Flow" }).click();
  await page.locator("#define", { hasText: "Untitled Flow" }).waitFor({ timeout: 5000 });
  await page.locator("#flow-name-input").fill("arXiv Paper Reading Flow");
  await page.locator("#flow-description-input").fill("User-authored flow that searches arXiv, reads papers, creates layered summaries, and exports cited artifacts with alphaXiv links.");
  const arxivSteps = [
    ["scope_topic", "agent", "research-planner@1.0.0", ""],
    ["search_arxiv", "tool_group", "", "search"],
    ["select_papers", "agent", "source-ranker@1.0.0", ""],
    ["read_papers", "tool_group", "", "reader"],
    ["extract_contributions", "agent", "citation-extractor@1.0.0", ""],
    ["layered_summary", "agent", "report-synthesizer@1.0.0", ""],
    ["cross_paper_synthesis", "agent", "report-synthesizer@1.0.0", ""],
    ["verify_sources", "verifier", "", ""],
    ["export", "artifact", "", ""]
  ];
  for (const [index, [id, type, skill, providerRole]] of arxivSteps.entries()) {
    await page.locator("#step-id-input").fill(id);
    await page.locator("#step-type-select").selectOption(type);
    await page.locator("#step-skill-input").selectOption(skill);
    await page.locator("#step-provider-role-input").selectOption(providerRole);
    await page.getByRole("button", { name: "Add Step" }).click();
    await page.waitForFunction((count) => document.querySelectorAll(".flow-step-chip").length >= count, index + 1);
  }
  await page.locator("#artifact-id-input").fill("markdown_report");
  await page.locator("#artifact-type-select").selectOption("markdown_report");
  await page.getByRole("button", { name: "Add Artifact" }).click();
  await page.locator("#artifact-id-input").fill("evidence_bundle");
  await page.locator("#artifact-type-select").selectOption("json_evidence_bundle");
  await page.getByRole("button", { name: "Add Artifact" }).click();
  await page.waitForFunction(() => {
    const textarea = document.querySelector(".flow-editor textarea") as HTMLTextAreaElement | null;
    if (!textarea) return false;
    const definition = JSON.parse(textarea.value);
    return definition.steps?.length === 9 && definition.artifacts?.length === 2;
  });
  await page.locator("#define", { hasText: "Search arXiv papers" }).waitFor({ timeout: 5000 });
  await page.locator("#define", { hasText: "Layered summary" }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Save Draft" }).click();
  await page.locator("#define .history-item", { hasText: "arXiv Paper Reading Flow" }).waitFor({ timeout: 5000 });
  await page.locator("#define .history-item", { hasText: "9 steps" }).waitFor({ timeout: 5000 });
  const publishButton = page.getByRole("button", { name: "Publish Version" });
  await publishButton.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const publish = buttons.find((button) => button.textContent?.includes("Publish Version"));
    return publish && !(publish as HTMLButtonElement).disabled;
  });
  await publishButton.click();
  await page.locator("#define .history-item", { hasText: "published · v1" }).waitFor({ timeout: 5000 });

  await page.locator(".sidebar-nav a[href='#run']").click();
  await page.locator("#flow-select").selectOption({ label: "arXiv Paper Reading Flow" });
  await page.locator("#topic-input").fill("retrieval augmented generation arxiv papers");
  await page.locator("#audience-input").fill("ML engineers");
  await page.locator("#freshness-input").fill("365");
  await page.locator("#preset-select").selectOption("deep");
  await page.locator("#run", { hasText: "Selected flow and function map" }).waitFor({ timeout: 5000 });
  await page.locator("#run", { hasText: "Search arXiv papers" }).waitFor({ timeout: 5000 });
  await page.locator("button[type='submit']").click();

  await page.locator(".history-item", { hasText: "retrieval augmented generation arxiv papers" }).waitFor({ timeout: 5000 });
  await page.locator("a[href='#timeline']").click();
  await page.locator("#timeline .timeline li.succeeded", { hasText: "Export artifacts" }).waitFor({ timeout: 10000 });
  await page.locator("a[href='#artifacts']").click();
  await page.locator("#artifacts .card", { hasText: "arXiv Paper Reading Report" }).waitFor({ timeout: 8000 });
  await page.locator("#artifacts", { hasText: "Layer 1: Executive Takeaways" }).waitFor({ timeout: 8000 });
  await page.locator("#artifacts", { hasText: "alphaXiv" }).waitFor({ timeout: 8000 });
  await page.locator("a[href='#evidence']").click();
  await page.locator("#evidence .card").first().waitFor({ timeout: 8000 });
  await page.locator("#evidence", { hasText: "https://www.alphaxiv.org/abs/" }).waitFor({ timeout: 8000 });
  await page.locator("#evidence", { hasText: "arXiv ID:" }).waitFor({ timeout: 8000 });
  await page.locator("a[href='#manage']").click();
  await page.locator("#manage", { hasText: "Sync models" }).waitFor({ timeout: 5000 });
  await page.locator("#manage", { hasText: "Test model" }).waitFor({ timeout: 5000 });
  const visiblePanels = await page.locator(".workspace > .panel").count();
  if (visiblePanels !== 1) {
    throw new Error(`Expected one active workspace panel, got ${visiblePanels}`);
  }

  await page.locator("a[href='#artifacts']").click();
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
