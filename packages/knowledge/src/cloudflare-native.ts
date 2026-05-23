// @ts-nocheck
import { KnowledgeProvider } from "./provider.js";
import {
  DEFAULT_EMBEDDING_MODEL,
  chunksToCitations,
  createRetrievedChunk,
  normalizeIngestInput,
  normalizeRetrievalQuery
} from "./schema.js";

export class CloudflareNativeKnowledgeProvider extends KnowledgeProvider {
  constructor({ env, embeddingModel = DEFAULT_EMBEDDING_MODEL, idFactory = defaultIdFactory }) {
    super({
      id: "cloudflare-native",
      name: "Cloudflare Native Knowledge",
      capabilities: ["ingest", "retrieve", "cite", "vector_search", "workers_ai_embeddings"]
    });
    this.env = env;
    this.embeddingModel = embeddingModel;
    this.idFactory = idFactory;
  }

  async ingest(input) {
    this.requireBindings();
    const normalized = normalizeIngestInput(input);
    const documentId = normalized.documentId || this.idFactory("doc");
    const chunks = chunkText(normalized.text).map((text, index) => ({
      id: `${documentId}:chunk:${index}`,
      text,
      index
    }));

    const vectors = [];
    for (const chunk of chunks) {
      const embedding = await this.embed(chunk.text);
      vectors.push({
        id: chunk.id,
        values: embedding,
        metadata: {
          collectionId: normalized.collectionId,
          documentId,
          chunkIndex: chunk.index,
          title: normalized.title,
          uri: normalized.uri,
          text: chunk.text
        }
      });
    }

    if (vectors.length > 0) {
      await this.env.VECTORIZE.upsert(vectors);
    }

    const contentRef = `knowledge/${normalized.collectionId}/${documentId}.txt`;
    await this.env.ARTIFACTS.put(contentRef, normalized.text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" }
    });

    return {
      provider: this.id,
      collectionId: normalized.collectionId,
      documentId,
      contentRef,
      chunkCount: chunks.length,
      vectorIds: vectors.map((vector) => vector.id)
    };
  }

  async retrieve(query) {
    this.requireBindings();
    const normalized = normalizeRetrievalQuery(query);
    const vector = await this.embed(normalized.query);
    const result = await this.env.VECTORIZE.query(vector, {
      topK: normalized.topK,
      returnMetadata: true,
      filter: {
        collectionId: normalized.collectionId,
        ...normalized.filters
      }
    });

    return (result.matches || []).map((match) => createRetrievedChunk({
      id: match.id,
      text: match.metadata?.text || "",
      score: match.score,
      source: {
        id: match.metadata?.documentId,
        uri: match.metadata?.uri,
        title: match.metadata?.title,
        provider: this.id
      },
      metadata: match.metadata || {}
    })).filter((chunk) => chunk.text.length > 0);
  }

  async cite(chunks) {
    return chunksToCitations(chunks);
  }

  async embed(text) {
    const response = await this.env.AI.run(this.embeddingModel, { text });
    const data = response.data || response.embeddings || response;
    const [embedding] = Array.isArray(data?.[0]) ? data : [data];
    if (!Array.isArray(embedding)) {
      throw new Error("Workers AI embedding response did not include a vector");
    }
    return embedding;
  }

  requireBindings() {
    for (const binding of ["AI", "VECTORIZE", "ARTIFACTS"]) {
      if (!this.env?.[binding]) {
        throw new Error(`Missing Cloudflare knowledge binding: ${binding}`);
      }
    }
  }
}

export function chunkText(text, { maxWords = 220, overlapWords = 30 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  const stride = Math.max(1, maxWords - overlapWords);
  for (let start = 0; start < words.length; start += stride) {
    chunks.push(words.slice(start, start + maxWords).join(" "));
  }
  return chunks;
}

function defaultIdFactory(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
