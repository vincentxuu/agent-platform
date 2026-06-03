import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { deepResearchFlow } from "../packages/core/src/deep-research-flow.js";
import { validateFlowDefinition, validateFlowInputs } from "../packages/core/src/flow.js";
import { InMemoryFlowRuntime } from "../packages/runtime/src/flow-runtime.js";
import {
  DEFAULT_ALLOWED_PROVIDER_IDS,
  createProviderConfigs,
  createProviderReadiness,
  fetchProviderModelIds,
  getProviderCatalogEntry
} from "../packages/runtime/src/provider-catalog.js";
import {
  createLocalHealthReport,
  createLocalPlatformPaths,
  createLocalReadinessReport,
  loadLocalDevVars
} from "../packages/local/src/adapter.js";
import { LocalApiGatewayStore } from "../packages/local/src/api-gateway-store.js";
import {
  attributeRunUsage,
  authorizeRequest,
  generateApiKey,
  normalizeAllowedFlows,
  normalizeBudget,
  normalizeRateLimit,
  normalizeScopes,
  toPublicClient,
  type ApiScope,
  type GatewayDecision,
  type RateLimitHeaders
} from "../packages/runtime/src/api-gateway.js";

type JsonRecord = Record<string, unknown>;
type FlowDefinition = typeof deepResearchFlow;

type LocalFlowRecord = {
  id: string;
  status: "seed" | "draft" | "published" | "archived";
  source: "built-in" | "user";
  draft?: FlowDefinition;
  versions: Array<{
    version: number;
    flow: FlowDefinition;
    publishedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type LocalRunView = {
  id: string;
  flowId: string;
  presetId: string;
  status: "queued" | "running" | "complete" | "failed" | "canceled";
  currentStepId: string;
  clientId?: string;
  usageAttributed?: boolean;
  topic: string;
  audience: string;
  freshnessDays: number;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ stepId: string; status: string; attempt: number }>;
  evidence: Array<{ claim: string; source: string; sourceTitle: string; sourceUrl: string; alphaXivUrl?: string; arxivId?: string; excerpt: string; confidence: string; conflicts: string; review?: EvidenceReview }>;
  artifacts: Array<LocalArtifact>;
  detail: JsonRecord;
};

type LocalArtifact = {
  id: string;
  name: string;
  type: string;
  version: number;
  content: unknown;
  downloadUrl: string;
  versions?: Array<ArtifactVersion>;
};

type ArtifactVersion = {
  version: number;
  updatedAt: string;
  note: string;
  content: unknown;
};

type EvidenceReview = {
  status: "accepted" | "rejected" | "watch";
  note: string;
  updatedAt: string;
};

type LocalResearchSource = {
  id: string;
  title: string;
  url: string;
  alphaXivUrl?: string;
  arxivId?: string;
  provider: string;
  freshnessDays: number;
  excerpt: string;
  claims: string[];
  tags: string[];
};

type ManagementConfig = {
  flow: {
    id: string;
    policyRef?: string;
    defaultPreset: string;
    defaultAudience: string;
    defaultFreshnessDays: number;
  };
  policy: {
    maxCostUsd: number;
    maxIterations: number;
    citationRequired: boolean;
    allowedProviders: string[];
  };
  policies: ManagedPolicy[];
  improvementProposals: ManagedImprovementProposal[];
  providerCredentials: Record<string, { credentialRef: string; value: string; updatedAt: string }>;
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    credentialRef: string;
    credentialConfigured?: boolean;
    credentialSource?: string;
    models: string[];
    activeModel: string;
  }>;
  skills: ManagedSkill[];
};

type ManagedPolicy = {
  id: string;
  name: string;
  status: "draft" | "published" | "archived";
  version: number;
  draft: {
    maxCostUsd: number;
    maxIterations: number;
    citationRequired: boolean;
    allowedProviders: string[];
  };
  versions: Array<{
    version: number;
    publishedAt: string;
    config: ManagedPolicy["draft"];
  }>;
};

type ManagedImprovementProposal = {
  id: string;
  type: "eval-case" | "skill" | "policy" | "memory";
  status: "review";
  sourceRunId?: string;
  summary: string;
  evalCase: {
    id: string;
    sourceRunId?: string;
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
    status: "draft";
  };
  createdAt: string;
};

type ManagedSkill = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  activeVersion: string;
  availableVersions: string[];
  permissions: string[];
  evals: string[];
  source: "built-in" | "draft";
};

const paths = createLocalPlatformPaths();
const {
  port,
  webRoot,
  localStateDir,
  runStorePath,
  flowStorePath,
  configStorePath,
  localSourcesPath
} = paths;
let idCounter = 0;

const loadedDevVars = loadLocalDevVars(paths.devVarsPath);
const runtime = new InMemoryFlowRuntime({
  idFactory(prefix: string) {
    idCounter += 1;
    return `${prefix}_${idCounter}`;
  }
});

const runViews = new Map<string, LocalRunView>();
const runTimers = new Map<string, Array<NodeJS.Timeout>>();
const flowRecords = new Map<string, LocalFlowRecord>();
const apiGatewayStore = new LocalApiGatewayStore(paths.apiGatewayStorePath);
loadRunStore();
loadFlowStore();
let managementConfig = loadManagementConfig();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, createLocalHealthReport(paths));
    }

    if (url.pathname === "/api/api-clients" && request.method === "GET") {
      return sendJson(response, { clients: apiGatewayStore.listClients().map(serializeApiClient) });
    }

    if (url.pathname === "/api/api-clients" && request.method === "POST") {
      const body = await readJson(request);
      const result = await createApiClient(body);
      return sendJson(response, result.body, result.status);
    }

    const apiClientRevokeMatch = url.pathname.match(/^\/api\/api-clients\/([^/]+)\/revoke$/);
    if (apiClientRevokeMatch && request.method === "POST") {
      const result = revokeApiClient(apiClientRevokeMatch[1]);
      return sendJson(response, result.body, result.status);
    }

    const apiClientAuditMatch = url.pathname.match(/^\/api\/api-clients\/([^/]+)\/audit$/);
    if (apiClientAuditMatch && request.method === "GET") {
      const result = getApiClientAudit(apiClientAuditMatch[1]);
      return sendJson(response, result.body, result.status);
    }

    const apiClientMatch = url.pathname.match(/^\/api\/api-clients\/([^/]+)$/);
    if (apiClientMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateApiClient(apiClientMatch[1], body);
      return sendJson(response, result.body, result.status);
    }

    if (url.pathname.startsWith("/v1/")) {
      return handlePublicApi(url, request, response);
    }

    if (url.pathname === "/api/flows" && request.method === "GET") {
      return sendJson(response, { flows: listLocalFlows() });
    }

    if (url.pathname === "/api/flows" && request.method === "POST") {
      const body = await readJson(request);
      const result = createFlowDraft(body);
      if (!result.flow) return sendJson(response, { error: result.error, details: (result as any).details }, result.status);
      return sendJson(response, result, 201);
    }

    const flowRunMatch = url.pathname.match(/^\/api\/flows\/([^/]+)\/runs$/);
    if (flowRunMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = createFlowRun(flowRunMatch[1], body);
      if (!result.run) return sendJson(response, { error: result.error, details: (result as any).details }, result.status);
      return sendJson(response, result, 202);
    }

    const flowCloneMatch = url.pathname.match(/^\/api\/flows\/([^/]+)\/clone$/);
    if (flowCloneMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = cloneFlowDraft(flowCloneMatch[1], body);
      if (!result.flow) return sendJson(response, { error: result.error, details: (result as any).details }, result.status);
      return sendJson(response, result, 201);
    }

    const flowVersionMatch = url.pathname.match(/^\/api\/flows\/([^/]+)\/versions$/);
    if (flowVersionMatch && request.method === "POST") {
      const result = publishFlowDraft(flowVersionMatch[1]);
      if (!result.flow) return sendJson(response, { error: result.error, details: (result as any).details }, result.status);
      return sendJson(response, result, 201);
    }

    const flowMatch = url.pathname.match(/^\/api\/flows\/([^/]+)$/);
    if (flowMatch && request.method === "GET") {
      const flow = getFlowDetail(flowMatch[1]);
      if (!flow) return sendJson(response, { error: "Flow not found" }, 404);
      return sendJson(response, { flow });
    }

    if (flowMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateFlowDraft(flowMatch[1], body);
      if (!result.flow) return sendJson(response, { error: result.error, details: (result as any).details }, result.status);
      return sendJson(response, result);
    }

    if (flowMatch && request.method === "DELETE") {
      const result = deleteOrArchiveFlow(flowMatch[1]);
      if (!result.flow && !result.deleted) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result);
    }

    if (url.pathname === "/api/readiness" && request.method === "GET") {
      return sendJson(response, createReadinessReport());
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      return sendJson(response, createConfigReport());
    }

    if (url.pathname === "/api/config" && request.method === "PUT") {
      const body = await readJson(request);
      const result = updateManagementConfig(body);
      if (result.errors.length > 0) {
        return sendJson(response, { error: "Invalid config request", details: result.errors }, 400);
      }
      return sendJson(response, createConfigReport());
    }

    if (url.pathname === "/api/skills" && request.method === "GET") {
      return sendJson(response, { skills: managementConfig.skills, bindings: createSkillBindings() });
    }

    if (url.pathname === "/api/providers" && request.method === "GET") {
      return sendJson(response, { providers: managementConfig.providers });
    }

    if (url.pathname === "/api/policies" && request.method === "GET") {
      return sendJson(response, { policies: managementConfig.policies });
    }

    if (url.pathname === "/api/policies" && request.method === "POST") {
      const body = await readJson(request);
      const result = createManagedPolicy(body);
      if (!result.policy) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { policy: result.policy, policies: managementConfig.policies }, 201);
    }

    const policyVersionMatch = url.pathname.match(/^\/api\/policies\/([^/]+)\/versions$/);
    if (policyVersionMatch && request.method === "POST") {
      const result = publishManagedPolicy(policyVersionMatch[1]);
      if (!result.policy) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result, 201);
    }

    const policyApplyMatch = url.pathname.match(/^\/api\/policies\/([^/]+)\/apply$/);
    if (policyApplyMatch && request.method === "POST") {
      const result = applyManagedPolicy(policyApplyMatch[1]);
      if (!result.policy) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result);
    }

    const policyMatch = url.pathname.match(/^\/api\/policies\/([^/]+)$/);
    if (policyMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateManagedPolicy(policyMatch[1], body);
      if (!result.policy) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { policy: result.policy, policies: managementConfig.policies });
    }

    if (policyMatch && request.method === "DELETE") {
      const result = archiveManagedPolicy(policyMatch[1]);
      if (!result.policy) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { policy: result.policy, policies: managementConfig.policies });
    }

    if (url.pathname === "/api/improvements" && request.method === "POST") {
      const body = await readJson(request);
      const result = createImprovementProposal(body);
      return sendJson(response, { proposal: result.proposal, proposals: managementConfig.improvementProposals }, 201);
    }

    if (url.pathname === "/api/providers" && request.method === "POST") {
      const body = await readJson(request);
      const result = createManagedProvider(body);
      if (!result.provider) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { provider: result.provider, providers: managementConfig.providers }, 201);
    }

    const providerMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
    if (providerMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateManagedProvider(providerMatch[1], body);
      if (!result.provider) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { provider: result.provider, providers: managementConfig.providers });
    }

    if (providerMatch && request.method === "DELETE") {
      const result = updateManagedProvider(providerMatch[1], { enabled: false });
      if (!result.provider) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { provider: result.provider, providers: managementConfig.providers });
    }

    if (url.pathname === "/api/skills" && request.method === "POST") {
      const body = await readJson(request);
      const result = createManagedSkill(body);
      if (!result.skill) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { skill: result.skill, skills: managementConfig.skills }, 201);
    }

    const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
    if (skillMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateManagedSkill(skillMatch[1], body);
      if (!result.skill) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { skill: result.skill, skills: managementConfig.skills });
    }

    if (skillMatch && request.method === "DELETE") {
      const result = updateManagedSkill(skillMatch[1], { enabled: false });
      if (!result.skill) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { skill: result.skill, skills: managementConfig.skills });
    }

    const skillEvalMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/evals$/);
    if (skillEvalMatch && request.method === "POST") {
      const result = runManagedSkillEval(skillEvalMatch[1]);
      if (!result.eval) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result);
    }

    const providerTestMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/test$/);
    if (providerTestMatch && request.method === "POST") {
      const result = testProvider(providerTestMatch[1]);
      return sendJson(response, result, result.status);
    }

    const providerSyncMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models\/sync$/);
    if (providerSyncMatch && request.method === "POST") {
      const result = await syncProviderModels(providerSyncMatch[1]);
      if (!result.provider) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result, result.status);
    }

    const providerCredentialMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/credential$/);
    if (providerCredentialMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = updateProviderCredential(providerCredentialMatch[1], body);
      if (!result.credential) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result);
    }

    if (providerCredentialMatch && request.method === "DELETE") {
      const result = deleteProviderCredential(providerCredentialMatch[1]);
      if (!result.credential) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, result);
    }

    const providerModelTestMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models\/test$/);
    if (providerModelTestMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = testProviderModel(providerModelTestMatch[1], body);
      return sendJson(response, result, result.status);
    }

    if (url.pathname === "/api/runs" && request.method === "GET") {
      return sendJson(response, { runs: [...runViews.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }

    if (url.pathname === "/api/runs" && request.method === "DELETE") {
      clearLocalRuns();
      return sendJson(response, { deleted: "all", runs: [] });
    }

    if (url.pathname === "/api/runs" && request.method === "POST") {
      const body = await readJson(request);
      const result = createFlowRun(typeof body.flowId === "string" ? body.flowId : managementConfig.flow.id, body);
      if (!result.run) return sendJson(response, { error: result.error, details: result.details }, result.status);
      return sendJson(response, result, 202);
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch && request.method === "GET") {
      const run = runViews.get(runMatch[1]);
      if (!run) return sendJson(response, { error: "Run not found" }, 404);
      return sendJson(response, { runId: run.id, workflow: { status: run.status }, coordinator: run, run });
    }

    const observabilityMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/observability$/);
    if (observabilityMatch && request.method === "GET") {
      const run = runViews.get(observabilityMatch[1]);
      if (!run) return sendJson(response, { error: "Run not found" }, 404);
      return sendJson(response, { observability: createObservabilityReport(run) });
    }

    if (runMatch && request.method === "DELETE") {
      const deleted = deleteLocalRun(runMatch[1]);
      if (!deleted) return sendJson(response, { error: "Run not found" }, 404);
      return sendJson(response, { deleted: runMatch[1] });
    }

    const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      const run = cancelLocalRun(cancelMatch[1]);
      if (!run) return sendJson(response, { error: "Run not found" }, 404);
      return sendJson(response, { run });
    }

    const retryMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/retry-step$/);
    if (retryMatch && request.method === "POST") {
      const body = await readJson(request);
      const stepId = typeof body.stepId === "string" ? body.stepId : undefined;
      const existingRun = runViews.get(retryMatch[1]);
      const flow = existingRun ? getFlowForRun(existingRun) : undefined;
      if (stepId && flow && !flow.steps.some((step) => step.id === stepId)) {
        return sendJson(response, { error: "Invalid retry request", details: [`Unknown stepId: ${stepId}`] }, 400);
      }
      const run = retryLocalRunStep(retryMatch[1], stepId);
      if (!run) return sendJson(response, { error: "Run not found" }, 404);
      return sendJson(response, { run }, 202);
    }

    const evidenceReviewMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/evidence\/([0-9]+)$/);
    if (evidenceReviewMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateEvidenceReview(evidenceReviewMatch[1], Number(evidenceReviewMatch[2]), body);
      if (!result.run) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { run: result.run });
    }

    const regenerateMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/regenerate$/);
    if (regenerateMatch && request.method === "POST") {
      const result = regenerateArtifacts(regenerateMatch[1]);
      if (!result.run) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { run: result.run });
    }

    const artifactVersionsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)\/versions$/);
    if (artifactVersionsMatch && request.method === "GET") {
      const result = listArtifactVersions(artifactVersionsMatch[1], artifactVersionsMatch[2]);
      if (!result.versions) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { versions: result.versions });
    }

    const artifactDiffMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)\/diff$/);
    if (artifactDiffMatch && request.method === "GET") {
      const result = diffArtifactVersions(artifactDiffMatch[1], artifactDiffMatch[2]);
      if (!result.diff) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { diff: result.diff });
    }

    const artifactMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
    if (artifactMatch && request.method === "GET") {
      return sendArtifact(response, artifactMatch[1], artifactMatch[2]);
    }
    if (artifactMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const result = updateArtifactVersion(artifactMatch[1], artifactMatch[2], body);
      if (!result.run) return sendJson(response, { error: result.error }, result.status);
      return sendJson(response, { run: result.run, artifact: result.artifact });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return sendJson(response, { error: "Request body must be valid JSON" }, 400);
    }
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return sendJson(response, { error: message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local dev server listening on http://127.0.0.1:${port}`);
});

