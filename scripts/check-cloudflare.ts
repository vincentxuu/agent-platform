// @ts-nocheck
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getCloudflareArchitectureSummary } from "../packages/cloudflare/src/service-map.js";

const wrangler = readFileSync("wrangler.toml", "utf8");
const workerSource = readFileSync("apps/worker/src/index.ts", "utf8");
const workflowSource = readFileSync("apps/worker/src/workflow.ts", "utf8");
const repositorySource = readFileSync("packages/cloudflare/src/d1-repository.ts", "utf8");
const deployScript = readFileSync("scripts/cloudflare-deploy.ts", "utf8");
const remoteSmokeScript = readFileSync("scripts/check-remote-worker.ts", "utf8");

const sourceJavaScriptFiles = findFiles(".")
  .filter((path) => !path.startsWith("node_modules/"))
  .filter((path) => !path.startsWith(".tmp/"))
  .filter((path) => !path.startsWith(".wrangler/"))
  .filter((path) => !path.startsWith("apps/web/dist/"))
  .filter((path) => path.endsWith(".js") || path.endsWith(".mjs"));
if (sourceJavaScriptFiles.length > 0) {
  throw new Error(`Source files must be TypeScript only. Found: ${sourceJavaScriptFiles.join(", ")}`);
}

for (const token of ["DB", "CACHE", "ARTIFACTS", "VECTORIZE", "RUN_QUEUE", "RUN_COORDINATOR", "DEEP_RESEARCH_WORKFLOW", "ASSETS", "AI"]) {
  if (!wrangler.includes(token)) {
    throw new Error(`wrangler.toml is missing ${token} binding`);
  }
}

for (const token of ["[[workflows]]", "agent-platform-deep-research", "DeepResearchWorkflow"]) {
  if (!wrangler.includes(token)) {
    throw new Error(`wrangler.toml is missing workflow config token ${token}`);
  }
}

for (const token of [
  "new Hono",
  "/api/health",
  "/api/flows",
  "/api/readiness",
  "/api/config",
  "/api/skills",
  "/api/runs",
  "/observability",
  "createObservabilityReport",
  "/api/runs/:runId/evidence/:evidenceIndex",
  "/api/runs/:runId/artifacts/regenerate",
  "/api/runs/:runId/artifacts/:artifactId/versions",
  "/api/runs/:runId/artifacts/:artifactId/diff",
  "/api/runs/:runId/artifacts/:artifactId",
  "/api/runs/:runId/cancel",
  "/api/runs/:runId/retry-step",
  "regenerateReviewArtifact",
  "updateEvidenceReview",
  "updateArtifactVersion",
  "listArtifactVersions",
  "createArtifactDiff",
  "createConfigReport",
  "updateManagementConfig",
  "createManagedSkill",
  "updateManagedSkill",
  "createSkillBindings",
  "app.delete",
  "DEEP_RESEARCH_WORKFLOW.create",
  "DEEP_RESEARCH_WORKFLOW.get",
  "queue(batch, env)",
  "RunCoordinator"
]) {
  if (!workerSource.includes(token)) {
    throw new Error(`Worker entrypoint is missing ${token}`);
  }
}

for (const token of ["WorkflowEntrypoint", "step.do", "plan-flow-execution", "collect-evidence", "write-artifacts", "markdown_report", "evidence_bundle", "ARTIFACTS.put", "RUN_QUEUE.send", "persistRunStatus", "recordRunEvent"]) {
  if (!workflowSource.includes(token)) {
    throw new Error(`Workflow implementation is missing ${token}`);
  }
}

for (const token of ["flow_runs", "step_runs", "run_events", "seedBuiltInFlows", "updateRunStatus", "deleteRun", "deleteAllRuns"]) {
  if (!repositorySource.includes(token)) {
    throw new Error(`D1 repository is missing ${token}`);
  }
}

for (const token of ["--apply-setup", "--deploy", "--yes", "--smoke-url", "--smoke-create-run", "AGENT_PLATFORM_URL", "remoteSmokeCommand", "blockingSetupCommands", "provisioningCommands", "\"whoami\"", "\"migrations\"", "\"apply\"", "\"deploy\""]) {
  if (!deployScript.includes(token)) {
    throw new Error(`Cloudflare deploy helper is missing ${token}`);
  }
}

for (const token of ["AGENT_PLATFORM_URL", "--create-run", "--yes", "/api/readiness", "/api/runs", "/api/skills", "markdown_report", "evidence_bundle", "summary_json", "/versions", "/diff"]) {
  if (!remoteSmokeScript.includes(token)) {
    throw new Error(`Remote Worker smoke check is missing ${token}`);
  }
}

const summary = getCloudflareArchitectureSummary();
const services = summary.map((item) => item.service);
for (const service of ["Workers", "Workers Assets", "D1", "R2", "Vectorize", "KV", "Queues", "Workflows", "Durable Objects", "Workers AI"]) {
  if (!services.includes(service)) {
    throw new Error(`Cloudflare service map is missing ${service}`);
  }
}

console.log("cloudflare check passed");

function findFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    if ([".git", "node_modules", ".tmp", ".wrangler", "dist"].includes(entry)) continue;
    const path = join(root, entry);
    const normalized = path.replace(/^\.\//, "");
    if (normalized === "apps/web/dist") continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...findFiles(path));
    } else {
      files.push(normalized);
    }
  }
  return files;
}
