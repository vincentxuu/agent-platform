PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT NOT NULL DEFAULT 'cloudflare-native',
  embedding_model TEXT NOT NULL DEFAULT '@cf/baai/bge-base-en-v1.5',
  vector_index_ref TEXT NOT NULL DEFAULT 'agent-platform-knowledge',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
  source_id TEXT REFERENCES sources(id),
  uri TEXT,
  title TEXT,
  content_ref TEXT,
  content_hash TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id),
  collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  vector_id TEXT NOT NULL,
  content_ref TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS retrieval_queries (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES flow_runs(id),
  step_run_id TEXT REFERENCES step_runs(id),
  collection_id TEXT REFERENCES knowledge_collections(id),
  provider TEXT NOT NULL,
  query_text TEXT NOT NULL,
  top_k INTEGER NOT NULL DEFAULT 8,
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retrieval_results (
  id TEXT PRIMARY KEY,
  retrieval_query_id TEXT NOT NULL REFERENCES retrieval_queries(id),
  chunk_id TEXT REFERENCES knowledge_chunks(id),
  source_id TEXT REFERENCES sources(id),
  score REAL,
  rank INTEGER NOT NULL,
  excerpt TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_collection ON knowledge_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_collection ON knowledge_chunks(collection_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_queries_run ON retrieval_queries(run_id, step_run_id);
