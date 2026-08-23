import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeChatCompletionRequest,
  normalizeChatCompletionResponse,
  normalizeStreamChunk,
  normalizeModelList,
} from "./proxy-normalization.js";
import type { ChatCompletionRequest, ChatMessage } from "./proxy-api-types.js";
import type { ProviderResponseFormat, SupportedProvider } from "./proxy-normalization.js";
describe("proxy-normalization", () => {
  const sampleMessages: ChatMessage[] = [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
  ];

  const sampleRequest: ChatCompletionRequest = {
    model: "gpt-4o",
    messages: sampleMessages,
    temperature: 0.7,
    max_tokens: 100,
    stream: false,
  };

  describe("normalizeChatCompletionRequest", () => {
    it("passes through OpenAI-compatible providers unchanged", () => {
      for (const provider of ["openai", "groq", "openrouter", "nvidia", "ollama-cloud", "opencode-zen"] as const) {
        const result = normalizeChatCompletionRequest(sampleRequest, provider);
        expect(result.model).toBe("gpt-4o");
        expect(result.messages).toHaveLength(3);
        expect(result.temperature).toBe(0.7);
        expect(result.max_tokens).toBe(100);
      }
    });

    it("converts system messages for Anthropic", () => {
      const result = normalizeChatCompletionRequest(sampleRequest, "anthropic");
      expect(result.system).toBe("You are a helpful assistant");
      expect(result.messages).toHaveLength(2); // system removed
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
    });

    it("converts to Gemini format", () => {
      const result = normalizeChatCompletionRequest(sampleRequest, "gemini");
      expect(result.contents).toBeDefined();
      expect(result.contents).toHaveLength(3);
      expect(result.generationConfig?.temperature).toBe(0.7);
      expect(result.generationConfig?.maxOutputTokens).toBe(100);
    });

    it("converts to Workers AI format", () => {
      const result = normalizeChatCompletionRequest(sampleRequest, "workers-ai");
      expect(result.messages).toHaveLength(3);
      expect(result.model).toBe("gpt-4o");
    });

    it("handles array content", () => {
      const requestWithArrayContent: ChatCompletionRequest = {
        model: "gpt-4o",
        messages: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      };
      const result = normalizeChatCompletionRequest(requestWithArrayContent, "openai");
      expect(Array.isArray(result.messages[0].content)).toBe(true);
    });
  });

  describe("normalizeChatCompletionResponse", () => {
    const mockProviderResponse: ProviderResponseFormat = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1699999999,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    it("normalizes OpenAI-compatible response", () => {
      const result = normalizeChatCompletionResponse(mockProviderResponse, "gpt-4o", "openai");
      expect(result.id).toBe("chatcmpl-123");
      expect(result.model).toBe("gpt-4o");
      expect(result.choices[0].message.content).toBe("Hello!");
      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.usage?.total_tokens).toBe(15);
    });

    it("maps Anthropic finish_reason", () => {
      const anthropicResponse = {
        ...mockProviderResponse,
        choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "end_turn" }],
      };
      const result = normalizeChatCompletionResponse(anthropicResponse, "claude-3.5-sonnet", "anthropic");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("maps Gemini finish_reason", () => {
      const geminiResponse = {
        ...mockProviderResponse,
        choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "STOP" }],
      };
      const result = normalizeChatCompletionResponse(geminiResponse, "gemini-2.0-flash", "gemini");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("maps Workers AI finish_reason", () => {
      const workersResponse = {
        ...mockProviderResponse,
        choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "length" }],
      };
      const result = normalizeChatCompletionResponse(workersResponse, "llama-3.3-70b", "workers-ai");
      expect(result.choices[0].finish_reason).toBe("length");
    });
  });

  describe("normalizeStreamChunk", () => {
    const mockChunk: ProviderResponseFormat = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1699999999,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: { content: "Hello" },
          finish_reason: null,
        },
      ],
    };

    it("normalizes streaming chunk", () => {
      const result = normalizeStreamChunk(mockChunk, "gpt-4o", "openai");
      expect(result.id).toBe("chatcmpl-123");
      expect(result.choices[0].delta.content).toBe("Hello");
      expect(result.choices[0].delta.role).toBe("assistant");
      expect(result.choices[0].finish_reason).toBeNull();
    });

    it("handles final chunk with finish_reason", () => {
      const finalChunk = {
        ...mockChunk,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      const result = normalizeStreamChunk(finalChunk, "gpt-4o", "openai");
      expect(result.choices[0].finish_reason).toBe("stop");
    });
  });

  describe("normalizeModelList", () => {
    it("normalizes model list from provider", () => {
      const providerModels = [
        { id: "model-a", created: 1234567890, owned_by: "openai" },
        { id: "model-b", created: 1234567891, owned_by: "anthropic" },
      ];
      const result = normalizeModelList(providerModels, "openai");
      expect(result.object).toBe("list");
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe("model-a");
      expect(result.data[0].owned_by).toBe("openai");
    });

    it("handles missing fields with defaults", () => {
      const providerModels = [{ id: "model-x" }];
      const result = normalizeModelList(providerModels, "openai");
      expect(result.data[0].id).toBe("model-x");
      expect(result.data[0].owned_by).toBe("openai");
      expect(result.data[0].created).toBeDefined();
    });
  });
});