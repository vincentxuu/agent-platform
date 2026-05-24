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
  const customFlowId = await assertFlowDefineCommands();
  await assertConfigEditing();
  await assertValidation();
  const runId = await assertRunLifecycle(customFlowId);
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

  const skillEval = await requestJson("/api/skills/research-planner/evals", { method: "POST" });
  if (skillEval.status !== 200 || skillEval.body.eval?.passed !== true) {
    throw new Error("Expected Worker skill eval command to pass for enabled skill");
  }

  const disabledSkill = await requestJson("/api/skills/research-planner", { method: "DELETE" });
  if (disabledSkill.status !== 200 || disabledSkill.body.skill?.enabled !== false) {
    throw new Error("Expected Worker skill delete command to disable skill");
  }

  const draftSkill = await requestJson("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "worker-custom-checker", name: "Worker Custom Checker", version: "0.1.0", description: "Draft smoke skill" })
  });
  if (draftSkill.status !== 201 || !draftSkill.body.skills?.some((skill) => skill.id === "worker-custom-checker" && skill.source === "draft")) {
    throw new Error("Expected Worker draft skill creation");
  }

  const provider = await requestJson("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "worker-custom-provider", name: "Worker Custom Provider", enabled: false, credentialRef: "WORKER_CUSTOM_KEY", models: ["worker-model"], activeModel: "worker-model" })
  });
  if (provider.status !== 201 || provider.body.provider?.id !== "worker-custom-provider") {
    throw new Error("Expected Worker provider creation");
  }

  const enabledProvider = await requestJson("/api/providers/worker-custom-provider", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, activeModel: "worker-model" })
  });
  if (enabledProvider.status !== 200 || enabledProvider.body.provider?.enabled !== true) {
    throw new Error("Expected Worker provider update to enable provider");
  }

  const disabledProvider = await requestJson("/api/providers/worker-custom-provider", { method: "DELETE" });
  if (disabledProvider.status !== 200 || disabledProvider.body.provider?.enabled !== false) {
    throw new Error("Expected Worker provider delete command to disable provider");
  }

  const createdPolicy = await requestJson("/api/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "worker-check-policy",
      name: "Worker Check Policy",
      draft: {
        maxCostUsd: 1.75,
        maxIterations: 4,
        citationRequired: true,
        allowedProviders: ["workers_ai", "search"]
      }
    })
  });
  if (createdPolicy.status !== 201 || createdPolicy.body.policy?.id !== "worker-check-policy") {
    throw new Error("Expected Worker policy draft creation");
  }

  const updatedPolicy = await requestJson("/api/policies/worker-check-policy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft: { maxCostUsd: 2.25, maxIterations: 6, citationRequired: false, allowedProviders: ["workers_ai"] } })
  });
  if (updatedPolicy.status !== 200 || updatedPolicy.body.policy?.draft?.maxCostUsd !== 2.25) {
    throw new Error("Expected Worker policy draft update");
  }

  const publishedPolicy = await requestJson("/api/policies/worker-check-policy/versions", { method: "POST" });
  if (publishedPolicy.status !== 201 || publishedPolicy.body.policy?.version !== 1) {
    throw new Error("Expected Worker policy publication");
  }

  const appliedPolicy = await requestJson("/api/policies/worker-check-policy/apply", { method: "POST" });
  if (appliedPolicy.status !== 200 || appliedPolicy.body.config?.policy?.allowedProviders?.[0] !== "workers_ai") {
    throw new Error("Expected Worker policy apply-to-flow command");
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

async function assertFlowDefineCommands() {
  const initial = await getJson("/api/flows");
  if (!initial.flows.some((flow) => flow.id === "deep_research")) {
    throw new Error("Expected Worker flows endpoint to include Deep Research");
  }

  const clone = await postJson("/api/flows/deep_research/clone", { id: "worker_check_flow", name: "Worker Check Flow" });
  if (clone.status !== 201 || clone.body.flow?.id !== "worker_check_flow" || !clone.body.flow.hasDraft) {
    throw new Error(`Expected Worker flow clone command to create a draft: ${JSON.stringify(clone.body)}`);
  }

  const definition = clone.body.flow.draft || clone.body.flow.definition;
  definition.name = "Worker Check Flow Updated";
  const updated = await requestJson("/api/flows/worker_check_flow", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ definition })
  });
  if (updated.status !== 200 || updated.body.validation?.length !== 0 || !updated.body.flow.hasDraft) {
    throw new Error(`Expected Worker flow draft update to validate cleanly: ${JSON.stringify(updated.body)}`);
  }

  const published = await requestJson("/api/flows/worker_check_flow/versions", { method: "POST" });
  if (published.status !== 201 || published.body.version !== 1 || published.body.flow.status !== "published") {
    throw new Error(`Expected Worker flow publish command to create v1: ${JSON.stringify(published.body)}`);
  }

  const detail = await getJson("/api/flows/worker_check_flow");
  if (detail.flow.version !== 1 || detail.flow.hasDraft !== false) {
    throw new Error("Expected Worker published flow detail to expose v1 without a draft");
  }

  return "worker_check_flow";
}

