// @ts-nocheck
import { deepResearchFlow } from "../../core/src/deep-research-flow.js";

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

  async createRun({ id, presetId, inputs, initialStepId }) {
    const flowVersionId = `${deepResearchFlow.id}@${deepResearchFlow.version}`;
    const presetRef = `${flowVersionId}:${presetId}`;
    await this.db.prepare(
      [
        "INSERT INTO flow_runs",
        "(id, flow_id, flow_version_id, preset_id, status, input_json, started_at, current_step_key)",
        "VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)"
      ].join(" ")
    ).bind(
      id,
      deepResearchFlow.id,
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
