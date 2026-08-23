## 1. Core Infrastructure

- [x] 1.1 Add `proxy:write` scope to `ApiScope` type in `packages/runtime/src/api-gateway.ts`
- [x] 1.2 Add `proxy` budget fields to `ApiClientBudget` type in `packages/runtime/src/api-gateway.ts`
- [x] 1.3 Update `normalizeBudget` to handle proxy budget fields in `packages/runtime/src/api-gateway.ts`
- [x] 1.4 Update `isBudgetExceeded` to check proxy budget limits in `packages/runtime/src/api-gateway.ts`
- [x] 1.5 Update `authorizeRequest` to enforce proxy budget and rate limits for proxy endpoints in `packages/runtime/src/api-gateway.ts`

## 2. Model Mapping Configuration

- [x] 2.1 Create `packages/runtime/src/proxy-model-mapping.json` with initial model mappings for gpt-4o, gpt-4o-mini, claude-3.5-sonnet, gemini-2.0-flash
- [x] 2.2 Create `packages/runtime/src/proxy-model-mapping.ts` with config loader and validation
- [x] 2.3 Export `loadProxyModelMapping`, `getMappedProviders`, `getModelList` functions
- [x] 2.4 Add unit tests for config loading and validation

## 3. Request/Response Normalization

- [x] 3.1 Create `packages/runtime/src/proxy-normalization.ts`
- [x] 3.2 Implement `normalizeChatCompletionRequest(openaiRequest, targetProvider)` for OpenAI, Anthropic, Gemini, Groq, OpenRouter, Workers AI
- [x] 3.3 Implement `normalizeChatCompletionResponse(providerResponse, openaiModelId)` for all providers
- [x] 3.4 Implement `normalizeStreamChunk(providerChunk, openaiModelId)` for SSE format
- [x] 3.5 Implement `normalizeModelList(models, providerId)` for GET /v1/models
- [x] 3.6 Add unit tests for normalization functions with sample requests/responses

## 4. Proxy Handlers (Worker)

- [x] 4.1 Add `GET /v1/models` handler in `apps/worker/src/index.ts` using `handlePublicV1` with `proxy:write` scope
- [x] 4.2 Implement model list aggregation from mapping config and provider catalog
- [x] 4.3 Add `POST /v1/chat/completions` handler (non-streaming) in `apps/worker/src/index.ts`
- [x] 4.4 Implement provider routing with fallback chain using mapping config
- [x] 4.5 Add streaming support with SSE response for `stream: true`
- [x] 4.6 Implement error handling with OpenAI-format error responses
- [x] 4.7 Add request validation for OpenAI chat completion schema

## 5. Provider Integration

- [x] 5.1 Extend `ProviderRegistry` in `packages/runtime/src/provider-tool-routing.ts` with proxy model selection method
- [x] 5.2 Add proxy fallback logic with max 3 attempts and loop prevention
- [x] 5.3 Update provider readiness checks to exclude unready providers from proxy model list
- [x] 5.4 Integrate provider invocation logging for proxy requests

## 6. Observability Integration

- [x] 6.1 Add proxy request span creation in `ObservabilityEvidenceArtifacts` (type: `proxy_request`)
- [x] 6.2 Add proxy metrics: `proxy_request_duration_ms`, `proxy_tokens_input`, `proxy_tokens_output`, `proxy_cost_usd`, `proxy_fallback_count`, `proxy_stream_chunks`
- [x] 6.3 Add proxy metrics aggregation by client, model, provider
- [x] 6.4 Record fallback attempts in trace spans with provider, status, error, duration

## 7. Policy Integration

- [x] 7.1 Add proxy policy configuration to policy schema (allowedModels, deniedModels, proxy budget)
- [x] 7.2 Implement proxy model allow/deny list guard in policy runtime
- [x] 7.3 Add proxy budget tracking separate from run budgets
- [x] 7.4 Add proxy daily budget enforcement with window reset

## 8. Configuration & Deployment

- [ ] 8.1 Add route patterns for `/v1/models*` and `/v1/chat/completions*` in `wrangler.toml`
- [ ] 8.2 Update `wrangler.toml` with any new bindings needed
- [ ] 8.3 Document model mapping config format in README or docs
- [ ] 8.4 Create example API client configuration for proxy access

## 9. Testing & Validation

- [ ] 9.1 Write integration tests for GET /v1/models with various auth scenarios
- [ ] 9.2 Write integration tests for POST /v1/chat/completions non-streaming
- [ ] 9.3 Write integration tests for POST /v1/chat/completions streaming
- [ ] 9.4 Write integration tests for fallback behavior
- [ ] 9.5 Write integration tests for budget and rate limit enforcement
- [ ] 9.6 Test with OpenAI SDK client against deployed worker
- [ ] 9.7 Validate observability dashboard shows proxy metrics correctly