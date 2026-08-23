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
  createProviderReadinessChecks,
  fetchProviderModelIds,
  getProviderCatalogEntry
} from "../../../packages/runtime/src/provider-catalog.js";
import {
  loadProxyModelMapping,
  getMappedProviders,
  getModelList
} from "../../../packages/runtime/src/proxy-model-mapping.js";
import {
  normalizeChatCompletionRequest,
  normalizeChatCompletionResponse,
  normalizeStreamChunk,
  normalizeModelList,
  SupportedProvider
} from "../../../packages/runtime/src/proxy-normalization.js";
import { DeepResearchWorkflow } from "./workflow.js";
import { WorkerApiGatewayStore } from "../../../packages/cloudflare/src/api-gateway-store.js";
import {
  attributeRunUsage,
  authorizeRequest,
  generateApiKey,
  monthlyWindowKey,
  normalizeAllowedFlows,
  normalizeBudget,
  normalizeRateLimit,
  normalizeScopes,
  toPublicClient
} from "../../../packages/runtime/src/api-gateway.js";
export { DeepResearchWorkflow, RunCoordinator };

const app = new Hono();
const MANAGEMENT_CONFIG_DB_KEY = "management";

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

app.get("/api/flows", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  return c.json({ flows: await repository.listFlows() });
});

app.post("/api/flows", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.createFlowDraft(await c.req.json());
  return c.json(result.flow ? result : { error: result.error }, result.status);
});

app.get("/api/flows/:flowId", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const flow = await repository.getFlowDetail(c.req.param("flowId"));
  if (!flow) return c.json({ error: "Flow not found" }, 404);
  return c.json({ flow });
});

app.patch("/api/flows/:flowId", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.updateFlowDraft(c.req.param("flowId"), await c.req.json());
  return c.json(result.flow ? result : { error: result.error, details: result.details }, result.status);
});

app.delete("/api/flows/:flowId", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.deleteOrArchiveFlow(c.req.param("flowId"));
  return c.json(result.flow || result.deleted ? result : { error: result.error }, result.status);
});

app.post("/api/flows/:flowId/clone", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.cloneFlowDraft(c.req.param("flowId"), await c.req.json().catch(() => ({})));
  return c.json(result.flow ? result : { error: result.error, details: result.details }, result.status);
});

app.post("/api/flows/:flowId/versions", async (c) => {
  requireCloudflareBindings(c.env);
  const repository = new D1AgentRepository(c.env.DB);
  const result = await repository.publishFlowDraft(c.req.param("flowId"));
  return c.json(result.flow ? result : { error: result.error, details: result.details }, result.status);
});

app.post("/api/flows/:flowId/runs", async (c) => {
  requireCloudflareBindings(c.env);
  const body = await c.req.json();
  const result = await createCloudflareRun({ env: c.env, flowId: c.req.param("flowId"), body });
  if (result.error) return c.json(result, result.status);
  c.executionCtx.waitUntil(c.env.RUN_QUEUE.send({
    type: "run.created",
    runId: result.run.id,
    stepRunId: result.stepRun.id,
    stepId: result.stepRun.stepId
  }));
  return c.json(result, 202);
});

app.get("/api/readiness", async (c) => c.json(await createReadinessReport(c.env)));

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

app.get("/api/providers", async (c) => {
  requireCloudflareBindings(c.env);
  const config = await loadManagementConfig(c.env);
  return c.json({ providers: createPublicManagementConfig(config, c.env).providers });
});

app.get("/api/policies", async (c) => {
  requireCloudflareBindings(c.env);
  const config = await loadManagementConfig(c.env);
  return c.json({ policies: config.policies || [] });
});

app.post("/api/policies", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await createManagedPolicy(c.env, await c.req.json());
  return c.json(result.policy ? result : { error: result.error }, result.status);
});

app.patch("/api/policies/:policyId", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await updateManagedPolicy(c.env, c.req.param("policyId"), await c.req.json());
  return c.json(result.policy ? result : { error: result.error }, result.status);
});

app.delete("/api/policies/:policyId", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await archiveManagedPolicy(c.env, c.req.param("policyId"));
  return c.json(result.policy ? result : { error: result.error }, result.status);
});

app.post("/api/policies/:policyId/versions", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await publishManagedPolicy(c.env, c.req.param("policyId"));
  return c.json(result.policy ? result : { error: result.error }, result.status);
});

app.post("/api/policies/:policyId/apply", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await applyManagedPolicy(c.env, c.req.param("policyId"));
  return c.json(result.policy ? result : { error: result.error }, result.status);
});

app.post("/api/improvements", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await createImprovementProposal(c.env, await c.req.json());
  return c.json({ proposal: result.proposal, proposals: result.proposals }, 201);
});

app.post("/api/providers", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await createManagedProvider(c.env, await c.req.json());
  return c.json(result.provider ? result : { error: result.error }, result.status);
});

app.patch("/api/providers/:providerId", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await updateManagedProvider(c.env, c.req.param("providerId"), await c.req.json());
  return c.json(result.provider ? result : { error: result.error }, result.status);
});

app.delete("/api/providers/:providerId", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await updateManagedProvider(c.env, c.req.param("providerId"), { enabled: false });
  return c.json(result.provider ? result : { error: result.error }, result.status);
});

app.post("/api/skills", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await createManagedSkill(c.env, await c.req.json()), 201);
});

app.patch("/api/skills/:skillId", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await updateManagedSkill(c.env, c.req.param("skillId"), await c.req.json()));
});

app.delete("/api/skills/:skillId", async (c) => {
  requireCloudflareBindings(c.env);
  return c.json(await updateManagedSkill(c.env, c.req.param("skillId"), { enabled: false }));
});

app.post("/api/skills/:skillId/evals", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await runManagedSkillEval(c.env, c.req.param("skillId"));
  return c.json(result.eval ? result : { error: result.error }, result.status);
});

app.post("/api/providers/:providerId/test", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await testProvider(c.env, c.req.param("providerId"));
  return c.json(result, result.status);
});

app.post("/api/providers/:providerId/models/sync", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await syncProviderModels(c.env, c.req.param("providerId"));
  return c.json(result.provider ? result : { error: result.error }, result.status);
});

app.post("/api/providers/:providerId/credential", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await updateProviderCredential(c.env, c.req.param("providerId"), await c.req.json().catch(() => ({})));
  return c.json(result.credential ? result : { error: result.error }, result.status);
});

