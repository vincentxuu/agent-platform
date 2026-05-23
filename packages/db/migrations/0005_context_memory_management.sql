PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS context_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT NOT NULL REFERENCES step_runs(id),
  model_call_ref TEXT,
  total_budget_tokens INTEGER,
  response_budget_tokens INTEGER,
  assembled_prompt_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context_blocks (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  block_type TEXT NOT NULL,
  source_ref TEXT,
  content_ref TEXT,
  token_count INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context_budgets (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  block_type TEXT NOT NULL,
  allocated_tokens INTEGER NOT NULL,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(context_snapshot_id, block_type)
);

CREATE TABLE IF NOT EXISTS context_assemblies (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  status TEXT NOT NULL,
  selected_blocks_json TEXT NOT NULL DEFAULT '[]',
  excluded_blocks_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context_compressions (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  source_ref TEXT NOT NULL,
  compressed_ref TEXT NOT NULL,
  method TEXT NOT NULL,
  original_tokens INTEGER,
  compressed_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS context_injections (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  injection_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_selections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES flow_runs(id),
  step_run_id TEXT NOT NULL REFERENCES step_runs(id),
  selected_tools_json TEXT NOT NULL DEFAULT '[]',
  excluded_tools_json TEXT NOT NULL DEFAULT '[]',
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_descriptions (
  id TEXT PRIMARY KEY,
  tool_selection_id TEXT NOT NULL REFERENCES tool_selections(id),
  tool_ref TEXT NOT NULL,
  model_description TEXT NOT NULL,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_overlap_warnings (
  id TEXT PRIMARY KEY,
  tool_selection_id TEXT NOT NULL REFERENCES tool_selections(id),
  tool_refs_json TEXT NOT NULL,
  warning TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  content_ref TEXT NOT NULL,
  summary TEXT,
  freshness TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_run_id TEXT REFERENCES flow_runs(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_scopes (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id),
  scope_type TEXT NOT NULL,
  scope_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_sources (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id),
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id),
  embedding_ref TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_retrievals (
  id TEXT PRIMARY KEY,
  context_snapshot_id TEXT NOT NULL REFERENCES context_snapshots(id),
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id),
  score REAL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_write_proposals (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  proposed_content_ref TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  source_run_id TEXT REFERENCES flow_runs(id),
  status TEXT NOT NULL DEFAULT 'pending',
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_decay_policies (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,
  policy_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memory_archives (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL REFERENCES memory_items(id),
  reason TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_step_run_id ON context_snapshots(step_run_id);
CREATE INDEX IF NOT EXISTS idx_memory_scopes_scope ON memory_scopes(scope_type, scope_ref);
