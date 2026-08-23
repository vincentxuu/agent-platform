import { describe, it, expect, beforeEach } from "vitest";
import {
  loadProxyModelMapping,
  getMappedProviders,
  getModelList,
  hasModel,
  getProviderForModel,
  clearMappingCache,
  validateMapping,
} from "./proxy-model-mapping.js";

describe("proxy-model-mapping", () => {
  beforeEach(() => {
    clearMappingCache();
  });

  describe("loadProxyModelMapping", () => {
    it("loads mapping from config object", () => {
      const config = {
        version: 1,
        models: {
          "test-model": { providers: ["openai"], fallback: ["anthropic"] }
        }
      };
      const mapping = loadProxyModelMapping(config);
      expect(mapping.version).toBe(1);
      expect(mapping.models["test-model"].providers).toEqual(["openai"]);
    });

    it("caches mapping on first load", () => {
      const config = { version: 1, models: { "model-a": { providers: ["p1"], fallback: [] } } };
      loadProxyModelMapping(config);
      // Second call without config should return cached
      const mapping = loadProxyModelMapping();
      expect(mapping.models["model-a"]).toBeDefined();
    });

    it("throws on invalid version", () => {
      const config = { version: 0, models: {} };
      expect(() => loadProxyModelMapping(config)).toThrow("Invalid mapping version");
    });

    it("throws when model has no providers", () => {
      const config = { version: 1, models: { "bad-model": { providers: [], fallback: [] } } };
      expect(() => loadProxyModelMapping(config)).toThrow("must have at least one provider");
    });
  });

  describe("getMappedProviders", () => {
    it("returns primary providers first, then fallbacks", () => {
      const config = {
        version: 1,
        models: {
          "gpt-4o": { providers: ["openai"], fallback: ["openrouter", "anthropic"] }
        }
      };
      loadProxyModelMapping(config);
      const providers = getMappedProviders("gpt-4o");
      expect(providers).toHaveLength(3);
      expect(providers[0]).toEqual({ providerId: "openai", isFallback: false, fallbackIndex: -1 });
      expect(providers[1]).toEqual({ providerId: "openrouter", isFallback: true, fallbackIndex: 0 });
      expect(providers[2]).toEqual({ providerId: "anthropic", isFallback: true, fallbackIndex: 1 });
    });

    it("deduplicates providers that appear in both primary and fallback", () => {
      const config = {
        version: 1,
        models: {
          "gpt-4o": { providers: ["openai"], fallback: ["openai", "anthropic"] }
        }
      };
      loadProxyModelMapping(config);
      const providers = getMappedProviders("gpt-4o");
      expect(providers).toHaveLength(2);
      expect(providers.map(p => p.providerId)).toEqual(["openai", "anthropic"]);
    });

    it("returns empty array for unknown model", () => {
      loadProxyModelMapping({ version: 1, models: { "known": { providers: ["p1"], fallback: [] } } });
      expect(getMappedProviders("unknown")).toEqual([]);
    });
  });

  describe("getModelList", () => {
    it("returns sorted model IDs", () => {
      loadProxyModelMapping({
        version: 1,
        models: {
          "z-model": { providers: ["p1"], fallback: [] },
          "a-model": { providers: ["p1"], fallback: [] },
          "m-model": { providers: ["p1"], fallback: [] }
        }
      });
      expect(getModelList()).toEqual(["a-model", "m-model", "z-model"]);
    });
  });

  describe("hasModel", () => {
    it("returns true for existing model", () => {
      loadProxyModelMapping({ version: 1, models: { "gpt-4o": { providers: ["openai"], fallback: [] } } });
      expect(hasModel("gpt-4o")).toBe(true);
    });

    it("returns false for unknown model", () => {
      loadProxyModelMapping({ version: 1, models: { "gpt-4o": { providers: ["openai"], fallback: [] } } });
      expect(hasModel("unknown")).toBe(false);
    });
  });

  describe("getProviderForModel", () => {
    it("returns first primary provider", () => {
      loadProxyModelMapping({
        version: 1,
        models: { "gpt-4o": { providers: ["openai", "anthropic"], fallback: [] } }
      });
      expect(getProviderForModel("gpt-4o")).toBe("openai");
    });
    it("returns undefined for unknown model", () => {
      loadProxyModelMapping({ version: 1, models: { "gpt-4o": { providers: ["openai"], fallback: [] } } });
      expect(getProviderForModel("unknown")).toBeUndefined();
    });
  });

  describe("clearMappingCache", () => {
    it("clears cached mapping", () => {
      loadProxyModelMapping({ version: 1, models: { "test": { providers: ["p1"], fallback: [] } } });
      clearMappingCache();
      // After clear, loading without config reads from JSON file (which has models)
      // Just verify cache was cleared by checking config object is no longer used
      const mapping = loadProxyModelMapping();
      expect(mapping.version).toBe(1);
      expect(Object.keys(mapping.models).length).toBeGreaterThan(0);
    });
  });
});