app.delete("/api/providers/:providerId/credential", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await deleteProviderCredential(c.env, c.req.param("providerId"));
  return c.json(result.credential ? result : { error: result.error }, result.status);
});

app.post("/api/providers/:providerId/models/test", async (c) => {
  requireCloudflareBindings(c.env);
  const result = await testProviderModel(c.env, c.req.param("providerId"), await c.req.json().catch(() => ({})));
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
  if (!body.flowId || body.flowId === "deep_research") {
    const validation = validateCloudflareRunRequest(body);
    if (validation.errors.length > 0) {
      return c.json({ error: "Invalid request", details: validation.errors }, 400);
    }
  }
  const result = await createCloudflareRun({ env: c.env, flowId: body.flowId || "deep_research", body });
  if (result.error) return c.json(result, result.status);
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

// --- Admin API: external API clients ---

app.get("/api/api-clients", async (c) => {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  const clients = await store.listClients();
  const windowKey = monthlyWindowKey(new Date());
  const withUsage = await Promise.all(clients.map(async (client) => ({
    ...toPublicClient(client),
    usage: await store.getUsage(client.id, windowKey)
  })));
  return c.json({ clients: withUsage });
});

app.post("/api/api-clients", async (c) => {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "";
  if (!name) return c.json({ error: "name is required", code: "invalid_request" }, 422);
  const { plaintext, keyPrefix, keyHash } = await generateApiKey();
  const client = await store.insertClient({
    id: store.newClientId(),
    name,
    keyPrefix,
    keyHash,
    status: "active",
    scopes: normalizeScopes(body.scopes),
    allowedFlows: normalizeAllowedFlows(body.allowedFlows),
    rateLimit: normalizeRateLimit(body.rateLimit),
    budget: normalizeBudget(body.budget)
  });
  return c.json({ client: toPublicClient(client), key: plaintext }, 201);
});

app.patch("/api/api-clients/:clientId", async (c) => {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  const body = await c.req.json().catch(() => ({}));
  const patch = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
  if (body.scopes !== undefined) patch.scopes = normalizeScopes(body.scopes);
  if (body.allowedFlows !== undefined) patch.allowedFlows = normalizeAllowedFlows(body.allowedFlows);
  if (body.rateLimit !== undefined) patch.rateLimit = normalizeRateLimit(body.rateLimit);
  if (body.budget !== undefined) patch.budget = normalizeBudget(body.budget);
  const updated = await store.updateClient(c.req.param("clientId"), patch);
  if (!updated) return c.json({ error: "API client not found", code: "not_found" }, 404);
  return c.json({ client: toPublicClient(updated) });
});

app.post("/api/api-clients/:clientId/revoke", async (c) => {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  const updated = await store.updateClient(c.req.param("clientId"), { status: "revoked" });
  if (!updated) return c.json({ error: "API client not found", code: "not_found" }, 404);
  return c.json({ client: toPublicClient(updated) });
});

app.get("/api/api-clients/:clientId/audit", async (c) => {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  const id = c.req.param("clientId");
  const client = await store.getClientById(id);
  if (!client) return c.json({ error: "API client not found", code: "not_found" }, 404);
  const windowKey = monthlyWindowKey(new Date());
  return c.json({ audit: await store.listAudit(id, 100), usage: await store.getUsage(id, windowKey) });
});

// --- Public API: /v1 ---

app.post("/v1/runs", async (c) => {
  return handlePublicV1(c, "runs:write", async (store, decision) => {
    const body = await c.req.json().catch(() => ({}));
    const flowId = typeof body.flowId === "string" ? body.flowId : "deep_research";
    const presetId = typeof body.presetId === "string" ? body.presetId : "standard";
    let result;
    try {
      result = await createCloudflareRun({ env: c.env, flowId, body: { presetId, inputs: body.inputs || {}, version: body.version } });
    } catch (error) {
      let detail = {};
      try {
        const res = error instanceof Response ? error : (typeof error?.getResponse === "function" ? error.getResponse() : null);
        if (res) detail = await res.clone().json().catch(() => ({}));
      } catch {
        detail = {};
      }
      result = { status: 422, error: detail.error || (error?.message || "Invalid run request"), details: detail.details };
    }
    if (result.error || !result.run) {
      const status = result.status === 404 ? 404 : 422;
      await writeV1Audit(store, decision, "POST", "/v1/runs", undefined, status, 0, 0);
      return jsonV1(c, { error: result.error || "Invalid run request", code: "invalid_request", details: result.details }, status, decision);
    }
    c.executionCtx.waitUntil(c.env.RUN_QUEUE.send({
      type: "run.created",
      runId: result.run.id,
      stepRunId: result.stepRun.id,
      stepId: result.stepRun.stepId
    }));
    // Record run ownership so only the creating client can read it.
    await c.env.CACHE.put(`apiclient:run:${result.run.id}`, decision.client.id, { expirationTtl: 60 * 60 * 24 * 31 });
    await writeV1Audit(store, decision, "POST", "/v1/runs", result.run.id, 200, 0, 0);
    return jsonV1(c, { runId: result.run.id, status: "queued" }, 200, decision);
  }, { flowIdFromBody: true, countsAsRun: true });
});

app.get("/v1/flows", async (c) => {
  return handlePublicV1(c, "flows:read", async (store, decision) => {
    const repository = new D1AgentRepository(c.env.DB);
    const flows = await repository.listFlows();
    const visible = flows
      .filter((flow) => flow && flow.status !== "archived")
      .filter((flow) => decision.client.allowedFlows.length === 0 || decision.client.allowedFlows.includes(flow.id))
      .map((flow) => ({ id: flow.id, name: flow.name, description: flow.description, presets: flow.presets }));
    await writeV1Audit(store, decision, "GET", "/v1/flows", undefined, 200, 0, 0);
    return jsonV1(c, { flows: visible }, 200, decision);
  });
});

app.get("/v1/runs/:runId/artifacts/:artifactId", async (c) => {
  return handlePublicV1(c, "artifacts:read", async (store, decision) => {
    const runId = c.req.param("runId");
    const owned = await requireOwnedRunCloudflare(c, decision, runId);
    if (!owned.ok) {
      await writeV1Audit(store, decision, "GET", c.req.path, runId, owned.status, 0, 0);
      return jsonV1(c, owned.body, owned.status, decision);
    }
    const artifact = (owned.run.artifacts || []).find((item) => item.id === c.req.param("artifactId"));
    if (!artifact) {
      await writeV1Audit(store, decision, "GET", c.req.path, runId, 404, 0, 0);
      return jsonV1(c, { error: "Artifact not found", code: "not_found" }, 404, decision);
    }
    await writeV1Audit(store, decision, "GET", c.req.path, runId, 200, 0, 0);
    return jsonV1(c, { id: artifact.id, name: artifact.name, type: artifact.type, version: artifact.version, content: artifact.content }, 200, decision);
  });
});

app.get("/v1/runs/:runId/artifacts", async (c) => {
  return handlePublicV1(c, "artifacts:read", async (store, decision) => {
    const runId = c.req.param("runId");
    const owned = await requireOwnedRunCloudflare(c, decision, runId);
    if (!owned.ok) {
      await writeV1Audit(store, decision, "GET", c.req.path, runId, owned.status, 0, 0);
      return jsonV1(c, owned.body, owned.status, decision);
    }
    await writeV1Audit(store, decision, "GET", c.req.path, runId, 200, 0, 0);
    return jsonV1(c, { artifacts: (owned.run.artifacts || []).map((artifact) => ({ id: artifact.id, name: artifact.name, type: artifact.type, version: artifact.version })) }, 200, decision);
  });
});

app.get("/v1/runs/:runId/evidence", async (c) => {
  return handlePublicV1(c, "evidence:read", async (store, decision) => {
    const runId = c.req.param("runId");
    const owned = await requireOwnedRunCloudflare(c, decision, runId);
    if (!owned.ok) {
      await writeV1Audit(store, decision, "GET", c.req.path, runId, owned.status, 0, 0);
      return jsonV1(c, owned.body, owned.status, decision);
    }
    await writeV1Audit(store, decision, "GET", c.req.path, runId, 200, 0, 0);
    return jsonV1(c, { evidence: owned.run.evidence || [] }, 200, decision);
  });
});

app.get("/v1/runs/:runId", async (c) => {
  return handlePublicV1(c, "runs:read", async (store, decision) => {
    const runId = c.req.param("runId");
    const owned = await requireOwnedRunCloudflare(c, decision, runId);
    if (!owned.ok) {
      await writeV1Audit(store, decision, "GET", c.req.path, runId, owned.status, 0, 0);
      return jsonV1(c, owned.body, owned.status, decision);
    }
    await writeV1Audit(store, decision, "GET", c.req.path, runId, 200, 0, 0);
    return jsonV1(c, {
      runId: owned.run.id,
      status: owned.run.status,
      currentStepId: owned.run.currentStepId,
      timeline: owned.run.timeline
    }, 200, decision);
  });
});

// --- Proxy API: OpenAI-compatible endpoints ---

app.get("/v1/models", async (c) => {
  return handlePublicV1(c, "proxy:write", async (store, decision) => {
    // Load model mapping
    const mapping = loadProxyModelMapping();
    const modelIds = getModelList(mapping);
    
    const allModels: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
    
    // Add mapped models
    for (const modelId of modelIds) {
      allModels.push({
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "agent-platform"
      });
    }

    // Add provider-specific models from catalog
    try {
      for (const providerId of DEFAULT_ALLOWED_PROVIDER_IDS) {
        const catalogEntry = getProviderCatalogEntry(providerId);
        if (catalogEntry?.models) {
          for (const model of catalogEntry.models) {
            const prefixedId = `${providerId}/${model}`;
            if (!modelIds.includes(prefixedId)) {
              allModels.push({
                id: prefixedId,
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: providerId
              });
            }
          }
        }
      }
    } catch (e) {
      // Catalog unavailable, continue with mapped models
    }

    await writeV1Audit(store, decision, "GET", "/v1/models", undefined, 200, 0, 0);
    return jsonV1(c, normalizeModelList(allModels, "agent-platform"), 200, decision);
  }, { countsAsProxy: true });
});

app.post("/v1/chat/completions", async (c) => {
  return handlePublicV1(c, "proxy:write", async (store, decision) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 400, 0, 0);
      return jsonV1(c, { error: "Invalid JSON body", code: "invalid_request" }, 400, decision);
    }

    // Validate required fields
    const { model, messages, stream, temperature, max_tokens, top_p, stop } = body;
    if (!model || typeof model !== "string") {
      await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 400, 0, 0);
      return jsonV1(c, { error: "Missing required field: model", code: "invalid_request" }, 400, decision);
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 400, 0, 0);
      return jsonV1(c, { error: "Missing required field: messages", code: "invalid_request" }, 400, decision);
    }

    // Check proxy budget
    const budget = decision.client.budget || {};
    if (typeof budget.proxyMaxCostUsd === "number" || typeof budget.proxyMaxTokens === "number") {
      const proxyWindow = budget.proxyWindow === "daily" ? dayBucket(new Date()) : monthlyWindowKey(new Date());
      const usage = await store.getUsage(decision.client.id, `proxy:${proxyWindow}`);
      if (usage.costUsd >= (budget.proxyMaxCostUsd ?? Infinity) || usage.tokens >= (budget.proxyMaxTokens ?? Infinity)) {
        await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 402, 0, 0);
        return jsonV1(c, { error: "Proxy budget exceeded", code: "budget_exceeded" }, 402, decision);
      }
    }

    // Resolve model to providers with fallback chain
    // Support both "model" and "provider/model" formats
    const modelKey = model.includes("/") ? model.split("/").slice(1).join("/") : model;
    const mappedProviders = getMappedProviders(modelKey);
    if (mappedProviders.length === 0) {
      await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 404, 0, 0);
      return jsonV1(c, { error: `Model not found: ${model}`, code: "model_not_found" }, 404, decision);
    }

    // Validate messages structure
    for (const msg of messages) {
      if (!msg.role || !["system", "user", "assistant", "tool"].includes(msg.role)) {
        await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 400, 0, 0);
        return jsonV1(c, { error: "Invalid message role", code: "invalid_request" }, 400, decision);
      }
      if (msg.content !== null && typeof msg.content !== "string" && !Array.isArray(msg.content)) {
        await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 400, 0, 0);
        return jsonV1(c, { error: "Invalid message content", code: "invalid_request" }, 400, decision);
      }
    }
    const isStreaming = stream === true;

    // Load management config and check provider readiness once
    const config = await loadManagementConfig(c.env);
    const readiness = createProviderReadiness(c.env);
    
    // Filter mapped providers to only include ready ones, prioritizing primary over fallback
    const availableProviders = mappedProviders
      .filter(mapped => readiness[mapped.providerId] === true)
      .sort((a, b) => (a.isFallback === b.isFallback ? 0 : a.isFallback ? 1 : -1));
    
    if (availableProviders.length === 0) {
      await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 503, 0, 0);
      return jsonV1(c, { error: "No available providers for model", code: "no_available_providers" }, 503, decision);
    }

    // Try each provider in fallback chain
    let lastError: Error | null = null;
    for (let i = 0; i < availableProviders.length; i++) {
      const mapped = availableProviders[i];
      const providerId = mapped.providerId as SupportedProvider;
      
      try {
        // Normalize request for target provider
        const normalizedRequest = normalizeChatCompletionRequest(body, providerId);
        
        if (isStreaming) {
          const providerStream = await invokeProviderModelStream(c.env, config, providerId, normalizedRequest);
          
          await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 200, 0, 0);
          return new Response(providerStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            }
          });
        } else {
          // Non-streaming response using existing invoke function
          const providerResponse = await invokeProviderModel(c.env, config, providerId, normalizedRequest.model, 
            normalizedRequest.messages.map((m: any) => m.content).join("\n"), 
            normalizedRequest.max_tokens || 4096);
          
          const normalizedResponse = normalizeChatCompletionResponse(
            { 
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, message: { role: "assistant", content: providerResponse }, finish_reason: "stop" }],
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
            }, 
            model, 
            providerId
          );
          await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 200, 0, 0);
          return jsonV1(c, normalizedResponse, 200, decision);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`Provider ${providerId} failed for model ${model}:`, lastError);
        continue;
      }
    }

    // All providers failed
    await writeV1Audit(store, decision, "POST", "/v1/chat/completions", undefined, 502, 0, 0);
    return jsonV1(c, { error: `All providers failed for model: ${model}`, code: "provider_unavailable", detail: lastError?.message }, 502, decision);
  }, { countsAsProxy: true });
});

