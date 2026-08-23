import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
  ModelListResponse,
  ModelInfo,
} from "./proxy-api-types.js";

export type SupportedProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openrouter"
  | "workers-ai"
  | "nvidia"
  | "ollama-cloud"
  | "opencode-zen";

export interface ProviderRequestFormat {
  messages: Array<{ role: string; content: string | unknown[] | null; [key: string]: unknown }>;
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  system?: string;
  contents?: unknown[];
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ProviderResponseFormat {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: { role: string; content: string | null };
    delta?: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  // Gemini streaming format
  candidates?: Array<{
    index: number;
    content?: { parts: Array<{ text?: string }>; role?: string };
    finishReason?: string;
  }>;
}

export function normalizeChatCompletionRequest(
  openaiRequest: ChatCompletionRequest,
  targetProvider: SupportedProvider
): ProviderRequestFormat {
  const baseRequest: ProviderRequestFormat = {
    model: openaiRequest.model,
    messages: openaiRequest.messages.map(normalizeMessageForProvider),
    temperature: openaiRequest.temperature,
    max_tokens: openaiRequest.max_tokens,
    top_p: openaiRequest.top_p,
    stream: openaiRequest.stream,
    stop: openaiRequest.stop,
  };

  switch (targetProvider) {
    case "anthropic":
      return convertToAnthropicFormat(baseRequest);
    case "gemini":
      return convertToGeminiFormat(baseRequest);
    case "workers-ai":
      return convertToWorkersAIFormat(baseRequest);
    case "openai":
    case "groq":
    case "openrouter":
    case "nvidia":
    case "ollama-cloud":
    case "opencode-zen":
    default:
      return baseRequest;
  }
}

function normalizeMessageForProvider(msg: ChatMessage): { role: string; content: string | unknown[] | null; [key: string]: unknown } {
  const normalized: { role: string; content: string | unknown[] | null; [key: string]: unknown } = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.name) normalized.name = msg.name;
  if (msg.tool_calls) normalized.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) normalized.tool_call_id = msg.tool_call_id;
  return normalized;
}

function convertToAnthropicFormat(request: ProviderRequestFormat): ProviderRequestFormat {
  const messages = request.messages as Array<{ role: string; content: string | unknown[] | null; [key: string]: unknown }>;
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const anthropicRequest: ProviderRequestFormat = {
    ...request,
    messages: nonSystemMessages.map((m) => {
      const content = Array.isArray(m.content)
        ? m.content.map((c: unknown) => {
            if (
              c &&
              typeof c === "object" &&
              "type" in c &&
              c.type === "text" &&
              "text" in c &&
              typeof (c as Record<string, unknown>).text === "string"
            ) {
              return { type: "text", text: String((c as Record<string, unknown>).text) };
            }
            return c;
          })
        : [{ type: "text", text: String(m.content ?? "") }];

      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content,
      };
    }),
  };

  if (systemMessages.length > 0) {
    anthropicRequest.system = systemMessages
      .map((m) => {
        const msg = m as { content: string | unknown[] | null };
        if (Array.isArray(msg.content) && msg.content.length > 0) {
          const first = msg.content[0];
          if (first && typeof first === "object" && "text" in first) {
            return String((first as Record<string, unknown>).text);
          }
        }
        return String(msg.content ?? "");
      })
      .join("\n\n");
  }

  if (anthropicRequest.max_tokens) {
    anthropicRequest.max_tokens = Math.min(anthropicRequest.max_tokens, 8192);
  }

  return anthropicRequest;
}

function convertToGeminiFormat(request: ProviderRequestFormat): ProviderRequestFormat {
  const messages = request.messages as Array<{ role: string; content: string | unknown[] | null; [key: string]: unknown }>;
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: Array.isArray(m.content)
      ? m.content.map((c: unknown) => {
          if (
            c &&
            typeof c === "object" &&
            "type" in c &&
            c.type === "text" &&
            "text" in c &&
            typeof (c as Record<string, unknown>).text === "string"
          ) {
            return { text: String((c as Record<string, unknown>).text) };
          }
          return c;
        })
      : [{ text: String(m.content ?? "") }],
  }));

  const generationConfig: Record<string, unknown> = {};
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (request.max_tokens !== undefined) generationConfig.maxOutputTokens = request.max_tokens;
  if (request.top_p !== undefined) generationConfig.topP = request.top_p;
  if (request.stop !== undefined) generationConfig.stopSequences = Array.isArray(request.stop) ? request.stop : [request.stop];

  return {
    ...request,
    messages,
    contents,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
  };
}