function listLocalFlows() {
  return [...flowRecords.values()].map((record) => serializeFlowRecord(record));
}

function getFlowDetail(flowId: string) {
  const record = flowRecords.get(flowId);
  return record ? serializeFlowRecord(record, true) : undefined;
}

function createFlowDraft(body: JsonRecord) {
  const requestedDefinition = typeof body.definition === "object" && body.definition !== null ? body.definition as JsonRecord : undefined;
  const template = requestedDefinition || (typeof body.baseFlowId === "string" ? resolveFlowDraftOrVersion(body.baseFlowId) : undefined) || createBlankFlowDefinition(body);
  const base = normalizeFlowDefinition({
    ...template,
    id: sanitizeFlowId(typeof body.id === "string" ? body.id : typeof body.name === "string" ? body.name : "custom_flow"),
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Custom Flow",
    description: typeof body.description === "string" ? body.description.slice(0, 300) : "Custom workflow draft.",
    version: 0
  });
  if (!base.id) return { status: 400, error: "Flow id is required" };
  if (flowRecords.has(base.id)) return { status: 409, error: "Flow already exists" };
  const now = new Date().toISOString();
  const record: LocalFlowRecord = {
    id: base.id,
    status: "draft",
    source: "user",
    draft: base,
    versions: [],
    createdAt: now,
    updatedAt: now
  };
  flowRecords.set(record.id, record);
  persistFlowStore();
  return { status: 201, flow: serializeFlowRecord(record, true) };
}

function cloneFlowDraft(flowId: string, body: JsonRecord) {
  const source = resolveFlowDraftOrVersion(flowId);
  if (!source) return { status: 404, error: "Source flow not found" };
  const cloneId = sanitizeFlowId(typeof body.id === "string" ? body.id : `${source.id}_copy`);
  if (!cloneId) return { status: 400, error: "Clone id is required" };
  if (flowRecords.has(cloneId)) return { status: 409, error: "Flow already exists" };
  const now = new Date().toISOString();
  const draft = normalizeFlowDefinition({
    ...source,
    id: cloneId,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : `${source.name} Copy`,
    description: typeof body.description === "string" ? body.description.slice(0, 300) : source.description,
    version: 0
  });
  const record: LocalFlowRecord = {
    id: cloneId,
    status: "draft",
    source: "user",
    draft,
    versions: [],
    createdAt: now,
    updatedAt: now
  };
  flowRecords.set(record.id, record);
  persistFlowStore();
  return { status: 201, flow: serializeFlowRecord(record, true) };
}

function updateFlowDraft(flowId: string, body: JsonRecord) {
  const record = flowRecords.get(flowId);
  if (!record) return { status: 404, error: "Flow not found" };
  if (record.source === "built-in") return { status: 409, error: "Built-in flow must be cloned before editing" };
  const current = record.draft || record.versions.at(-1)?.flow;
  if (!current) return { status: 404, error: "Flow draft not found" };
  const draft = normalizeFlowDefinition({
    ...current,
    ...(typeof body.definition === "object" && body.definition !== null ? body.definition as JsonRecord : {}),
    id: record.id,
    name: typeof body.name === "string" ? body.name.slice(0, 100) : (body.definition as any)?.name || current.name,
    description: typeof body.description === "string" ? body.description.slice(0, 300) : (body.definition as any)?.description || current.description,
    inputs: Array.isArray(body.inputs) ? body.inputs : (body.definition as any)?.inputs || current.inputs,
    presets: Array.isArray(body.presets) ? body.presets : (body.definition as any)?.presets || current.presets,
    steps: Array.isArray(body.steps) ? body.steps : (body.definition as any)?.steps || current.steps,
    edges: Array.isArray(body.edges) ? body.edges : (body.definition as any)?.edges || current.edges,
    artifacts: Array.isArray(body.artifacts) ? body.artifacts : (body.definition as any)?.artifacts || current.artifacts,
    version: 0
  });
  record.draft = draft;
  record.status = "draft";
  record.updatedAt = new Date().toISOString();
  persistFlowStore();
  return { status: 200, flow: serializeFlowRecord(record, true), validation: validateDraft(draft) };
}

function publishFlowDraft(flowId: string) {
  const record = flowRecords.get(flowId);
  if (!record) return { status: 404, error: "Flow not found" };
  if (record.source === "built-in") return { status: 409, error: "Built-in flow is already published" };
  if (!record.draft) return { status: 400, error: "Flow has no draft to publish" };
  const errors = validateDraft(record.draft);
  if (errors.length > 0) return { status: 400, error: "Flow draft is invalid", details: errors };
  const version = Math.max(0, ...record.versions.map((item) => item.version)) + 1;
  const now = new Date().toISOString();
  const flow = normalizeFlowDefinition({ ...record.draft, version });
  record.versions.push({ version, flow, publishedAt: now });
  record.status = "published";
  record.draft = undefined;
  record.updatedAt = now;
  persistFlowStore();
  return { status: 201, flow: serializeFlowRecord(record, true), version };
}

function deleteOrArchiveFlow(flowId: string) {
  const record = flowRecords.get(flowId);
  if (!record) return { status: 404, error: "Flow not found" };
  if (record.source === "built-in") return { status: 409, error: "Built-in flow cannot be deleted" };
  const hasRuns = [...runViews.values()].some((run) => run.flowId === flowId);
  if (!hasRuns && record.versions.length === 0) {
    flowRecords.delete(flowId);
    persistFlowStore();
    return { status: 200, deleted: flowId };
  }
  record.status = "archived";
  record.updatedAt = new Date().toISOString();
  persistFlowStore();
  return { status: 200, flow: serializeFlowRecord(record, true) };
}

function resolveRunnableFlow(flowId: string, version?: number): FlowDefinition | undefined {
  const record = flowRecords.get(flowId);
  if (!record || record.status === "archived") return undefined;
  if (version !== undefined) return record.versions.find((item) => item.version === version)?.flow;
  return record.versions.at(-1)?.flow || (record.source === "built-in" ? record.versions[0]?.flow : undefined);
}

function resolveFlowDraftOrVersion(flowId: string): FlowDefinition | undefined {
  const record = flowRecords.get(flowId);
  return record?.draft || record?.versions.at(-1)?.flow;
}

function getFlowForRun(run: LocalRunView): FlowDefinition {
  return resolveRunnableFlow(run.flowId) || deepResearchFlow;
}

function serializeFlowRecord(record: LocalFlowRecord, includeDefinition = false) {
  const current = record.draft || record.versions.at(-1)?.flow;
  return {
    id: record.id,
    name: current?.name || record.id,
    description: current?.description || "",
    status: record.status,
    source: record.source,
    version: current?.version ?? 0,
    versions: record.versions.map((item) => ({ version: item.version, publishedAt: item.publishedAt })),
    hasDraft: Boolean(record.draft),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    presets: current?.presets || [],
    steps: current?.steps || [],
    artifacts: current?.artifacts || [],
    definition: includeDefinition ? current : undefined,
    draft: includeDefinition ? record.draft : undefined
  };
}

