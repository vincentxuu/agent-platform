PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  version INTEGER NOT NULL,
  input_schema_json TEXT NOT NULL,
  step_graph_json TEXT NOT NULL,
  allowed_capabilities_json TEXT NOT NULL DEFAULT '[]',
  artifact_schema_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(flow_id, version)
);

CREATE TABLE IF NOT EXISTS flow_presets (
  id TEXT PRIMARY KEY,
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  name TEXT NOT NULL,
  description TEXT,
  policy_ref TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flow_steps (
  id TEXT PRIMARY KEY,
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  step_key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  skill_binding_ref TEXT,
  provider_role TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(flow_version_id, step_key)
);

CREATE TABLE IF NOT EXISTS flow_edges (
  id TEXT PRIMARY KEY,
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  from_step_key TEXT NOT NULL,
  to_step_key TEXT NOT NULL,
  condition_expr TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artifact_schemas (
  id TEXT PRIMARY KEY,
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  artifact_type TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id),
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  preset_id TEXT REFERENCES flow_presets(id),
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  current_step_key TEXT,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS step_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  flow_step_id TEXT REFERENCES flow_steps(id),
  step_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  input_ref TEXT,
  output_ref TEXT,
  started_at TEXT,
  ended_at TEXT,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  completed_steps_json TEXT NOT NULL DEFAULT '[]',
  current_step_key TEXT,
  remaining_steps_json TEXT NOT NULL DEFAULT '[]',
  key_outputs_json TEXT NOT NULL DEFAULT '{}',
  context_summary TEXT,
  token_usage_json TEXT NOT NULL DEFAULT '{}',
  cost_usd REAL NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  approval_state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON flow_runs(status);
CREATE INDEX IF NOT EXISTS idx_step_runs_run_id ON step_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id_created_at ON run_events(run_id, created_at);
