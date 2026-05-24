PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS flow_drafts (
  flow_id TEXT PRIMARY KEY REFERENCES flows(id),
  definition_json TEXT NOT NULL,
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