function normalizeFlowDefinition(input: any): FlowDefinition {
  return {
    id: sanitizeFlowId(input.id),
    name: String(input.name || "Untitled Flow").slice(0, 100),
    version: Number.isInteger(input.version) ? input.version : 0,
    description: typeof input.description === "string" ? input.description.slice(0, 300) : "",
    inputs: Array.isArray(input.inputs) ? input.inputs : [],
    presets: Array.isArray(input.presets) ? input.presets : [],
    steps: Array.isArray(input.steps) ? input.steps : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : []
  } as FlowDefinition;
}

function createBlankFlowDefinition(body: JsonRecord) {
  const id = sanitizeFlowId(typeof body.id === "string" ? body.id : typeof body.name === "string" ? body.name : "custom_flow");
  return {
    id,
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Custom Flow",
    version: 0,
    description: typeof body.description === "string" ? body.description.slice(0, 300) : "User-authored workflow draft.",
    inputs: [
      { id: "topic", type: "string", required: true },
      { id: "audience", type: "string", required: false },
      { id: "freshness_days", type: "number", required: false, default: 365 }
    ],
    presets: [
      { id: "quick", name: "Quick", policy: { max_cost_usd: 1, max_iterations: 2, citation_required: true } },
      { id: "standard", name: "Standard", policy: { max_cost_usd: 3, max_iterations: 4, citation_required: true } },
      { id: "deep", name: "Deep", policy: { max_cost_usd: 8, max_iterations: 6, citation_required: true } }
    ],
    steps: [],
    edges: [],
    artifacts: []
  };
}

function validateDraft(flow: FlowDefinition) {
  return validateFlowDefinition({ ...flow, version: Number.isInteger(flow.version) && flow.version > 0 ? flow.version : 1 });
}

function sanitizeFlowId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function loadFlowStore() {
  const now = new Date().toISOString();
  for (const flow of [deepResearchFlow]) {
    flowRecords.set(flow.id, {
      id: flow.id,
      status: "seed",
      source: "built-in",
      versions: [{ version: flow.version, flow, publishedAt: now }],
      createdAt: now,
      updatedAt: now
    });
  }
  if (!existsSync(flowStorePath)) return;
  try {
    const stored = JSON.parse(readFileSync(flowStorePath, "utf8")) as { flows?: LocalFlowRecord[] };
    for (const record of stored.flows || []) {
      if (!record.id || record.source === "built-in") continue;
      flowRecords.set(record.id, {
        ...record,
        versions: Array.isArray(record.versions) ? record.versions : []
      });
    }
  } catch (error) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = `${flowStorePath}.corrupt-${timestamp}`;
    renameSync(flowStorePath, corruptPath);
    console.warn(`Local flow store was unreadable and has been moved to ${corruptPath}`);
  }
}

