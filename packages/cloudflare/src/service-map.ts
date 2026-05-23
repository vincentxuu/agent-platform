// @ts-nocheck
export const CLOUDFLARE_SERVICE_MAP = Object.freeze({
  edge: {
    service: "Workers",
    binding: "default fetch handler",
    responsibility: "HTTP API, auth boundary, provider routing, policy checks, and queue dispatch"
  },
  ui: {
    service: "Workers Assets",
    binding: "ASSETS",
    responsibility: "Serve the Agent Gateway web console from the same edge deployment"
  },
  relationalStore: {
    service: "D1",
    binding: "DB",
    responsibility: "Flows, runs, step runs, policies, skills, evidence metadata, metrics, and eval records"
  },
  objectStore: {
    service: "R2",
    binding: "ARTIFACTS",
    responsibility: "Large artifacts, evidence bundles, exported reports, diffs, and durable step outputs"
  },
  vectorStore: {
    service: "Vectorize",
    binding: "VECTORIZE",
    responsibility: "Chunk embeddings, semantic memory retrieval, and RAG candidate search"
  },
  ephemeralStore: {
    service: "KV",
    binding: "CACHE",
    responsibility: "Session state, provider health cache, idempotency keys, and short-lived UI snapshots"
  },
  asyncExecution: {
    service: "Queues",
    binding: "RUN_QUEUE",
    responsibility: "High-throughput background jobs such as evals, exports, retries, and provider health checks"
  },
  durableWorkflow: {
    service: "Workflows",
    binding: "DEEP_RESEARCH_WORKFLOW",
    responsibility: "Durable multi-step Deep Research execution with retryable step boundaries"
  },
  runCoordination: {
    service: "Durable Objects",
    binding: "RUN_COORDINATOR",
    responsibility: "Single-writer run coordination, live status, checkpoint fan-out, and streaming state"
  },
  modelRuntime: {
    service: "Workers AI",
    binding: "AI",
    responsibility: "Native Cloudflare model calls where policy allows edge-hosted inference"
  }
});

export function requireCloudflareBindings(env) {
  const required = [
    "ASSETS",
    "DB",
    "CACHE",
    "ARTIFACTS",
    "VECTORIZE",
    "RUN_QUEUE",
    "RUN_COORDINATOR",
    "DEEP_RESEARCH_WORKFLOW"
  ];
  const missing = required.filter((binding) => !env?.[binding]);
  if (missing.length > 0) {
    throw new Error(`Missing Cloudflare bindings: ${missing.join(", ")}`);
  }
}

export function getCloudflareArchitectureSummary() {
  return Object.entries(CLOUDFLARE_SERVICE_MAP).map(([layer, config]) => ({
    layer,
    service: config.service,
    binding: config.binding,
    responsibility: config.responsibility
  }));
}
