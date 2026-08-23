// @ts-nocheck
export class ProviderRegistry {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.providers = new Map();
    this.mcpServers = new Map();
    this.mcpTools = new Map();
    this.providerCalls = [];
    this.toolInvocations = [];
  }

  registerProvider(provider) {
    requireString(provider.name, "provider.name");
    requireString(provider.type, "provider.type");
    const id = provider.id || this.idFactory("provider");
    const record = {
      id,
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled ?? true,
      credentialRef: provider.credentialRef,
      capabilities: provider.capabilities || {},
      healthStatus: provider.healthStatus || "unknown",
      latencyP95Ms: provider.latencyP95Ms,
      costConfig: provider.costConfig || {},
      quotaStatus: provider.quotaStatus || {},
      fallbackChain: provider.fallbackChain || [],
      createdAt: now(),
      updatedAt: now()
    };
    this.providers.set(id, record);
    return record;
  }

  listProviders(type) {
    return [...this.providers.values()].filter((provider) => !type || provider.type === type);
  }

  selectProvider({ type, role, allowedProviderIds = [] }) {
    const candidates = this.listProviders(type).filter((provider) => {
      if (!provider.enabled) return false;
      if (allowedProviderIds.length > 0 && !allowedProviderIds.includes(provider.id)) return false;
      return !role || provider.capabilities.roles?.includes(role) || provider.capabilities.roles === undefined;
    });
    return candidates.find((provider) => provider.healthStatus !== "down") || candidates[0] || null;
  }

  // --- Proxy model selection ---
  selectProviderForProxyModel(modelId: string, mappedProviders: Array<{ providerId: string; isFallback: boolean; fallbackIndex: number }>) {
    const maxAttempts = 3;
    const attempts: Array<{ providerId: string; isFallback: boolean; fallbackIndex: number }> = [];
    
    for (const mapped of mappedProviders) {
      if (attempts.length >= maxAttempts) break;
      const provider = this.providers.get(mapped.providerId);
      if (!provider || !provider.enabled) continue;
      if (provider.healthStatus === "down") continue;
      attempts.push(mapped);
    }
    
    return attempts.map(m => ({
      providerId: m.providerId,
      isFallback: m.isFallback,
      fallbackIndex: m.fallbackIndex
    }));
  }

  getProxyModelProviders(modelId: string, proxyModelMapping: any) {
    // This will be called with the loaded proxy model mapping
    // Return all providers that can serve this model (primary + fallbacks)
    const entry = proxyModelMapping?.models?.[modelId];
    if (!entry) return [];
    
    const result: Array<{ providerId: string; isFallback: boolean; fallbackIndex: number }> = [];
    
    // Primary providers
    for (const providerId of entry.providers || []) {
      const provider = this.providers.get(providerId);
      if (provider && provider.enabled && provider.healthStatus !== "down") {
        result.push({ providerId, isFallback: false, fallbackIndex: -1 });
      }
    }
    
    // Fallback providers
    for (let i = 0; i < (entry.fallback || []).length; i++) {
      const providerId = entry.fallback[i];
      const provider = this.providers.get(providerId);
      if (provider && provider.enabled && provider.healthStatus !== "down") {
        result.push({ providerId, isFallback: true, fallbackIndex: i });
      }
    }
    
    return result;
  }

  // --- Provider readiness for proxy ---
  isProviderReadyForProxy(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    return !!(provider && provider.enabled && provider.healthStatus !== "down");
  }

  filterReadyProxyModels(modelIds: string[], proxyModelMapping: any): string[] {
    return modelIds.filter(modelId => {
      const providers = this.getProxyModelProviders(modelId, proxyModelMapping);
      return providers.length > 0;
    });
  }

  registerMcpServer(server) {
    requireString(server.name, "server.name");
    requireString(server.transport, "server.transport");
    const id = server.id || this.idFactory("mcp_server");
    const record = {
      id,
      name: server.name,
      transport: server.transport,
      config: server.config || {},
      enabled: server.enabled ?? true,
      lastDiscoveredAt: undefined,
      createdAt: now(),
      updatedAt: now()
    };
    this.mcpServers.set(id, record);
    return record;
  }

  discoverMcpTools(serverId, tools) {
    const server = this.mcpServers.get(serverId);
    if (!server) throw new Error(`Unknown MCP server: ${serverId}`);
    const discovered = [];
    for (const tool of tools) {
      requireString(tool.name, "tool.name");
      const id = tool.id || this.idFactory("mcp_tool");
      const record = {
        id,
        serverId,
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || {},
        permissionScope: tool.permissionScope,
        modelDescription: tool.modelDescription || tool.description || tool.name,
        createdAt: now()
      };
      this.mcpTools.set(id, record);
      discovered.push(record);
    }
    server.lastDiscoveredAt = now();
    server.updatedAt = now();
    return discovered;
  }

  selectStepTools({ flowAllowedTools = [], skillAllowedTools = [], policyAllowedTools = [] }) {
    const allowedSets = [flowAllowedTools, skillAllowedTools, policyAllowedTools].filter((set) => set.length > 0);
    return [...this.mcpTools.values()].filter((tool) => {
      if (allowedSets.length === 0) return true;
      return allowedSets.every((set) => set.includes(tool.name) || set.includes(tool.id) || set.includes(tool.permissionScope));
    });
  }

  recordProviderCall(call) {
    const record = {
      id: call.id || this.idFactory("provider_call"),
      runId: call.runId,
      stepRunId: call.stepRunId,
      providerId: call.providerId,
      role: call.role,
      model: call.model,
      status: call.status,
      inputRef: call.inputRef,
      outputRef: call.outputRef,
      tokensInput: call.tokensInput || 0,
      tokensOutput: call.tokensOutput || 0,
      costUsd: call.costUsd || 0,
      durationMs: call.durationMs,
      retryCount: call.retryCount || 0,
      fallbackFromProviderId: call.fallbackFromProviderId,
      fallbackReason: call.fallbackReason,
      error: call.error,
      createdAt: now()
    };
    this.providerCalls.push(record);
    return record;
  }

  recordToolInvocation(invocation) {
    const record = {
      id: invocation.id || this.idFactory("tool_invocation"),
      runId: invocation.runId,
      stepRunId: invocation.stepRunId,
      skillInvocationId: invocation.skillInvocationId,
      mcpToolId: invocation.mcpToolId,
      toolName: invocation.toolName,
      status: invocation.status,
      inputRef: invocation.inputRef,
      outputRef: invocation.outputRef,
      durationMs: invocation.durationMs,
      retryCount: invocation.retryCount || 0,
      costUsd: invocation.costUsd || 0,
      error: invocation.error,
      createdAt: now()
    };
    this.toolInvocations.push(record);
    return record;
  }

  // --- Proxy request logging ---
  recordProxyRequest(request: {
    id?: string;
    runId?: string;
    clientId: string;
    model: string;
    providerId: string;
    isFallback: boolean;
    fallbackIndex: number;
    status: "success" | "error" | "fallback";
    tokensInput: number;
    tokensOutput: number;
    costUsd: number;
    durationMs: number;
    error?: string;
  }) {
    const record = {
      id: request.id || this.idFactory("proxy_request"),
      runId: request.runId,
      clientId: request.clientId,
      model: request.model,
      providerId: request.providerId,
      isFallback: request.isFallback,
      fallbackIndex: request.fallbackIndex,
      status: request.status,
      tokensInput: request.tokensInput,
      tokensOutput: request.tokensOutput,
      costUsd: request.costUsd,
      durationMs: request.durationMs,
      error: request.error,
      createdAt: now()
    };
    this.providerCalls.push(record);
    return record;
  }
}

export function createMvpProviderAdapters() {
  return [
    {
      id: "openai",
      name: "OpenAI",
      type: "llm",
      capabilities: { roles: ["planner", "synthesizer"], streaming: true }
    },
    {
      id: "anthropic",
      name: "Anthropic",
      type: "llm",
      capabilities: { roles: ["planner", "verifier"], streaming: true }
    },
    {
      id: "mvp-search",
      name: "MVP Search",
      type: "search",
      capabilities: { roles: ["search"], freshness: true }
    },
    {
      id: "jina-reader",
      name: "Jina Reader",
      type: "reader",
      capabilities: { roles: ["reader"], urlRead: true }
    }
  ];
}

export function createMvpMcpTools() {
  return [
    {
      name: "search.web",
      description: "Search the web for sources relevant to the current research subquestion.",
      permissionScope: "search:read",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          freshnessDays: { type: "number" }
        }
      }
    },
    {
      name: "reader.read_url",
      description: "Read and extract text from a URL selected by the research workflow.",
      permissionScope: "reader:read",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string" }
        }
      }
    }
  ];
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}