function persistFlowStore() {
  mkdirSync(localStateDir, { recursive: true });
  const flows = [...flowRecords.values()].filter((record) => record.source !== "built-in");
  const tempPath = `${flowStorePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ version: 1, flows }, null, 2));
  renameSync(tempPath, flowStorePath);
}

function createLocalRun(body: JsonRecord) {
  return createFlowRun(typeof body.flowId === "string" ? body.flowId : managementConfig.flow.id, body);
}

function createFlowRun(flowId: string, body: JsonRecord) {
  const flow = resolveRunnableFlow(flowId, typeof body.version === "number" ? body.version : undefined);
  if (!flow) return { status: 404, error: "Runnable flow not found" };
  const inputs = readInputs(body);
  const presetId = typeof body.presetId === "string" ? body.presetId : "standard";
  const validation = validateRunRequestForFlow(flow, body);
  if (validation.errors.length > 0) {
    return { status: 400, error: "Invalid run request", details: validation.errors };
  }
  const run = runtime.createRun({ flow, presetId, inputs });
  const currentStepId = run.currentStepIds[0] || flow.steps[0].id;
  const firstStep = [...(runtime as any).stepRuns.values()].find((stepRun: any) => stepRun.runId === run.id && stepRun.stepId === currentStepId);

  if (!firstStep) {
    throw new Error("Expected initial step run to be created");
  }

  const view: LocalRunView = {
    id: run.id,
    flowId: run.flowId,
    presetId: run.presetId,
    status: "queued",
    currentStepId,
    topic: String(inputs.topic),
    audience: String(inputs.audience || "engineering leaders"),
    freshnessDays: Number(inputs.freshness_days || 365),
    createdAt: run.createdAt,
    updatedAt: run.createdAt,
    timeline: flow.steps.map((step) => ({
      stepId: step.id,
      status: step.id === currentStepId ? "pending" : "waiting",
      attempt: 1
    })),
    evidence: [],
    artifacts: [],
    detail: {
      runtime: "local-dev",
      runId: run.id,
      stepRunId: firstStep.id,
      queued: true
    }
  };
  runViews.set(run.id, view);
  persistRunStore();
  scheduleLocalProgress(run.id);

  return {
    run: {
      id: run.id,
      flow_id: run.flowId,
      preset_id: run.presetId,
      status: view.status,
      input_json: JSON.stringify(inputs),
      created_at: run.createdAt,
      current_step_key: currentStepId
    },
    stepRun: {
      id: firstStep.id,
      runId: firstStep.runId,
      stepId: firstStep.stepId,
      status: firstStep.status,
      attempt: firstStep.attempt
    },
    workflow: { id: run.id, status: view.status },
    queued: true
  };
}

function validateRunRequest(body: JsonRecord) {
  const flow = resolveRunnableFlow(typeof body.flowId === "string" ? body.flowId : managementConfig.flow.id);
  return flow ? validateRunRequestForFlow(flow, body) : { errors: ["Runnable flow not found"] };
}

function validateRunRequestForFlow(flow: FlowDefinition, body: JsonRecord) {
  const errors: string[] = [];
  const presetId = typeof body.presetId === "string" ? body.presetId : "standard";
  const inputs = readInputs(body);

  if (!flow.presets.some((preset) => preset.id === presetId)) {
    errors.push(`Unknown presetId: ${presetId}`);
  }

  errors.push(...validateFlowInputs(flow, inputs));

  if (Object.prototype.hasOwnProperty.call(inputs, "freshness_days") && inputs.freshness_days <= 0 || !Number.isFinite(inputs.freshness_days)) {
    errors.push("Input freshness_days must be a positive number");
  }

  return { errors };
}

function createReadinessReport() {
  return createLocalReadinessReport({ paths, loadedDevVars, runCount: runViews.size });
}

function createConfigReport() {
  return {
    config: createPublicManagementConfig(),
    operationFlow: createOperationFlow(),
    editableSurfaces: [
      { id: "run_inputs", label: "執行輸入", editable: true, detail: "主題、讀者、新鮮度、策略可在執行前調整。" },
      { id: "flow_defaults", label: "流程預設", editable: true, detail: "預設策略、讀者、新鮮度可在管理區儲存。" },
      { id: "providers", label: "Provider 啟用狀態", editable: true, detail: "可調整 OpenAI、Anthropic、搜尋與 Reader 的啟用狀態與 credential reference。" },
      { id: "policy", label: "政策", editable: true, detail: "可調整成本上限、迭代上限、citation requirement 與允許 provider。" },
      { id: "skills", label: "技能版本", editable: true, detail: "可啟用/停用 skill、切換 active version，並新增草稿 skill 到管理設定。" },
      { id: "artifact_versions", label: "產物版本", editable: true, detail: "可編輯 artifact、建立版本、查看最近兩版差異，並下載目前版本。" }
    ]
  };
}

function createPublicManagementConfig() {
  return {
    ...managementConfig,
    providerCredentials: undefined,
    providers: managementConfig.providers.map(withCredentialStatus)
  };
}

function createOperationFlow() {
  return {
    nodes: [
      { id: "configure", label: "設定", status: "editable", detail: "編輯流程預設、Provider、Policy 與 Skill 版本。" },
      { id: "run", label: "執行", status: "editable", detail: "填寫 topic、audience、freshness 並開始 run。" },
      { id: "monitor", label: "監控", status: "operable", detail: "查看 timeline、trace、cost、token、provider/tool 使用量，並 retry 或 cancel。" },
      { id: "review", label: "檢視", status: "operable", detail: "檢視 evidence、sources、artifacts。" },
      { id: "export", label: "輸出", status: "operable", detail: "下載 Markdown report、JSON evidence bundle 與目前 artifact 版本。" },
      { id: "improve", label: "改進", status: "operable", detail: "可標註 evidence、重新產生 review summary、編輯 artifact、比較版本，並調整後續 run 的 skill 版本。" }
    ],
    edges: [
      ["configure", "run"],
      ["run", "monitor"],
      ["monitor", "review"],
      ["review", "export"],
      ["review", "improve"],
      ["improve", "configure"]
    ]
  };
}

function defaultManagementConfig(): ManagementConfig {
  return {
    flow: {
      id: "deep_research",
      policyRef: "standard-research",
      defaultPreset: "standard",
      defaultAudience: "工程管理者",
      defaultFreshnessDays: 365
    },
    policy: {
      maxCostUsd: 3,
      maxIterations: 4,
      citationRequired: true,
      allowedProviders: DEFAULT_ALLOWED_PROVIDER_IDS
    },
    policies: [defaultManagedPolicy()],
    improvementProposals: [],
    providerCredentials: {},
    providers: createProviderConfigs(process.env, { localWorkersAiReady: true }),
    skills: builtInSkills()
  };
}

function loadManagementConfig(): ManagementConfig {
  if (!existsSync(configStorePath)) return defaultManagementConfig();
  try {
    const stored = JSON.parse(readFileSync(configStorePath, "utf8")) as Partial<ManagementConfig>;
    return normalizeManagementConfig(stored);
  } catch {
    return defaultManagementConfig();
  }
}

function updateManagementConfig(body: JsonRecord) {
  const next = normalizeManagementConfig({
    ...managementConfig,
    ...(body as Partial<ManagementConfig>),
    providerCredentials: (body as Partial<ManagementConfig>).providerCredentials ?? managementConfig.providerCredentials
  });
  const errors = validateManagementConfig(next);
  if (errors.length === 0) {
    managementConfig = next;
    persistManagementConfig();
  }
  return { errors };
}

function normalizeManagementConfig(input: Partial<ManagementConfig>): ManagementConfig {
  const fallback = defaultManagementConfig();
  const providerById = new Map(fallback.providers.map((provider) => [provider.id, provider]));
  for (const provider of input.providers || []) {
    const normalized = normalizeManagedProvider(provider, providerById.get(provider.id));
    if (!normalized) continue;
    providerById.set(normalized.id, {
      ...(providerById.get(normalized.id) || normalized),
      ...normalized,
      activeModel: normalized.models.includes(normalized.activeModel) ? normalized.activeModel : normalized.models[0]
    });
  }
  const allowedProviderIds = new Set(providerById.keys());
  const skillById = new Map(fallback.skills.map((skill) => [skill.id, skill]));
  for (const skill of input.skills || []) {
    const normalized = normalizeManagedSkill(skill, skillById.get(skill.id));
    if (normalized) skillById.set(normalized.id, normalized);
  }
  return {
    flow: {
      id: "deep_research",
      policyRef: typeof input.flow?.policyRef === "string" ? input.flow.policyRef : fallback.flow.policyRef,
      defaultPreset: typeof input.flow?.defaultPreset === "string" ? input.flow.defaultPreset : fallback.flow.defaultPreset,
      defaultAudience: typeof input.flow?.defaultAudience === "string" ? input.flow.defaultAudience.slice(0, 120) : fallback.flow.defaultAudience,
      defaultFreshnessDays: Number(input.flow?.defaultFreshnessDays || fallback.flow.defaultFreshnessDays)
    },
    policy: {
      maxCostUsd: Number(input.policy?.maxCostUsd ?? fallback.policy.maxCostUsd),
      maxIterations: Number(input.policy?.maxIterations ?? fallback.policy.maxIterations),
      citationRequired: Boolean(input.policy?.citationRequired ?? fallback.policy.citationRequired),
      allowedProviders: Array.isArray(input.policy?.allowedProviders)
        ? input.policy.allowedProviders.filter((id) => allowedProviderIds.has(id))
        : fallback.policy.allowedProviders
    },
    policies: normalizeManagedPolicies(input.policies, fallback.policies, [...providerById.keys()]),
    improvementProposals: normalizeImprovementProposals(input.improvementProposals),
    providerCredentials: normalizeProviderCredentials(input.providerCredentials, fallback.providerCredentials, [...providerById.keys()]),
    providers: [...providerById.values()],
    skills: [...skillById.values()]
  };
}

function normalizeProviderCredentials(
  input: Partial<ManagementConfig>["providerCredentials"],
  fallback: ManagementConfig["providerCredentials"] = {},
  providerIds: string[] = []
) {
  const source = input && typeof input === "object" ? input : fallback || {};
  const byProvider: ManagementConfig["providerCredentials"] = {};
  for (const [rawProviderId, rawCredential] of Object.entries(source)) {
    const providerId = sanitizeProviderId(rawProviderId);
    if (!providerId || !providerIds.includes(providerId) || !rawCredential) continue;
    const credentialRef = typeof rawCredential.credentialRef === "string" ? rawCredential.credentialRef.slice(0, 120) : "";
    const value = typeof rawCredential.value === "string" ? rawCredential.value : "";
    if (!credentialRef || !value) continue;
    byProvider[providerId] = {
      credentialRef,
      value,
      updatedAt: typeof rawCredential.updatedAt === "string" ? rawCredential.updatedAt : new Date().toISOString()
    };
  }
  return byProvider;
}

function defaultManagedPolicy(): ManagedPolicy {
  const now = new Date().toISOString();
  const config = {
    maxCostUsd: 3,
    maxIterations: 4,
    citationRequired: true,
    allowedProviders: DEFAULT_ALLOWED_PROVIDER_IDS
  };
  return {
    id: "standard-research",
    name: "Standard Research",
    status: "published",
    version: 1,
    draft: config,
    versions: [{ version: 1, publishedAt: now, config }]
  };
}

function normalizeManagedPolicies(input: unknown, fallback: ManagedPolicy[], providerIds: string[]) {
  const byId = new Map(fallback.map((policy) => [policy.id, policy]));
  if (Array.isArray(input)) {
    for (const policy of input) {
      const normalized = normalizeManagedPolicy(policy, byId.get(policy?.id), providerIds);
      if (normalized) byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()];
}

function normalizeManagedPolicy(input: any, fallback: ManagedPolicy | undefined, providerIds: string[]): ManagedPolicy | undefined {
  const id = sanitizePolicyId(input?.id || fallback?.id);
  if (!id) return undefined;
  const draftSource = input?.draft || input || fallback?.draft || {};
  const draft = {
    maxCostUsd: Number(draftSource.maxCostUsd ?? fallback?.draft.maxCostUsd ?? 3),
    maxIterations: Number(draftSource.maxIterations ?? fallback?.draft.maxIterations ?? 4),
    citationRequired: Boolean(draftSource.citationRequired ?? fallback?.draft.citationRequired ?? true),
    allowedProviders: Array.isArray(draftSource.allowedProviders)
      ? draftSource.allowedProviders.filter((providerId: string) => providerIds.includes(providerId))
      : fallback?.draft.allowedProviders || DEFAULT_ALLOWED_PROVIDER_IDS
  };
  return {
    id,
    name: typeof input?.name === "string" ? input.name.slice(0, 80) : fallback?.name || id,
    status: ["draft", "published", "archived"].includes(input?.status) ? input.status : fallback?.status || "draft",
    version: Number(input?.version ?? fallback?.version ?? 0),
    draft,
    versions: Array.isArray(input?.versions) ? input.versions : fallback?.versions || []
  };
}

function createManagedPolicy(body: JsonRecord) {
  const policy = normalizeManagedPolicy({ ...body, status: "draft", version: 0 }, undefined, managementConfig.providers.map((provider) => provider.id));
  if (!policy) return { status: 400, error: "Policy id is required" };
  if (managementConfig.policies.some((candidate) => candidate.id === policy.id)) return { status: 409, error: "Policy already exists" };
  managementConfig = normalizeManagementConfig({ ...managementConfig, policies: [...managementConfig.policies, policy] });
  persistManagementConfig();
  return { status: 201, policy };
}

function updateManagedPolicy(policyId: string, body: JsonRecord) {
  const id = sanitizePolicyId(policyId);
  const existing = managementConfig.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const next = normalizeManagedPolicy({ ...existing, ...body, id, status: "draft" }, existing, managementConfig.providers.map((provider) => provider.id));
  if (!next) return { status: 400, error: "Invalid policy request" };
  managementConfig = normalizeManagementConfig({ ...managementConfig, policies: managementConfig.policies.map((policy) => policy.id === id ? next : policy) });
  persistManagementConfig();
  return { status: 200, policy: next };
}

function publishManagedPolicy(policyId: string) {
  const id = sanitizePolicyId(policyId);
  const existing = managementConfig.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const version = existing.version + 1;
  const next = {
    ...existing,
    status: "published" as const,
    version,
    versions: [...existing.versions, { version, publishedAt: new Date().toISOString(), config: existing.draft }]
  };
  managementConfig = normalizeManagementConfig({ ...managementConfig, policies: managementConfig.policies.map((policy) => policy.id === id ? next : policy) });
  persistManagementConfig();
  return { status: 201, policy: next, version };
}

function applyManagedPolicy(policyId: string) {
  const id = sanitizePolicyId(policyId);
  const policy = managementConfig.policies.find((candidate) => candidate.id === id && candidate.status !== "archived");
  if (!policy) return { status: 404, error: "Policy not found" };
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    flow: { ...managementConfig.flow, policyRef: id },
    policy: policy.draft
  });
  persistManagementConfig();
  return { status: 200, policy, config: managementConfig };
}

function archiveManagedPolicy(policyId: string) {
  const id = sanitizePolicyId(policyId);
  const existing = managementConfig.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const next = { ...existing, status: "archived" as const };
  managementConfig = normalizeManagementConfig({ ...managementConfig, policies: managementConfig.policies.map((policy) => policy.id === id ? next : policy) });
  persistManagementConfig();
  return { status: 200, policy: next };
}

function sanitizePolicyId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function normalizeImprovementProposals(input: unknown): ManagedImprovementProposal[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((proposal) => normalizeImprovementProposal(proposal))
    .filter((proposal): proposal is ManagedImprovementProposal => Boolean(proposal));
}

function normalizeImprovementProposal(input: any): ManagedImprovementProposal | undefined {
  const id = typeof input?.id === "string" ? input.id.slice(0, 80) : "";
  if (!id) return undefined;
  const type = ["eval-case", "skill", "policy", "memory"].includes(input?.type) ? input.type : "eval-case";
  const evalCaseId = typeof input?.evalCase?.id === "string" ? input.evalCase.id : `eval_case_${id}`;
  return {
    id,
    type,
    status: "review",
    sourceRunId: typeof input?.sourceRunId === "string" ? input.sourceRunId : undefined,
    summary: typeof input?.summary === "string" ? input.summary.slice(0, 300) : "Review failed or corrected run as a regression case.",
    evalCase: {
      id: evalCaseId.slice(0, 100),
      sourceRunId: typeof input?.evalCase?.sourceRunId === "string" ? input.evalCase.sourceRunId : typeof input?.sourceRunId === "string" ? input.sourceRunId : undefined,
      input: isRecord(input?.evalCase?.input) ? input.evalCase.input : {},
      expected: isRecord(input?.evalCase?.expected) ? input.evalCase.expected : {},
      status: "draft"
    },
    createdAt: typeof input?.createdAt === "string" ? input.createdAt : new Date().toISOString()
  };
}

function createImprovementProposal(body: JsonRecord) {
  const sourceRunId = typeof body.sourceRunId === "string" ? body.sourceRunId : undefined;
  const sourceRun = sourceRunId ? runViews.get(sourceRunId) : undefined;
  const proposal = normalizeImprovementProposal({
    id: `improvement_${Date.now().toString(36)}`,
    type: body.type || "eval-case",
    sourceRunId,
    summary: typeof body.summary === "string" ? body.summary : sourceRun ? `Create eval case from ${sourceRun.topic}` : "Create eval case from operator feedback.",
    evalCase: {
      id: `eval_case_${Date.now().toString(36)}`,
      sourceRunId,
      input: sourceRun ? { topic: sourceRun.topic, audience: sourceRun.audience, presetId: sourceRun.presetId } : isRecord(body.input) ? body.input : {},
      expected: isRecord(body.expected) ? body.expected : { status: "review-required" }
    },
    createdAt: new Date().toISOString()
  })!;
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    improvementProposals: [proposal, ...managementConfig.improvementProposals].slice(0, 50)
  });
  persistManagementConfig();
  return { status: 201, proposal };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeManagedProvider(input: any, fallback?: ManagementConfig["providers"][number]) {
  const id = sanitizeProviderId(input?.id || fallback?.id);
  if (!id) return undefined;
  const models = Array.isArray(input?.models) && input.models.length > 0
    ? input.models.map(String).filter(Boolean).slice(0, 200)
    : fallback?.models || [typeof input?.activeModel === "string" ? input.activeModel : "default"];
  const activeModel = typeof input?.activeModel === "string" ? input.activeModel.slice(0, 160) : fallback?.activeModel || models[0];
  return {
    id,
    name: typeof input?.name === "string" ? input.name.slice(0, 80) : fallback?.name || id,
    enabled: Boolean(input?.enabled ?? fallback?.enabled ?? false),
    credentialRef: typeof input?.credentialRef === "string" ? input.credentialRef.slice(0, 120) : fallback?.credentialRef || `${id.toUpperCase()}_API_KEY`,
    models: models.includes(activeModel) ? models : [activeModel, ...models],
    activeModel
  };
}

function createManagedProvider(body: JsonRecord) {
  const provider = normalizeManagedProvider({ ...body, enabled: body.enabled ?? false });
  if (!provider) return { status: 400, error: "Provider id is required" };
  if (managementConfig.providers.some((candidate) => candidate.id === provider.id)) {
    return { status: 409, error: "Provider already exists" };
  }
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    providers: [...managementConfig.providers, provider]
  });
  persistManagementConfig();
  return { status: 201, provider };
}

function updateManagedProvider(providerId: string, body: JsonRecord) {
  const id = sanitizeProviderId(providerId);
  const existing = managementConfig.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const next = normalizeManagedProvider({ ...existing, ...body, id }, existing);
  if (!next) return { status: 400, error: "Invalid provider request" };
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    providers: managementConfig.providers.map((provider) => provider.id === id ? next : provider)
  });
  persistManagementConfig();
  return { status: 200, provider: next };
}

async function syncProviderModels(providerId: string) {
  const id = sanitizeProviderId(providerId);
  const existing = managementConfig.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const catalogEntry = getProviderCatalogEntry(id);
  if (!catalogEntry) return { status: 404, error: "No sync catalog is available for this provider" };

  const before = new Set(existing.models);
  let liveModels: string[] = [];
  try {
    liveModels = await fetchProviderModelIds(
      id,
      (secretName: string, provider: string) => process.env[secretName] || providerSecret(provider || id) || "",
      {
        cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
        ollamaBaseUrl: process.env.OLLAMA_API_BASE || process.env.OLLAMA_HOST || process.env.OLLAMA_URL
      }
    );
  } catch (error) {
    return {
      status: 502,
      error: error instanceof Error ? error.message : "Provider model sync failed",
      provider: id
    };
  }
  const models = Array.from(new Set([...existing.models, ...liveModels, ...catalogEntry.models])).filter(Boolean).sort();
  const provider = normalizeManagedProvider({
    ...existing,
    name: existing.name || catalogEntry.name,
    credentialRef: existing.credentialRef || catalogEntry.credentialRefs.join(" or "),
    models,
    activeModel: models.includes(existing.activeModel) ? existing.activeModel : catalogEntry.activeModel
  }, existing)!;
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    providers: managementConfig.providers.map((candidate) => candidate.id === id ? provider : candidate)
  });
  persistManagementConfig();
  return {
    status: 200,
    provider,
    added: models.filter((model) => !before.has(model)).length,
    existing: models.filter((model) => before.has(model)).length,
    total: models.length,
    source: liveModels.length > 0 ? "provider-api" : "catalog"
  };
}

function updateProviderCredential(providerId: string, body: JsonRecord) {
  const id = sanitizeProviderId(providerId);
  const existing = managementConfig.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const refs = extractCredentialRefs(existing);
  const credentialRef = typeof body.credentialRef === "string" && body.credentialRef.trim()
    ? body.credentialRef.trim().slice(0, 120)
    : refs[0] || existing.credentialRef;
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!credentialRef) return { status: 400, error: "credentialRef is required" };
  if (!value) return { status: 400, error: "API key value is required" };
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    providerCredentials: {
      ...managementConfig.providerCredentials,
      [id]: { credentialRef, value, updatedAt: new Date().toISOString() }
    }
  });
  persistManagementConfig();
  return {
    status: 200,
    provider: withCredentialStatus(managementConfig.providers.find((provider) => provider.id === id)!),
    credential: { providerId: id, credentialRef, configured: true }
  };
}

function deleteProviderCredential(providerId: string) {
  const id = sanitizeProviderId(providerId);
  const existing = managementConfig.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const providerCredentials = { ...managementConfig.providerCredentials };
  delete providerCredentials[id];
  managementConfig = normalizeManagementConfig({ ...managementConfig, providerCredentials });
  persistManagementConfig();
  return {
    status: 200,
    provider: withCredentialStatus(managementConfig.providers.find((provider) => provider.id === id)!),
    credential: { providerId: id, configured: false }
  };
}

function extractCredentialRefs(provider: ManagementConfig["providers"][number]) {
  return String(provider.credentialRef || "")
    .split(/\s+or\s+| 或 |,\s*/)
    .map((item) => item.trim())
    .filter((item) => /^[A-Z0-9_]+$/.test(item));
}

function providerCredentialSource(provider: ManagementConfig["providers"][number]) {
  if (provider.id === "workers_ai") return "binding";
  if (managementConfig.providerCredentials?.[provider.id]?.value) return "config";
  return extractCredentialRefs(provider).some((key) => Boolean(process.env[key])) ? "env" : "";
}

function providerSecret(providerId: string) {
  const stored = managementConfig.providerCredentials?.[providerId]?.value;
  if (stored) return stored;
  const keys = {
    openai: ["OPENAI_API_KEY"],
    groq: ["GROQ_API_KEY"],
    openrouter: ["OPENROUTER_API_KEY"],
    nvidia: ["NVIDIA_API_KEY"],
    cerebras: ["CEREBRAS_API_KEY"],
    ollama_cloud: ["OLLAMA_CLOUD_API_KEY", "OLLAMA_API_KEY"],
    ollama: ["OLLAMA_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    workers_ai: ["CLOUDFLARE_API_TOKEN"],
    cloudflare: ["CLOUDFLARE_API_TOKEN"]
  }[providerId] || [];
  return keys.map((key) => process.env[key]).find(Boolean) || "";
}

function withCredentialStatus(provider: ManagementConfig["providers"][number]) {
  const source = providerCredentialSource(provider);
  return {
    ...provider,
    credentialConfigured: Boolean(source),
    credentialSource: source || "missing"
  };
}

function sanitizeProviderId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function validateManagementConfig(config: ManagementConfig) {
  const errors: string[] = [];
  if (!deepResearchFlow.presets.some((preset) => preset.id === config.flow.defaultPreset)) {
    errors.push(`Unknown defaultPreset: ${config.flow.defaultPreset}`);
  }
  if (!config.flow.defaultAudience.trim()) errors.push("defaultAudience is required");
  if (!Number.isFinite(config.flow.defaultFreshnessDays) || config.flow.defaultFreshnessDays < 1) {
    errors.push("defaultFreshnessDays must be a positive number");
  }
  if (!Number.isFinite(config.policy.maxCostUsd) || config.policy.maxCostUsd <= 0) {
    errors.push("maxCostUsd must be positive");
  }
  if (!Number.isFinite(config.policy.maxIterations) || config.policy.maxIterations < 1) {
    errors.push("maxIterations must be positive");
  }
  for (const skill of config.skills) {
    if (!skill.availableVersions.includes(skill.activeVersion)) {
      errors.push(`activeVersion ${skill.activeVersion} is not available for ${skill.id}`);
    }
  }
  return errors;
}

function builtInSkills(): ManagedSkill[] {
  return [
    {
      id: "research-planner",
      name: "Research Planner",
      version: "1.0.0",
      description: "Plans research subquestions, source strategy, and stopping conditions for Deep Research.",
      permissions: ["provider:llm"],
      evals: ["trigger", "output-schema"]
    },
    {
      id: "source-ranker",
      name: "Source Ranker",
      version: "1.0.0",
      description: "Ranks candidate sources by relevance, freshness, authority, and coverage.",
      permissions: ["provider:llm"],
      evals: ["output-schema"]
    },
    {
      id: "citation-extractor",
      name: "Citation Extractor",
      version: "1.0.0",
      description: "Extracts claims, citations, excerpts, source mappings, conflicts, and confidence from read sources.",
      permissions: ["provider:llm", "reader:read"],
      evals: ["output-schema", "citation-quality"]
    },
    {
      id: "report-synthesizer",
      name: "Report Synthesizer",
      version: "1.0.0",
      description: "Synthesizes evidence-backed findings into a Markdown report and artifact-ready evidence bundle.",
      permissions: ["provider:llm"],
      evals: ["output-schema", "artifact-format"]
    }
  ].map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: true,
    activeVersion: skill.version,
    availableVersions: [skill.version],
    permissions: skill.permissions,
    evals: skill.evals,
    source: "built-in" as const
  }));
}

function normalizeManagedSkill(input: any, fallback?: ManagedSkill): ManagedSkill | undefined {
  const id = sanitizeSkillId(input?.id || fallback?.id);
  if (!id) return undefined;
  const versions = Array.isArray(input?.availableVersions)
    ? input.availableVersions.map((version: unknown) => String(version)).filter(Boolean).slice(0, 8)
    : fallback?.availableVersions || ["0.1.0"];
  const activeVersion = typeof input?.activeVersion === "string" && versions.includes(input.activeVersion)
    ? input.activeVersion
    : fallback?.activeVersion || versions[0];
  return {
    id,
    name: typeof input?.name === "string" ? input.name.slice(0, 80) : fallback?.name || id,
    description: typeof input?.description === "string" ? input.description.slice(0, 300) : fallback?.description || "",
    enabled: Boolean(input?.enabled ?? fallback?.enabled ?? false),
    activeVersion,
    availableVersions: versions.includes(activeVersion) ? versions : [activeVersion, ...versions],
    permissions: Array.isArray(input?.permissions) ? input.permissions.map(String).slice(0, 12) : fallback?.permissions || [],
    evals: Array.isArray(input?.evals) ? input.evals.map(String).slice(0, 12) : fallback?.evals || [],
    source: input?.source === "draft" || fallback?.source === "draft" ? "draft" : "built-in"
  };
}

function createManagedSkill(body: JsonRecord) {
  const id = sanitizeSkillId(body.id);
  if (!id) return { status: 400, error: "Skill id is required" };
  if (managementConfig.skills.some((skill) => skill.id === id)) {
    return { status: 409, error: "Skill already exists" };
  }
  const version = typeof body.version === "string" ? body.version.slice(0, 32) : "0.1.0";
  const skill = normalizeManagedSkill({
    id,
    name: body.name,
    description: body.description,
    enabled: false,
    activeVersion: version,
    availableVersions: [version],
    permissions: Array.isArray(body.permissions) ? body.permissions : [],
    evals: Array.isArray(body.evals) ? body.evals : [],
    source: "draft"
  });
  if (!skill) return { status: 400, error: "Invalid skill request" };
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    skills: [...managementConfig.skills, skill]
  });
  persistManagementConfig();
  return { status: 201, skill };
}

function updateManagedSkill(skillId: string, body: JsonRecord) {
  const id = sanitizeSkillId(skillId);
  const existing = managementConfig.skills.find((skill) => skill.id === id);
  if (!existing) return { status: 404, error: "Skill not found" };
  const versions = typeof body.activeVersion === "string" && !existing.availableVersions.includes(body.activeVersion)
    ? [...existing.availableVersions, body.activeVersion]
    : existing.availableVersions;
  const next = normalizeManagedSkill({
    ...existing,
    enabled: body.enabled ?? existing.enabled,
    activeVersion: body.activeVersion || existing.activeVersion,
    availableVersions: versions
  }, existing);
  if (!next) return { status: 400, error: "Invalid skill request" };
  managementConfig = normalizeManagementConfig({
    ...managementConfig,
    skills: managementConfig.skills.map((skill) => skill.id === id ? next : skill)
  });
  persistManagementConfig();
  return { status: 200, skill: next };
}

function runManagedSkillEval(skillId: string) {
  const id = sanitizeSkillId(skillId);
  const skill = managementConfig.skills.find((candidate) => candidate.id === id);
  if (!skill) return { status: 404, error: "Skill not found" };
  const passed = skill.enabled && skill.availableVersions.includes(skill.activeVersion);
  return {
    status: 200,
    eval: {
      id: `skill_eval_${id}_${Date.now().toString(36)}`,
      skillId: id,
      version: skill.activeVersion,
      passed,
      checks: skill.evals.map((name) => ({ name, status: passed ? "passed" : "blocked" })),
      createdAt: new Date().toISOString()
    }
  };
}

function createSkillBindings() {
  return deepResearchFlow.steps
    .filter((step) => step.skill)
    .map((step) => ({
      stepId: step.id,
      defaultBinding: step.skill,
      activeBinding: skillBindingForStep(step.id)
    }));
}

function skillBindingForStep(stepId: string, flow: FlowDefinition = deepResearchFlow) {
  const defaultBinding = flow.steps.find((step) => step.id === stepId)?.skill;
  if (!defaultBinding) return null;
  const skillId = defaultBinding.split("@")[0];
  const skill = managementConfig.skills.find((candidate) => candidate.id === skillId);
  if (!skill || !skill.enabled) return defaultBinding;
  return `${skill.id}@${skill.activeVersion}`;
}

function sanitizeSkillId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

function persistManagementConfig() {
  mkdirSync(localStateDir, { recursive: true });
  const tempPath = `${configStorePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(managementConfig, null, 2));
  renameSync(tempPath, configStorePath);
}

