// @ts-nocheck
export class KnowledgeProvider {
  constructor({ id, name, capabilities = [] }) {
    this.id = id;
    this.name = name;
    this.capabilities = capabilities;
  }

  async ingest() {
    throw new Error(`${this.id} does not implement ingest`);
  }

  async retrieve() {
    throw new Error(`${this.id} does not implement retrieve`);
  }

  async cite(chunks) {
    return chunks;
  }
}

export class KnowledgeProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    if (!provider?.id) {
      throw new Error("Knowledge provider id is required");
    }
    this.providers.set(provider.id, provider);
    return provider;
  }

  resolve(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown knowledge provider: ${providerId}`);
    }
    return provider;
  }
}
