// @ts-nocheck
import { deepResearchFlow } from "../../core/src/deep-research-flow.js";
import { validateFlowDefinition } from "../../core/src/flow.js";

export class D1AgentRepository {
  constructor(db) {
    if (!db) throw new Error("D1 binding is required");
    this.db = db;
  }

  async seedBuiltInFlows() {
    await this.db.prepare(
      "INSERT OR IGNORE INTO flows (id, name, description, status) VALUES (?, ?, ?, ?)"
    ).bind(deepResearchFlow.id, deepResearchFlow.name, deepResearchFlow.description, "active").run();

    const flowVersionId = `${deepResearchFlow.id}@${deepResearchFlow.version}`;
    await this.db.prepare(
      [
        "INSERT OR IGNORE INTO flow_versions",
        "(id, flow_id, version, input_schema_json, step_graph_json, allowed_capabilities_json, artifact_schema_json)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")
    ).bind(
      flowVersionId,
      deepResearchFlow.id,
      deepResearchFlow.version,
      JSON.stringify(deepResearchFlow.inputs),
      JSON.stringify({ steps: deepResearchFlow.steps, edges: deepResearchFlow.edges }),
      JSON.stringify(["llm", "search", "reader", "artifact"]),
      JSON.stringify(deepResearchFlow.artifacts)
    ).run();

    for (const preset of deepResearchFlow.presets) {
      await this.db.prepare(
        "INSERT OR IGNORE INTO flow_presets (id, flow_version_id, name, policy_ref, config_json) VALUES (?, ?, ?, ?, ?)"
      ).bind(
        `${flowVersionId}:${preset.id}`,
        flowVersionId,
        preset.name,
        `policy:${preset.id}`,
        JSON.stringify(preset.policy)
      ).run();
    }

    return { flowId: deepResearchFlow.id, flowVersionId };
  }

  async listFlows() {
    await this.seedBuiltInFlows();
    const flows = (await this.db.prepare("SELECT * FROM flows ORDER BY created_at DESC").all()).results || [];
    return Promise.all(flows.map((flow) => this.getFlowDetail(flow.id)));
  }