function testProvider(id: string) {
  const provider = managementConfig.providers.find((candidate) => candidate.id === id);
  if (!provider) return { status: 404, error: "Provider not found" };
  const allowed = managementConfig.policy.allowedProviders.includes(provider.id);
  const credentialSource = providerCredentialSource(provider);
  const ready = Boolean(provider.enabled && allowed && credentialSource);
  return {
    status: ready ? 200 : 412,
    id: provider.id,
    name: provider.name,
    ready,
    enabled: provider.enabled,
    allowed,
    activeModel: provider.activeModel,
    credentialRef: provider.credentialRef,
    credentialConfigured: Boolean(credentialSource),
    credentialSource: credentialSource || "missing",
    detail: ready
      ? `${provider.name} is ready with ${provider.activeModel}.`
      : `${provider.name} needs enabled=true, Policy allowed=true, and an API key in config or env.`
  };
}

function testProviderModel(id: string, body: JsonRecord) {
  const provider = managementConfig.providers.find((candidate) => candidate.id === sanitizeProviderId(id));
  if (!provider) return { status: 404, error: "Provider not found" };
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : provider.activeModel;
  if (!model) return { status: 400, error: "Model is required" };
  const base = testProvider(provider.id);
  if (!base.ready) return { ...base, status: 412, model, ok: false, error: base.detail };
  const prompt = typeof body.prompt === "string" && body.prompt.trim()
    ? body.prompt.trim().slice(0, 1000)
    : "Reply in one short sentence confirming this model connection works.";
  return {
    status: 200,
    ok: true,
    provider: provider.id,
    model,
    durationMs: 1,
    content: `Local dev model test accepted for ${provider.name}/${model}. Prompt: ${prompt.slice(0, 120)}`
  };
}

