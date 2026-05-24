// @ts-nocheck
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.WORKER_RUNTIME_CHECK_PORT || "8793");
const baseUrl = `http://127.0.0.1:${port}`;
const persistDir = join(process.cwd(), ".tmp", "worker-runtime-check");

rmSync(persistDir, { recursive: true, force: true });

await runCommand("npm", ["run", "build:web"]);
await runCommand("npx", ["wrangler", "d1", "migrations", "apply", "agent-platform", "--local", "--persist-to", persistDir]);

const worker = spawn("npx", [
  "wrangler",
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  String(port),
  "--persist-to",
  persistDir,
  "--log-level",
  "error"
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
worker.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
worker.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await waitForWorker();
  await assertReadiness();
  await assertConfigEditing();
  await assertValidation();
  const runId = await assertRunLifecycle();
  await assertArtifact(runId);
  await assertEvidenceReviewAndRegeneration(runId);
  await assertRetryCancelDelete(runId);
  console.log("worker runtime check passed");
} finally {
  worker.kill("SIGTERM");
  await waitForExit(worker);
  rmSync(persistDir, { recursive: true, force: true });
}

async function assertReadiness() {
  const readiness = await getJson("/api/readiness");
  if (readiness.runtime !== "cloudflare" || readiness.usableNow !== true) {
    throw new Error("Expected wrangler dev Worker readiness to be usable");
  }
}

async function assertConfigEditing() {
  const initial = await getJson("/api/config");
  if (!initial.operationFlow?.nodes?.some((node) => node.id === "configure" && node.status === "editable")) {
    throw new Error("Expected Worker config report to expose editable operation flow nodes");
  }
  if (!initial.editableSurfaces?.some((surface) => surface.id === "policy" && surface.editable === true)) {
    throw new Error("Expected Worker policy management surface to be editable");
  }
  if (!initial.editableSurfaces?.some((surface) => surface.id === "skills" && surface.editable === true)) {
    throw new Error("Expected Worker skill management surface to be editable");
  }

  const updated = await putJson("/api/config", {
    flow: {
      id: "deep_research",
      defaultPreset: "deep",
      defaultAudience: "研究團隊",
      defaultFreshnessDays: 45
    },
    policy: {
      maxCostUsd: 4,
      maxIterations: 5,
      citationRequired: true,
      allowedProviders: ["workers_ai", "search", "jina"]
    },
    providers: [
      { id: "workers_ai", enabled: true, credentialRef: "AI binding" },
      { id: "search", enabled: true, credentialRef: "TAVILY_API_KEY" },
      { id: "jina", enabled: false, credentialRef: "JINA_API_KEY" }
    ]
  });
  if (updated.status !== 200 || updated.body.config.flow.defaultPreset !== "deep") {
    throw new Error("Expected Worker config update to persist flow defaults");
  }

  const reloaded = await getJson("/api/config");
  if (reloaded.config.flow.defaultAudience !== "研究團隊" || reloaded.config.policy.maxIterations !== 5) {
    throw new Error("Expected Worker config GET to return saved editable settings from KV");
  }

  const skills = await getJson("/api/skills");
  if (!Array.isArray(skills.skills) || !skills.skills.some((skill) => skill.id === "research-planner" && skill.activeVersion === "1.0.0")) {
    throw new Error("Expected Worker skill catalog to include built-in research-planner");
  }

  const updatedSkill = await requestJson("/api/skills/research-planner", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, activeVersion: "1.1.0" })
  });
  if (updatedSkill.status !== 200 || updatedSkill.body.skill?.activeVersion !== "1.1.0") {
    throw new Error("Expected Worker skill version update to persist");
  }

  const draftSkill = await requestJson("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "worker-custom-checker", name: "Worker Custom Checker", version: "0.1.0", description: "Draft smoke skill" })
  });
  if (draftSkill.status !== 201 || !draftSkill.body.skills?.some((skill) => skill.id === "worker-custom-checker" && skill.source === "draft")) {
    throw new Error("Expected Worker draft skill creation");
  }
}

