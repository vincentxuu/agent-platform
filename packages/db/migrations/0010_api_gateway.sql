PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,        -- e.g. ak_live_9f3c (lookup, not secret)
  key_hash TEXT NOT NULL,                 -- SHA-256(plaintext); plaintext returned once at creation
  status TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  scopes_json TEXT NOT NULL DEFAULT '[]',
  allowed_flows_json TEXT NOT NULL DEFAULT '[]', -- empty array = all flows within scope
  rate_limit_json TEXT NOT NULL DEFAULT '{}',    -- {requestsPerMin, runsPerDay}
  budget_json TEXT NOT NULL DEFAULT '{}',        -- {maxCostUsd, maxTokens, window:"monthly"}
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS api_audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  run_id TEXT,
  status_code INTEGER NOT NULL,
  outcome TEXT NOT NULL,                   -- allow | deny:<reason>
  cost_usd REAL DEFAULT 0,
  tokens INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_api_audit_log_client ON api_audit_log (client_id, ts);

CREATE TABLE IF NOT EXISTS api_client_usage (
  client_id TEXT NOT NULL,
  window_key TEXT NOT NULL,               -- e.g. 2026-06 (monthly)
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, window_key)
);
