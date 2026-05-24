// @ts-nocheck
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.LOCAL_API_CHECK_PORT || "8791");
const baseUrl = `http://127.0.0.1:${port}`;
const stateDir = join(process.cwd(), ".tmp", "local-api-check");
const devVarsPath = join(stateDir, ".dev.vars");
const serverPath = join(process.cwd(), ".tmp", "tsc", "scripts", "local-dev-server.js");
const localAdapterSource = readFileSync(join(process.cwd(), "packages", "local", "src", "adapter.ts"), "utf8");

if (!existsSync(serverPath)) {
  throw new Error("Expected compiled local-dev-server.js. Run npm run build:ts first.");
}

for (const token of ["createLocalPlatformPaths", "loadLocalDevVars", "createLocalHealthReport", "createLocalReadinessReport"]) {
  if (!localAdapterSource.includes(token)) {
    throw new Error(`Expected packages/local adapter to expose ${token}`);
  }
}

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, "agent-platform-runs.json"), "{not valid json");
writeFileSync(devVarsPath, [
  "# local API check fixture",
  "OPENAI_API_KEY=check-openai-key",
  "TAVILY_API_KEY=\"check-tavily-key\""
].join("\n"));

const server = spawn(process.execPath, [serverPath], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    LOCAL_STATE_DIR: stateDir,
    DEV_VARS_PATH: devVarsPath,
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

try {
  await waitForServer();
  assertCorruptStoreRecovery();
  await assertReadiness();
  await assertConfigEditing();
  await assertValidation();
  const runId = await assertRunLifecycle();
  await assertArtifacts(runId);
  await assertEvidenceReviewAndRegeneration(runId);
  await assertDelete(runId);
  console.log("local api check passed");
} finally {
  server.kill("SIGTERM");
  await waitForExit();
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

async function assertReadiness() {
  const readiness = await getJson("/api/readiness");
  if (readiness.runtime !== "local-dev" || readiness.usableNow !== true) {
    throw new Error("Expected local readiness report to mark the local runtime usable");
  }
  if (readiness.local?.persistence?.driver !== "file") {
    throw new Error("Expected file-backed local persistence in readiness report");
  }
  if (!readiness.local?.devVars?.loaded || !readiness.local.devVars.keys.includes("OPENAI_API_KEY")) {
    throw new Error("Expected local readiness report to include loaded .dev.vars keys");
  }
  if (!readiness.providers?.configured?.some((item) => item.id === "openai" && item.ready)) {
    throw new Error("Expected .dev.vars OPENAI_API_KEY to mark OpenAI provider ready");
  }
  if (!readiness.providers?.configured?.some((item) => item.id === "search" && item.ready)) {
    throw new Error("Expected .dev.vars TAVILY_API_KEY to mark search provider ready");
  }
  if (readiness.cloudflare?.deployReady !== true) {
    throw new Error("Expected Cloudflare deploy readiness to be true after resource setup");
  }
}

function assertCorruptStoreRecovery() {
  const recovered = readdirSync(stateDir).some((file) => file.startsWith("agent-platform-runs.json.corrupt-"));
  if (!recovered) {
    throw new Error("Expected corrupt local run store to be preserved and moved aside during startup");
  }
}

async function assertConfigEditing() {
  const initial = await getJson("/api/config");
  if (!initial.operationFlow?.nodes?.some((node) => node.id === "configure" && node.status === "editable")) {
    throw new Error("Expected config report to expose editable operation flow nodes");
  }
  if (!initial.editableSurfaces?.some((surface) => surface.id === "providers" && surface.editable === true)) {
    throw new Error("Expected provider management surface to be editable");
  }
  if (!initial.editableSurfaces?.some((surface) => surface.id === "skills" && surface.editable === true)) {
    throw new Error("Expected skill management surface to be editable");
  }

  const updated = await putJson("/api/config", {
    flow: {
      id: "deep_research",
      defaultPreset: "quick",
      defaultAudience: "營運團隊",
      defaultFreshnessDays: 21
    },
    policy: {
      maxCostUsd: 1.5,
      maxIterations: 2,
      citationRequired: false,
      allowedProviders: ["workers_ai", "search"]
    },
    providers: [
      { id: "workers_ai", enabled: true, credentialRef: "AI binding" },
      { id: "openai", enabled: false, credentialRef: "OPENAI_API_KEY" },
      { id: "search", enabled: true, credentialRef: "TAVILY_API_KEY" }
    ]
  });
  if (updated.status !== 200 || updated.body.config.flow.defaultPreset !== "quick") {
    throw new Error("Expected config update to persist flow defaults");
  }

  const reloaded = await getJson("/api/config");
  if (reloaded.config.flow.defaultAudience !== "營運團隊" || reloaded.config.policy.allowedProviders.length !== 2) {
    throw new Error("Expected config GET to return saved editable settings");
  }

  const skills = await getJson("/api/skills");
  if (!Array.isArray(skills.skills) || !skills.skills.some((skill) => skill.id === "research-planner" && skill.activeVersion === "1.0.0")) {
    throw new Error("Expected local skill catalog to include built-in research-planner");
  }

  const updatedSkill = await requestJson("/api/skills/research-planner", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, activeVersion: "1.1.0" })
  });
  if (updatedSkill.status !== 200 || updatedSkill.body.skill?.activeVersion !== "1.1.0") {
    throw new Error("Expected local skill version update to persist");
  }

  const draftSkill = await requestJson("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "custom-checker", name: "Custom Checker", version: "0.1.0", description: "Draft smoke skill" })
  });
  if (draftSkill.status !== 201 || !draftSkill.body.skills?.some((skill) => skill.id === "custom-checker" && skill.source === "draft")) {
    throw new Error("Expected local draft skill creation");
  }
}

