PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS trace_spans (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES trace_spans(id),
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  input_ref TEXT,
  output_ref TEXT,
  error_type TEXT,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trace_events (
  id TEXT PRIMARY KEY,
  trace_span_id TEXT REFERENCES trace_spans(id),
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metric_points (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  value REAL NOT NULL,
  dimensions_json TEXT NOT NULL DEFAULT '{}',
  measured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT,
  provider TEXT,
  retrieved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  source_id TEXT REFERENCES sources(id),
  excerpt TEXT,
  confidence TEXT,
  supports_step_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  artifact_version_id TEXT,
  claim_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',
  confidence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id),
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
  citation_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(id),
  evidence_item_id TEXT REFERENCES evidence_items(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version INTEGER NOT NULL,
  content_ref TEXT NOT NULL,
  source_step_run_id TEXT REFERENCES step_runs(id),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(artifact_id, version)
);

CREATE TABLE IF NOT EXISTS eval_suites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  eval_suite_id TEXT NOT NULL REFERENCES eval_suites(id),
  name TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  eval_suite_id TEXT NOT NULL REFERENCES eval_suites(id),
  target_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL REFERENCES eval_runs(id),
  eval_case_id TEXT REFERENCES eval_cases(id),
  status TEXT NOT NULL,
  score REAL,
  output_ref TEXT,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eval_metrics (
  id TEXT PRIMARY KEY,
  eval_result_id TEXT NOT NULL REFERENCES eval_results(id),
  name TEXT NOT NULL,
  value REAL NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS regression_cases (
  id TEXT PRIMARY KEY,
  source_run_id TEXT REFERENCES flow_runs(id),
  eval_case_id TEXT REFERENCES eval_cases(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_gates (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_ref TEXT NOT NULL,
  eval_suite_id TEXT REFERENCES eval_suites(id),
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  signal_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS learning_signals (
  id TEXT PRIMARY KEY,
  learning_event_id TEXT NOT NULL REFERENCES learning_events(id),
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_proposals (
  id TEXT PRIMARY KEY,
  source_run_id TEXT REFERENCES flow_runs(id),
  skill_id TEXT REFERENCES skills(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS skill_proposal_diffs (
  id TEXT PRIMARY KEY,
  skill_proposal_id TEXT NOT NULL REFERENCES skill_proposals(id),
  path TEXT NOT NULL,
  diff_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policy_suggestions (
  id TEXT PRIMARY KEY,
  source_run_id TEXT REFERENCES flow_runs(id),
  policy_id TEXT REFERENCES policies(id),
  title TEXT NOT NULL,
  suggestion_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trace_spans_run_id ON trace_spans(run_id);
CREATE INDEX IF NOT EXISTS idx_evidence_items_run_id ON evidence_items(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_suite ON eval_runs(eval_suite_id);
