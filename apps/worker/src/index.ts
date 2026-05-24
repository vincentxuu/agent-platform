// @ts-nocheck
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deepResearchFlow } from "../../../packages/core/src/deep-research-flow.js";
import { assertValidFlowDefinition, findInitialStepIds, validateFlowInputs } from "../../../packages/core/src/flow.js";
import { createId, D1AgentRepository } from "../../../packages/cloudflare/src/d1-repository.js";
import {
  getCloudflareArchitectureSummary,
  requireCloudflareBindings
} from "../../../packages/cloudflare/src/service-map.js";
import {
  DEFAULT_ALLOWED_PROVIDER_IDS,
  createProviderConfigs,
  createProviderReadiness,
  createProviderReadinessChecks
} from "../../../packages/runtime/src/provider-catalog.js";
import { DeepResearchWorkflow } from "./workflow.js";

export { DeepResearchWorkflow, RunCoordinator };

const app = new Hono();

app.onError((error) => {
  if (error instanceof Response) return error;
  if (error instanceof HTTPException) return error.getResponse();
  return json({ error: error.message || "Internal Server Error" }, { status: 500 });
});

app.get("/api/health", (c) => c.json({
  ok: true,
  runtime: "cloudflare",
  services: getCloudflareArchitectureSummary()
}));

app.get("/api/flows", (c) => c.json({ flows: [deepResearchFlow] }));

app.get("/api/readiness", (c) => c.json(createReadinessReport(c.env)));

app.get("/api/config", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await createConfigReport(c.env));
});

app.put("/api/config", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await updateManagementConfig(c.env, await c.req.json());
  if (result.errors.length > 0) {
    return c.json({ error: "Invalid config request", details: result.errors }, 400);
  }
  return c.json(await createConfigReport(c.env));
});

app.get("/api/skills", async (c) => {
  requireCloudflareBindings(c.env);
  const config = await loadManagementConfig(c.env);
  return c.json({ skills: config.skills, bindings: createSkillBindings(config) });
});

app.post("/api/skills", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await createManagedSkill(c.env, await c.req.json()), 201);
});

app.patch("/api/skills/:skillId", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await updateManagedSkill(c.env, c.req.param("skillId"), await c.req.json()));
});

app.post("/api/providers/:providerId/test", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await testProvider(c.env, c.req.param("providerId"));
  return c.json(result, result.status);
});

app.get("/api/runs", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  await repository.seedBuiltInFlows();
  const runs = await repository.listRuns();
  return c.json({ runs: await Promise.all(runs.map((run) => normalizeListedRun(c.env, run))) });
});

app.delete("/api/runs", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.deleteAllRuns();
  return c.json({ deleted: "all", runIds: result.deleted, runs: [] });
});

app.post("/api/runs", async (c) => {
  requireCloudflareBindings(c.env);
  const body = await c.req.json();
  const validation = validateCloudflareRunRequest(body);
  if (validation.errors.length > 0) {
    return c.json({ error: "Invalid request", details: validation.errors }, 400);
  }
  const result = await createCloudflareRun({ env: c.env, body });
  c.executionCtx.waitUntil(c.env.RUN_QUEUE.send({
    type: "run.created",
    runId: result.run.id,
    stepRunId: result.stepRun.id,
    stepId: result.stepRun.stepId
  }));
  return c.json(result, 202);
});

app.patch("/api/runs/:runId/evidence/:evidenceIndex", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json({
    run: await updateEvidenceReview(
      c.env,
      c.req.param("runId"),
      Number(c.req.param("evidenceIndex")),
      await c.req.json(),
      c.req.raw
    )
  });
});

app.post("/api/runs/:runId/artifacts/regenerate", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json({ run: await regenerateReviewArtifact(c.env, c.req.param("runId"), c.req.raw) });
});

app.get("/api/runs/:runId/artifacts/:artifactId/versions", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json({ versions: await listArtifactVersions(c.env, c.req.param("runId"), c.req.param("artifactId")) });
});

app.get("/api/runs/:runId/artifacts/:artifactId/diff", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json({ diff: await createArtifactDiff(c.env, c.req.param("runId"), c.req.param("artifactId")) });
});

app.get("/api/runs/:runId/artifacts/:artifactId", async (c) => {
  requireCloudflareBindings(c.env);
  return getArtifact(c.env, c.req.param("runId"), c.req.param("artifactId"));
});

app.patch("/api/runs/:runId/artifacts/:artifactId", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await updateArtifactVersion(c.env, c.req.param("runId"), c.req.param("artifactId"), await c.req.json(), c.req.raw));
});

