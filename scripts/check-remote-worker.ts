// @ts-nocheck
export {};

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const baseUrl = normalizeBaseUrl(readArg("--url") || process.env.AGENT_PLATFORM_URL || "");
const createRun = args.has("--create-run");
const confirmed = args.has("--yes");
const timeoutMs = Number(readArg("--timeout-ms") || process.env.REMOTE_WORKER_SMOKE_TIMEOUT_MS || "60000");

if (args.has("--help") || args.has("-h")) {
  printUsage();
  process.exit(0);
}

if (!baseUrl) {
  printUsage();
  console.log("");
  console.log("No remote Worker URL provided. Set AGENT_PLATFORM_URL or pass --url after deploying.");
  process.exit(0);
}

if (createRun && !confirmed) {
  throw new Error("Remote run creation is mutating. Re-run with --create-run --yes to confirm.");
}

await assertReadOnlySmoke();
if (createRun) {
  const runId = await assertRunLifecycle();
  await assertArtifacts(runId);
  await assertEvidenceReviewAndRegeneration(runId);
  await deleteRun(runId);
}

console.log(createRun ? "remote Worker lifecycle smoke passed" : "remote Worker read-only smoke passed");

async function assertReadOnlySmoke() {
  const health = await getJson("/api/health");
  if (health.ok !== true || health.runtime !== "cloudflare") {
    throw new Error(`Expected Cloudflare health payload: ${JSON.stringify(health)}`);
  }

  const readiness = await getJson("/api/readiness");
  if (readiness.runtime !== "cloudflare" || readiness.usableNow !== true) {
    throw new Error(`Expected deployed Worker readiness to be usable: ${JSON.stringify(readiness)}`);
  }

  const flows = await getJson("/api/flows");
  if (!Array.isArray(flows.flows) || !flows.flows.some((flow) => flow.id === "deep_research")) {
    throw new Error("Expected deployed Worker to expose the Deep Research flow");
  }

  const skills = await getJson("/api/skills");
  if (!Array.isArray(skills.skills) || !skills.skills.some((skill) => skill.id === "research-planner")) {
    throw new Error("Expected deployed Worker to expose editable skill catalog");
  }
  if (!Array.isArray(skills.bindings) || !skills.bindings.some((binding) => binding.stepId === "clarify")) {
    throw new Error("Expected deployed Worker to expose flow skill bindings");
  }
}

async function assertRunLifecycle() {
  const created = await postJson("/api/runs", {
    presetId: "standard",
    inputs: {
      topic: "remote worker smoke",
      audience: "operators",
      freshness_days: 30
    }
  });
  if (created.status !== 202 || !created.body.run?.id) {
    throw new Error(`Expected remote run creation to return 202 and run id: ${JSON.stringify(created.body)}`);
  }

  const runId = created.body.run.id;
  const run = await waitForComplete(runId);
  if (run.topic !== "remote worker smoke" || run.audience !== "operators" || run.freshnessDays !== 30) {
    throw new Error("Expected remote run detail to preserve inputs");
  }
  if (!Array.isArray(run.timeline) || run.timeline.length !== 10) {
    throw new Error("Expected remote run timeline to include all Deep Research steps");
  }
  for (const artifactId of ["markdown_report", "evidence_bundle", "summary_json"]) {
    if (!run.artifacts?.some((artifact) => artifact.id === artifactId)) {
      throw new Error(`Expected remote completed run to expose ${artifactId}`);
    }
  }

  const list = await getJson("/api/runs");
  const listedRun = list.runs?.find((candidate) => candidate.id === runId);
  if (!listedRun || listedRun.topic !== "remote worker smoke" || listedRun.status !== "complete") {
    throw new Error("Expected remote run history to include normalized completed run");
  }

  const observability = await getJson(`/api/runs/${runId}/observability`);
  if (
    observability.observability?.metrics?.providerCallCount < 1
    || observability.observability?.metrics?.toolInvocationCount < 1
    || !Array.isArray(observability.observability.trace)
  ) {
    throw new Error("Expected remote observability report with provider calls, tool invocations, and trace");
  }

  return runId;
}