  async getFlowDetail(id) {
    const flow = await this.db.prepare("SELECT * FROM flows WHERE id = ?").bind(id).first();
    if (!flow) return undefined;
    const versions = (await this.db.prepare(
      "SELECT * FROM flow_versions WHERE flow_id = ? ORDER BY version ASC"
    ).bind(id).all()).results || [];
    const draft = await this.db.prepare("SELECT * FROM flow_drafts WHERE flow_id = ?").bind(id).first();
    const latestVersion = versions.at(-1);
    const latestDefinition = draft ? JSON.parse(draft.definition_json) : latestVersion ? await this.flowDefinitionFromVersion(flow, latestVersion) : undefined;
    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      status: flow.status,
      source: flow.id === deepResearchFlow.id ? "built-in" : "user",
      version: latestDefinition?.version || 0,
      hasDraft: Boolean(draft),
      versions: versions.map((version) => ({ version: version.version, publishedAt: version.created_at })),
      presets: latestDefinition?.presets || [],
      steps: latestDefinition?.steps || [],
      artifacts: latestDefinition?.artifacts || [],
      definition: latestDefinition,
      draft: draft ? JSON.parse(draft.definition_json) : undefined,
      createdAt: flow.created_at,
      updatedAt: flow.updated_at
    };
  }

  async createFlowDraft(body) {
    const id = sanitizeFlowId(body.id || body.name || "custom_flow");
    if (!id) return { status: 400, error: "Flow id is required" };
    if (await this.db.prepare("SELECT id FROM flows WHERE id = ?").bind(id).first()) {
      return { status: 409, error: "Flow already exists" };
    }
    const draft = normalizeFlowDefinition({
      ...deepResearchFlow,
      id,
      name: body.name || "Custom Flow",
      description: body.description || "Custom workflow draft.",
      version: 0
    });
    const errors = validateDraft(draft);
    await this.db.batch([
      this.db.prepare("INSERT INTO flows (id, name, description, status) VALUES (?, ?, ?, ?)").bind(id, draft.name, draft.description, "draft"),
      this.db.prepare("INSERT INTO flow_drafts (flow_id, definition_json, validation_errors_json) VALUES (?, ?, ?)").bind(id, JSON.stringify(draft), JSON.stringify(errors))
    ]);
    return { status: 201, flow: await this.getFlowDetail(id), validation: errors };
  }

  async cloneFlowDraft(sourceId, body = {}) {
    const source = await this.getRunnableFlow(sourceId);
    if (!source) return { status: 404, error: "Source flow not found" };
    const id = sanitizeFlowId(body.id || `${source.id}_copy`);
    if (!id) return { status: 400, error: "Clone id is required" };
    if (await this.db.prepare("SELECT id FROM flows WHERE id = ?").bind(id).first()) {
      return { status: 409, error: "Flow already exists" };
    }
    const draft = normalizeFlowDefinition({
      ...source,
      id,
      name: body.name || `${source.name} Copy`,
      description: body.description || source.description,
      version: 0
    });
    await this.db.batch([
      this.db.prepare("INSERT INTO flows (id, name, description, status) VALUES (?, ?, ?, ?)").bind(id, draft.name, draft.description, "draft"),
      this.db.prepare("INSERT INTO flow_drafts (flow_id, definition_json, validation_errors_json) VALUES (?, ?, ?)").bind(id, JSON.stringify(draft), JSON.stringify(validateDraft(draft)))
    ]);
    return { status: 201, flow: await this.getFlowDetail(id) };
  }

  async updateFlowDraft(id, body) {
    const current = await this.getFlowDetail(id);
    if (!current) return { status: 404, error: "Flow not found" };
    if (current.source === "built-in") return { status: 409, error: "Built-in flow must be cloned before editing" };
    const base = current.draft || current.definition;
    const definition = body.definition || {};
    const draft = normalizeFlowDefinition({
      ...base,
      ...definition,
      id,
      name: body.name || definition.name || base.name,
      description: body.description || definition.description || base.description,
      inputs: body.inputs || definition.inputs || base.inputs,
      presets: body.presets || definition.presets || base.presets,
      steps: body.steps || definition.steps || base.steps,
      edges: body.edges || definition.edges || base.edges,
      artifacts: body.artifacts || definition.artifacts || base.artifacts,
      version: 0
    });
    const errors = validateDraft(draft);
    await this.db.batch([
      this.db.prepare("UPDATE flows SET name = ?, description = ?, status = 'draft', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(draft.name, draft.description, id),
      this.db.prepare([
        "INSERT INTO flow_drafts (flow_id, definition_json, validation_errors_json, updated_at)",
        "VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        "ON CONFLICT(flow_id) DO UPDATE SET definition_json = excluded.definition_json, validation_errors_json = excluded.validation_errors_json, updated_at = CURRENT_TIMESTAMP"
      ].join(" ")).bind(id, JSON.stringify(draft), JSON.stringify(errors))
    ]);
    return { status: 200, flow: await this.getFlowDetail(id), validation: errors };
  }

  async publishFlowDraft(id) {
    const flow = await this.db.prepare("SELECT * FROM flows WHERE id = ?").bind(id).first();
    if (!flow) return { status: 404, error: "Flow not found" };
    if (id === deepResearchFlow.id) return { status: 409, error: "Built-in flow is already published" };
    const draftRow = await this.db.prepare("SELECT * FROM flow_drafts WHERE flow_id = ?").bind(id).first();
    if (!draftRow) return { status: 400, error: "Flow has no draft to publish" };
    const draft = JSON.parse(draftRow.definition_json);
    const errors = validateDraft(draft);
    if (errors.length > 0) return { status: 400, error: "Flow draft is invalid", details: errors };
    const latest = await this.db.prepare("SELECT MAX(version) AS version FROM flow_versions WHERE flow_id = ?").bind(id).first();
    const version = Number(latest?.version || 0) + 1;
    const published = normalizeFlowDefinition({ ...draft, version });
    const flowVersionId = `${id}@${version}`;
    await this.db.batch([
      this.db.prepare([
        "INSERT INTO flow_versions",
        "(id, flow_id, version, input_schema_json, step_graph_json, allowed_capabilities_json, artifact_schema_json)",
        "VALUES (?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")).bind(flowVersionId, id, version, JSON.stringify(published.inputs), JSON.stringify({ steps: published.steps, edges: published.edges }), JSON.stringify(["llm", "search", "reader", "artifact"]), JSON.stringify(published.artifacts)),
      this.db.prepare("DELETE FROM flow_drafts WHERE flow_id = ?").bind(id),
      this.db.prepare("UPDATE flows SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id)
    ]);
    for (const preset of published.presets) {
      await this.db.prepare(
        "INSERT OR REPLACE INTO flow_presets (id, flow_version_id, name, policy_ref, config_json) VALUES (?, ?, ?, ?, ?)"
      ).bind(`${flowVersionId}:${preset.id}`, flowVersionId, preset.name, `policy:${preset.id}`, JSON.stringify(preset.policy || {})).run();
    }
    return { status: 201, flow: await this.getFlowDetail(id), version };
  }

  async deleteOrArchiveFlow(id) {
    const flow = await this.getFlowDetail(id);
    if (!flow) return { status: 404, error: "Flow not found" };
    if (flow.source === "built-in") return { status: 409, error: "Built-in flow cannot be deleted" };
    const run = await this.db.prepare("SELECT id FROM flow_runs WHERE flow_id = ? LIMIT 1").bind(id).first();
    if (!run && flow.versions.length === 0) {
      await this.db.batch([
        this.db.prepare("DELETE FROM flow_drafts WHERE flow_id = ?").bind(id),
        this.db.prepare("DELETE FROM flows WHERE id = ?").bind(id)
      ]);
      return { status: 200, deleted: id };
    }
    await this.db.prepare("UPDATE flows SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    return { status: 200, flow: await this.getFlowDetail(id) };
  }

  async getRunnableFlow(id = deepResearchFlow.id, version) {
    await this.seedBuiltInFlows();
    const row = version
      ? await this.db.prepare("SELECT * FROM flow_versions WHERE flow_id = ? AND version = ?").bind(id, version).first()
      : await this.db.prepare("SELECT * FROM flow_versions WHERE flow_id = ? ORDER BY version DESC LIMIT 1").bind(id).first();
    if (!row) return undefined;
    const flow = await this.db.prepare("SELECT * FROM flows WHERE id = ?").bind(id).first();
    if (!flow || flow.status === "archived") return undefined;
    return this.flowDefinitionFromVersion(flow, row);
  }

  async flowDefinitionFromVersion(flow, versionRow) {
    const definition = flowDefinitionFromRows(flow, versionRow);
    const presets = (await this.db.prepare(
      "SELECT * FROM flow_presets WHERE flow_version_id = ? ORDER BY created_at ASC"
    ).bind(versionRow.id).all()).results || [];
    definition.presets = presets.map((preset) => ({
      id: String(preset.id).split(":").at(-1),
      name: preset.name,
      policy: JSON.parse(preset.config_json || "{}")
    }));
    return definition;
  }

  async createRun({ id, flow = deepResearchFlow, presetId, inputs, initialStepId }) {
    const flowVersionId = `${flow.id}@${flow.version}`;
    const presetRef = `${flowVersionId}:${presetId}`;
    await this.db.prepare(
      [
        "INSERT INTO flow_runs",
        "(id, flow_id, flow_version_id, preset_id, status, input_json, started_at, current_step_key)",
        "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)"
      ].join(" ")
    ).bind(
      id,
      flow.id,
      flowVersionId,
      presetRef,
      "active",
      JSON.stringify(inputs),
      initialStepId
    ).run();
    return this.getRun(id);
  }

  async createStepRun({ id, runId, stepId, status = "pending", attempt = 1 }) {
    await this.db.prepare(
      "INSERT INTO step_runs (id, run_id, step_key, status, attempt) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, runId, stepId, status, attempt).run();
    return { id, runId, stepId, status, attempt };
  }

  async recordRunEvent({ id, runId, stepRunId, type, payload = {} }) {
    await this.db.prepare(
      "INSERT INTO run_events (id, run_id, step_run_id, type, payload_json) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, runId, stepRunId, type, JSON.stringify(payload)).run();
  }

  async getRun(id) {
    return this.db.prepare("SELECT * FROM flow_runs WHERE id = ?").bind(id).first();
  }

  async updateRunStatus({ id, status, currentStepId, ended = false }) {
    await this.db.prepare(
      [
        "UPDATE flow_runs",
        "SET status = ?, current_step_key = COALESCE(?, current_step_key),",
        "ended_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE ended_at END,",
        "updated_at = CURRENT_TIMESTAMP",
        "WHERE id = ?"
      ].join(" ")
    ).bind(status, currentStepId ?? null, ended ? 1 : 0, id).run();
    return this.getRun(id);
  }

  async deleteRun(id) {
    await this.db.prepare(
      "DELETE FROM citations WHERE claim_id IN (SELECT id FROM claims WHERE run_id = ?) OR evidence_item_id IN (SELECT id FROM evidence_items WHERE run_id = ?)"
    ).bind(id, id).run();
    await this.db.prepare(
      "DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE run_id = ?)"
    ).bind(id).run();
    await this.db.prepare("DELETE FROM claims WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM evidence_items WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM artifacts WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM trace_events WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM trace_spans WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM checkpoints WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM run_events WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM step_runs WHERE run_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM flow_runs WHERE id = ?").bind(id).run();
    return { deleted: id };
  }

  async deleteAllRuns(limit = 100) {
    const runs = await this.listRuns(limit);
    for (const run of runs) {
      await this.deleteRun(run.id);
    }
    return { deleted: runs.map((run) => run.id) };
  }

  async listRuns(limit = 20) {
    const result = await this.db.prepare(
      "SELECT * FROM flow_runs ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
    return result.results || [];
  }
}

export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function flowDefinitionFromRows(flow, versionRow) {
  const stepGraph = JSON.parse(versionRow.step_graph_json || "{}");
  const presets = [];
  return normalizeFlowDefinition({
    id: flow.id,
    name: flow.name,
    description: flow.description || "",
    version: Number(versionRow.version),
    inputs: JSON.parse(versionRow.input_schema_json || "[]"),
    presets,
    steps: stepGraph.steps || [],
    edges: stepGraph.edges || [],
    artifacts: JSON.parse(versionRow.artifact_schema_json || "[]")
  });
}

function normalizeFlowDefinition(input) {
  return {
    id: sanitizeFlowId(input.id),
    name: String(input.name || "Untitled Flow").slice(0, 100),
    version: Number.isInteger(input.version) ? input.version : 0,
    description: typeof input.description === "string" ? input.description.slice(0, 300) : "",
    inputs: Array.isArray(input.inputs) ? input.inputs : [],
    presets: Array.isArray(input.presets) ? input.presets : deepResearchFlow.presets,
    steps: Array.isArray(input.steps) ? input.steps : [],
    edges: Array.isArray(input.edges) ? input.edges : [],
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : []
  };
}

function validateDraft(flow) {
  return validateFlowDefinition({ ...flow, version: Number.isInteger(flow.version) && flow.version > 0 ? flow.version : 1 });
}

function sanitizeFlowId(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}