async function assertValidation() {
  const badPreset = await postJson("/api/runs", {
    presetId: "missing",
    inputs: { topic: "worker validation", freshness_days: 30 }
  });
  if (badPreset.status !== 400 || !JSON.stringify(badPreset.body).includes("Unknown presetId")) {
    throw new Error(`Expected Worker bad preset validation error: ${JSON.stringify(badPreset)}`);
  }

  const badFreshness = await postJson("/api/runs", {
    presetId: "standard",
    inputs: { topic: "worker validation", freshness_days: 0 }
  });
  if (badFreshness.status !== 400 || !JSON.stringify(badFreshness.body).includes("freshness_days")) {
    throw new Error(`Expected Worker freshness_days validation error: ${JSON.stringify(badFreshness)}`);
  }
}

async function assertRunLifecycle() {
  const created = await postJson("/api/runs", {
    presetId: "standard",
    inputs: {
      topic: "wrangler dev worker smoke",
      audience: "operators",
      freshness_days: 30
    }
  });
  if (created.status !== 202 || !created.body.run?.id) {
    throw new Error(`Expected Worker run creation to return 202 and run id: ${JSON.stringify(created.body)}`);
  }

  const runId = created.body.run.id;
  const run = await waitForComplete(runId);
  if (run.topic !== "wrangler dev worker smoke" || run.audience !== "operators" || run.freshnessDays !== 30) {
    throw new Error("Expected Worker run detail to preserve inputs");
  }
  if (!Array.isArray(run.timeline) || run.timeline.length !== 10) {
    throw new Error("Expected Worker run timeline to include all Deep Research steps");
  }
  if (!Array.isArray(run.artifacts) || run.artifacts.length !== 3) {
    throw new Error("Expected Worker completed run to expose Markdown, evidence bundle, and summary artifacts");
  }
  for (const artifactId of ["markdown_report", "evidence_bundle", "summary_json"]) {
    if (!run.artifacts.some((artifact) => artifact.id === artifactId)) {
      throw new Error(`Expected Worker completed run to expose ${artifactId}`);
    }
  }

  const list = await getJson("/api/runs");
  const listedRun = list.runs.find((candidate) => candidate.id === runId);
  if (!listedRun || listedRun.topic !== "wrangler dev worker smoke" || listedRun.status !== "complete") {
    throw new Error("Expected Worker run history to include normalized run");
  }

  const observability = await getJson(`/api/runs/${runId}/observability`);
  if (
    observability.observability?.metrics?.providerCallCount < 1
    || observability.observability?.metrics?.toolInvocationCount < 1
    || !Array.isArray(observability.observability.trace)
  ) {
    throw new Error("Expected Worker observability report with provider calls, tool invocations, and trace");
  }

  return runId;
}

