import defaultMappingJSON from "./proxy-model-mapping.json" with { type: "json" };
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const defaultMapping = defaultMappingJSON as any;

export interface ProxyModelMapping {
  version: number;
  models: Record<string, ModelMappingEntry>;
}

export interface ModelMappingEntry {
  providers: string[];
  fallback: string[];
}

export interface MappedProvider {
  providerId: string;
  isFallback: boolean;
  fallbackIndex: number;
}

let cachedMapping: ProxyModelMapping | null = null;

export function loadProxyModelMapping(config?: ProxyModelMapping): ProxyModelMapping {
  if (config) {
    validateMapping(config);
    cachedMapping = config;
    return config;
  }

  if (cachedMapping) {
    return cachedMapping;
  }

  // Use statically imported mapping (bundled by esbuild)
  const mapping = defaultMapping as ProxyModelMapping;
  validateMapping(mapping);
  cachedMapping = mapping;
  return mapping;
}

export function validateMapping(mapping: ProxyModelMapping): void {
  if (typeof mapping.version !== "number" || mapping.version < 1) {
    throw new Error("Invalid mapping version");
  }
  if (!mapping.models || typeof mapping.models !== "object") {
    throw new Error("Mapping must contain models object");
  }

  for (const [modelId, entry] of Object.entries(mapping.models)) {
    if (!entry.providers || !Array.isArray(entry.providers) || entry.providers.length === 0) {
      throw new Error(`Model ${modelId} must have at least one provider`);
    }
    if (entry.fallback && !Array.isArray(entry.fallback)) {
      throw new Error(`Model ${modelId} fallback must be an array`);
    }
  }
}

export function getMappedProviders(modelId: string, mapping?: ProxyModelMapping): MappedProvider[] {
  const map = mapping ?? loadProxyModelMapping();
  const entry = map.models[modelId];
  if (!entry) {
    return [];
  }

  const result: MappedProvider[] = [];

  // Primary providers
  for (const providerId of entry.providers) {
    result.push({ providerId, isFallback: false, fallbackIndex: -1 });
  }

  // Fallback providers
  for (let i = 0; i < entry.fallback.length; i++) {
    const providerId = entry.fallback[i];
    // Avoid duplicates
    if (!result.some(p => p.providerId === providerId)) {
      result.push({ providerId, isFallback: true, fallbackIndex: i });
    }
  }

  return result;
}

export function getModelList(mapping?: ProxyModelMapping): string[] {
  const map = mapping ?? loadProxyModelMapping();
  return Object.keys(map.models).sort();
}

export function hasModel(modelId: string, mapping?: ProxyModelMapping): boolean {
  const map = mapping ?? loadProxyModelMapping();
  return modelId in map.models;
}

export function getProviderForModel(modelId: string, mapping?: ProxyModelMapping): string | undefined {
  const providers = getMappedProviders(modelId, mapping);
  return providers[0]?.providerId;
}

export function clearMappingCache(): void {
  cachedMapping = null;
}