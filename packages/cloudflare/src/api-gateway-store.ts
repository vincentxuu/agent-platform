// @ts-nocheck
// Worker-side ApiGatewayStore: api_clients/api_audit_log/api_client_usage live
// in D1; short-window rate counters live in KV with a TTL.
import { createId } from "./d1-repository.js";

const ENSURE_STATEMENTS = [
  [
    "CREATE TABLE IF NOT EXISTS api_clients (",
    "id TEXT PRIMARY KEY,",
    "name TEXT NOT NULL,",
    "key_prefix TEXT NOT NULL UNIQUE,",
    "key_hash TEXT NOT NULL,",
    "status TEXT NOT NULL DEFAULT 'active',",
    "scopes_json TEXT NOT NULL DEFAULT '[]',",
    "allowed_flows_json TEXT NOT NULL DEFAULT '[]',",
    "rate_limit_json TEXT NOT NULL DEFAULT '{}',",
    "budget_json TEXT NOT NULL DEFAULT '{}',",
    "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "last_used_at TEXT",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS api_audit_log (",
    "id TEXT PRIMARY KEY,",
    "client_id TEXT,",
    "ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,",
    "method TEXT NOT NULL,",
    "path TEXT NOT NULL,",
    "run_id TEXT,",
    "status_code INTEGER NOT NULL,",
    "outcome TEXT NOT NULL,",
    "cost_usd REAL DEFAULT 0,",
    "tokens INTEGER DEFAULT 0",
    ")"
  ].join(" "),
  [
    "CREATE TABLE IF NOT EXISTS api_client_usage (",
    "client_id TEXT NOT NULL,",
    "window_key TEXT NOT NULL,",
    "cost_usd REAL NOT NULL DEFAULT 0,",
    "tokens INTEGER NOT NULL DEFAULT 0,",
    "runs INTEGER NOT NULL DEFAULT 0,",
    "PRIMARY KEY (client_id, window_key)",
    ")"
  ].join(" ")
];

