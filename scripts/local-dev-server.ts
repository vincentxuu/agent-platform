import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { deepResearchFlow } from "../packages/core/src/deep-research-flow.js";
import { validateFlowInputs } from "../packages/core/src/flow.js";
import { InMemoryFlowRuntime } from "../packages/runtime/src/flow-runtime.js";
import {
  DEFAULT_ALLOWED_PROVIDER_IDS,
  createProviderConfigs,
  createProviderReadiness
} from "../packages/runtime/src/provider-catalog.js";
import {
  createLocalHealthReport,
  createLocalPlatformPaths,
  createLocalReadinessReport,
  loadLocalDevVars
} from "../packages/local/src/adapter.js";

type JsonRecord = Record<string, unknown>;

type LocalRunView = {
  id: string;
  flowId: string;
  presetId: string;
  status: "queued" | "running" | "complete" | "failed" | "canceled";
  currentStepId: string;
  topic: string;
  audience: string;
  freshnessDays: number;
  createdAt: string;
  updatedAt: string;
  timeline: Array<{ stepId: string; status: string; attempt: number }>;
  evidence: Array<{ claim: string; source: string; sourceTitle: string; sourceUrl: string; excerpt: string; confidence: string; conflicts: string; review?: EvidenceReview }>;
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
  provider: string;
  freshnessDays: number;
  excerpt: string;
  claims: string[];
  tags: string[];
};

