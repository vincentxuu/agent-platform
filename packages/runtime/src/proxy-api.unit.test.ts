import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadProxyModelMapping, getMappedProviders, getModelList } from "./proxy-model-mapping.js";
import { normalizeChatCompletionRequest, normalizeChatCompletionResponse, normalizeStreamChunk, normalizeModelList } from "./proxy-normalization.js";
import { PolicyRuntimeControls } from "./policy-runtime-controls.js";
import { createStandardResearchPolicy } from "./policy-runtime-controls.js";

describe("Proxy API Unit Tests", () => {
  describe("Model Mapping", () => {
    it("loads proxy model mapping", () => {
      const mapping = loadProxyModelMapping();
      expect(mapping.version).toBe(1);
      expect(mapping.models).toBeDefined();
      expect(Object.keys(mapping.models).length).toBeGreaterThan(0);
    });

    it("gets mapped providers for known model", () => {
      const providers = getMappedProviders("gpt-4o");
      expect(providers.length).toBeGreaterThan(0);
      expect(providers[0].providerId).toBe("openai");
      expect(providers[0].isFallback).toBe(false);
    });

    it("returns empty for unknown model", () => {
      const providers = getMappedProviders("unknown-model-xyz");
      expect(providers).toEqual([]);
    });

    it("gets model list", () => {
      const models = getModelList();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
      expect(models).toContain("gpt-4o");
    });
  });

  describe("Request/Response Normalization", () => {
    const sampleRequest = {
      model: "gpt-4o",
      messages: [
        { role: "system" as const, content: "You are helpful" },
        { role: "user" as const, content: "Hello" }
      ],
      temperature: 0.7,
      max_tokens: 100,
      stream: false
    };

    const mockResponse = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1699999999,
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant" as const, content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    };

    it("normalizes for OpenAI-compatible providers", () => {
      for (const provider of ["openai", "groq", "openrouter", "nvidia", "ollama-cloud", "opencode-zen"] as const) {
        const result = normalizeChatCompletionRequest(sampleRequest, provider);
        expect(result.model).toBe("gpt-4o");
        expect(result.messages).toHaveLength(2);
        expect(result.temperature).toBe(0.7);
        expect(result.max_tokens).toBe(100);
      }
    });

    it("converts system messages for Anthropic", () => {
      const result = normalizeChatCompletionRequest(sampleRequest, "anthropic");
      expect(result.system).toBe("You are helpful");
      expect(result.messages).toHaveLength(1); // Only user message remains
      expect(result.messages[0].role).toBe("user");
    });

    it("converts to Gemini format", () => {
      const result = normalizeChatCompletionRequest(sampleRequest, "gemini");
      expect(result.contents).toBeDefined();
      expect(result.contents).toHaveLength(2);
      expect(result.generationConfig?.temperature).toBe(0.7);
      expect(result.generationConfig?.maxOutputTokens).toBe(100);
    });

    it("normalizes chat completion response", () => {
      const result = normalizeChatCompletionResponse(mockResponse, "gpt-4o", "openai");
      expect(result.id).toBe("chatcmpl-123");
      expect(result.model).toBe("gpt-4o");
      expect(result.choices[0].message.content).toBe("Hello!");
      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.usage?.total_tokens).toBe(15);
    });

    it("maps Anthropic finish_reason", () => {
      const response = { ...mockResponse, choices: [{ index: 0, message: { role: "assistant" as const, content: "Hi" }, finish_reason: "end_turn" }] };
      const result = normalizeChatCompletionResponse(response, "claude-3.5-sonnet", "anthropic");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("maps Gemini finish_reason", () => {
      const response = { ...mockResponse, choices: [{ index: 0, message: { role: "assistant" as const, content: "Hi" }, finish_reason: "STOP" }] };
      const result = normalizeChatCompletionResponse(response, "gemini-2.0-flash", "gemini");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("normalizes stream chunk", () => {
      const mockChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1699999999,
        model: "gpt-4o",
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }]
      };

      const result = normalizeStreamChunk(mockChunk, "gpt-4o", "openai");
      expect(result.id).toBe("chatcmpl-123");
      expect(result.choices[0].delta.content).toBe("Hello");
      expect(result.choices[0].finish_reason).toBeNull();
    });

    it("normalizes model list", () => {
      const providerModels = [
        { id: "model-a", created: 1234567890, owned_by: "openai" },
        { id: "model-b", created: 1234567891, owned_by: "anthropic" }
      ];
      const result = normalizeModelList(providerModels, "openai");
      expect(result.object).toBe("list");
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("model-a");
    });
  });

  describe("Proxy Policy Guards", () => {
    let policyControls: PolicyRuntimeControls;

    beforeEach(() => {
      policyControls = new PolicyRuntimeControls();
      const policy = createStandardResearchPolicy();
      policy.id = "test-policy";
      (policy as any).proxy = {
        allowedModels: ["gpt-4o", "claude-3.5-sonnet"],
        deniedModels: ["gpt-4"],
        budget: {
          maxCostUsd: 10.0,
          maxTokens: 100000,
          maxDailyCost: 5.0,
          maxDailyTokens: 50000,
          maxRequestsPerMinute: 60
        }
      };
      policyControls.registerPolicy(policy);
    });

    it("allows allowed model", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4o",
        usage: { proxyCostUsd: 1, proxyTokens: 100, proxyRequests: 1 },
        isStreaming: false
      });
      expect(result.some(r => r.status === "blocked")).toBe(false);
    });

    it("blocks denied model", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4",
        usage: { proxyCostUsd: 1, proxyTokens: 100 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.model_denied");
      expect(blocked).toBeDefined();
      expect(blocked?.message).toContain("gpt-4");
    });

    it("blocks model not in allowed list", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-3.5-turbo",
        usage: { proxyCostUsd: 1, proxyTokens: 100 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.model_denied");
      expect(blocked).toBeDefined();
      expect(blocked?.message).toContain("gpt-3.5-turbo");
    });

    it("blocks when cost budget exceeded", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4o",
        usage: { proxyCostUsd: 15, proxyTokens: 100 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.budget.cost");
      expect(blocked).toBeDefined();
    });

    it("blocks when tokens budget exceeded", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4o",
        usage: { proxyCostUsd: 1, proxyTokens: 150000 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.budget.tokens");
      expect(blocked).toBeDefined();
    });

    it("blocks when daily cost budget exceeded", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4o",
        usage: { proxyCostUsd: 1, proxyTokens: 100, proxyDailyCost: 10 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.budget.daily_cost");
      expect(blocked).toBeDefined();
    });

    it("blocks when rate limit exceeded", () => {
      const result = policyControls.runProxyGuards({
        policyId: "test-policy",
        runId: "run-1",
        stepRunId: "step-1",
        clientId: "client-1",
        model: "gpt-4o",
        usage: { proxyCostUsd: 1, proxyTokens: 100, proxyRequestsThisMinute: 100 },
        isStreaming: false
      });
      const blocked = result.find(r => r.status === "blocked" && r.guardType === "proxy.rate_limit");
      expect(blocked).toBeDefined();
    });

    it("returns proxy budget status", () => {
      const status = policyControls.getProxyBudgetStatus("test-policy", {
        proxyCostUsd: 5,
        proxyTokens: 50000,
        proxyRequests: 10,
        proxyDailyCost: 2,
        proxyDailyTokens: 20000,
        proxyRequestsThisMinute: 10
      });
      expect(status.costPercent).toBe(50);
      expect(status.tokensPercent).toBe(50);
    });
  });

  describe("Model List Aggregation", () => {
    it("includes mapped models", () => {
      const mapping = loadProxyModelMapping();
      const models = getModelList(mapping);
      expect(models).toContain("gpt-4o");
      expect(models).toContain("claude-3.5-sonnet");
      expect(models).toContain("gemini-2.0-flash");
    });

    it("includes free models from mapping", () => {
      const mapping = loadProxyModelMapping();
      const models = getModelList(mapping);
      expect(models).toContain("nemotron-3-ultra");
      expect(models).toContain("gpt-oss-120b");
      expect(models).toContain("glm-5.2");
      expect(models).toContain("hy3");
    });
  });
});