async function assertArtifact(runId) {
  const markdownResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/markdown_report`);
  const markdown = await markdownResponse.text();
  if (!markdownResponse.ok || !markdown.includes("# wrangler dev worker smoke") || !markdown.includes("## Findings")) {
    throw new Error("Expected Worker Markdown report artifact from R2");
  }

  const bundleResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/evidence_bundle`);
  const bundle = await bundleResponse.json();
  if (!bundleResponse.ok || bundle.runId !== runId || !Array.isArray(bundle.evidence) || !Array.isArray(bundle.claims)) {
    throw new Error("Expected Worker evidence bundle artifact from R2");
  }

  const summaryResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/summary_json`);
  const summary = await summaryResponse.text();
  if (!summaryResponse.ok || !summary.includes(runId) || !summary.includes("plannedSteps")) {
    throw new Error("Expected Worker artifact download from R2 summary object");
  }
}

async function assertEvidenceReviewAndRegeneration(runId) {
  const reviewed = await requestJson(`/api/runs/${runId}/evidence/0`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", note: "keep this workflow evidence" })
  });
  if (reviewed.status !== 200 || reviewed.body.run?.evidence?.[0]?.review?.status !== "accepted") {
    throw new Error(`Expected Worker evidence review to be saved on the run: ${JSON.stringify(reviewed.body)}`);
  }

  const regenerated = await requestJson(`/api/runs/${runId}/artifacts/regenerate`, { method: "POST" });
  if (regenerated.status !== 200 || !regenerated.body.run?.artifacts?.some((artifact) => artifact.id === "review_summary")) {
    throw new Error("Expected Worker artifact regeneration to add review_summary");
  }

  const summaryResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/review_summary`);
  const summary = await summaryResponse.json();
  if (!summaryResponse.ok || summary.reviewedCount !== 1 || summary.acceptedCount !== 1) {
    throw new Error("Expected Worker review summary artifact from R2");
  }

  const edited = await requestJson(`/api/runs/${runId}/artifacts/review_summary`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: { ...summary, editorNote: "worker runtime artifact edit smoke" },
      note: "worker runtime edits review summary"
    })
  });
  const editedArtifact = edited.body.run?.artifacts?.find((artifact) => artifact.id === "review_summary");
  if (edited.status !== 200 || editedArtifact?.version !== 2) {
    throw new Error(`Expected Worker artifact edit to create version 2: ${JSON.stringify(edited.body)}`);
  }

  const versions = await requestJson(`/api/runs/${runId}/artifacts/review_summary/versions`);
  if (versions.status !== 200 || !Array.isArray(versions.body.versions) || versions.body.versions.length !== 2) {
    throw new Error("Expected Worker artifact versions endpoint to list two versions");
  }

  const diff = await requestJson(`/api/runs/${runId}/artifacts/review_summary/diff`);
  if (diff.status !== 200 || !Array.isArray(diff.body.diff?.lines) || diff.body.diff.lines.length === 0) {
    throw new Error("Expected Worker artifact diff endpoint to return changed lines");
  }
}

async function assertRetryCancelDelete(runId) {
  const retry = await postJson(`/api/runs/${runId}/retry-step`, { stepId: "search" });
  if (retry.status !== 202 || retry.body.run?.currentStepId !== "search") {
    throw new Error("Expected Worker retry-step to queue the requested step");
  }

  const cancel = await postJson(`/api/runs/${runId}/cancel`, {});
  if (cancel.status !== 200 || cancel.body.run?.status !== "canceled") {
    throw new Error("Expected Worker cancel endpoint to mark the run canceled");
  }

  const deleted = await requestJson(`/api/runs/${runId}`, { method: "DELETE" });
  if (deleted.status !== 200 || deleted.body.deleted !== runId) {
    throw new Error("Expected Worker run delete endpoint to delete the run");
  }

  const missing = await requestJson(`/api/runs/${runId}`);
  if (missing.status !== 404) {
    throw new Error(`Expected deleted Worker run to return 404: ${JSON.stringify(missing)}`);
  }
}

async function waitForComplete(runId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const payload = await getJson(`/api/runs/${runId}`);
    if (payload.run?.status === "complete") return payload.run;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for Worker run ${runId} to complete`);
}

async function waitForWorker() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (worker.exitCode !== null) {
      throw new Error(`wrangler dev exited early:\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Keep polling while workerd starts.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for wrangler dev:\n${output}`);
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
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : { error: `Expected JSON from ${path}, got ${contentType || "unknown content-type"}`, text: (await response.text()).slice(0, 240) };
  return { ok: response.ok, status: response.status, body };
}

async function runCommand(command, args) {
  const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let commandOutput = "";
  child.stdout.on("data", (chunk) => {
    commandOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    commandOutput += chunk.toString();
  });
  const code = await waitForExit(child);
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${code}:\n${commandOutput}`);
  }
}

async function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
