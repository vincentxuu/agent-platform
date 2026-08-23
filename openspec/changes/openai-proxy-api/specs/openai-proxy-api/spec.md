## ADDED Requirements

### Requirement: OpenAI-compatible model listing
The system SHALL expose `GET /v1/models` returning an OpenAI-format model list aggregated from enabled providers with model mapping configuration.

#### Scenario: List available models
- **WHEN** an authenticated client with `proxy:write` scope sends `GET /v1/models`
- **THEN** the system returns 200 with `{ object: "list", data: Model[] }` where each Model has `id`, `object: "model", created, owned_by` fields populated from model mapping config and provider catalog

#### Scenario: Unauthorized request rejected
- **WHEN** a request lacks valid Authorization header or valid API key
- **THEN** the system returns 401 with OpenAI-format error `{ error: { message, type, code } }`

#### Scenario: Insufficient scope rejected
- **WHEN** a valid API key lacks `proxy:write` scope
- **THEN** the system returns 403 with OpenAI-format error `{ error: { message: "Insufficient scope", type: "insufficient_scope", code: "scope_required" } }`

### Requirement: OpenAI-compatible chat completions
The system SHALL expose `POST /v1/chat/completions` accepting OpenAI-format requests, routing to mapped providers with fallback, and returning OpenAI-format responses (non-streaming and streaming).

#### Scenario: Non-streaming chat completion
- **WHEN** an authenticated client with `proxy:write` scope sends `POST /v1/chat/completions` with `{ model, messages, stream: false, ... }`
- **THEN** the system routes to the mapped provider, normalizes request/response, and returns 200 with OpenAI-format response `{ id, object: "chat.completion", created, model, choices, usage }`

#### Scenario: Streaming chat completion
- **WHEN** an authenticated client sends `POST /v1/chat/completions` with `stream: true`
- **THEN** the system returns 200 with `Content-Type: text/event-stream` and emits OpenAI-format SSE chunks: `data: { id, object: "chat.completion.chunk", created, model, choices: [{ delta, index, finish_reason }] }\n\n` ending with `data: [DONE]\n\n`

#### Scenario: Model not found
- **WHEN** request specifies a model not in model mapping config
- **THEN** the system returns 404 with OpenAI-format error `{ error: { message: "Model not found", type: "invalid_request_error", code: "model_not_found" } }`

#### Scenario: Provider failure triggers fallback
- **WHEN** primary mapped provider returns error or exceeds timeout
- **THEN** the system attempts next fallback provider per mapping config priority and returns successful response or final error after all fallbacks exhausted

#### Scenario: Request validation error
- **WHEN** request body fails OpenAI schema validation (missing model, invalid messages format)
- **THEN** the system returns 400 with OpenAI-format error `{ error: { message, type: "invalid_request_error", code } }`

#### Scenario: Budget guard enforced
- **WHEN** request would exceed client's `proxy.maxTokensPerRequest` or `proxy.maxCostUsdPerRequest`
- **THEN** the system returns 429 with OpenAI-format error `{ error: { message: "Budget exceeded", type: "rate_limit_error", code: "budget_exceeded" } }` and `Retry-After` header

#### Scenario: Rate limit enforced
- **WHEN** client exceeds `requestsPerMin` rate limit
- **THEN** the system returns 429 with OpenAI-format error and `Retry-After` header

### Requirement: Proxy request observability
The system SHALL emit structured traces and metrics for every proxy request including latency, token usage, cost, fallback count, and streaming chunk count.

#### Scenario: Trace created for proxy request
- **WHEN** a proxy request is received
- **THEN** a trace span is created with type `proxy_request`, name `chat_completion` or `model_list`, linked to client ID and model ID

#### Scenario: Metrics recorded
- **WHEN** a proxy request completes
- **THEN** metrics are recorded: `proxy_request_duration_ms`, `proxy_tokens_input`, `proxy_tokens_output`, `proxy_cost_usd`, `proxy_fallback_count`, `proxy_stream_chunks` (for streaming)