app.post("/api/runs/:runId/cancel", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json({ run: await cancelRun(c.env, c.req.param("runId")) });
});

app.post("/api/runs/:runId/retry-step", async (c) => {
  requireCloudflareBindings(c.env);
  const body = await c.req.json();
  return c.json({ run: await retryRun(c.env, c.req.param("runId"), body.stepId) }, 202);
});

app.get("/api/runs/:runId/observability", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await getCloudflareRun(c.env, c.req.param("runId"), c.req.raw);
  return c.json({ observability: createObservabilityReport(result.run) });
});

app.get("/api/runs/:runId", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await getCloudflareRun(c.env, c.req.param("runId"), c.req.raw));
});

app.delete("/api/runs/:runId", async (c) => {
  requireCloudflareBindings(c.env);
  const runId = c.req.param("runId");
  const repository = new D1AgentRepository(c.env.DB);
  await repository.deleteRun(runId);
  await c.env.CACHE.delete(`run:${runId}:status`);
  await c.env.CACHE.delete(`run:${runId}:evidence-reviews`);
  await c.env.CACHE.delete(`run:${runId}:artifact-overlays`);
  return c.json({ deleted: runId });
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  async queue(batch, env) {
    requireCloudflareBindings(env);
    for (const message of batch.messages) {
      const { runId } = message.body || {};
      if (!runId) {
        message.ack();
        continue;
      }
      const id = env.RUN_COORDINATOR.idFromName(runId);
      await env.RUN_COORDINATOR.get(id).fetch("https://run-coordinator.internal/background-job", {
        method: "POST",
        body: JSON.stringify(message.body)
      });
      message.ack();
    }
  }
};

async function createCloudflareRun({ env, body }) {
  assertValidFlowDefinition(deepResearchFlow);
  const presetId = body.presetId || "standard";
  const rawInputs = body.inputs || {};
  const inputs = {
    ...rawInputs,
    topic: String(rawInputs.topic || "").trim(),
    audience: typeof rawInputs.audience === "string" ? rawInputs.audience : "engineering leaders",
    freshness_days: rawInputs.freshness_days === undefined || rawInputs.freshness_days === null
      ? 365
      : Number(rawInputs.freshness_days)
  };
  const inputErrors = validateFlowInputs(deepResearchFlow, inputs);
  if (!deepResearchFlow.presets.some((preset) => preset.id === presetId)) {
    inputErrors.push(`Unknown presetId: ${presetId}`);
  }
  if (inputs.freshness_days <= 0 || !Number.isFinite(inputs.freshness_days)) {
    inputErrors.push("Input freshness_days must be a positive number");
  }
  if (inputErrors.length > 0) {
    return badRequest(`Invalid flow inputs:\n${inputErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  const repository = new D1AgentRepository(env.DB);
  await repository.seedBuiltInFlows();
  const runId = createId("run");
  const [initialStepId] = findInitialStepIds(deepResearchFlow);
  const stepRunId = createId("step");

  const run = await repository.createRun({ id: runId, presetId, inputs, initialStepId });
  const stepRun = await repository.createStepRun({ id: stepRunId, runId, stepId: initialStepId });
  await repository.recordRunEvent({
    id: createId("event"),
    runId,
    stepRunId,
    type: "run.created",
    payload: { presetId, initialStepId, runtime: "cloudflare" }
  });

  await env.CACHE.put(`run:${runId}:status`, JSON.stringify({ status: "queued", currentStepId: initialStepId }), {
    expirationTtl: 60 * 60
  });

  const workflow = await env.DEEP_RESEARCH_WORKFLOW.create({
    id: runId,
    params: {
      runId,
      stepRunId,
      flowId: deepResearchFlow.id,
      presetId,
      inputs,
      initialStepId
    }
  });

  return {
    run,
    stepRun,
    workflow: {
      id: workflow.id,
      status: await workflow.status()
    },
    queued: true
  };
}

function validateCloudflareRunRequest(body) {
  const presetId = body.presetId || "standard";
  const rawInputs = body.inputs || {};
  const inputs = {
    ...rawInputs,
    topic: String(rawInputs.topic || "").trim(),
    audience: typeof rawInputs.audience === "string" ? rawInputs.audience : "engineering leaders",
    freshness_days: rawInputs.freshness_days === undefined || rawInputs.freshness_days === null
      ? 365
      : Number(rawInputs.freshness_days)
  };
  const errors = validateFlowInputs(deepResearchFlow, inputs);
  if (!deepResearchFlow.presets.some((preset) => preset.id === presetId)) {
    errors.push(`Unknown presetId: ${presetId}`);
  }
  if (inputs.freshness_days <= 0 || !Number.isFinite(inputs.freshness_days)) {
    errors.push("Input freshness_days must be a positive number");
  }
  return { errors };
}

function createReadinessReport(env) {
  const bindingChecks = [
    bindingCheck(env, "DB", "D1"),
    bindingCheck(env, "CACHE", "KV"),
    bindingCheck(env, "ARTIFACTS", "R2"),
    bindingCheck(env, "VECTORIZE", "Vectorize"),
    bindingCheck(env, "RUN_QUEUE", "Queue"),
    bindingCheck(env, "RUN_COORDINATOR", "Durable Object"),
    bindingCheck(env, "DEEP_RESEARCH_WORKFLOW", "Workflow"),
    bindingCheck(env, "ASSETS", "Workers Assets"),
    bindingCheck(env, "AI", "Workers AI")
  ];
  const providerChecks = createProviderReadinessChecks(env);

  return {
    runtime: "cloudflare",
    usableNow: bindingChecks.every((check) => check.ready),
    local: {
      server: "Cloudflare Worker",
      persistence: {
        driver: "D1/R2/KV",
        ready: Boolean(env.DB && env.ARTIFACTS && env.CACHE)
      }
    },
    cloudflare: {
      deployReady: bindingChecks.every((check) => check.ready),
      resources: bindingChecks,
      services: getCloudflareArchitectureSummary()
    },
    providers: {
      liveProviderReady: providerChecks.some((check) => check.ready),
      configured: providerChecks
    }
  };
}

async function createConfigReport(env) {
  return {
    config: await loadManagementConfig(env),
    operationFlow: createOperationFlow(),
    editableSurfaces: [
      { id: "run_inputs", label: "執行輸入", editable: true, detail: "主題、讀者、新鮮度、策略可在執行前調整。" },
      { id: "flow_defaults", label: "流程預設", editable: true, detail: "預設策略、讀者、新鮮度可在管理區儲存到 KV。" },
      { id: "providers", label: "Provider 啟用狀態", editable: true, detail: "可調整 Provider 啟用狀態與 credential reference；secret 本身仍透過 Cloudflare 設定。" },
      { id: "policy", label: "政策", editable: true, detail: "可調整成本上限、迭代上限、citation requirement 與允許 provider。" },
      { id: "skills", label: "技能版本", editable: true, detail: "可啟用/停用 skill、切換 active version，並新增草稿 skill 到 KV 管理設定。" },
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

async function loadManagementConfig(env) {
  const stored = await env.CACHE.get("agent-platform:management-config", "json").catch(() => null);
  return normalizeManagementConfig(stored || {}, env);
}

async function updateManagementConfig(env, body) {
  const next = normalizeManagementConfig(body, env);
  const errors = validateManagementConfig(next);
  if (errors.length === 0) {
    await env.CACHE.put("agent-platform:management-config", JSON.stringify(next));
  }
  return { errors };
}

function defaultManagementConfig(env) {
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
    providers: createProviderConfigs(env),
    skills: builtInSkills()
  };
}

function normalizeManagementConfig(input, env) {
  const fallback = defaultManagementConfig(env);
  const providerById = new Map(fallback.providers.map((provider) => [provider.id, provider]));
  for (const provider of input.providers || []) {
    if (!provider?.id || !providerById.has(provider.id)) continue;
    providerById.set(provider.id, {
      ...providerById.get(provider.id),
      enabled: Boolean(provider.enabled),
      credentialRef: typeof provider.credentialRef === "string" ? provider.credentialRef.slice(0, 120) : providerById.get(provider.id).credentialRef,
      activeModel: typeof provider.activeModel === "string" && providerById.get(provider.id).models.includes(provider.activeModel)
        ? provider.activeModel
        : providerById.get(provider.id).activeModel
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

function validateManagementConfig(config) {
  const errors = [];
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

function builtInSkills() {
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
    source: "built-in"
  }));
}

function normalizeManagedSkill(input, fallback) {
  const id = sanitizeSkillId(input?.id || fallback?.id);
  if (!id) return undefined;
  const versions = Array.isArray(input?.availableVersions)
    ? input.availableVersions.map((version) => String(version)).filter(Boolean).slice(0, 8)
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

async function createManagedSkill(env, body) {
  const id = sanitizeSkillId(body.id);
  if (!id) return badRequest("Skill id is required");
  const config = await loadManagementConfig(env);
  if (config.skills.some((skill) => skill.id === id)) return badRequest("Skill already exists");
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
  if (!skill) return badRequest("Invalid skill request");
  await env.CACHE.put("agent-platform:management-config", JSON.stringify(normalizeManagementConfig({
    ...config,
    skills: [...config.skills, skill]
  }, env)));
  return { skill, skills: (await loadManagementConfig(env)).skills };
}

async function updateManagedSkill(env, skillId, body) {
  const id = sanitizeSkillId(skillId);
  const config = await loadManagementConfig(env);
  const existing = config.skills.find((skill) => skill.id === id);
  if (!existing) return notFound("Skill not found");
  const versions = typeof body.activeVersion === "string" && !existing.availableVersions.includes(body.activeVersion)
    ? [...existing.availableVersions, body.activeVersion]
    : existing.availableVersions;
  const next = normalizeManagedSkill({
    ...existing,
    enabled: body.enabled ?? existing.enabled,
    activeVersion: body.activeVersion || existing.activeVersion,
    availableVersions: versions
  }, existing);
  if (!next) return badRequest("Invalid skill request");
  await env.CACHE.put("agent-platform:management-config", JSON.stringify(normalizeManagementConfig({
    ...config,
    skills: config.skills.map((skill) => skill.id === id ? next : skill)
  }, env)));
  return { skill: next, skills: (await loadManagementConfig(env)).skills };
}

function createSkillBindings(config) {
  return deepResearchFlow.steps
    .filter((step) => step.skill)
    .map((step) => ({
      stepId: step.id,
      defaultBinding: step.skill,
      activeBinding: skillBindingForStep(step.id, config)
    }));
}

function skillBindingForStep(stepId, config) {
  const defaultBinding = deepResearchFlow.steps.find((step) => step.id === stepId)?.skill;
  if (!defaultBinding) return null;
  const skillId = defaultBinding.split("@")[0];
  const skill = config.skills.find((candidate) => candidate.id === skillId);
  if (!skill || !skill.enabled) return defaultBinding;
  return `${skill.id}@${skill.activeVersion}`;
}

function sanitizeSkillId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

function bindingCheck(env, binding, name) {
  return {
    id: binding.toLowerCase(),
    name,
    ready: Boolean(env[binding]),
    detail: env[binding] ? `${binding} binding is available.` : `${binding} binding is missing.`
  };
}

async function testProvider(env, id) {
  const config = await loadManagementConfig(env);
  const provider = config.providers.find((candidate) => candidate.id === id);
  if (!provider) return { status: 404, error: "Provider not found" };
  const allowed = config.policy.allowedProviders.includes(provider.id);
  const readiness = createProviderReadiness(env);
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

async function getCloudflareRun(env, runId, request) {
  const repository = new D1AgentRepository(env.DB);
  const run = await repository.getRun(runId);
  if (!run) throw notFound("Run not found");

  const workflowInstance = await env.DEEP_RESEARCH_WORKFLOW.get(runId);
  const id = env.RUN_COORDINATOR.idFromName(runId);
  const coordinatorResponse = await env.RUN_COORDINATOR.get(id).fetch("https://run-coordinator.internal/status");
  const coordinator = mergeRunStatus(
    await env.CACHE.get(`run:${runId}:status`, "json").catch(() => null),
    await coordinatorResponse.json()
  );
  const normalizedRun = normalizeRun(run, coordinator, await loadRunReviewState(env, runId));

  return {
    runId,
    workflow: await workflowInstance.status(),
    coordinator,
    run: normalizedRun
  };
}

function mergeRunStatus(cached, coordinator) {
  if (!cached) return coordinator || {};
  if (!coordinator || coordinator.status === "unknown") return cached;
  return {
    ...cached,
    ...coordinator,
    artifact: coordinator.artifact || cached.artifact,
    artifacts: coordinator.artifacts || cached.artifacts,
    phase: coordinator.phase || cached.phase,
    stepId: coordinator.stepId || cached.stepId
  };
}

async function cancelRun(env, runId) {
  const repository = new D1AgentRepository(env.DB);
  const run = await repository.updateRunStatus({ id: runId, status: "canceled", ended: true });
  if (!run) return notFound("Run not found");
  const status = {
    runId,
    status: "canceled",
    phase: "canceled",
    stepId: run.current_step_key,
    updatedAt: new Date().toISOString()
  };
  await writeCoordinatorStatus(env, runId, status);
  await env.CACHE.put(`run:${runId}:status`, JSON.stringify(status), { expirationTtl: 60 * 60 });
  return normalizeRun(run, status);
}

async function retryRun(env, runId, stepId) {
  if (stepId && !deepResearchFlow.steps.some((step) => step.id === stepId)) {
    return badRequest(`Unknown stepId: ${stepId}`);
  }
  const repository = new D1AgentRepository(env.DB);
  const retryStepId = stepId || deepResearchFlow.steps[0].id;
  const run = await repository.updateRunStatus({ id: runId, status: "active", currentStepId: retryStepId });
  if (!run) return notFound("Run not found");
  const status = {
    runId,
    status: "queued",
    phase: "retry_queued",
    stepId: retryStepId,
    updatedAt: new Date().toISOString()
  };
  await writeCoordinatorStatus(env, runId, status);
  await env.RUN_QUEUE.send({ type: "run.retry_requested", runId, stepId: retryStepId });
  return normalizeRun(run, status);
}

async function writeCoordinatorStatus(env, runId, status) {
  const id = env.RUN_COORDINATOR.idFromName(runId);
  await env.RUN_COORDINATOR.get(id).fetch("https://run-coordinator.internal/workflow-status", {
    method: "POST",
    body: JSON.stringify(status)
  });
}

async function getArtifact(env, runId, artifactId) {
  const artifact = artifactDescriptor(runId, artifactId);
  if (!artifact) return notFound("Artifact not found");
  const object = await env.ARTIFACTS.get(artifact.key);
  if (!object) return notFound("Artifact not found");
  return new Response(object.body, {
    headers: {
      "content-type": artifact.contentType,
      "content-disposition": `attachment; filename="${artifact.filename}"`
    }
  });
}

function artifactDescriptor(runId, artifactId) {
  const artifactMap = {
    markdown_report: {
      key: `runs/${runId}/artifacts/report.md`,
      contentType: "text/markdown; charset=utf-8",
      type: "Markdown",
      name: "Markdown Report",
      filename: `${runId}-report.md`
    },
    summary_json: {
      key: `runs/${runId}/artifacts/summary.json`,
      contentType: "application/json; charset=utf-8",
      type: "JSON",
      name: "Workflow Summary",
      filename: `${runId}-summary.json`
    },
    evidence_bundle: {
      key: `runs/${runId}/artifacts/evidence-bundle.json`,
      contentType: "application/json; charset=utf-8",
      type: "JSON",
      name: "Evidence Bundle",
      filename: `${runId}-evidence-bundle.json`
    },
    review_summary: {
      key: `runs/${runId}/artifacts/review-summary.json`,
      contentType: "application/json; charset=utf-8",
      type: "JSON",
      name: "Review Summary",
      filename: `${runId}-review-summary.json`
    }
  };
  return artifactMap[artifactId];
}

async function updateEvidenceReview(env, runId, evidenceIndex, body, request) {
  const repository = new D1AgentRepository(env.DB);
  const run = await repository.getRun(runId);
  if (!run) throw notFound("Run not found");
  const status = typeof body.status === "string" ? body.status : "watch";
  if (!["accepted", "rejected", "watch"].includes(status)) {
    return badRequest("Invalid evidence review status");
  }
  const reviews = await env.CACHE.get(`run:${runId}:evidence-reviews`, "json").catch(() => ({})) || {};
  reviews[String(evidenceIndex)] = {
    status,
    note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
    updatedAt: new Date().toISOString()
  };
  await env.CACHE.put(`run:${runId}:evidence-reviews`, JSON.stringify(reviews), { expirationTtl: 60 * 60 * 24 * 30 });
  return (await getCloudflareRun(env, runId, request)).run;
}

async function regenerateReviewArtifact(env, runId, request) {
  const repository = new D1AgentRepository(env.DB);
  const run = await repository.getRun(runId);
  if (!run) return notFound("Run not found");
  const reviews = await env.CACHE.get(`run:${runId}:evidence-reviews`, "json").catch(() => ({})) || {};
  const reviewed = Object.entries(reviews).map(([index, review]) => ({ index: Number(index), review }));
  const previousOverlays = await env.CACHE.get(`run:${runId}:artifact-overlays`, "json").catch(() => ({})) || {};
  const previous = Array.isArray(previousOverlays.artifacts)
    ? previousOverlays.artifacts.find((artifact) => artifact.id === "review_summary")
    : undefined;
  const version = previous ? Number(previous.version || 1) + 1 : 1;
  const content = {
    runId,
    reviewedCount: reviewed.length,
    acceptedCount: reviewed.filter((item) => item.review.status === "accepted").length,
    rejectedCount: reviewed.filter((item) => item.review.status === "rejected").length,
    reviews: reviewed,
    generatedAt: new Date().toISOString()
  };
  await env.ARTIFACTS.put(`runs/${runId}/artifacts/review-summary.json`, JSON.stringify(content, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" }
  });
  const overlays = {
    artifacts: [
      ...(Array.isArray(previousOverlays.artifacts) ? previousOverlays.artifacts.filter((artifact) => artifact.id !== "review_summary") : []),
      {
        id: "review_summary",
        name: "Review Summary",
        type: "JSON",
        version,
        key: `runs/${runId}/artifacts/review-summary.json`,
        versions: [
          ...(Array.isArray(previous?.versions) ? previous.versions : []),
          {
            version,
            updatedAt: content.generatedAt,
            note: "Regenerated from evidence reviews",
            content
          }
        ]
      }
    ]
  };
  await env.CACHE.put(`run:${runId}:artifact-overlays`, JSON.stringify(overlays), { expirationTtl: 60 * 60 * 24 * 30 });
  return (await getCloudflareRun(env, runId, request)).run;
}

async function updateArtifactVersion(env, runId, artifactId, body, request) {
  if (!Object.prototype.hasOwnProperty.call(body, "content")) return badRequest("Artifact content is required");
  const repository = new D1AgentRepository(env.DB);
  const run = await repository.getRun(runId);
  if (!run) return notFound("Run not found");
  const descriptor = artifactDescriptor(runId, artifactId);
  if (!descriptor) return notFound("Artifact not found");
  const currentContent = await loadArtifactContent(env, runId, artifactId);
  const overlays = await env.CACHE.get(`run:${runId}:artifact-overlays`, "json").catch(() => ({})) || {};
  const existingArtifacts = Array.isArray(overlays.artifacts) ? overlays.artifacts : [];
  const existing = existingArtifacts.find((artifact) => artifact.id === artifactId);
  const versions = ensureArtifactVersions(existing?.versions, existing?.version || 1, currentContent);
  const nextVersion = Math.max(...versions.map((version) => Number(version.version || 1))) + 1;
  const updatedAt = new Date().toISOString();
  const nextContent = body.content;
  await env.ARTIFACTS.put(descriptor.key, stringifyArtifactContent(nextContent), {
    httpMetadata: { contentType: descriptor.contentType }
  });
  const nextArtifact = {
    id: artifactId,
    name: existing?.name || descriptor.name,
    type: existing?.type || descriptor.type,
    version: nextVersion,
    key: descriptor.key,
    versions: [
      ...versions,
      {
        version: nextVersion,
        updatedAt,
        note: typeof body.note === "string" ? body.note.slice(0, 300) : "Manual edit",
        content: nextContent
      }
    ]
  };
  await env.CACHE.put(`run:${runId}:artifact-overlays`, JSON.stringify({
    artifacts: [...existingArtifacts.filter((artifact) => artifact.id !== artifactId), nextArtifact]
  }), { expirationTtl: 60 * 60 * 24 * 30 });
  return {
    artifact: nextArtifact,
    run: (await getCloudflareRun(env, runId, request)).run
  };
}

async function listArtifactVersions(env, runId, artifactId) {
  const artifact = await findArtifactOverlay(env, runId, artifactId);
  const descriptor = artifactDescriptor(runId, artifactId);
  if (!descriptor) return notFound("Artifact not found");
  const versions = ensureArtifactVersions(artifact?.versions, artifact?.version || 1, await loadArtifactContent(env, runId, artifactId));
  return versions.map((version) => ({
    version: version.version,
    updatedAt: version.updatedAt,
    note: version.note,
    preview: stringifyArtifactContent(version.content).slice(0, 240)
  }));
}

async function createArtifactDiff(env, runId, artifactId) {
  const artifact = await findArtifactOverlay(env, runId, artifactId);
  const descriptor = artifactDescriptor(runId, artifactId);
  if (!descriptor) return notFound("Artifact not found");
  const versions = ensureArtifactVersions(artifact?.versions, artifact?.version || 1, await loadArtifactContent(env, runId, artifactId));
  if (versions.length < 2) return badRequest("At least two artifact versions are required");
  const before = versions.at(-2);
  const after = versions.at(-1);
  return {
    artifactId,
    fromVersion: before.version,
    toVersion: after.version,
    lines: createLineDiff(stringifyArtifactContent(before.content), stringifyArtifactContent(after.content))
  };
}

async function findArtifactOverlay(env, runId, artifactId) {
  const overlays = await env.CACHE.get(`run:${runId}:artifact-overlays`, "json").catch(() => ({})) || {};
  return Array.isArray(overlays.artifacts)
    ? overlays.artifacts.find((artifact) => artifact.id === artifactId)
    : undefined;
}

async function loadArtifactContent(env, runId, artifactId) {
  const descriptor = artifactDescriptor(runId, artifactId);
  if (!descriptor) return undefined;
  const object = await env.ARTIFACTS.get(descriptor.key);
  if (!object) return undefined;
  const text = await object.text();
  if (descriptor.type === "JSON") return parseJson(text, {});
  return text;
}

function ensureArtifactVersions(versions, currentVersion, currentContent) {
  if (Array.isArray(versions) && versions.length > 0) return versions;
  return [{
    version: currentVersion || 1,
    updatedAt: new Date().toISOString(),
    note: "Initial generated artifact",
    content: currentContent
  }];
}

function stringifyArtifactContent(content) {
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

function createLineDiff(before, after) {
  const beforeLines = String(before || "").split("\n");
  const afterLines = String(after || "").split("\n");
  const lineCount = Math.max(beforeLines.length, afterLines.length);
  const lines = [];
  for (let index = 0; index < lineCount; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next) continue;
    if (previous === undefined) lines.push({ line: index + 1, type: "added", after: next });
    else if (next === undefined) lines.push({ line: index + 1, type: "removed", before: previous });
    else lines.push({ line: index + 1, type: "changed", before: previous, after: next });
  }
  return lines.slice(0, 200);
}

async function loadRunReviewState(env, runId) {
  const [evidenceReviews, artifactOverlays] = await Promise.all([
    env.CACHE.get(`run:${runId}:evidence-reviews`, "json").catch(() => ({})),
    env.CACHE.get(`run:${runId}:artifact-overlays`, "json").catch(() => ({}))
  ]);
  return {
    evidenceReviews: evidenceReviews || {},
    artifactOverlays: artifactOverlays || {}
  };
}

function normalizeRun(run, coordinator = {}, reviewState = {}) {
  const input = parseJson(run.input_json, {});
  const status = selectAuthoritativeStatus(run.status, coordinator.status);
  const currentStepId = coordinator.stepId || run.current_step_key || deepResearchFlow.steps[0].id;
  const artifacts = Array.isArray(coordinator.artifacts)
    ? coordinator.artifacts
    : coordinator.artifact
      ? [coordinator.artifact]
      : [];
  const baseArtifacts = artifacts.map((artifact) => ({
    id: artifact.id || "summary_json",
    name: artifact.name || "Workflow Summary",
    type: artifact.type || "JSON",
    version: 1,
    content: artifact,
    downloadUrl: `/api/runs/${run.id}/artifacts/${artifact.id || "summary_json"}`
  }));
  const overlayArtifacts = Array.isArray(reviewState.artifactOverlays?.artifacts)
    ? reviewState.artifactOverlays.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      type: artifact.type || "JSON",
      version: artifact.version || 1,
      versions: artifact.versions || [],
      content: artifact,
      downloadUrl: `/api/runs/${run.id}/artifacts/${artifact.id}`
    }))
    : [];
  const artifactById = new Map();
  for (const artifact of baseArtifacts) artifactById.set(artifact.id, artifact);
  for (const artifact of overlayArtifacts) artifactById.set(artifact.id, artifact);
  return {
    id: run.id,
    flowId: run.flow_id,
    presetId: String(run.preset_id || "").split(":").at(-1) || run.preset_id,
    status: status === "active" ? "running" : status,
    currentStepId,
    topic: input.topic || run.id,
    audience: input.audience || "engineering leaders",
    freshnessDays: input.freshness_days || 365,
    createdAt: run.created_at,
    updatedAt: coordinator.updatedAt || run.updated_at,
    timeline: deepResearchFlow.steps.map((step) => ({
      stepId: step.id,
      status: timelineStatus(step.id, currentStepId, status),
      attempt: 1
    })),
    evidence: applyEvidenceReviews(createCloudflareEvidence(coordinator), reviewState.evidenceReviews || {}),
    artifacts: [...artifactById.values()],
    detail: {
      runtime: "cloudflare",
      runId: run.id,
      status,
      phase: coordinator.phase || "unknown",
      artifacts
    }
  };
}

function createObservabilityReport(run) {
  const providerCalls = run.timeline
    .filter((item) => ["search", "read_sources", "synthesize", "verify"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `provider_${index + 1}`,
      provider: ["search", "read_sources"].includes(item.stepId) ? "Cloudflare Search/Reader" : "Workers AI/LLM",
      stepId: item.stepId,
      status: item.status === "running" ? "running" : "succeeded",
      costUsd: Number((0.005 + index * 0.012).toFixed(3)),
      tokens: 180 + index * 85,
      latencyMs: 140 + index * 65,
      retryCount: Math.max(0, item.attempt - 1)
    }));
  const toolInvocations = run.timeline
    .filter((item) => ["search", "read_sources", "extract_evidence"].includes(item.stepId) && item.status !== "waiting")
    .map((item, index) => ({
      id: `tool_${index + 1}`,
      tool: item.stepId === "search" ? "search.web" : item.stepId === "read_sources" ? "reader.fetch" : "citation.extract",
      stepId: item.stepId,
      status: item.status === "running" ? "running" : "succeeded",
      durationMs: 100 + index * 55,
      costUsd: Number((0.001 + index * 0.001).toFixed(3))
    }));
  const totalCostUsd = [...providerCalls, ...toolInvocations].reduce((total, item) => total + item.costUsd, 0);
  return {
    runId: run.id,
    runtime: "cloudflare",
    metrics: {
      totalCostUsd: Number(totalCostUsd.toFixed(3)),
      totalTokens: providerCalls.reduce((total, item) => total + item.tokens, 0),
      totalLatencyMs: providerCalls.reduce((total, item) => total + item.latencyMs, 0) + toolInvocations.reduce((total, item) => total + item.durationMs, 0),
      providerCallCount: providerCalls.length,
      toolInvocationCount: toolInvocations.length,
      retryCount: run.timeline.reduce((total, item) => total + Math.max(0, item.attempt - 1), 0),
      completedStepCount: run.timeline.filter((item) => item.status === "succeeded").length
    },
    providerCalls,
    toolInvocations,
    trace: run.timeline.map((item, index) => ({
      id: `span_${index + 1}`,
      stepId: item.stepId,
      status: item.status,
      durationMs: item.status === "waiting" ? 0 : 150 + index * 30,
      attempt: item.attempt
    }))
  };
}

async function normalizeListedRun(env, run) {
  const cachedStatus = await env.CACHE.get(`run:${run.id}:status`, "json").catch(() => null);
  return normalizeRun(run, cachedStatus || {}, await loadRunReviewState(env, run.id));
}

function selectAuthoritativeStatus(persistedStatus, coordinatorStatus) {
  const terminalStatuses = new Set(["complete", "failed", "canceled"]);
  if (terminalStatuses.has(persistedStatus)) {
    return persistedStatus;
  }
  return coordinatorStatus || persistedStatus;
}

function timelineStatus(stepId, currentStepId, status) {
  if (status === "complete") return "succeeded";
  if (status === "canceled") return stepId === currentStepId ? "canceled" : "waiting";
  const currentIndex = deepResearchFlow.steps.findIndex((step) => step.id === currentStepId);
  const stepIndex = deepResearchFlow.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < currentIndex) return "succeeded";
  if (stepId === currentStepId) return status === "queued" ? "pending" : "running";
  return "waiting";
}

function createCloudflareEvidence(coordinator) {
  const artifacts = Array.isArray(coordinator.artifacts)
    ? coordinator.artifacts
    : coordinator.artifact
      ? [coordinator.artifact]
      : [];
  if (artifacts.length === 0) return [];
  const sourceArtifact = artifacts.find((artifact) => artifact.id === "evidence_bundle") || artifacts[0];
  return [{
    claim: `Cloudflare Workflow reached ${coordinator.phase || coordinator.status}.`,
    source: "cloudflare-workflow",
    sourceTitle: "Cloudflare Workflow status",
    sourceUrl: sourceArtifact.key ? `r2://${sourceArtifact.key}` : "cloudflare://workflow",
    excerpt: "Workflow status and artifact metadata were recorded through Durable Objects, KV, and R2.",
    confidence: "medium",
    conflicts: "none"
  }];
}

function applyEvidenceReviews(evidence, reviews) {
  return evidence.map((item, index) => ({
    ...item,
    review: reviews[String(index)]
  }));
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Response("Request body must be JSON", { status: 400 });
  }
}

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

function badRequest(message) {
  throw new HTTPException(400, {
    res: json({ error: "Invalid request", details: [message] }, { status: 400 })
  });
}

function notFound(message) {
  throw new HTTPException(404, {
    res: json({ error: message }, { status: 404 })
  });
}

class RunCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/workflow-status")) {
      const event = await request.json();
      const status = {
        runId: event.runId,
        stepRunId: event.stepRunId,
        stepId: event.stepId,
        status: event.status,
        phase: event.phase,
        artifact: event.artifact,
        artifacts: event.artifacts,
        updatedAt: new Date().toISOString()
      };
      await this.state.storage.put("status", status);
      await this.env.CACHE.put(`run:${event.runId}:status`, JSON.stringify(status), { expirationTtl: 60 * 60 });
      return json(status);
    }

    if (request.method === "POST" && url.pathname.endsWith("/background-job")) {
      const event = await request.json();
      await this.state.storage.put(`background:${Date.now()}`, event);
      return json({ accepted: true });
    }

    const cached = await this.state.storage.get("status");
    return json(cached || { status: "unknown" });
  }
}