app.notFound((c) => {
  if (c.req.path.startsWith("/v1/")) return json({ error: "Not found", code: "not_found" }, { status: 404 });
  return c.env.ASSETS.fetch(c.req.raw);
});

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

async function createCloudflareRun({ env, flowId = "deep_research", body }) {
  const repository = new D1AgentRepository(env.DB);
  const flow = await repository.getRunnableFlow(flowId, typeof body.version === "number" ? body.version : undefined);
  if (!flow) return { status: 404, error: "Runnable flow not found" };
  assertValidFlowDefinition(flow);
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
  const inputErrors = validateFlowInputs(flow, inputs);
  if (!flow.presets.some((preset) => preset.id === presetId)) {
    inputErrors.push(`Unknown presetId: ${presetId}`);
  }
  if (inputs.freshness_days <= 0 || !Number.isFinite(inputs.freshness_days)) {
    inputErrors.push("Input freshness_days must be a positive number");
  }
  if (inputErrors.length > 0) {
    return badRequest(`Invalid flow inputs:\n${inputErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  const runId = createId("run");
  const [initialStepId] = findInitialStepIds(flow);
  const stepRunId = createId("step");

  const run = await repository.createRun({ id: runId, flow, presetId, inputs, initialStepId });
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
      flowId: flow.id,
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

async function createReadinessReport(env) {
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
  const config = await loadManagementConfig(env);
  const providerChecks = createProviderReadinessChecks(env).map((check) => {
    const provider = config.providers.find((candidate) => candidate.id === check.id);
    if (!provider) return check;
    const source = providerCredentialSource(config, env, provider);
    return {
      ...check,
      ready: Boolean(check.ready || source),
      detail: source === "config"
        ? `${provider.name} API key is configured in D1 config.`
        : check.detail
    };
  });

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
    config: createPublicManagementConfig(await loadManagementConfig(env), env),
    operationFlow: createOperationFlow(),
    editableSurfaces: [
      { id: "run_inputs", label: "執行輸入", editable: true, detail: "主題、讀者、新鮮度、策略可在執行前調整。" },
      { id: "flow_defaults", label: "流程預設", editable: true, detail: "預設策略、讀者、新鮮度可透過 config CRUD 儲存到 D1。" },
      { id: "providers", label: "Provider 啟用狀態", editable: true, detail: "可調整 Provider 啟用狀態與 credential reference；secret 本身仍透過 Cloudflare 設定。" },
      { id: "policy", label: "政策", editable: true, detail: "可調整成本上限、迭代上限、citation requirement 與允許 provider。" },
      { id: "skills", label: "技能版本", editable: true, detail: "可啟用/停用 skill、切換 active version，並新增草稿 skill 到 D1 管理設定。" },
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
  const stored = await loadManagementConfigFromDb(env);
  return normalizeManagementConfig(stored || {}, env);
}

async function updateManagementConfig(env, body) {
  const current = await loadManagementConfig(env);
  const next = normalizeManagementConfig({ ...current, ...body, providerCredentials: body.providerCredentials ?? current.providerCredentials }, env);
  const errors = validateManagementConfig(next);
  if (errors.length === 0) {
    await saveManagementConfig(env, next);
  }
  return { errors };
}

async function loadManagementConfigFromDb(env) {
  try {
    const row = await env.DB.prepare("SELECT value_json FROM app_config WHERE key = ?")
      .bind(MANAGEMENT_CONFIG_DB_KEY)
      .first();
    return row?.value_json ? JSON.parse(row.value_json) : null;
  } catch (error) {
    if (isMissingAppConfigTable(error)) return null;
    throw error;
  }
}

async function saveManagementConfig(env, config) {
  await env.DB.prepare([
    "INSERT INTO app_config (key, value_json, updated_at)",
    "VALUES (?, ?, CURRENT_TIMESTAMP)",
    "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP"
  ].join(" ")).bind(MANAGEMENT_CONFIG_DB_KEY, JSON.stringify(config)).run();
}

function isMissingAppConfigTable(error) {
  return /no such table: app_config/i.test(String(error?.message || error));
}

function defaultManagementConfig(env) {
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
    providers: createProviderConfigs(env),
    skills: builtInSkills()
  };
}

function normalizeManagementConfig(input, env) {
  const fallback = defaultManagementConfig(env);
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

function createPublicManagementConfig(config, env) {
  return {
    ...config,
    providerCredentials: undefined,
    providers: config.providers.map((provider) => {
      const source = providerCredentialSource(config, env, provider);
      return {
        ...provider,
        credentialConfigured: Boolean(source),
        credentialSource: source || "missing"
      };
    })
  };
}

function normalizeProviderCredentials(input, fallback = {}, providerIds = []) {
  const source = isRecord(input) ? input : fallback || {};
  const byProvider = {};
  for (const [rawProviderId, rawCredential] of Object.entries(source)) {
    const providerId = sanitizeProviderId(rawProviderId);
    if (!providerId || !providerIds.includes(providerId) || !isRecord(rawCredential)) continue;
    const credentialRef = typeof rawCredential.credentialRef === "string"
      ? rawCredential.credentialRef.slice(0, 120)
      : "";
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

function defaultManagedPolicy() {
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

function normalizeManagedPolicies(input, fallback, providerIds) {
  const byId = new Map((fallback || []).map((policy) => [policy.id, policy]));
  if (Array.isArray(input)) {
    for (const policy of input) {
      const normalized = normalizeManagedPolicy(policy, byId.get(policy?.id), providerIds);
      if (normalized) byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()];
}

function normalizeManagedPolicy(input, fallback, providerIds) {
  const id = sanitizePolicyId(input?.id || fallback?.id);
  if (!id) return undefined;
  const draftSource = input?.draft || input || fallback?.draft || {};
  const draft = {
    maxCostUsd: Number(draftSource.maxCostUsd ?? fallback?.draft.maxCostUsd ?? 3),
    maxIterations: Number(draftSource.maxIterations ?? fallback?.draft.maxIterations ?? 4),
    citationRequired: Boolean(draftSource.citationRequired ?? fallback?.draft.citationRequired ?? true),
    allowedProviders: Array.isArray(draftSource.allowedProviders)
      ? draftSource.allowedProviders.filter((providerId) => providerIds.includes(providerId))
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

async function createManagedPolicy(env, body) {
  const config = await loadManagementConfig(env);
  const policy = normalizeManagedPolicy({ ...body, status: "draft", version: 0 }, undefined, config.providers.map((provider) => provider.id));
  if (!policy) return { status: 400, error: "Policy id is required" };
  if (config.policies.some((candidate) => candidate.id === policy.id)) return { status: 409, error: "Policy already exists" };
  const next = normalizeManagementConfig({ ...config, policies: [...config.policies, policy] }, env);
  await saveManagementConfig(env, next);
  return { status: 201, policy, policies: next.policies };
}

async function updateManagedPolicy(env, policyId, body) {
  const config = await loadManagementConfig(env);
  const id = sanitizePolicyId(policyId);
  const existing = config.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const policy = normalizeManagedPolicy({ ...existing, ...body, id, status: "draft" }, existing, config.providers.map((provider) => provider.id));
  if (!policy) return { status: 400, error: "Invalid policy request" };
  const next = normalizeManagementConfig({ ...config, policies: config.policies.map((candidate) => candidate.id === id ? policy : candidate) }, env);
  await saveManagementConfig(env, next);
  return { status: 200, policy, policies: next.policies };
}

async function publishManagedPolicy(env, policyId) {
  const config = await loadManagementConfig(env);
  const id = sanitizePolicyId(policyId);
  const existing = config.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const version = existing.version + 1;
  const policy = {
    ...existing,
    status: "published",
    version,
    versions: [...existing.versions, { version, publishedAt: new Date().toISOString(), config: existing.draft }]
  };
  const next = normalizeManagementConfig({ ...config, policies: config.policies.map((candidate) => candidate.id === id ? policy : candidate) }, env);
  await saveManagementConfig(env, next);
  return { status: 201, policy, version };
}

async function applyManagedPolicy(env, policyId) {
  const config = await loadManagementConfig(env);
  const id = sanitizePolicyId(policyId);
  const policy = config.policies.find((candidate) => candidate.id === id && candidate.status !== "archived");
  if (!policy) return { status: 404, error: "Policy not found" };
  const next = normalizeManagementConfig({ ...config, flow: { ...config.flow, policyRef: id }, policy: policy.draft }, env);
  await saveManagementConfig(env, next);
  return { status: 200, policy, config: next };
}

async function archiveManagedPolicy(env, policyId) {
  const config = await loadManagementConfig(env);
  const id = sanitizePolicyId(policyId);
  const existing = config.policies.find((policy) => policy.id === id);
  if (!existing) return { status: 404, error: "Policy not found" };
  const policy = { ...existing, status: "archived" };
  const next = normalizeManagementConfig({ ...config, policies: config.policies.map((candidate) => candidate.id === id ? policy : candidate) }, env);
  await saveManagementConfig(env, next);
  return { status: 200, policy, policies: next.policies };
}

function sanitizePolicyId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function normalizeImprovementProposals(input) {
  if (!Array.isArray(input)) return [];
  return input.map((proposal) => normalizeImprovementProposal(proposal)).filter(Boolean);
}

function normalizeImprovementProposal(input) {
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

async function createImprovementProposal(env, body) {
  const config = await loadManagementConfig(env);
  const sourceRunId = typeof body.sourceRunId === "string" ? body.sourceRunId : undefined;
  let sourceRun;
  if (sourceRunId) {
    const repository = new D1AgentRepository(env.DB);
    sourceRun = await repository.getRun(sourceRunId);
  }
  const proposal = normalizeImprovementProposal({
    id: `improvement_${Date.now().toString(36)}`,
    type: body.type || "eval-case",
    sourceRunId,
    summary: typeof body.summary === "string" ? body.summary : sourceRun ? `Create eval case from ${sourceRun.topic || sourceRun.id}` : "Create eval case from operator feedback.",
    evalCase: {
      id: `eval_case_${Date.now().toString(36)}`,
      sourceRunId,
      input: sourceRun ? { topic: sourceRun.topic, presetId: sourceRun.preset_id } : isRecord(body.input) ? body.input : {},
      expected: isRecord(body.expected) ? body.expected : { status: "review-required" }
    },
    createdAt: new Date().toISOString()
  });
  const next = normalizeManagementConfig({
    ...config,
    improvementProposals: [proposal, ...config.improvementProposals].slice(0, 50)
  }, env);
  await saveManagementConfig(env, next);
  return { status: 201, proposal, proposals: next.improvementProposals };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeManagedProvider(input, fallback) {
  const id = sanitizeProviderId(input?.id || fallback?.id);
  if (!id) return undefined;
  const models = Array.isArray(input?.models) && input.models.length > 0
    ? input.models.map(String).filter(Boolean).slice(0, 200)
    : fallback?.models || [typeof input?.activeModel === "string" ? input.activeModel : "default"];
  const activeModel = typeof input?.activeModel === "string" ? input.activeModel.slice(0, 160) : fallback?.activeModel || models[0];
  return {
    id,
    name: typeof input?.name === "string" ? input.name.slice(0, 80) : fallback?.name || id,
    type: typeof input?.type === "string" ? input.type.slice(0, 40) : fallback?.type || "llm",
    enabled: Boolean(input?.enabled ?? fallback?.enabled ?? false),
    credentialRef: typeof input?.credentialRef === "string" ? input.credentialRef.slice(0, 120) : fallback?.credentialRef || `${id.toUpperCase()}_API_KEY`,
    models: models.includes(activeModel) ? models : [activeModel, ...models],
    activeModel
  };
}

async function syncProviderModels(env, providerId) {
  const config = await loadManagementConfig(env);
  const id = sanitizeProviderId(providerId);
  const existing = config.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const catalogEntry = getProviderCatalogEntry(id);
  if (!catalogEntry) return { status: 404, error: "No sync catalog is available for this provider" };

  const before = new Set(existing.models);
  let liveModels = [];
  try {
    liveModels = await fetchProviderModelIds(
      id,
      (secretName, provider) => env[secretName] || providerSecret(env, config, provider || id) || "",
      {
        cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
        cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
        ollamaBaseUrl: env.OLLAMA_API_BASE || env.OLLAMA_HOST || env.OLLAMA_URL
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
  }, existing);
  const next = normalizeManagementConfig({
    ...config,
    providers: config.providers.map((candidate) => candidate.id === id ? provider : candidate)
  }, env);
  await saveManagementConfig(env, next);
  return {
    status: 200,
    provider: createPublicProvider(next, env, provider.id),
    added: models.filter((model) => !before.has(model)).length,
    existing: models.filter((model) => before.has(model)).length,
    total: models.length,
    source: liveModels.length > 0 ? "provider-api" : "catalog"
  };
}

async function updateProviderCredential(env, providerId, body) {
  const config = await loadManagementConfig(env);
  const id = sanitizeProviderId(providerId);
  const existing = config.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const secretRefs = extractCredentialRefs(existing);
  const requestedRef = typeof body.credentialRef === "string" ? body.credentialRef.trim().slice(0, 120) : "";
  const credentialRef = requestedRef || secretRefs[0] || existing.credentialRef;
  const value = typeof body.value === "string" ? body.value.trim() : "";
  if (!credentialRef) return { status: 400, error: "credentialRef is required" };
  if (!value) return { status: 400, error: "API key value is required" };
  const next = normalizeManagementConfig({
    ...config,
    providerCredentials: {
      ...(config.providerCredentials || {}),
      [id]: {
        credentialRef,
        value,
        updatedAt: new Date().toISOString()
      }
    }
  }, env);
  await saveManagementConfig(env, next);
  return {
    status: 200,
    provider: createPublicProvider(next, env, id),
    credential: {
      providerId: id,
      credentialRef,
      configured: true
    }
  };
}

async function deleteProviderCredential(env, providerId) {
  const config = await loadManagementConfig(env);
  const id = sanitizeProviderId(providerId);
  if (!config.providers.some((provider) => provider.id === id)) return { status: 404, error: "Provider not found" };
  const providerCredentials = { ...(config.providerCredentials || {}) };
  delete providerCredentials[id];
  const next = normalizeManagementConfig({ ...config, providerCredentials }, env);
  await saveManagementConfig(env, next);
  return {
    status: 200,
    provider: createPublicProvider(next, env, id),
    credential: {
      providerId: id,
      configured: false
    }
  };
}

function createPublicProvider(config, env, providerId) {
  return createPublicManagementConfig(config, env).providers.find((provider) => provider.id === providerId);
}

async function createManagedProvider(env, body) {
  const config = await loadManagementConfig(env);
  const provider = normalizeManagedProvider({ ...body, enabled: body.enabled ?? false });
  if (!provider) return { status: 400, error: "Provider id is required" };
  if (config.providers.some((candidate) => candidate.id === provider.id)) {
    return { status: 409, error: "Provider already exists" };
  }
  const next = normalizeManagementConfig({ ...config, providers: [...config.providers, provider] }, env);
  await saveManagementConfig(env, next);
  return { status: 201, provider: createPublicProvider(next, env, provider.id), providers: createPublicManagementConfig(next, env).providers };
}

async function updateManagedProvider(env, providerId, body) {
  const config = await loadManagementConfig(env);
  const id = sanitizeProviderId(providerId);
  const existing = config.providers.find((provider) => provider.id === id);
  if (!existing) return { status: 404, error: "Provider not found" };
  const provider = normalizeManagedProvider({ ...existing, ...body, id }, existing);
  if (!provider) return { status: 400, error: "Invalid provider request" };
  const next = normalizeManagementConfig({
    ...config,
    providers: config.providers.map((candidate) => candidate.id === id ? provider : candidate)
  }, env);
  await saveManagementConfig(env, next);
  return { status: 200, provider: createPublicProvider(next, env, provider.id), providers: createPublicManagementConfig(next, env).providers };
}

function sanitizeProviderId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function extractCredentialRefs(provider) {
  return String(provider?.credentialRef || "")
    .split(/\s+or\s+| 或 |,\s*/)
    .map((item) => item.trim())
    .filter((item) => /^[A-Z0-9_]+$/.test(item));
}

function providerCredentialSource(config, env, provider) {
  if (provider.id === "workers_ai" && env.AI) return "binding";
  const stored = config.providerCredentials?.[provider.id];
  if (stored?.value) return "config";
  return extractCredentialRefs(provider).some((key) => Boolean(env[key])) ? "env" : "";
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
  await saveManagementConfig(env, normalizeManagementConfig({
    ...config,
    skills: [...config.skills, skill]
  }, env));
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
  await saveManagementConfig(env, normalizeManagementConfig({
    ...config,
    skills: config.skills.map((skill) => skill.id === id ? next : skill)
  }, env));
  return { skill: next, skills: (await loadManagementConfig(env)).skills };
}

async function runManagedSkillEval(env, skillId) {
  const config = await loadManagementConfig(env);
  const id = sanitizeSkillId(skillId);
  const skill = config.skills.find((candidate) => candidate.id === id);
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
  const credentialSource = providerCredentialSource(config, env, provider);
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

async function testProviderModel(env, id, body) {
  const config = await loadManagementConfig(env);
  const provider = config.providers.find((candidate) => candidate.id === sanitizeProviderId(id));
  if (!provider) return { status: 404, error: "Provider not found" };
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : provider.activeModel;
  if (!model) return { status: 400, error: "Model is required" };

  const base = await testProvider(env, provider.id);
  if (!base.ready) return { ...base, status: 412, model, error: base.detail };

  const prompt = typeof body.prompt === "string" && body.prompt.trim()
    ? body.prompt.trim().slice(0, 1000)
    : "Reply in one short sentence confirming this model connection works.";
  const maxTokens = Number.isFinite(Number(body.maxTokens))
    ? Math.min(Math.max(Math.round(Number(body.maxTokens)), 16), 512)
    : 96;
  const started = Date.now();

  try {
    const content = await invokeProviderModel(env, config, provider.id, model, prompt, maxTokens);
    return {
      status: 200,
      ok: true,
      provider: provider.id,
      model,
      durationMs: Date.now() - started,
      content
    };
  } catch (error) {
    return {
      status: 502,
      ok: false,
      provider: provider.id,
      model,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function invokeProviderModel(env, config, providerId, model, prompt, maxTokens) {
  if (providerId === "workers_ai") {
    const response = await env.AI.run(model, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens
    });
    return extractModelText(response);
  }

  if (["openai", "groq", "openrouter", "nvidia", "cerebras", "ollama_cloud", "ollama"].includes(providerId)) {
    const apiKey = providerSecret(env, config, providerId);
    const baseUrl = openAiCompatibleBaseUrl(env, providerId);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.message || response.statusText);
    return extractModelText(payload);
  }

  if (providerId === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": providerSecret(env, config, providerId)
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.message || response.statusText);
    return extractModelText(payload);
  }

  if (providerId === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(providerSecret(env, config, providerId))}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || payload.message || response.statusText);
    return extractModelText(payload);
  }

  return `${providerId} is configured for ${model}. Live invocation is not implemented for this provider type.`;
}

async function invokeProviderModelStream(
  env: any,
  config: any,
  providerId: string,
  request: any
): Promise<ReadableStream> {
  const apiKey = providerSecret(env, config, providerId);

  // OpenAI-compatible providers (OpenAI, Groq, OpenRouter, NVIDIA, Cerebras, Ollama Cloud, Ollama, OpenCode Zen)
  const openaiCompatibleProviders = [
    "openai", "groq", "openrouter", "nvidia", "cerebras", 
    "ollama_cloud", "ollama", "opencode-zen"
  ];
  
  if (openaiCompatibleProviders.includes(providerId)) {
    const baseUrl = openAiCompatibleBaseUrl(env, providerId);
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "accept": "text/event-stream"
      },
      body: JSON.stringify({ ...request, stream: true })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || payload.message || response.statusText);
    }
    
    // Convert provider streaming format to OpenAI SSE format
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  continue;
                }
                try {
                  const chunk = JSON.parse(data);
                  const normalizedChunk = normalizeStreamChunk(chunk, request.model, providerId);
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(normalizedChunk)}\n\n`));
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    
    return readable;
  }

  if (providerId === "anthropic") {
    const systemMessage = request.messages.find((m: any) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m: any) => m.role !== "system");
    
    const anthropicRequest = {
      model: request.model,
      max_tokens: request.max_tokens || 4096,
      messages: nonSystemMessages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: Array.isArray(m.content) 
          ? m.content.map((c: any) => c.type === "text" ? { type: "text", text: c.text } : c) 
          : [{ type: "text", text: String(m.content ?? "") }]
      })),
      stream: true,
      temperature: request.temperature,
      top_p: request.top_p,
      stop_sequences: request.stop ? (Array.isArray(request.stop) ? request.stop : [request.stop]) : undefined
    };
    
    if (systemMessage) {
      anthropicRequest.system = Array.isArray(systemMessage.content) 
        ? systemMessage.content.map((c: any) => c.type === "text" ? c.text : "").join("\n")
        : String(systemMessage.content ?? "");
    }
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": providerSecret(env, config, providerId),
        "accept": "text/event-stream"
      },
      body: JSON.stringify(anthropicRequest)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || payload.message || response.statusText);
    }
    
    // Convert Anthropic streaming format to OpenAI SSE format
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            
            for (const line of lines) {
              if (line.startsWith("event: ")) {
                const eventType = line.slice(7).trim();
                // Store event type for next data line
                (controller as any)._anthropicEventType = eventType;
              } else if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                  continue;
                }
                try {
                  const chunk = JSON.parse(data);
                  const eventType = (controller as any)._anthropicEventType || "content_block_delta";
                  delete (controller as any)._anthropicEventType;
                  
                  // Convert Anthropic streaming format to OpenAI SSE format
                  let normalizedChunk: any;
                  if (eventType === "content_block_delta" && chunk.delta?.text) {
                    normalizedChunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: request.model,
                      choices: [{
                        index: 0,
                        delta: { content: chunk.delta.text },
                        finish_reason: null
                      }]
                    };
                  } else if (eventType === "message_stop") {
                    normalizedChunk = {
                      id: `chatcmpl-${Date.now()}`,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: request.model,
                      choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: "stop"
                      }]
                    };
                  } else {
                    continue; // Skip other event types
                  }
                  
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(normalizedChunk)}\n\n`));
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    
    return readable;
  }

  if (providerId === "gemini") {
    const contents = request.messages.map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: Array.isArray(m.content) 
        ? m.content.map((c: any) => c.type === "text" ? { text: c.text } : c) 
        : [{ text: String(m.content ?? "") }]
    }));
    
    const generationConfig: Record<string, any> = {};
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
    if (request.top_p !== undefined) generationConfig.topP = request.top_p;
    if (request.stop !== undefined) generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];
    
    const geminiRequest = {
      contents,
      generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined
    };
    
    const apiKey = providerSecret(env, config, providerId);
    const modelName = request.model.startsWith("models/") ? request.model : `models/${request.model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelName}:streamGenerateContent?key=${encodeURIComponent(apiKey)}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(geminiRequest)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || payload.message || response.statusText);
    }
    
    // Convert Google's streaming format to OpenAI SSE format
    // Note: Google returns raw JSON objects, not SSE format
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              
              // Google returns raw JSON objects (not SSE format)
              // They can be either complete objects or partial chunks
              try {
                const chunk = JSON.parse(trimmed);
                const normalizedChunk = normalizeStreamChunk(chunk, request.model, providerId);
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(normalizedChunk)}\n\n`));
              } catch {
                // Skip invalid JSON
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
        
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    
    return readable;
  }

  if (providerId === "workers_ai") {
    const response = await env.AI.run(request.model, {
      messages: request.messages,
      max_tokens: request.max_tokens,
      stream: true,
      temperature: request.temperature,
      top_p: request.top_p
    });
    return response as ReadableStream;
  }

  throw new Error(`Streaming not implemented for provider: ${providerId}`);
}

function providerSecret(env, config, providerId) {
  const stored = config.providerCredentials?.[providerId]?.value;
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
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
  }[providerId] || [];
  return keys.map((key) => env[key]).find(Boolean) || "";
}

function openAiCompatibleBaseUrl(env, providerId) {
  if (providerId === "openai") return "https://api.openai.com/v1";
  if (providerId === "groq") return "https://api.groq.com/openai/v1";
  if (providerId === "openrouter") return "https://openrouter.ai/api/v1";
  if (providerId === "nvidia") return "https://integrate.api.nvidia.com/v1";
  if (providerId === "cerebras") return "https://api.cerebras.ai/v1";
  if (providerId === "ollama_cloud") return "https://ollama.com/v1";
  const base = env.OLLAMA_API_BASE || env.OLLAMA_HOST || env.OLLAMA_URL || "http://localhost:11434";
  return String(base).replace(/\/api\/?$/, "").replace(/\/v1\/?$/, "") + "/v1";
}

function extractModelText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.response === "string") return payload.response;
  if (typeof payload?.content === "string") return payload.content;
  if (Array.isArray(payload?.content)) return payload.content.map((part) => part.text || "").filter(Boolean).join("\n");
  if (typeof payload?.choices?.[0]?.message?.content === "string") return payload.choices[0].message.content;
  const geminiText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").filter(Boolean).join("\n");
  if (geminiText) return geminiText;
  return JSON.stringify(payload);
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
  const sources = [
    {
      artifact: artifacts.find((artifact) => artifact.id === "evidence_bundle") || artifacts[0],
      claim: `Cloudflare Workflow reached ${coordinator.phase || coordinator.status}.`,
      source: "cloudflare-workflow",
      sourceTitle: "Cloudflare Workflow status",
      excerpt: "Workflow status and artifact metadata were recorded through Durable Objects, KV, and R2.",
      confidence: "medium"
    },
    {
      artifact: artifacts.find((artifact) => artifact.id === "markdown_report") || artifacts[0],
      claim: "The run produced an evidence-backed Markdown report artifact.",
      source: "cloudflare-artifacts",
      sourceTitle: "Markdown report artifact",
      excerpt: "Report artifact generation is recorded in R2 and linked back to the completed run.",
      confidence: "medium"
    },
    {
      artifact: artifacts.find((artifact) => artifact.id === "summary_json") || artifacts[0],
      claim: "The run captured structured summary metadata for inspection and export.",
      source: "cloudflare-summary",
      sourceTitle: "Workflow summary artifact",
      excerpt: "Summary metadata preserves run identifiers, planned steps, and artifact references for review.",
      confidence: "medium"
    }
  ];
  return sources.map((source) => ({
    claim: source.claim,
    source: source.source,
    sourceTitle: source.sourceTitle,
    sourceUrl: source.artifact?.key ? `r2://${source.artifact.key}` : "cloudflare://workflow",
    excerpt: source.excerpt,
    confidence: source.confidence,
    conflicts: "none"
  }));
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

