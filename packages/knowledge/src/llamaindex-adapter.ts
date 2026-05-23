// @ts-nocheck
import { KnowledgeProvider } from "./provider.js";
import { chunksToCitations, createRetrievedChunk, normalizeIngestInput, normalizeRetrievalQuery } from "./schema.js";

export class LlamaIndexKnowledgeProvider extends KnowledgeProvider {
  constructor({ index, documentFactory, idFactory = defaultIdFactory } = {}) {
    super({
      id: "llamaindex",
      name: "LlamaIndex.TS Adapter",
      capabilities: ["ingest", "retrieve", "cite"]
    });
    this.index = index;
    this.documentFactory = documentFactory;
    this.idFactory = idFactory;
  }

  async ingest(input) {
    const normalized = normalizeIngestInput(input);
    this.requireIndex();
    if (!this.documentFactory) {
      throw new Error("LlamaIndex adapter requires a documentFactory to avoid coupling core code to LlamaIndex classes");
    }

    const document = this.documentFactory({
      id_: normalized.documentId || this.idFactory("doc"),
      text: normalized.text,
      metadata: {
        collectionId: normalized.collectionId,
        uri: normalized.uri,
        title: normalized.title,
        ...normalized.metadata
      }
    });

    await this.index.insert(document);
    return {
      provider: this.id,
      collectionId: normalized.collectionId,
      documentId: document.id_ || document.id,
      chunkCount: undefined
    };
  }

  async retrieve(query) {
    const normalized = normalizeRetrievalQuery(query);
    this.requireIndex();
    const retriever = this.index.asRetriever ? this.index.asRetriever() : this.index;
    const nodes = await retriever.retrieve({
      query: normalized.query,
      similarityTopK: normalized.topK,
      filters: normalized.filters
    });

    return nodes.map((node, index) => {
      const sourceNode = node.node || node;
      const metadata = sourceNode.metadata || {};
      return createRetrievedChunk({
        id: sourceNode.id_ || sourceNode.id || `llamaindex_chunk_${index}`,
        text: sourceNode.text || sourceNode.getText?.() || "",
        score: node.score || 0,
        source: {
          id: metadata.documentId,
          uri: metadata.uri,
          title: metadata.title,
          provider: this.id
        },
        metadata
      });
    }).filter((chunk) => chunk.text.length > 0);
  }

  async cite(chunks) {
    return chunksToCitations(chunks);
  }

  requireIndex() {
    if (!this.index) {
      throw new Error("LlamaIndex adapter requires an injected LlamaIndex index/query engine");
    }
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
