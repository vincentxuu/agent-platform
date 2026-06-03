// @ts-nocheck
// Public /v1 API + access-control control-flow check against an isolated local
// dev server. Mirrors the boot strategy of scripts/check-local-api.ts.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const port = Number(process.env.PUBLIC_API_CHECK_PORT || "8795");
const baseUrl = `http://127.0.0.1:${port}`;
const stateDir = join(process.cwd(), ".tmp", "public-api-check");
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
    DEV_VARS_PATH: join(stateDir, ".dev.vars")
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForServer();
  await run();
  console.log("public api check passed");
} finally {
  server.kill("SIGTERM");
  await waitForExit();
  rmSync(stateDir, { recursive: true, force: true });
}

async function run() {
  // 1. Issue a fully-scoped client (admin API).
  const created = await admin("POST", "/api/api-clients", {
    name: "Full Access",
    scopes: ["runs:write", "runs:read", "artifacts:read", "evidence:read", "flows:read"],
    allowedFlows: [],
    rateLimit: { requestsPerMin: 100, runsPerDay: 100 },
    budget: { maxCostUsd: 100, maxTokens: 1000000 }
  });
  if (created.status !== 201 || !created.body.key || !created.body.key.startsWith("ak_live_")) {
    throw new Error(`Expected client creation to return ak_live_ key once: ${JSON.stringify(created.body)}`);
  }
  const fullKey = created.body.key;
  const fullClientId = created.body.client.id;
  if (created.body.client.keyHash) {
    throw new Error("Admin client payload must not expose key_hash");
  }

  // 2. Missing key -> 401.
  const noKey = await v1("POST", "/v1/runs", undefined, runBody());
  if (noKey.status !== 401 || noKey.body.code !== "unauthorized") {
    throw new Error(`Expected 401 without key: ${JSON.stringify(noKey)}`);
  }

  // 3. Valid key creates a run -> 200 with runId/status.
  const createdRun = await v1("POST", "/v1/runs", fullKey, runBody("public api smoke"));
  if (createdRun.status !== 200 || !createdRun.body.runId || createdRun.body.status !== "queued") {
    throw new Error(`Expected run creation with key: ${JSON.stringify(createdRun)}`);
  }
  const runId = createdRun.body.runId;

  // Reading the run with the same key works.
  const runRead = await v1("GET", `/v1/runs/${runId}`, fullKey);
  if (runRead.status !== 200 || runRead.body.runId !== runId) {
    throw new Error(`Expected run read with key: ${JSON.stringify(runRead)}`);
  }

  // Discovery lists flows.
  const flows = await v1("GET", "/v1/flows", fullKey);
  if (flows.status !== 200 || !Array.isArray(flows.body.flows) || !flows.body.flows.some((flow) => flow.id === "deep_research")) {
    throw new Error(`Expected /v1/flows discovery: ${JSON.stringify(flows)}`);
  }

  // Wait for run to complete, then read artifacts + evidence.
  await waitForRunComplete(runId, fullKey);
  const artifacts = await v1("GET", `/v1/runs/${runId}/artifacts`, fullKey);
  if (artifacts.status !== 200 || !Array.isArray(artifacts.body.artifacts) || artifacts.body.artifacts.length < 1) {
    throw new Error(`Expected artifact list: ${JSON.stringify(artifacts)}`);
  }
  const artifactId = artifacts.body.artifacts[0].id;
  const artifact = await v1("GET", `/v1/runs/${runId}/artifacts/${artifactId}`, fullKey);
  if (artifact.status !== 200 || artifact.body.id !== artifactId || artifact.body.content === undefined) {
    throw new Error(`Expected artifact download: ${JSON.stringify(artifact)}`);
  }
  const evidence = await v1("GET", `/v1/runs/${runId}/evidence`, fullKey);
  if (evidence.status !== 200 || !Array.isArray(evidence.body.evidence)) {
    throw new Error(`Expected evidence list: ${JSON.stringify(evidence)}`);
  }

  // Ownership isolation: a different client cannot read this run.
  const otherClient = await admin("POST", "/api/api-clients", {
    name: "Other",
    scopes: ["runs:read"],
    rateLimit: { requestsPerMin: 100 }
  });
  const otherRead = await v1("GET", `/v1/runs/${runId}`, otherClient.body.key);
  if (otherRead.status !== 404) {
    throw new Error(`Expected run owned by another client to be 404: ${JSON.stringify(otherRead)}`);
  }

  // 4. Missing scope -> 403.
  const noScope = await admin("POST", "/api/api-clients", {
    name: "No Write Scope",
    scopes: ["runs:read"],
    rateLimit: { requestsPerMin: 100 }
  });
  const scopeDenied = await v1("POST", "/v1/runs", noScope.body.key, runBody());
  if (scopeDenied.status !== 403 || scopeDenied.body.code !== "forbidden") {
    throw new Error(`Expected 403 for missing scope: ${JSON.stringify(scopeDenied)}`);
  }

  // 5. Flow not in allow-list -> 403.
  const flowRestricted = await admin("POST", "/api/api-clients", {
    name: "Flow Restricted",
    scopes: ["runs:write"],
    allowedFlows: ["some_other_flow"],
    rateLimit: { requestsPerMin: 100 }
  });
  const flowDenied = await v1("POST", "/v1/runs", flowRestricted.body.key, runBody());
  if (flowDenied.status !== 403 || flowDenied.body.code !== "forbidden") {
    throw new Error(`Expected 403 for flow not allowed: ${JSON.stringify(flowDenied)}`);
  }

  // 6. Rate limit -> 429 with Retry-After.
  const limited = await admin("POST", "/api/api-clients", {
    name: "Rate Limited",
    scopes: ["flows:read"],
    rateLimit: { requestsPerMin: 2 }
  });
  await v1("GET", "/v1/flows", limited.body.key); // 1
  await v1("GET", "/v1/flows", limited.body.key); // 2
  const rateDenied = await v1("GET", "/v1/flows", limited.body.key); // 3 -> over limit
  if (rateDenied.status !== 429 || rateDenied.body.code !== "rate_limited" || !rateDenied.headers["retry-after"]) {
    throw new Error(`Expected 429 with Retry-After: ${JSON.stringify(rateDenied)} headers=${JSON.stringify(rateDenied.headers)}`);
  }
  if (!rateDenied.headers["x-ratelimit-limit"]) {
    throw new Error("Expected X-RateLimit-Limit header on rate-limited response");
  }

  // 7. Budget exceeded -> 402.
  const budgetClient = await admin("POST", "/api/api-clients", {
    name: "Budget Capped",
    scopes: ["runs:write", "runs:read"],
    rateLimit: { requestsPerMin: 100, runsPerDay: 100 },
    budget: { maxTokens: 1 }
  });
  const budgetKey = budgetClient.body.key;
  const budgetRun = await v1("POST", "/v1/runs", budgetKey, runBody("budget seed"));
  if (budgetRun.status !== 200) {
    throw new Error(`Expected first budget run to succeed: ${JSON.stringify(budgetRun)}`);
  }
  const budgetRunId = budgetRun.body.runId;
  // The local runtime attributes settled usage on the completion timer; wait
  // wall-clock for usage to accrue past the cap.
  await sleep(5000);
  // Run creation is denied once over budget.
  const budgetDenied = await v1("POST", "/v1/runs", budgetKey, runBody("over budget"));
  if (budgetDenied.status !== 402 || budgetDenied.body.code !== "budget_exceeded") {
    throw new Error(`Expected 402 budget_exceeded after usage accrues: ${JSON.stringify(budgetDenied)}`);
  }
  // Read-only requests are exempt from budget: the client can still retrieve
  // already-paid-for results even after blowing its budget.
  const budgetRead = await v1("GET", `/v1/runs/${budgetRunId}`, budgetKey);
  if (budgetRead.status !== 200 || budgetRead.body.runId !== budgetRunId) {
    throw new Error(`Expected read to stay allowed when over budget: ${JSON.stringify(budgetRead)}`);
  }

  // 8. Audit log present for the full client.
  const audit = await admin("GET", `/api/api-clients/${fullClientId}/audit`);
  if (audit.status !== 200 || !Array.isArray(audit.body.audit) || audit.body.audit.length === 0) {
    throw new Error(`Expected audit log entries: ${JSON.stringify(audit.body)}`);
  }
  if (!audit.body.audit.some((entry) => entry.path === "/v1/runs" && entry.outcome === "allow")) {
    throw new Error("Expected an allow audit entry for /v1/runs");
  }
  if (audit.body.usage === undefined) {
    throw new Error("Expected current-period usage in audit response");
  }

  // 9. Revoke -> subsequent calls 401.
  const revoked = await admin("POST", `/api/api-clients/${fullClientId}/revoke`, {});
  if (revoked.status !== 200 || revoked.body.client.status !== "revoked") {
    throw new Error(`Expected revoke to flip status: ${JSON.stringify(revoked.body)}`);
  }
  const afterRevoke = await v1("GET", `/v1/runs/${runId}`, fullKey);
  if (afterRevoke.status !== 401 || afterRevoke.body.code !== "unauthorized") {
    throw new Error(`Expected revoked key to be 401: ${JSON.stringify(afterRevoke)}`);
  }
}

function runBody(topic = "public api run") {
  return {
    flowId: "deep_research",
    presetId: "standard",
    inputs: { topic, audience: "engineering leaders", freshnessDays: 30 }
  };
}

async function waitForRunComplete(runId, key) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    const payload = await v1("GET", `/v1/runs/${runId}`, key);
    if (payload.body?.status === "complete") return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${runId} to complete`);
}

async function admin(method, path, body) {
  return request(method, path, undefined, body);
}

async function v1(method, path, key, body) {
  return request(method, path, key, body);
}

async function request(method, path, key, body) {
  const headers = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  const parsed = contentType.includes("application/json")
    ? await response.json()
    : { text: await response.text() };
  const headerObject = {};
  response.headers.forEach((value, name) => { headerObject[name] = value; });
  return { status: response.status, body: parsed, headers: headerObject };
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
      // keep polling
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for local dev server:\n${output}`);
}

async function waitForExit() {
  if (server.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    server.once("exit", () => { clearTimeout(timer); resolve(undefined); });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