async function assertValidation() {
  const missingTopic = await postJson("/api/runs", {
    presetId: "standard",
    inputs: { topic: "", freshness_days: 14 }
  });
  if (missingTopic.status !== 400 || !JSON.stringify(missingTopic.body).includes("topic")) {
    throw new Error("Expected missing topic validation error");
  }

  const badFreshness = await postJson("/api/runs", {
    presetId: "standard",
    inputs: { topic: "validation", freshness_days: 0 }
  });
  if (badFreshness.status !== 400 || !JSON.stringify(badFreshness.body).includes("freshness_days")) {
    throw new Error("Expected freshness_days validation error");
  }

  const badPreset = await postJson("/api/runs", {
    presetId: "missing",
    inputs: { topic: "validation", freshness_days: 14 }
  });
  if (badPreset.status !== 400 || !JSON.stringify(badPreset.body).includes("Unknown presetId")) {
    throw new Error("Expected preset validation error");
  }
}

async function assertRunLifecycle() {
  const created = await postJson("/api/runs", {
    presetId: "deep",
    inputs: {
      topic: "local api smoke test",
      audience: "product managers",
      freshness_days: 14
    }
  });
  if (created.status !== 202 || !created.body.run?.id) {
    throw new Error(`Expected run creation to return 202 and run id: ${JSON.stringify(created.body)}`);
  }

  const runId = created.body.run.id;
  const run = await waitForComplete(runId);
  if (run.topic !== "local api smoke test" || run.audience !== "product managers" || run.freshnessDays !== 14) {
    throw new Error("Expected run detail to preserve topic, audience, and freshness_days inputs");
  }
  if (run.evidence.length < 3 || run.artifacts.length !== 2) {
    throw new Error("Expected completed run to include evidence and two artifacts");
  }
  if (!run.evidence.every((item) => item.sourceTitle && item.sourceUrl && item.excerpt)) {
    throw new Error("Expected completed run evidence to include source title, URL, and excerpt");
  }

  const list = await getJson("/api/runs");
  if (!list.runs.some((candidate) => candidate.id === runId)) {
    throw new Error("Expected completed run to appear in run history");
  }

  const observability = await getJson(`/api/runs/${runId}/observability`);
  if (
    observability.observability?.metrics?.providerCallCount < 1
    || observability.observability?.metrics?.toolInvocationCount < 1
    || !Array.isArray(observability.observability.trace)
  ) {
    throw new Error("Expected local observability report with provider calls, tool invocations, and trace");
  }

  return runId;
}