async function assertRunLifecycle(flowId = "deep_research") {
  const created = await postJson(`/api/flows/${flowId}/runs`, {
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
  const rejected = await requestJson(`/api/runs/${runId}/evidence/1`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "rejected", note: "reject this worker evidence" })
  });
  if (rejected.status !== 200 || rejected.body.run?.evidence?.[1]?.review?.status !== "rejected") {
    throw new Error("Expected Worker evidence reject command to be saved on the run");
  }
  const annotated = await requestJson(`/api/runs/${runId}/evidence/2`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "watch", note: "worker follow-up annotation" })
  });
  if (annotated.status !== 200 || annotated.body.run?.evidence?.[2]?.review?.note !== "worker follow-up annotation") {
    throw new Error("Expected Worker evidence annotation command to be saved on the run");
  }

  const regenerated = await requestJson(`/api/runs/${runId}/artifacts/regenerate`, { method: "POST" });
  if (regenerated.status !== 200 || !regenerated.body.run?.artifacts?.some((artifact) => artifact.id === "review_summary")) {
    throw new Error("Expected Worker artifact regeneration to add review_summary");
  }

  const summaryResponse = await fetch(`${baseUrl}/api/runs/${runId}/artifacts/review_summary`);
  const summary = await summaryResponse.json();
  if (!summaryResponse.ok || summary.reviewedCount !== 3 || summary.acceptedCount !== 1 || summary.rejectedCount !== 1) {
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

  const approvedArtifact = await requestJson(`/api/runs/${runId}/artifacts/review_summary`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: { ...summary, review: { status: "accepted" } },
      note: "approve worker review summary"
    })
  });
  if (approvedArtifact.status !== 200 || approvedArtifact.body.artifact?.version !== 3) {
    throw new Error("Expected Worker artifact approve command to create a reviewed version");
  }

  const versions = await requestJson(`/api/runs/${runId}/artifacts/review_summary/versions`);
  if (versions.status !== 200 || !Array.isArray(versions.body.versions) || versions.body.versions.length !== 3) {
    throw new Error("Expected Worker artifact versions endpoint to list three versions");
  }

  const diff = await requestJson(`/api/runs/${runId}/artifacts/review_summary/diff`);
  if (diff.status !== 200 || !Array.isArray(diff.body.diff?.lines) || diff.body.diff.lines.length === 0) {
    throw new Error("Expected Worker artifact diff endpoint to return changed lines");
  }

  const improvement = await requestJson("/api/improvements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceRunId: runId, type: "eval-case", summary: "Create Worker regression case from corrected run" })
  });
  if (improvement.status !== 201 || improvement.body.proposal?.evalCase?.sourceRunId !== runId) {
    throw new Error("Expected Worker improvement proposal command to create a draft eval case from run feedback");
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
