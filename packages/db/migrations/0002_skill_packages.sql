PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id),
  version TEXT NOT NULL,
  package_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  input_schema_json TEXT,
  output_schema_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(skill_id, version)
);

CREATE TABLE IF NOT EXISTS skill_files (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL REFERENCES skill_versions(id),
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(skill_version_id, path)
);

CREATE TABLE IF NOT EXISTS skill_bindings (
  id TEXT PRIMARY KEY,
  flow_version_id TEXT NOT NULL REFERENCES flow_versions(id),
  step_key TEXT NOT NULL,
  skill_version_id TEXT NOT NULL REFERENCES skill_versions(id),
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(flow_version_id, step_key)
);

CREATE TABLE IF NOT EXISTS skill_permissions (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL REFERENCES skill_versions(id),
  permission_type TEXT NOT NULL,
  permission_value TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT NOT NULL REFERENCES step_runs(id),
  skill_version_id TEXT NOT NULL REFERENCES skill_versions(id),
  status TEXT NOT NULL,
  input_ref TEXT,
  output_ref TEXT,
  permission_decisions_json TEXT NOT NULL DEFAULT '[]',
  tool_usage_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  ended_at TEXT,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_evals (
  id TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL REFERENCES skill_versions(id),
  eval_suite_ref TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_eval_runs (
  id TEXT PRIMARY KEY,
  skill_eval_id TEXT NOT NULL REFERENCES skill_evals(id),
  status TEXT NOT NULL,
  result_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_id ON skill_versions(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_step_run_id ON skill_invocations(step_run_id);