type ManagementConfig = {
  flow: {
    id: string;
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
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    credentialRef: string;
    models: string[];
    activeModel: string;
  }>;
  skills: ManagedSkill[];
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
loadRunStore();
let managementConfig = loadManagementConfig();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, createLocalHealthReport(paths));
    }

    if (url.pathname === "/api/flows" && request.method === "GET") {
      return sendJson(response, { flows: [deepResearchFlow] });
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

    const providerTestMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/test$/);
    if (providerTestMatch && request.method === "POST") {
      const result = testProvider(providerTestMatch[1]);
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
      const validation = validateRunRequest(body);
      if (validation.errors.length > 0) {
        return sendJson(response, { error: "Invalid run request", details: validation.errors }, 400);
      }
      const result = createLocalRun(body);
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
      if (stepId && !deepResearchFlow.steps.some((step) => step.id === stepId)) {
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

function createLocalRun(body: JsonRecord) {
  const inputs = readInputs(body);
  const presetId = typeof body.presetId === "string" ? body.presetId : "standard";
  const run = runtime.createRun({ flow: deepResearchFlow, presetId, inputs });
  const currentStepId = run.currentStepIds[0] || deepResearchFlow.steps[0].id;
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
    timeline: deepResearchFlow.steps.map((step) => ({
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
  const errors: string[] = [];
  const presetId = typeof body.presetId === "string" ? body.presetId : "standard";
  const inputs = readInputs(body);

  if (!deepResearchFlow.presets.some((preset) => preset.id === presetId)) {
    errors.push(`Unknown presetId: ${presetId}`);
  }

  errors.push(...validateFlowInputs(deepResearchFlow, inputs));

  if (inputs.freshness_days <= 0 || !Number.isFinite(inputs.freshness_days)) {
    errors.push("Input freshness_days must be a positive number");
  }

  return { errors };
}

function createReadinessReport() {
  return createLocalReadinessReport({ paths, loadedDevVars, runCount: runViews.size });
}

function createConfigReport() {
  return {
    config: managementConfig,
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
  const next = normalizeManagementConfig(body as Partial<ManagementConfig>);
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
    if (!provider?.id || !providerById.has(provider.id)) continue;
    providerById.set(provider.id, {
      ...providerById.get(provider.id)!,
      enabled: Boolean(provider.enabled),
      credentialRef: typeof provider.credentialRef === "string" ? provider.credentialRef.slice(0, 120) : providerById.get(provider.id)!.credentialRef,
      activeModel: typeof provider.activeModel === "string" && providerById.get(provider.id)!.models.includes(provider.activeModel)
        ? provider.activeModel
        : providerById.get(provider.id)!.activeModel
    });
  }
  const skillById = new Map(fallback.skills.map((skill) => [skill.id, skill]));
  for (const skill of input.skills || []) {
    const normalized = normalizeManagedSkill(skill, skillById.get(skill.id));
    if (normalized) skillById.set(normalized.id, normalized);
  }
  return {
    flow: {
      id: "deep_research",
      defaultPreset: typeof input.flow?.defaultPreset === "string" ? input.flow.defaultPreset : fallback.flow.defaultPreset,
      defaultAudience: typeof input.flow?.defaultAudience === "string" ? input.flow.defaultAudience.slice(0, 120) : fallback.flow.defaultAudience,
      defaultFreshnessDays: Number(input.flow?.defaultFreshnessDays || fallback.flow.defaultFreshnessDays)
    },
    policy: {
      maxCostUsd: Number(input.policy?.maxCostUsd ?? fallback.policy.maxCostUsd),
      maxIterations: Number(input.policy?.maxIterations ?? fallback.policy.maxIterations),
      citationRequired: Boolean(input.policy?.citationRequired ?? fallback.policy.citationRequired),
      allowedProviders: Array.isArray(input.policy?.allowedProviders)
        ? input.policy.allowedProviders.filter((id) => providerById.has(id))
        : fallback.policy.allowedProviders
    },
    providers: [...providerById.values()],
    skills: [...skillById.values()]
  };
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

function createSkillBindings() {
  return deepResearchFlow.steps
    .filter((step) => step.skill)
    .map((step) => ({
      stepId: step.id,
      defaultBinding: step.skill,
      activeBinding: skillBindingForStep(step.id)
    }));
}

function skillBindingForStep(stepId: string) {
  const defaultBinding = deepResearchFlow.steps.find((step) => step.id === stepId)?.skill;
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
  const readiness = createProviderReadiness(process.env, { localWorkersAiReady: true });
  const ready = Boolean(provider.enabled && allowed && readiness[provider.id]);
  return {
    status: ready ? 200 : 412,
    id: provider.id,
    name: provider.name,
    ready,
    enabled: provider.enabled,
    allowed,
    activeModel: provider.activeModel,
    credentialRef: provider.credentialRef,
    detail: ready
      ? `${provider.name} is ready with ${provider.activeModel}.`
      : `${provider.name} needs enabled=true, Policy allowed=true, and its credential/binding configured.`
  };
}

function scheduleLocalProgress(runId: string) {
  clearRunTimers(runId);
  const stepIds = deepResearchFlow.steps.map((step) => step.id);
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
    persistRunStore();
  }, 300 + stepIds.length * 350);
  timers.push(completeTimer);
  runTimers.set(runId, timers);
}

function createStepDetail(run: LocalRunView, stepId: string): JsonRecord {
  return {
    runtime: "local-dev",
    runId: run.id,
    step: stepId,
    providerCalls: ["search", "read_sources"].includes(stepId) ? 1 : 0,
    skillInvocation: skillBindingForStep(stepId),
    guardResults: "passed",
    costUsd: Number((0.01 + run.timeline.filter((item) => item.status === "succeeded").length * 0.02).toFixed(2)),
    latencyMs: 250,
    tokens: 300 + run.timeline.filter((item) => item.status === "succeeded").length * 120
  };
}

function createObservabilityReport(run: LocalRunView) {
  const succeededCount = run.timeline.filter((item) => item.status === "succeeded").length;
  const providerCalls = run.timeline
    .filter((item) => ["search", "read_sources", "synthesize", "verify"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `provider_${index + 1}`,
      provider: ["search", "read_sources"].includes(item.stepId) ? "Search/Reader" : "LLM",
      stepId: item.stepId,
      status: item.status === "running" ? "running" : "succeeded",
      costUsd: Number((0.01 + index * 0.015).toFixed(3)),
      tokens: 220 + index * 90,
      latencyMs: 180 + index * 70,
      retryCount: Math.max(0, item.attempt - 1)
    }));
  const toolInvocations = run.timeline
    .filter((item) => ["search", "read_sources", "extract_evidence"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `tool_${index + 1}`,
      tool: item.stepId === "search" ? "search.web" : item.stepId === "read_sources" ? "reader.fetch" : "citation.extract",
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
      excerpt: source.excerpt,
      confidence: claimIndex === 0 ? "high" : "medium",
      conflicts: "none"
    }));
  });
}

function createArtifacts(run: LocalRunView): LocalRunView["artifacts"] {
  return [
    {
      id: "markdown_report",
      name: "Deep Research Report",
      type: "Markdown",
      version: 1,
      content: [
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
        sources: sourceSummaries(run),
        evidence: run.evidence,
        claims: run.evidence.map((item, index) => ({
          id: `claim_${index + 1}`,
          text: item.claim,
          citation: item.source,
          confidence: item.confidence
        }))
      },
      downloadUrl: `/api/runs/${run.id}/artifacts/evidence_bundle`
    }
  ].map((artifact) => withInitialArtifactVersion(artifact));
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
  const stepIds = deepResearchFlow.steps.map((step) => step.id);
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
  const queryTokens = tokenize(`${run.topic} ${run.audience}`);
  const ranked = sources
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
  const bySource = new Map<string, { id: string; title: string; url: string; evidenceCount: number }>();
  for (const item of run.evidence) {
    const existing = bySource.get(item.source) || {
      id: item.source,
      title: item.sourceTitle,
      url: item.sourceUrl,
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
  const stepIds = deepResearchFlow.steps.map((step) => step.id);
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

function sendJson(response: ServerResponse, payload: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
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
