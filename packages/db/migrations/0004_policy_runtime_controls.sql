PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  budget_json TEXT NOT NULL DEFAULT '{}',
  providers_json TEXT NOT NULL DEFAULT '{}',
  quality_json TEXT NOT NULL DEFAULT '{}',
  security_json TEXT NOT NULL DEFAULT '{}',
  human_json TEXT NOT NULL DEFAULT '{}',
  retry_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guard_rules (
  id TEXT PRIMARY KEY,
  policy_id TEXT REFERENCES policies(id),
  type TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'block',
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guard_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  guard_rule_id TEXT REFERENCES guard_rules(id),
  guard_type TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  action_type TEXT NOT NULL,
  action_payload_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_note TEXT
);

CREATE TABLE IF NOT EXISTS loop_signals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS circuit_breaker_states (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT,
  closes_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope, scope_ref)
);

CREATE TABLE IF NOT EXISTS drift_signals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS escalation_policies (
  id TEXT PRIMARY KEY,
  policy_id TEXT REFERENCES policies(id),
  trigger_type TEXT NOT NULL,
  strategy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS escalation_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  escalation_policy_id TEXT REFERENCES escalation_policies(id),
  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT,
  original_context_ref TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_guard_results_run_id ON guard_results(run_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