// --- Public /v1 gateway helpers ---

async function handlePublicV1(c, requiredScope, handler, options = {}) {
  requireCloudflareBindings(c.env);
  const store = new WorkerApiGatewayStore(c.env);
  let flowId;
  if (options.flowIdFromBody) {
    const cloned = c.req.raw.clone();
    const body = await cloned.json().catch(() => ({}));
    flowId = typeof body.flowId === "string" ? body.flowId : "deep_research";
  }
  const decision = await authorizeRequest(store, {
    method: c.req.method,
    path: c.req.path,
    authorization: c.req.header("authorization"),
    requiredScope,
    flowId,
    countsAsRun: options.countsAsRun
  });
  if (!decision.allowed) {
    await writeV1Audit(store, decision, c.req.method, c.req.path, undefined, decision.statusCode, 0, 0);
    return jsonV1(c, { error: decision.error, code: decision.code }, decision.statusCode, decision);
  }
  await store.touchClient(decision.client.id, new Date().toISOString());
  return handler(store, decision);
}

function jsonV1(c, payload, status, decision) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (decision?.headers) {
    for (const [key, value] of Object.entries(decision.headers)) {
      if (value !== undefined) headers[key] = value;
    }
  }
  return new Response(JSON.stringify(payload, null, 2), { status, headers });
}