async function assertArtifacts(runId) {
  const markdownResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/markdown_report`);
  const markdown = await markdownResponse.text();
  if (
    !markdownResponse.ok
    || !markdown.includes("# local api smoke test")
    || !markdown.includes("Audience: product managers")
    || !markdown.includes("## Findings")
    || !markdown.includes("## Sources")
  ) {
    throw new Error("Expected downloadable Markdown artifact with propagated inputs");
  }

  const evidenceBundle = await getJson(`/api/runs/${runId}/artifacts/evidence_bundle`);
  if (evidenceBundle.topic !== "local api smoke test" || evidenceBundle.freshnessDays !== 14) {
    throw new Error("Expected downloadable evidence bundle with propagated inputs");
  }
  if (!Array.isArray(evidenceBundle.sources) || evidenceBundle.sources.length < 2 || !Array.isArray(evidenceBundle.claims)) {
    throw new Error("Expected downloadable evidence bundle with structured sources and claims");
  }
}

async function assertEvidenceReviewAndRegeneration(runId) {
  const reviewed = await requestJson(`/api/runs/${runId}/evidence/0`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", note: "use this claim in the final report" })
  });
  if (reviewed.status !== 200 || reviewed.body.run?.evidence?.[0]?.review?.status !== "accepted") {
    throw new Error("Expected local evidence review to be saved on the run");
  }

  const regenerated = await requestJson(`/api/runs/${runId}/artifacts/regenerate`, { method: "POST" });
  if (regenerated.status !== 200 || !regenerated.body.run?.artifacts?.some((artifact) => artifact.id === "review_summary")) {
    throw new Error("Expected local artifact regeneration to add review_summary");
  }

  const summary = await getJson(`/api/runs/${runId}/artifacts/review_summary`);
  if (summary.reviewedCount !== 1 || summary.acceptedCount !== 1) {
    throw new Error("Expected local review summary artifact to reflect evidence review");
  }

  const edited = await requestJson(`/api/runs/${runId}/artifacts/review_summary`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: { ...summary, editorNote: "manual artifact edit smoke" },
      note: "local smoke edits review summary"
    })
  });
  const editedArtifact = edited.body.run?.artifacts?.find((artifact) => artifact.id === "review_summary");
  if (edited.status !== 200 || editedArtifact?.version !== 2) {
    throw new Error("Expected local artifact edit to create version 2");
  }

  const versions = await getJson(`/api/runs/${runId}/artifacts/review_summary/versions`);
  if (!Array.isArray(versions.versions) || versions.versions.length !== 2) {
    throw new Error("Expected local artifact versions endpoint to list two versions");
  }

  const diff = await getJson(`/api/runs/${runId}/artifacts/review_summary/diff`);
  if (!Array.isArray(diff.diff?.lines) || diff.diff.lines.length === 0) {
    throw new Error("Expected local artifact diff endpoint to return changed lines");
  }
}

async function assertDelete(runId) {
  const deleted = await requestJson(`/api/runs/${runId}`, { method: "DELETE" });
  if (deleted.status !== 200 || deleted.body.deleted !== runId) {
    throw new Error("Expected single run delete to succeed");
  }

  const missing = await requestJson(`/api/runs/${runId}`);
  if (missing.status !== 404) {
    throw new Error("Expected deleted run to return 404");
  }

  const cleared = await requestJson("/api/runs", { method: "DELETE" });
  if (cleared.status !== 200 || cleared.body.runs.length !== 0) {
    throw new Error("Expected clear history endpoint to return an empty run list");
  }
}

async function waitForComplete(runId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const payload = await getJson(`/api/runs/${runId}`);
    if (payload.run?.status === "complete") return payload.run;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${runId} to complete`);
}

async function getJson(path) {
  const result = await requestJson(path);
  if (!result.ok) {
    throw new Error(`GET ${path} returned ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function postJson(path, body) {
  return requestJson(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function putJson(path, body) {
  return requestJson(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

async function waitForExit() {
  if (server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