function scheduleLocalProgress(runId: string) {
  clearRunTimers(runId);
  const existing = runViews.get(runId);
  const flow = existing ? getFlowForRun(existing) : deepResearchFlow;
  const stepIds = flow.steps.map((step) => step.id);
  const timers: Array<NodeJS.Timeout> = [];

  stepIds.forEach((stepId, index) => {
    const timer = setTimeout(() => {
      const view = runViews.get(runId);
      if (!view || ["failed", "canceled", "complete"].includes(view.status)) return;
      view.status = "running";
      view.currentStepId = stepId;
      view.updatedAt = new Date().toISOString();
      view.timeline = view.timeline.map((item, itemIndex) => ({
        ...item,
        status: itemIndex < index ? "succeeded" : itemIndex === index ? "running" : "waiting"
      }));
      view.detail = createStepDetail(view, stepId);
      persistRunStore();
    }, 300 + index * 350);
    timers.push(timer);
  });

  const completeTimer = setTimeout(() => {
    const view = runViews.get(runId);
    if (!view || ["failed", "canceled"].includes(view.status)) return;
    view.status = "complete";
    view.currentStepId = "export";
    view.updatedAt = new Date().toISOString();
    view.timeline = view.timeline.map((item) => ({ ...item, status: "succeeded" }));
    view.evidence = createEvidence(view);
    view.artifacts = createArtifacts(view);
    view.detail = {
      runtime: "local-dev",
      runId: view.id,
      status: "complete",
      artifactCount: view.artifacts.length,
      evidenceCount: view.evidence.length
    };
    attributeLocalRunUsage(view);
    persistRunStore();
  }, 300 + stepIds.length * 350);
  timers.push(completeTimer);
  runTimers.set(runId, timers);
}

function createStepDetail(run: LocalRunView, stepId: string): JsonRecord {
  const flow = getFlowForRun(run);
  const arxiv = isArxivRun(run);
  return {
    runtime: "local-dev",
    runId: run.id,
    step: stepId,
    providerCalls: ["search", "read_sources", "search_arxiv", "read_papers"].includes(stepId) ? 1 : 0,
    skillInvocation: skillBindingForStep(stepId, flow),
    functionInfo: functionInfoForStep(stepId, arxiv),
    guardResults: "passed",
    costUsd: Number((0.01 + run.timeline.filter((item) => item.status === "succeeded").length * 0.02).toFixed(2)),
    latencyMs: 250,
    tokens: 300 + run.timeline.filter((item) => item.status === "succeeded").length * 120
  };
}

function createObservabilityReport(run: LocalRunView) {
  const succeededCount = run.timeline.filter((item) => item.status === "succeeded").length;
  const providerCalls = run.timeline
    .filter((item) => ["search", "read_sources", "synthesize", "verify", "search_arxiv", "read_papers", "layered_summary", "verify_sources"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `provider_${index + 1}`,
      provider: ["search", "read_sources", "search_arxiv", "read_papers"].includes(item.stepId) ? "Search/Reader" : "LLM",
      stepId: item.stepId,
      status: item.status === "running" ? "running" : "succeeded",
      costUsd: Number((0.01 + index * 0.015).toFixed(3)),
      tokens: 220 + index * 90,
      latencyMs: 180 + index * 70,
      retryCount: Math.max(0, item.attempt - 1)
    }));
  const toolInvocations = run.timeline
    .filter((item) => ["search", "read_sources", "extract_evidence", "search_arxiv", "read_papers", "extract_contributions"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `tool_${index + 1}`,
      tool: ["search", "search_arxiv"].includes(item.stepId) ? "search.arxiv" : ["read_sources", "read_papers"].includes(item.stepId) ? "reader.fetch" : "citation.extract",
      stepId: item.stepId,
      status: item.status === "running" ? "running" : "succeeded",
      durationMs: 120 + index * 60,
      costUsd: Number((0.002 + index * 0.001).toFixed(3))
    }));
  const totalCostUsd = [...providerCalls, ...toolInvocations].reduce((total, item) => total + item.costUsd, 0);
  return {
    runId: run.id,
    runtime: "local-dev",
    metrics: {
      totalCostUsd: Number(totalCostUsd.toFixed(3)),
      totalTokens: providerCalls.reduce((total, item) => total + item.tokens, 0),
      totalLatencyMs: providerCalls.reduce((total, item) => total + item.latencyMs, 0) + toolInvocations.reduce((total, item) => total + item.durationMs, 0),
      providerCallCount: providerCalls.length,
      toolInvocationCount: toolInvocations.length,
      retryCount: run.timeline.reduce((total, item) => total + Math.max(0, item.attempt - 1), 0),
      completedStepCount: succeededCount
    },
    providerCalls,
    toolInvocations,
    trace: run.timeline.map((item, index) => ({
      id: `span_${index + 1}`,
      stepId: item.stepId,
      status: item.status,
      durationMs: item.status === "waiting" ? 0 : 180 + index * 35,
      attempt: item.attempt
    }))
  };
}

function createEvidence(run: LocalRunView): LocalRunView["evidence"] {
  const sources = selectLocalSources(run);
  return sources.flatMap((source, sourceIndex) => {
    const selectedClaims = source.claims.slice(0, sourceIndex === 0 ? 2 : 1);
    return selectedClaims.map((claim, claimIndex) => ({
      claim: `${claim} Applied to "${run.topic}" for ${run.audience}.`,
      source: source.id,
      sourceTitle: source.title,
      sourceUrl: source.url,
      alphaXivUrl: source.alphaXivUrl,
      arxivId: source.arxivId,
      excerpt: source.excerpt,
      confidence: claimIndex === 0 ? "high" : "medium",
      conflicts: "none"
    }));
  });
}

function createArtifacts(run: LocalRunView): LocalRunView["artifacts"] {
  const arxiv = isArxivRun(run);
  return [
    {
      id: "markdown_report",
      name: arxiv ? "arXiv Paper Reading Report" : "Deep Research Report",
      type: "Markdown",
      version: 1,
      content: arxiv ? createArxivMarkdownReport(run) : [
        `# ${run.topic}`,
        "",
        `Audience: ${run.audience}`,
        `Freshness window: ${run.freshnessDays} days`,
        "",
        `Local development run completed with ${run.evidence.length} evidence items from ${new Set(run.evidence.map((item) => item.source)).size} local fixture sources.`,
        "",
        "## Findings",
        "",
        ...run.evidence.map((item, index) => `${index + 1}. ${item.claim} [${item.source}]`),
        "",
        "## Sources",
        "",
        ...sourceSummaries(run).map((source) => `- ${source.title}: ${source.url}`)
      ].join("\n"),
      downloadUrl: `/api/runs/${run.id}/artifacts/markdown_report`
    },
    {
      id: "evidence_bundle",
      name: "Evidence Bundle",
      type: "JSON",
      version: 1,
      content: {
        runId: run.id,
        topic: run.topic,
        audience: run.audience,
        freshnessDays: run.freshnessDays,
        flowId: run.flowId,
        sources: sourceSummaries(run),
        evidence: run.evidence,
        claims: run.evidence.map((item, index) => ({
          id: `claim_${index + 1}`,
          text: item.claim,
          citation: item.source,
          arxivId: (item as any).arxivId,
          alphaXivUrl: (item as any).alphaXivUrl,
          confidence: item.confidence
        })),
        functionMap: run.timeline.map((item) => ({
          stepId: item.stepId,
          status: item.status,
          info: functionInfoForStep(item.stepId, arxiv)
        }))
      },
      downloadUrl: `/api/runs/${run.id}/artifacts/evidence_bundle`
    }
  ].map((artifact) => withInitialArtifactVersion(artifact));
}

function createArxivMarkdownReport(run: LocalRunView) {
  const sources = sourceSummaries(run);
  return [
    `# ${run.topic}`,
    "",
    `Audience: ${run.audience}`,
    `Freshness window: ${run.freshnessDays} days`,
    "",
    `This arXiv paper reading run selected ${sources.length} papers and produced ${run.evidence.length} cited notes. Each paper keeps both the arXiv source and alphaXiv discussion link.`,
    "",
    "## Layer 1: Executive Takeaways",
    "",
    ...run.evidence.slice(0, 3).map((item, index) => `${index + 1}. ${item.claim} [${item.source}]`),
    "",
    "## Layer 2: Paper-By-Paper Reading Notes",
    "",
    ...sources.flatMap((source, index) => [
      `### ${index + 1}. ${source.title}`,
      "",
      `- arXiv: ${source.url}`,
      `- alphaXiv: ${source.alphaXivUrl || "not available"}`,
      `- arXiv ID: ${source.arxivId || "unknown"}`,
      `- Evidence items: ${source.evidenceCount}`,
      ""
    ]),
    "## Layer 3: Cross-Paper Synthesis",
    "",
    "The selected papers separate retrieval design, evidence grounding, and report verification into inspectable units. The flow keeps citation metadata next to each claim so operators can audit the final report from the UI.",
    "",
    "## Sources",
    "",
    ...sources.map((source) => `- ${source.title}: ${source.url} | alphaXiv: ${source.alphaXivUrl || "not available"}`)
  ].join("\n");
}

function isArxivRun(run: LocalRunView) {
  const flow = getFlowForRun(run);
  const stepIds = new Set(flow.steps.map((step) => step.id));
  return stepIds.has("search_arxiv") && stepIds.has("read_papers") && stepIds.has("layered_summary");
}

function functionInfoForStep(stepId: string, arxiv: boolean) {
  const common: Record<string, string> = {
    clarify: "Clarifies the research objective before search.",
    build_brief: "Turns the objective into an executable research brief.",
    plan: "Plans subquestions and source strategy.",
    search: "Finds candidate sources for the topic.",
    rank_sources: "Ranks retrieved sources for relevance and coverage.",
    read_sources: "Reads selected source pages and extracts usable text.",
    extract_evidence: "Turns source excerpts into claim-level evidence.",
    synthesize: "Builds the cited report from evidence.",
    verify: "Checks citation coverage and output format.",
    export: "Writes Markdown and JSON artifacts."
  };
  const arxivMap: Record<string, string> = {
    scope_topic: "Normalizes the requested topic into arXiv search intent and reading criteria.",
    search_arxiv: "Finds candidate arXiv papers matching the topic.",
    select_papers: "Selects the papers with the best topical coverage and source metadata.",
    read_papers: "Reads paper abstracts and metadata while preserving arXiv and alphaXiv links.",
    extract_contributions: "Extracts contribution, method, limitation, and follow-up evidence from each paper.",
    layered_summary: "Creates executive, paper-level, and detail-level summaries.",
    cross_paper_synthesis: "Compares papers across methods, assumptions, and practical implications.",
    verify_sources: "Verifies that every claim has source and alphaXiv metadata.",
    export: "Writes the Markdown report and JSON evidence bundle."
  };
  return arxiv ? arxivMap[stepId] || common[stepId] || "Executes this flow step." : common[stepId] || "Executes this flow step.";
}

function updateEvidenceReview(runId: string, evidenceIndex: number, body: JsonRecord) {
  const run = runViews.get(runId);
  if (!run) return { status: 404, error: "Run not found" };
  const evidence = run.evidence[evidenceIndex];
  if (!evidence) return { status: 404, error: "Evidence not found" };
  const status = typeof body.status === "string" ? body.status : "watch";
  if (!["accepted", "rejected", "watch"].includes(status)) {
    return { status: 400, error: "Invalid evidence review status" };
  }
  evidence.review = {
    status: status as EvidenceReview["status"],
    note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
    updatedAt: new Date().toISOString()
  };
  run.updatedAt = evidence.review.updatedAt;
  run.detail = {
    ...run.detail,
    lastEvidenceReview: {
      index: evidenceIndex,
      status: evidence.review.status,
      updatedAt: evidence.review.updatedAt
    }
  };
  persistRunStore();
  return { status: 200, run };
}

