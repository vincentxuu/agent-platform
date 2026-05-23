PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  credential_ref TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  health_status TEXT NOT NULL DEFAULT 'unknown',
  latency_p95_ms INTEGER,
  cost_config_json TEXT NOT NULL DEFAULT '{}',
  quota_status_json TEXT NOT NULL DEFAULT '{}',
  fallback_chain_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES providers(id),
  scope TEXT NOT NULL,
  storage_kind TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_discovered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id),
  name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  permission_scope TEXT,
  model_description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, name)
);

CREATE TABLE IF NOT EXISTS mcp_resources (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id),
  uri TEXT NOT NULL,
  name TEXT,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, uri)
);

CREATE TABLE IF NOT EXISTS mcp_prompts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id),
  name TEXT NOT NULL,
  description TEXT,
  arguments_schema_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id, name)
);

CREATE TABLE IF NOT EXISTS provider_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  provider_id TEXT REFERENCES providers(id),
  role TEXT,
  model TEXT,
  status TEXT NOT NULL,
  input_ref TEXT,
  output_ref TEXT,
  tokens_input INTEGER NOT NULL DEFAULT 0,
  tokens_output INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  fallback_from_provider_id TEXT REFERENCES providers(id),
  fallback_reason TEXT,
  error_type TEXT,
  error_message TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  skill_invocation_id TEXT REFERENCES skill_invocations(id),
  mcp_tool_id TEXT REFERENCES mcp_tools(id),
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_ref TEXT,
  output_ref TEXT,
  duration_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  error_type TEXT,
  error_message TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_providers_type_enabled ON providers(type, enabled);
CREATE INDEX IF NOT EXISTS idx_provider_calls_step_run_id ON provider_calls(step_run_id);
CREATE INDEX IF NOT EXISTS idx_tool_invocations_step_run_id ON tool_invocations(step_run_id);
