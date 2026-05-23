// @ts-nocheck
export const DEFAULT_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const DEFAULT_COLLECTION_ID = "default";

export function normalizeIngestInput(input) {
  requireString(input?.text, "input.text");
  return {
    collectionId: input.collectionId || DEFAULT_COLLECTION_ID,
    documentId: input.documentId,
    uri: input.uri,
    title: input.title || input.uri || "Untitled document",
    text: input.text,
    metadata: input.metadata || {}
  };
}

export function normalizeRetrievalQuery(query) {
  requireString(query?.query, "query.query");
  return {
    collectionId: query.collectionId || DEFAULT_COLLECTION_ID,
    query: query.query,
    topK: query.topK || 8,
    filters: query.filters || {},
    runId: query.runId,
    stepRunId: query.stepRunId
  };
}

export function createRetrievedChunk({ id, text, score = 0, source = {}, metadata = {} }) {
  requireString(id, "chunk.id");
  requireString(text, "chunk.text");
  return {
    id,
    text,
    score,
    source: {
      id: source.id,
      uri: source.uri,
      title: source.title,
      provider: source.provider
    },
    metadata
  };
}

export function chunksToCitations(chunks) {
  return chunks.map((chunk, index) => ({
    id: `citation_${index + 1}`,
    chunkId: chunk.id,
    sourceId: chunk.source.id,
    citationText: chunk.source.title || chunk.source.uri || chunk.id,
    excerpt: chunk.text,
    score: chunk.score
  }));
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}