function regenerateArtifacts(runId: string) {
  const run = runViews.get(runId);
  if (!run) return { status: 404, error: "Run not found" };
  const reviewed = run.evidence.filter((item) => item.review);
  const accepted = run.evidence.filter((item) => item.review?.status === "accepted");
  const rejected = run.evidence.filter((item) => item.review?.status === "rejected");
  const existing = run.artifacts.find((artifact) => artifact.id === "review_summary");
  const version = existing ? existing.version + 1 : 1;
  const reviewSummary = {
    id: "review_summary",
    name: "Review Summary",
    type: "JSON",
    version,
    content: {
      runId: run.id,
      topic: run.topic,
      reviewedCount: reviewed.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      reviews: reviewed.map((item, index) => ({
        index,
        claim: item.claim,
        source: item.source,
        review: item.review
      }))
    },
    downloadUrl: `/api/runs/${run.id}/artifacts/review_summary`
  };
  run.artifacts = [...run.artifacts.filter((artifact) => artifact.id !== "review_summary"), withInitialArtifactVersion(reviewSummary)];
  run.updatedAt = new Date().toISOString();
  run.detail = {
    ...run.detail,
    regeneratedAt: run.updatedAt,
    reviewSummaryVersion: version
  };
  persistRunStore();
  return { status: 200, run };
}

function updateArtifactVersion(runId: string, artifactId: string, body: JsonRecord) {
  const run = runViews.get(runId);
  if (!run) return { status: 404, error: "Run not found" };
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return { status: 404, error: "Artifact not found" };
  if (!Object.prototype.hasOwnProperty.call(body, "content")) return { status: 400, error: "Artifact content is required" };

  ensureArtifactVersions(artifact);
  const nextVersion = Math.max(artifact.version || 1, ...(artifact.versions || []).map((version) => version.version)) + 1;
  const updatedAt = new Date().toISOString();
  artifact.version = nextVersion;
  artifact.content = body.content;
  artifact.versions = [
    ...(artifact.versions || []),
    {
      version: nextVersion,
      updatedAt,
      note: typeof body.note === "string" ? body.note.slice(0, 300) : "Manual edit",
      content: body.content
    }
  ];
  artifact.downloadUrl = `/api/runs/${run.id}/artifacts/${artifact.id}`;
  run.updatedAt = updatedAt;
  run.detail = {
    ...run.detail,
    lastArtifactEdit: {
      artifactId,
      version: nextVersion,
      updatedAt
    }
  };
  persistRunStore();
  return { status: 200, run, artifact };
}

function listArtifactVersions(runId: string, artifactId: string) {
  const run = runViews.get(runId);
  if (!run) return { status: 404, error: "Run not found" };
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return { status: 404, error: "Artifact not found" };
  ensureArtifactVersions(artifact);
  return {
    status: 200,
    versions: (artifact.versions || []).map((version) => ({
      version: version.version,
      updatedAt: version.updatedAt,
      note: version.note,
      preview: stringifyArtifactContent(version.content).slice(0, 240)
    }))
  };
}

function diffArtifactVersions(runId: string, artifactId: string) {
  const run = runViews.get(runId);
  if (!run) return { status: 404, error: "Run not found" };
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return { status: 404, error: "Artifact not found" };
  ensureArtifactVersions(artifact);
  const versions = artifact.versions || [];
  if (versions.length < 2) return { status: 400, error: "At least two artifact versions are required" };
  const before = versions.at(-2);
  const after = versions.at(-1);
  return {
    status: 200,
    diff: {
      artifactId,
      fromVersion: before?.version,
      toVersion: after?.version,
      lines: createLineDiff(stringifyArtifactContent(before?.content), stringifyArtifactContent(after?.content))
    }
  };
}

function withInitialArtifactVersion<T extends LocalArtifact>(artifact: T): T {
  const updatedAt = new Date().toISOString();
  artifact.versions = artifact.versions || [{
    version: artifact.version || 1,
    updatedAt,
    note: "Initial generated artifact",
    content: artifact.content
  }];
  return artifact;
}

function ensureArtifactVersions(artifact: LocalArtifact) {
  if (!Array.isArray(artifact.versions) || artifact.versions.length === 0) {
    artifact.versions = [{
      version: artifact.version || 1,
      updatedAt: new Date().toISOString(),
      note: "Initial generated artifact",
      content: artifact.content
    }];
  }
}

function stringifyArtifactContent(content: unknown) {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

function createLineDiff(before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  const lines: Array<{ line: number; type: "same" | "changed" | "added" | "removed"; before?: string; after?: string }> = [];
  for (let index = 0; index < lineCount; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next) {
      lines.push({ line: index + 1, type: "same", before: previous, after: next });
    } else if (previous === undefined) {
      lines.push({ line: index + 1, type: "added", after: next });
    } else if (next === undefined) {
      lines.push({ line: index + 1, type: "removed", before: previous });
    } else {
      lines.push({ line: index + 1, type: "changed", before: previous, after: next });
    }
  }
  return lines.filter((line) => line.type !== "same").slice(0, 200);
}

function cancelLocalRun(runId: string) {
  const run = runViews.get(runId);
  if (!run) return undefined;
  clearRunTimers(runId);
  run.status = "canceled";
  run.updatedAt = new Date().toISOString();
  run.timeline = run.timeline.map((item) => ({
    ...item,
    status: item.status === "succeeded" ? item.status : "canceled"
  }));
  run.detail = {
    runtime: "local-dev",
    runId,
    status: "canceled",
    currentStepId: run.currentStepId
  };
  persistRunStore();
  return run;
}

function deleteLocalRun(runId: string) {
  if (!runViews.has(runId)) return false;
  clearRunTimers(runId);
  runViews.delete(runId);
  persistRunStore();
  return true;
}

function clearLocalRuns() {
  for (const runId of runViews.keys()) {
    clearRunTimers(runId);
  }
  runViews.clear();
  persistRunStore();
}

function retryLocalRunStep(runId: string, stepId?: string) {
  const run = runViews.get(runId);
  if (!run) return undefined;
  clearRunTimers(runId);
  const flow = getFlowForRun(run);
  const stepIds = flow.steps.map((step) => step.id);
  const retryStepId = stepId && stepIds.includes(stepId) ? stepId : run.currentStepId;
  const retryIndex = Math.max(0, stepIds.indexOf(retryStepId));

  run.status = "queued";
  run.currentStepId = retryStepId;
  run.updatedAt = new Date().toISOString();
  run.evidence = [];
  run.artifacts = [];
  run.timeline = run.timeline.map((item, index) => ({
    ...item,
    attempt: index >= retryIndex ? item.attempt + 1 : item.attempt,
    status: index < retryIndex ? "succeeded" : index === retryIndex ? "pending" : "waiting"
  }));
  run.detail = {
    runtime: "local-dev",
    runId,
    status: "retry_queued",
    retryStepId
  };
  persistRunStore();
  scheduleLocalProgressFrom(runId, retryIndex);
  return run;
}

function selectLocalSources(run: LocalRunView) {
  const sources = loadLocalResearchSources();
  const sourcePool = isArxivRun(run) ? sources.filter((source) => source.arxivId || source.alphaXivUrl || source.tags.includes("arxiv")) : sources;
  const queryTokens = tokenize(`${run.topic} ${run.audience}`);
  const ranked = sourcePool
    .map((source) => ({
      source,
      score: source.tags.reduce((total, tag) => total + (queryTokens.has(tag) ? 2 : 0), 0)
        + source.title.split(/\W+/).reduce((total, token) => total + (queryTokens.has(token.toLowerCase()) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score || a.source.freshnessDays - b.source.freshnessDays)
    .map((item) => item.source);
  return ranked.slice(0, run.presetId === "quick" ? 2 : 3);
}

function loadLocalResearchSources(): LocalResearchSource[] {
  if (!existsSync(localSourcesPath)) return [];
  const payload = JSON.parse(readFileSync(localSourcesPath, "utf8")) as { sources?: LocalResearchSource[] };
  return (payload.sources || []).filter((source) => source.id && source.title && source.url && source.excerpt);
}

function sourceSummaries(run: LocalRunView) {
  const bySource = new Map<string, { id: string; title: string; url: string; alphaXivUrl?: string; arxivId?: string; evidenceCount: number }>();
  for (const item of run.evidence) {
    const existing = bySource.get(item.source) || {
      id: item.source,
      title: item.sourceTitle,
      url: item.sourceUrl,
      alphaXivUrl: (item as any).alphaXivUrl,
      arxivId: (item as any).arxivId,
      evidenceCount: 0
    };
    existing.evidenceCount += 1;
    bySource.set(item.source, existing);
  }
  return [...bySource.values()];
}

function tokenize(value: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function scheduleLocalProgressFrom(runId: string, startIndex: number) {
  clearRunTimers(runId);
  const existing = runViews.get(runId);
  const flow = existing ? getFlowForRun(existing) : deepResearchFlow;
  const stepIds = flow.steps.map((step) => step.id);
  const timers: Array<NodeJS.Timeout> = [];

  stepIds.slice(startIndex).forEach((stepId, offset) => {
    const absoluteIndex = startIndex + offset;
    const timer = setTimeout(() => {
      const view = runViews.get(runId);
      if (!view || ["failed", "canceled", "complete"].includes(view.status)) return;
      view.status = "running";
      view.currentStepId = stepId;
      view.updatedAt = new Date().toISOString();
      view.timeline = view.timeline.map((item, itemIndex) => ({
        ...item,
        status: itemIndex < absoluteIndex ? "succeeded" : itemIndex === absoluteIndex ? "running" : "waiting"
      }));
      view.detail = createStepDetail(view, stepId);
      persistRunStore();
    }, 300 + offset * 350);
    timers.push(timer);
  });

  const completeTimer = setTimeout(() => {
    const view = runViews.get(runId);
    if (!view || ["failed", "canceled"].includes(view.status)) return;
    view.status = "complete";
    view.currentStepId = "export";
    view.updatedAt = new Date().toISOString();
    view.timeline = view.timeline.map((item) => ({ ...item, status: "succeeded" }));
    view.evidence = createEvidence(view);
    view.artifacts = createArtifacts(view);
    view.detail = {
      runtime: "local-dev",
      runId: view.id,
      status: "complete",
      artifactCount: view.artifacts.length,
      evidenceCount: view.evidence.length
    };
    attributeLocalRunUsage(view);
    persistRunStore();
  }, 300 + (stepIds.length - startIndex) * 350);
  timers.push(completeTimer);
  runTimers.set(runId, timers);
}

function clearRunTimers(runId: string) {
  const timers = runTimers.get(runId) || [];
  for (const timer of timers) clearTimeout(timer);
  runTimers.delete(runId);
}

function loadRunStore() {
  if (!existsSync(runStorePath)) return;

  try {
    const stored = JSON.parse(readFileSync(runStorePath, "utf8")) as { runs?: LocalRunView[] };
    for (const run of stored.runs || []) {
      run.audience ||= "engineering leaders";
      run.freshnessDays ||= 365;
      runViews.set(run.id, run);
      const numericId = Number(run.id.split("_").at(-1));
      if (Number.isFinite(numericId)) idCounter = Math.max(idCounter, numericId);
      for (const artifact of run.artifacts || []) {
        artifact.downloadUrl = `/api/runs/${run.id}/artifacts/${artifact.id}`;
      }
    }
  } catch (error) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = `${runStorePath}.corrupt-${timestamp}`;
    renameSync(runStorePath, corruptPath);
    console.warn(`Local run store was unreadable and has been moved to ${corruptPath}`);
  }
}

function persistRunStore() {
  mkdirSync(localStateDir, { recursive: true });
  const runs = [...runViews.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tempPath = `${runStorePath}.tmp`;
  writeFileSync(tempPath, JSON.stringify({ version: 1, runs }, null, 2));
  renameSync(tempPath, runStorePath);
}

function readInputs(body: JsonRecord) {
  const rawInputs = typeof body.inputs === "object" && body.inputs !== null ? body.inputs as JsonRecord : {};
  const freshnessValue = rawInputs.freshness_days === undefined || rawInputs.freshness_days === null
    ? 365
    : Number(rawInputs.freshness_days);
  return {
    topic: String(rawInputs.topic || "").trim(),
    audience: typeof rawInputs.audience === "string" ? rawInputs.audience : "engineering leaders",
    freshness_days: freshnessValue
  };
}

async function readJson(request: IncomingMessage): Promise<JsonRecord> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonRecord;
}

function sendJson(response: ServerResponse, payload: unknown, status = 200, headers: Record<string, string> = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload, null, 2));
}

// --- API gateway: admin CRUD + public /v1 middleware ---

function serializeApiClient(client: ReturnType<LocalApiGatewayStore["listClients"]>[number]) {
  const windowKey = new Date().toISOString().slice(0, 7);
  return {
    ...toPublicClient(client),
    usage: apiGatewayStore.getUsageSnapshot(client.id, windowKey)
  };
}

async function createApiClient(body: JsonRecord) {
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "";
  if (!name) return { status: 422, body: { error: "name is required", code: "invalid_request" } };
  const { plaintext, keyPrefix, keyHash } = await generateApiKey();
  const now = new Date().toISOString();
  const client = apiGatewayStore.insertClient({
    id: apiGatewayStore.newClientId(),
    name,
    keyPrefix,
    keyHash,
    status: "active",
    scopes: normalizeScopes(body.scopes),
    allowedFlows: normalizeAllowedFlows(body.allowedFlows),
    rateLimit: normalizeRateLimit(body.rateLimit),
    budget: normalizeBudget(body.budget),
    createdAt: now
  });
  return { status: 201, body: { client: serializeApiClient(client), key: plaintext } };
}

function updateApiClient(id: string, body: JsonRecord) {
  const existing = apiGatewayStore.getClientById(id);
  if (!existing) return { status: 404, body: { error: "API client not found", code: "not_found" } };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.scopes !== undefined) patch.scopes = normalizeScopes(body.scopes);
  if (body.allowedFlows !== undefined) patch.allowedFlows = normalizeAllowedFlows(body.allowedFlows);
  if (body.rateLimit !== undefined) patch.rateLimit = normalizeRateLimit(body.rateLimit);
  if (body.budget !== undefined) patch.budget = normalizeBudget(body.budget);
  const updated = apiGatewayStore.updateClient(id, patch);
  return { status: 200, body: { client: serializeApiClient(updated!) } };
}

function revokeApiClient(id: string) {
  const existing = apiGatewayStore.getClientById(id);
  if (!existing) return { status: 404, body: { error: "API client not found", code: "not_found" } };
  const updated = apiGatewayStore.updateClient(id, { status: "revoked" });
  return { status: 200, body: { client: serializeApiClient(updated!) } };
}

function getApiClientAudit(id: string) {
  const existing = apiGatewayStore.getClientById(id);
  if (!existing) return { status: 404, body: { error: "API client not found", code: "not_found" } };
  const windowKey = new Date().toISOString().slice(0, 7);
  return {
    status: 200,
    body: {
      audit: apiGatewayStore.listAudit(id, 100),
      usage: apiGatewayStore.getUsageSnapshot(id, windowKey)
    }
  };
}

function attributeLocalRunUsage(view: LocalRunView) {
  if (!view.clientId || view.usageAttributed) return;
  view.usageAttributed = true;
  const metrics = createObservabilityReport(view).metrics;
  void attributeRunUsage(apiGatewayStore, view.clientId, {
    costUsd: metrics.totalCostUsd,
    tokens: metrics.totalTokens,
    runs: 0
  });
}

const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp; scope: ApiScope; isRun?: boolean }> = [
  { method: "POST", pattern: /^\/v1\/runs$/, scope: "runs:write", isRun: true },
  { method: "GET", pattern: /^\/v1\/flows$/, scope: "flows:read" },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/, scope: "artifacts:read" },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)\/artifacts$/, scope: "artifacts:read" },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)\/evidence$/, scope: "evidence:read" },
  { method: "GET", pattern: /^\/v1\/runs\/([^/]+)$/, scope: "runs:read" }
];

