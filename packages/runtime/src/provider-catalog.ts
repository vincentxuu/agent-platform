// @ts-nocheck
export const PROVIDER_MODEL_CATALOG = [
  {
    id: "workers_ai",
    name: "Workers AI",
    type: "llm",
    credentialRefs: ["AI binding"],
    readinessKeys: ["AI"],
    models: ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
    activeModel: "@cf/meta/llama-3.1-8b-instruct"
  },
  {
    id: "groq",
    name: "Groq",
    type: "llm",
    credentialRefs: ["GROQ_API_KEY"],
    readinessKeys: ["GROQ_API_KEY"],
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    activeModel: "llama-3.3-70b-versatile"
  },
  {
    id: "openai",
    name: "OpenAI",
    type: "llm",
    credentialRefs: ["OPENAI_API_KEY"],
    readinessKeys: ["OPENAI_API_KEY"],
    models: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    activeModel: "gpt-4.1-mini"
  },
  {
    id: "anthropic",
    name: "Anthropic",
    type: "llm",
    credentialRefs: ["ANTHROPIC_API_KEY"],
    readinessKeys: ["ANTHROPIC_API_KEY"],
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    activeModel: "claude-3-5-sonnet-latest"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    type: "llm",
    credentialRefs: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    readinessKeys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    activeModel: "gemini-2.0-flash"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    type: "llm",
    credentialRefs: ["OPENROUTER_API_KEY"],
    readinessKeys: ["OPENROUTER_API_KEY"],
    models: ["openrouter/auto"],
    activeModel: "openrouter/auto"
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    type: "llm",
    credentialRefs: ["NVIDIA_API_KEY"],
    readinessKeys: ["NVIDIA_API_KEY"],
    models: ["meta/llama-3.1-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct"],
    activeModel: "meta/llama-3.1-70b-instruct"
  },
  {
    id: "cerebras",
    name: "Cerebras",
    type: "llm",
    credentialRefs: ["CEREBRAS_API_KEY"],
    readinessKeys: ["CEREBRAS_API_KEY"],
    models: ["llama-3.3-70b", "llama3.1-8b"],
    activeModel: "llama-3.3-70b"
  },
  {
    id: "ollama_cloud",
    name: "Ollama Cloud",
    type: "llm",
    credentialRefs: ["OLLAMA_CLOUD_API_KEY", "OLLAMA_API_KEY"],
    readinessKeys: ["OLLAMA_CLOUD_API_KEY", "OLLAMA_API_KEY"],
    models: ["gpt-oss:20b", "llama3.2"],
    activeModel: "gpt-oss:20b"
  },
  {
    id: "ollama",
    name: "Ollama",
    type: "llm",
    credentialRefs: ["OLLAMA_API_BASE", "OLLAMA_HOST", "OLLAMA_URL"],
    readinessKeys: ["OLLAMA_API_BASE", "OLLAMA_HOST", "OLLAMA_URL"],
    models: ["llama3.2", "qwen2.5", "mistral"],
    activeModel: "llama3.2"
  },
  {
    id: "search",
    name: "Search",
    type: "search",
    credentialRefs: ["TAVILY_API_KEY", "EXA_API_KEY", "JINA_SEARCH_API_KEY"],
    readinessKeys: ["TAVILY_API_KEY", "EXA_API_KEY", "JINA_SEARCH_API_KEY"],
    models: ["tavily-search", "exa-search", "jina-search"],
    activeModel: "tavily-search"
  },
  {
    id: "jina",
    name: "Jina Reader",
    type: "reader",
    credentialRefs: ["JINA_API_KEY"],
    readinessKeys: ["JINA_API_KEY"],
    models: ["jina-reader", "jina-reranker-v2-base-multilingual"],
    activeModel: "jina-reader"
  }
];

export const DEFAULT_ALLOWED_PROVIDER_IDS = ["workers_ai", "groq", "openai", "anthropic", "gemini", "openrouter", "search", "jina"];

export function createProviderConfigs(env = {}, options = {}) {
  const readiness = createProviderReadiness(env, options);
  return PROVIDER_MODEL_CATALOG.map((provider) => ({
    id: provider.id,
    name: provider.name,
    enabled: Boolean(readiness[provider.id]),
    credentialRef: provider.credentialRefs.join(" or "),
    models: [...provider.models],
    activeModel: provider.activeModel
  }));
}

export function createProviderReadiness(env = {}, options = {}) {
  return Object.fromEntries(PROVIDER_MODEL_CATALOG.map((provider) => {
    if (provider.id === "workers_ai" && options.localWorkersAiReady) {
      return [provider.id, true];
    }
    return [provider.id, provider.readinessKeys.some((key) => Boolean(env[key]))];
  }));
}

export function createProviderReadinessChecks(env = {}, options = {}) {
  const readiness = createProviderReadiness(env, options);
  return PROVIDER_MODEL_CATALOG.map((provider) => ({
    id: provider.id,
    name: provider.name,
    ready: Boolean(readiness[provider.id]),
    detail: createProviderReadinessDetail(provider, env, readiness[provider.id])
  }));
}

function createProviderReadinessDetail(provider, env, ready) {
  if (ready) {
    const configured = provider.readinessKeys.find((key) => Boolean(env[key]));
    return configured ? `${configured} is configured.` : `${provider.name} is available in this runtime.`;
  }

  if (provider.id === "workers_ai") {
    return "Configure the Workers AI binding named AI.";
  }

  return `Set one of: ${provider.credentialRefs.join(", ")}.`;
}