async function writeV1Audit(store, decision, method, path, runId, statusCode, costUsd, tokens) {
  const clientId = decision.client ? decision.client.id : undefined;
  await store.recordAudit({
    id: store.newAuditId(),
    clientId,
    ts: new Date().toISOString(),
    method,
    path,
    runId,
    statusCode,
    outcome: decision.allowed ? "allow" : `deny:${decision.reason}`,
    costUsd: costUsd || 0,
    tokens: tokens || 0
  });
}

async function requireOwnedRunCloudflare(c, decision, runId) {
  const owner = await c.env.CACHE.get(`apiclient:run:${runId}`).catch(() => null);
  if (!owner || owner !== decision.client.id) {
    return { ok: false, status: 404, body: { error: "Run not found", code: "not_found" } };
  }
  let result;
  try {
    result = await getCloudflareRun(c.env, runId, c.req.raw);
  } catch {
    return { ok: false, status: 404, body: { error: "Run not found", code: "not_found" } };
  }
  const run = result.run;
  // Attribute settled usage to the owning client once the run completes.
  if (run && run.status === "complete") {
    const attributedKey = `apiclient:run:${runId}:attributed`;
    const already = await c.env.CACHE.get(attributedKey).catch(() => null);
    if (!already) {
      const metrics = createObservabilityReport(run).metrics;
      await attributeRunUsage(new WorkerApiGatewayStore(c.env), decision.client.id, {
        costUsd: metrics.totalCostUsd,
        tokens: metrics.totalTokens,
        runs: 0
      });
      await c.env.CACHE.put(attributedKey, "1", { expirationTtl: 60 * 60 * 24 * 31 });
    }
  }
  return { ok: true, status: 200, run };
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
