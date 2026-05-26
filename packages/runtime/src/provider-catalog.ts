// @ts-nocheck
import providerCatalogConfig from "./provider-config.json" with { type: "json" };

export const PROVIDER_MODEL_CATALOG = providerCatalogConfig.providers;
export const DEFAULT_ALLOWED_PROVIDER_IDS = providerCatalogConfig.defaultAllowedProviderIds;

export function getProviderCatalogEntry(id) {
  return PROVIDER_MODEL_CATALOG.find((provider) => provider.id === id);
}

export async function fetchProviderModelIds(providerId, resolveSecret = (_secretName, _providerId) => "", options = {}) {
  const provider = String(providerId || "").trim().toLowerCase();

  if (provider === "groq" || provider === "openai") {
    return fetchOpenAiLikeModels(
      provider === "groq" ? "https://api.groq.com/openai/v1/models" : "https://api.openai.com/v1/models",
      resolveSecret(provider === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY", provider),
      provider
    );
  }

  if (provider === "gemini" || provider === "google") {
    return fetchGoogleModels(resolveSecret("GEMINI_API_KEY", provider) || resolveSecret("GOOGLE_API_KEY", provider));
  }

  if (provider === "anthropic") {
    return fetchAnthropicModels(resolveSecret("ANTHROPIC_API_KEY", provider));
  }

  if (provider === "openrouter") {
    return fetchOpenRouterModels(resolveSecret("OPENROUTER_API_KEY", provider));
  }

  if (provider === "nvidia") {
    return fetchOpenAiLikeModels("https://integrate.api.nvidia.com/v1/models", resolveSecret("NVIDIA_API_KEY", provider), provider);
  }

  if (provider === "cerebras") {
    return fetchOpenAiLikeModels("https://api.cerebras.ai/v1/models", resolveSecret("CEREBRAS_API_KEY", provider), provider);
  }

  if (provider === "workers_ai" || provider === "cloudflare") {
    const accountId = resolveSecret("CLOUDFLARE_ACCOUNT_ID", provider) || options.cloudflareAccountId;
    const apiToken = resolveSecret("CLOUDFLARE_API_TOKEN", provider) || options.cloudflareApiToken;
    return fetchCloudflareModels(accountId, apiToken);
  }

  if (provider === "ollama_cloud") {
    return fetchOllamaCloudModels(resolveSecret("OLLAMA_CLOUD_API_KEY", provider) || resolveSecret("OLLAMA_API_KEY", provider));
  }

  if (provider === "ollama") {
    const baseUrl = resolveSecret("OLLAMA_API_BASE", provider)
      || resolveSecret("OLLAMA_HOST", provider)
      || resolveSecret("OLLAMA_URL", provider)
      || options.ollamaBaseUrl
      || "http://localhost:11434";
    return fetchOllamaLocalModels(baseUrl);
  }

  return [];
}

export function createProviderConfigs(env = {}, options = {}) {
  return PROVIDER_MODEL_CATALOG.map((provider) => ({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    enabled: Boolean(provider.enabled),
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

async function fetchOpenAiLikeModels(url, apiKey, provider) {
  if (!apiKey) throw new Error(`${provider.toUpperCase()}_API_KEY is missing`);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`OpenAI-compatible API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map((item) => typeof item?.id === "string" ? item.id.trim() : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error(`${provider} model list API failed`);
  }
}

async function fetchGoogleModels(apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is missing");
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw new Error(`Google models API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models.map((item) => typeof item?.name === "string" ? item.name.trim().replace(/^models\//, "") : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error("gemini model list API failed");
  }
}

async function fetchAnthropicModels(apiKey) {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing");
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": apiKey
      }
    });
    if (!response.ok) {
      throw new Error(`Anthropic API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map((item) => typeof item?.id === "string" ? item.id.trim() : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error("anthropic model list API failed");
  }
}

async function fetchOpenRouterModels(apiKey) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.data) ? payload.data : [];
    return data.map((item) => typeof item?.id === "string" ? item.id.trim() : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error("openrouter model list API failed");
  }
}

async function fetchCloudflareModels(accountId, apiToken) {
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is missing");
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is missing");
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search`, {
      headers: { authorization: `Bearer ${apiToken}` }
    });
    if (!response.ok) {
      throw new Error(`Cloudflare Models API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.result) ? payload.result : [];
    return data.map((item) => typeof item?.name === "string" ? item.name.trim() : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error("workers_ai model list API failed");
  }
}

async function fetchOllamaCloudModels(apiKey) {
  if (!apiKey) throw new Error("OLLAMA_CLOUD_API_KEY or OLLAMA_API_KEY is missing");
  try {
    const response = await fetch("https://ollama.com/api/tags", {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      throw new Error(`Ollama Cloud API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.models) ? payload.models : [];
    return data.map((item) => typeof item?.model === "string" ? item.model.trim() : "").filter(Boolean);
  } catch (error) {
    if (error?.message?.includes("is missing")) throw error;
    throw new Error("ollama_cloud model list API failed");
  }
}

async function fetchOllamaLocalModels(baseUrl) {
  const normalized = String(baseUrl || "http://localhost:11434").trim().replace(/\/+$/, "").replace(/\/api\/generate$/i, "").replace(/\/v1$/i, "");
  try {
    const response = await fetch(`${normalized}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama local API failed (${response.status}): ${await response.text()}`);
    }
    const payload = await response.json().catch(() => null);
    const data = Array.isArray(payload?.models) ? payload.models : [];
    return data
      .map((item) => {
        if (typeof item?.name === "string") return item.name.trim();
        if (typeof item?.model === "string") return item.model.trim();
        return "";
      })
      .filter(Boolean);
  } catch (error) {
    throw new Error("ollama local model list API failed");
  }
}