async function handlePublicApi(url: URL, request: IncomingMessage, response: ServerResponse) {
  const method = request.method || "GET";
  const route = PUBLIC_ROUTES.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
  if (!route) {
    return sendJson(response, { error: "Not found", code: "not_found" }, 404);
  }

  let body: JsonRecord = {};
  if (method === "POST") {
    try {
      body = await readJson(request);
    } catch {
      return sendJson(response, { error: "Request body must be valid JSON", code: "invalid_request" }, 400);
    }
  }

  const flowId = route.isRun ? (typeof body.flowId === "string" ? body.flowId : undefined) : undefined;
  const decision = await authorizeRequest(apiGatewayStore, {
    method,
    path: url.pathname,
    authorization: request.headers["authorization"] as string | undefined,
    requiredScope: route.scope,
    flowId,
    countsAsRun: route.isRun
  });

  if (!decision.allowed) {
    await writePublicAudit(decision, method, url.pathname, undefined, 0, 0);
    return sendJson(response, { error: decision.error, code: decision.code }, decision.statusCode, rateLimitHeaderObject(decision.headers));
  }

  const headers = rateLimitHeaderObject(decision.headers);
  apiGatewayStore.touchClient(decision.client.id, new Date().toISOString());

  // Dispatch to existing handlers.
  if (route.method === "POST" && /^\/v1\/runs$/.test(url.pathname)) {
    const result = createFlowRun(flowId || managementConfig.flow.id, body);
    if (!result.run) {
      await writePublicAudit(decision, method, url.pathname, undefined, 0, 0, result.status);
      return sendJson(response, { error: result.error, code: "invalid_request", details: (result as any).details }, result.status === 404 ? 404 : 422, headers);
    }
    const view = runViews.get(result.run.id);
    if (view) view.clientId = decision.client.id;
    persistRunStore();
    await writePublicAudit(decision, method, url.pathname, result.run.id, 0, 0, 200);
    return sendJson(response, { runId: result.run.id, status: result.run.status }, 200, headers);
  }

  if (/^\/v1\/flows$/.test(url.pathname)) {
    const flows = listLocalFlows()
      .filter((flow) => flow.status !== "archived")
      .filter((flow) => decision.client.allowedFlows.length === 0 || decision.client.allowedFlows.includes(flow.id))
      .map((flow) => ({ id: flow.id, name: flow.name, description: flow.description, presets: flow.presets }));
    await writePublicAudit(decision, method, url.pathname, undefined, 0, 0, 200);
    return sendJson(response, { flows }, 200, headers);
  }

  const artifactDownload = url.pathname.match(/^\/v1\/runs\/([^/]+)\/artifacts\/([^/]+)$/);
  if (artifactDownload) {
    const owned = requireOwnedRun(decision, artifactDownload[1]);
    if (!owned.ok) {
      await writePublicAudit(decision, method, url.pathname, artifactDownload[1], 0, 0, owned.status);
      return sendJson(response, owned.body, owned.status, headers);
    }
    const artifact = owned.run.artifacts.find((candidate) => candidate.id === artifactDownload[2]);
    if (!artifact) {
      await writePublicAudit(decision, method, url.pathname, artifactDownload[1], 0, 0, 404);
      return sendJson(response, { error: "Artifact not found", code: "not_found" }, 404, headers);
    }
    await writePublicAudit(decision, method, url.pathname, artifactDownload[1], 0, 0, 200);
    return sendJson(response, { id: artifact.id, name: artifact.name, type: artifact.type, version: artifact.version, content: artifact.content }, 200, headers);
  }

  const artifactList = url.pathname.match(/^\/v1\/runs\/([^/]+)\/artifacts$/);
  if (artifactList) {
    const owned = requireOwnedRun(decision, artifactList[1]);
    if (!owned.ok) {
      await writePublicAudit(decision, method, url.pathname, artifactList[1], 0, 0, owned.status);
      return sendJson(response, owned.body, owned.status, headers);
    }
    await writePublicAudit(decision, method, url.pathname, artifactList[1], 0, 0, 200);
    return sendJson(response, { artifacts: owned.run.artifacts.map((artifact) => ({ id: artifact.id, name: artifact.name, type: artifact.type, version: artifact.version })) }, 200, headers);
  }

  const evidenceList = url.pathname.match(/^\/v1\/runs\/([^/]+)\/evidence$/);
  if (evidenceList) {
    const owned = requireOwnedRun(decision, evidenceList[1]);
    if (!owned.ok) {
      await writePublicAudit(decision, method, url.pathname, evidenceList[1], 0, 0, owned.status);
      return sendJson(response, owned.body, owned.status, headers);
    }
    await writePublicAudit(decision, method, url.pathname, evidenceList[1], 0, 0, 200);
    return sendJson(response, { evidence: owned.run.evidence }, 200, headers);
  }

  const runDetail = url.pathname.match(/^\/v1\/runs\/([^/]+)$/);
  if (runDetail) {
    const owned = requireOwnedRun(decision, runDetail[1]);
    if (!owned.ok) {
      await writePublicAudit(decision, method, url.pathname, runDetail[1], 0, 0, owned.status);
      return sendJson(response, owned.body, owned.status, headers);
    }
    await writePublicAudit(decision, method, url.pathname, runDetail[1], 0, 0, 200);
    return sendJson(response, {
      runId: owned.run.id,
      status: owned.run.status,
      currentStepId: owned.run.currentStepId,
      timeline: owned.run.timeline
    }, 200, headers);
  }

  return sendJson(response, { error: "Not found", code: "not_found" }, 404, headers);
}

function requireOwnedRun(decision: GatewayDecision, runId: string): {
  ok: boolean;
  run?: LocalRunView;
  status: number;
  body?: { error: string; code: string };
} {
  const run = runViews.get(runId);
  // Treat runs owned by a different client as not found so ownership is not leaked.
  if (!run || run.clientId !== decision.client?.id) {
    return { ok: false, status: 404, body: { error: "Run not found", code: "not_found" } };
  }
  return { ok: true, run, status: 200 };
}

function rateLimitHeaderObject(headers: RateLimitHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function writePublicAudit(
  decision: GatewayDecision,
  method: string,
  path: string,
  runId: string | undefined,
  costUsd: number,
  tokens: number,
  statusCode?: number
) {
  const clientId = decision.allowed ? decision.client.id : decision.client?.id;
  const defaultCode = decision.allowed ? 200 : decision.statusCode;
  const outcome = decision.allowed ? "allow" : `deny:${decision.reason}`;
  await apiGatewayStore.recordAudit({
    id: apiGatewayStore.newAuditId(),
    clientId,
    ts: new Date().toISOString(),
    method,
    path,
    runId,
    statusCode: statusCode ?? defaultCode,
    outcome,
    costUsd,
    tokens
  });
}

function sendArtifact(response: ServerResponse, runId: string, artifactId: string) {
  const run = runViews.get(runId);
  if (!run) return sendJson(response, { error: "Run not found" }, 404);
  const artifact = run.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) return sendJson(response, { error: "Artifact not found" }, 404);

  const isJson = artifact.type === "JSON";
  const body = isJson ? JSON.stringify(artifact.content, null, 2) : String(artifact.content);
  const extension = isJson ? "json" : "md";
  response.writeHead(200, {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${run.id}-${artifact.id}.${extension}"`
  });
  response.end(body);
}

function serveStatic(pathname: string, response: ServerResponse) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(webRoot, normalized);
  const fallbackPath = join(webRoot, "index.html");
  const targetPath = existsSync(filePath) && statSync(filePath).isFile() ? filePath : fallbackPath;

  if (!existsSync(targetPath)) {
    return sendJson(response, { error: "Run npm run build:web before starting local dev server." }, 404);
  }

  response.writeHead(200, { "content-type": contentType(targetPath) });
  createReadStream(targetPath).pipe(response);
}

function contentType(path: string) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