function rowToClient(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    status: row.status,
    scopes: parseJson(row.scopes_json, []),
    allowedFlows: parseJson(row.allowed_flows_json, []),
    rateLimit: parseJson(row.rate_limit_json, {}),
    budget: parseJson(row.budget_json, {}),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || undefined
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export class WorkerApiGatewayStore {
  constructor(env) {
    if (!env?.DB) throw new Error("D1 binding is required for the API gateway store");
    this.env = env;
    this.db = env.DB;
    this.cache = env.CACHE;
    this.ensured = false;
  }

  async ensureSchema() {
    if (this.ensured) return;
    for (const statement of ENSURE_STATEMENTS) {
      await this.db.prepare(statement).run();
    }
    this.ensured = true;
  }

  // --- ApiGatewayStore interface ---

  async getClientByPrefix(prefix) {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM api_clients WHERE key_prefix = ?").bind(prefix).first();
    return rowToClient(row);
  }

  async recordAudit(entry) {
    await this.ensureSchema();
    await this.db.prepare([
      "INSERT INTO api_audit_log (id, client_id, ts, method, path, run_id, status_code, outcome, cost_usd, tokens)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).bind(
      entry.id,
      entry.clientId || null,
      entry.ts,
      entry.method,
      entry.path,
      entry.runId || null,
      entry.statusCode,
      entry.outcome,
      entry.costUsd || 0,
      entry.tokens || 0
    ).run();
  }

  async incrRateWindow(windowKey, ttlSeconds) {
    if (!this.cache) return 1;
    const current = Number((await this.cache.get(windowKey)) || 0);
    const next = current + 1;
    await this.cache.put(windowKey, String(next), { expirationTtl: Math.max(60, Math.ceil(ttlSeconds)) });
    return next;
  }

  async getUsage(clientId, windowKey) {
    await this.ensureSchema();
    const row = await this.db.prepare(
      "SELECT cost_usd, tokens, runs FROM api_client_usage WHERE client_id = ? AND window_key = ?"
    ).bind(clientId, windowKey).first();
    return {
      costUsd: Number(row?.cost_usd || 0),
      tokens: Number(row?.tokens || 0),
      runs: Number(row?.runs || 0)
    };
  }

  async addUsage(clientId, windowKey, delta) {
    await this.ensureSchema();
    await this.db.prepare([
      "INSERT INTO api_client_usage (client_id, window_key, cost_usd, tokens, runs)",
      "VALUES (?, ?, ?, ?, ?)",
      "ON CONFLICT(client_id, window_key) DO UPDATE SET",
      "cost_usd = cost_usd + excluded.cost_usd,",
      "tokens = tokens + excluded.tokens,",
      "runs = runs + excluded.runs"
    ].join(" ")).bind(
      clientId,
      windowKey,
      Number(delta.costUsd || 0),
      Number(delta.tokens || 0),
      Number(delta.runs || 0)
    ).run();
  }

  // --- Admin CRUD helpers ---

  async listClients() {
    await this.ensureSchema();
    const result = await this.db.prepare("SELECT * FROM api_clients ORDER BY created_at DESC").all();
    return (result.results || []).map(rowToClient);
  }

  async getClientById(id) {
    await this.ensureSchema();
    const row = await this.db.prepare("SELECT * FROM api_clients WHERE id = ?").bind(id).first();
    return rowToClient(row);
  }

  async insertClient(client) {
    await this.ensureSchema();
    await this.db.prepare([
      "INSERT INTO api_clients (id, name, key_prefix, key_hash, status, scopes_json, allowed_flows_json, rate_limit_json, budget_json)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ].join(" ")).bind(
      client.id,
      client.name,
      client.keyPrefix,
      client.keyHash,
      client.status,
      JSON.stringify(client.scopes || []),
      JSON.stringify(client.allowedFlows || []),
      JSON.stringify(client.rateLimit || {}),
      JSON.stringify(client.budget || {})
    ).run();
    return this.getClientById(client.id);
  }

  async updateClient(id, patch) {
    await this.ensureSchema();
    const existing = await this.getClientById(id);
    if (!existing) return undefined;
    const next = {
      name: patch.name ?? existing.name,
      scopes: patch.scopes ?? existing.scopes,
      allowedFlows: patch.allowedFlows ?? existing.allowedFlows,
      rateLimit: patch.rateLimit ?? existing.rateLimit,
      budget: patch.budget ?? existing.budget,
      status: patch.status ?? existing.status
    };
    await this.db.prepare([
      "UPDATE api_clients SET name = ?, scopes_json = ?, allowed_flows_json = ?, rate_limit_json = ?, budget_json = ?, status = ?",
      "WHERE id = ?"
    ].join(" ")).bind(
      next.name,
      JSON.stringify(next.scopes),
      JSON.stringify(next.allowedFlows),
      JSON.stringify(next.rateLimit),
      JSON.stringify(next.budget),
      next.status,
      id
    ).run();
    return this.getClientById(id);
  }

  async touchClient(id, ts) {
    await this.ensureSchema();
    await this.db.prepare("UPDATE api_clients SET last_used_at = ? WHERE id = ?").bind(ts, id).run();
  }

  async listAudit(clientId, limit = 50) {
    await this.ensureSchema();
    const result = await this.db.prepare(
      "SELECT * FROM api_audit_log WHERE client_id = ? ORDER BY ts DESC LIMIT ?"
    ).bind(clientId, limit).all();
    return (result.results || []).map((row) => ({
      id: row.id,
      clientId: row.client_id,
      ts: row.ts,
      method: row.method,
      path: row.path,
      runId: row.run_id || undefined,
      statusCode: row.status_code,
      outcome: row.outcome,
      costUsd: Number(row.cost_usd || 0),
      tokens: Number(row.tokens || 0)
    }));
  }

  newAuditId() {
    return createId("audit");
  }

  newClientId() {
    return createId("client");
  }
}