function convertToWorkersAIFormat(request: ProviderRequestFormat): ProviderRequestFormat {
  return {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: String(m.content ?? ""),
    })),
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: request.stream,
  };
}

export function normalizeChatCompletionResponse(
  providerResponse: ProviderResponseFormat,
  openaiModelId: string,
  providerId: SupportedProvider
): ChatCompletionResponse {
  let content: string | null = null;
  let finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null = null;

  if (providerResponse.choices.length > 0) {
    const choice = providerResponse.choices[0];
    if (choice.message?.content) {
      content = choice.message.content;
    } else if (choice.delta?.content) {
      content = choice.delta.content;
    }
    finishReason = mapFinishReason(choice.finish_reason, providerId);
  }

  return {
    id: providerResponse.id,
    object: "chat.completion",
    created: providerResponse.created,
    model: openaiModelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: finishReason,
      },
    ],
    usage: providerResponse.usage
      ? {
          prompt_tokens: providerResponse.usage.prompt_tokens,
          completion_tokens: providerResponse.usage.completion_tokens,
          total_tokens: providerResponse.usage.total_tokens,
        }
      : undefined,
    system_fingerprint: undefined,
  };
}

export function normalizeStreamChunk(
  providerChunk: ProviderResponseFormat,
  openaiModelId: string,
  providerId: SupportedProvider
): ChatCompletionChunk {
  let deltaContent: string | undefined;
  let finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null = null;

  // Handle Gemini streaming format (different from OpenAI)
  if (providerId === "gemini" && providerChunk.candidates) {
    const candidate = providerChunk.candidates[0];
    if (candidate.content?.parts?.[0]?.text) {
      deltaContent = candidate.content.parts[0].text;
    }
    if (candidate.finishReason === "STOP" || candidate.finishReason === "MAX_TOKENS") {
      finishReason = candidate.finishReason === "MAX_TOKENS" ? "length" : "stop";
    }
  } else if (providerChunk.choices.length > 0) {
    const choice = providerChunk.choices[0];
    if (choice.delta?.content) {
      deltaContent = choice.delta.content;
    }
    finishReason = mapFinishReason(choice.finish_reason, providerId);
  }

  return {
    id: providerChunk.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: providerChunk.created || Math.floor(Date.now() / 1000),
    model: openaiModelId,
    choices: [
      {
        index: 0,
        delta: {
          role: deltaContent !== undefined ? "assistant" : undefined,
          content: deltaContent,
        },
        finish_reason: finishReason,
      },
    ],
  };
}

function mapFinishReason(
  reason: string | null,
  providerId: SupportedProvider
): "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null {
  if (!reason) return null;

  const reasonMap: Record<string, Record<string, "stop" | "length" | "tool_calls" | "content_filter" | "function_call">> = {
    anthropic: {
      end_turn: "stop",
      max_tokens: "length",
      stop_sequence: "stop",
      tool_use: "tool_calls",
    },
    gemini: {
      STOP: "stop",
      MAX_TOKENS: "length",
      SAFETY: "content_filter",
      RECITATION: "content_filter",
    },
    "workers-ai": {
      stop: "stop",
      length: "length",
    },
  };

  const mapped = reasonMap[providerId]?.[reason];
  if (mapped) return mapped;

  // Pass through if already a valid OpenAI finish_reason
  const validReasons = ["stop", "length", "tool_calls", "content_filter", "function_call"] as const;
  if (validReasons.includes(reason as typeof validReasons[number])) {
    return reason as "stop" | "length" | "tool_calls" | "content_filter" | "function_call";
  }

  return null;
}

export function normalizeModelList(
  providerModels: Array<{ id: string; object?: string; created?: number; owned_by?: string }>,
  providerId: SupportedProvider
): ModelListResponse {
  return {
    object: "list",
    data: providerModels.map((m) => ({
      id: m.id,
      object: "model",
      created: m.created ?? Math.floor(Date.now() / 1000),
      owned_by: m.owned_by ?? providerId,
    })),
  };
}