async function assertArtifacts(runId) {
  const markdownResponse = await fetchUrl(`/api/runs/${runId}/artifacts/markdown_report`);
  const markdown = await markdownResponse.text();
  if (!markdownResponse.ok || !markdown.includes("# remote worker smoke") || !markdown.includes("## Findings")) {
    throw new Error("Expected remote Markdown report artifact from R2");
  }

  const bundleResponse = await fetchUrl(`/api/runs/${runId}/artifacts/evidence_bundle`);
  const bundle = await bundleResponse.json();
  if (!bundleResponse.ok || bundle.runId !== runId || !Array.isArray(bundle.evidence) || !Array.isArray(bundle.claims)) {
    throw new Error("Expected remote evidence bundle artifact from R2");
  }

  const summaryResponse = await fetchUrl(`/api/runs/${runId}/artifacts/summary_json`);
  const summary = await summaryResponse.text();
  if (!summaryResponse.ok || !summary.includes(runId) || !summary.includes("plannedSteps")) {
    throw new Error("Expected remote summary artifact from R2");
  }
}

async function assertEvidenceReviewAndRegeneration(runId) {
  const reviewed = await requestJson(`/api/runs/${runId}/evidence/0`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "accepted", note: "remote smoke accepts this evidence" })
  });
  if (reviewed.status !== 200 || reviewed.body.run?.evidence?.[0]?.review?.status !== "accepted") {
    throw new Error("Expected remote evidence review to be saved on the run");
  }

  const regenerated = await requestJson(`/api/runs/${runId}/artifacts/regenerate`, { method: "POST" });
  if (regenerated.status !== 200 || !regenerated.body.run?.artifacts?.some((artifact) => artifact.id === "review_summary")) {
    throw new Error("Expected remote artifact regeneration to add review_summary");
  }

  const summaryResponse = await fetchUrl(`/api/runs/${runId}/artifacts/review_summary`);
  const summary = await summaryResponse.json();
  if (!summaryResponse.ok || summary.reviewedCount !== 1 || summary.acceptedCount !== 1) {
    throw new Error("Expected remote review summary artifact from R2");
  }

  const edited = await requestJson(`/api/runs/${runId}/artifacts/review_summary`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: { ...summary, editorNote: "remote artifact edit smoke" },
      note: "remote smoke edits review summary"
    })
  });
  const editedArtifact = edited.body.run?.artifacts?.find((artifact) => artifact.id === "review_summary");
  if (edited.status !== 200 || editedArtifact?.version !== 2) {
    throw new Error("Expected remote artifact edit to create version 2");
  }

  const versions = await requestJson(`/api/runs/${runId}/artifacts/review_summary/versions`);
  if (versions.status !== 200 || !Array.isArray(versions.body.versions) || versions.body.versions.length !== 2) {
    throw new Error("Expected remote artifact versions endpoint to list two versions");
  }

  const diff = await requestJson(`/api/runs/${runId}/artifacts/review_summary/diff`);
  if (diff.status !== 200 || !Array.isArray(diff.body.diff?.lines) || diff.body.diff.lines.length === 0) {
    throw new Error("Expected remote artifact diff endpoint to return changed lines");
  }
}

async function deleteRun(runId) {
  const deleted = await requestJson(`/api/runs/${runId}`, { method: "DELETE" });
  if (deleted.status !== 200 || deleted.body.deleted !== runId) {
    throw new Error(`Expected remote run delete endpoint to delete ${runId}`);
  }
}

async function waitForComplete(runId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await getJson(`/api/runs/${runId}`);
    if (payload.run?.status === "complete") return payload.run;
    if (payload.run?.status === "failed") {
      throw new Error(`Remote run ${runId} failed: ${JSON.stringify(payload.run)}`);
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for remote run ${runId} to complete after ${timeoutMs}ms`);
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

async function requestJson(path, init = {}) {
  const response = await fetchUrl(path, init);
  const body = await response.json();
  return { ok: response.ok, status: response.status, body };
}

function fetchUrl(path, init) {
  return fetch(`${baseUrl}${path}`, init);
}

function readArg(name) {
  const index = rawArgs.indexOf(name);
  return index === -1 ? undefined : rawArgs[index + 1];
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run cloudflare:smoke:remote -- --url https://<worker-url>");
  console.log("  npm run cloudflare:smoke:remote -- --url https://<worker-url> --create-run --yes");
  console.log("");
  console.log("Environment:");
  console.log("  AGENT_PLATFORM_URL=https://<worker-url>");
  console.log("  REMOTE_WORKER_SMOKE_TIMEOUT_MS=60000");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
