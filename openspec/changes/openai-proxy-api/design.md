## Context

The agent platform currently exposes a `/v1` API for flow runs, artifacts, and evidence (see `apps/worker/src/index.ts` lines 426-542). The platform has a provider registry (`packages/runtime/src/provider-catalog.ts`, `provider-tool-routing.ts`) supporting multiple LLM providers (OpenAI, Anthropic, Gemini, Groq, Workers AI, OpenRouter, etc.) with model catalogs, credential management, and readiness checks.

Auth uses API keys with scopes (`runs:write`, `runs:read`, `artifacts:read`, `evidence:read`, `flows:read`) via `packages/runtime/src/api-gateway.ts`. Policy runtime controls enforce budget, rate limits, and guards (`packages/runtime/src/policy-runtime-controls.ts`). Observability captures traces, metrics, and evidence (`packages/runtime/src/observability-evidence-artifacts.ts`).

The goal is to add an OpenAI-compatible proxy layer at `/v1/models` and `/v1/chat/completions` that routes to existing provider adapters.

## Goals / Non-Goals

**Goals:**
- Expose `GET /v1/models` returning OpenAI-format model list aggregated from enabled providers
- Expose `POST /v1/chat/completions` with OpenAI request/response format, streaming (SSE) support
- Map OpenAI model IDs (e.g., `gpt-4o`, `claude-3.5-sonnet`) to internal provider adapters with fallback chains
- Auth via existing API key system with new `proxy:write` scope
- Request/response normalization between OpenAI format and provider-specific formats
- Budget guards (per-request token limits, cost ceilings) and rate limiting at proxy layer
- Full observability integration (request traces, latency/cost metrics, streaming chunk metrics)
- Worker route registration for `/v1/*` paths in wrangler config

**Non-Goals:**
- Completions API (`/v1/completions`) — chat completions only
- Embeddings API (`/v1/embeddings`)
- Fine-tuning, moderation, or audio APIs
- Admin UI for model mapping configuration (config-driven initially)
- Multi-tenant model routing (single global mapping for MVP)
- Provider credential management via proxy (uses existing admin APIs)

## Decisions

### 1. New Scope: `proxy:write`

**Decision**: Add `proxy:write` to `ApiScope` in `api-gateway.ts`.

**Rationale**: Separates proxy access from flow/artifact scopes. Allows clients to be granted proxy-only access without run management permissions. Follows existing scope pattern.

**Alternatives considered**: 
- Reuse `runs:write` — rejected: proxy is stateless, doesn't create runs
- No new scope — rejected: least-privilege principle

### 2. Model Mapping Configuration

**Decision**: JSON config file at `packages/runtime/src/proxy-model-mapping.json` mapping OpenAI model IDs to provider entries with fallback priority.

```json
{
  "modelMappings": [
    {
      "openaiModelId": "gpt-4o",
      "providerId": "openai",
      "providerModelId": "gpt-4o",
      "fallbackPriority": 1
    },
    {
      "openaiModelId": "claude-3.5-sonnet",
      "providerId": "anthropic",
      "providerModelId": "claude-3.5-sonnet-latest",
      "fallbackPriority": 1
    },
    {
      "openaiModelId": "gpt-4o-mini",
      "providerId": "openai",
      "providerModelId": "gpt-4o-mini",
      "fallbackPriority": 1
    },
    {
      "openaiModelId": "gpt-4o-mini",
      "providerId": "groq",
      "providerModelId": "llama-3.1-8b-instant",
      "fallbackPriority": 2
    }
  ]
}
```

**Rationale**: Config-driven enables operator changes without code deploy. Fallback priority enables automatic failover. Maps to existing `provider-catalog.ts` provider IDs and model IDs.

**Alternatives considered**:
- Database-backed mapping — rejected: adds complexity for MVP; config is simpler
- Auto-discovery from provider catalog — rejected: OpenAI model IDs don't match 1:1 with provider model IDs

### 3. Request/Response Normalization

**Decision**: Create normalization layer in `packages/runtime/src/proxy-normalization.ts` with:
- `normalizeChatCompletionRequest(openaiRequest, targetProvider)` → provider-specific request
- `normalizeChatCompletionResponse(providerResponse, openaiModelId)` → OpenAI response format
- `normalizeStreamChunk(providerChunk, openaiModelId)` → OpenAI SSE chunk format

**Rationale**: Each provider has different request/response shapes (e.g., Anthropic uses `messages` + `system` param, OpenAI uses `messages` with `role: system`). Centralized normalization keeps handlers clean and testable.

**Alternatives considered**:
- Provider-specific handlers — rejected: duplicates logic, harder to maintain
- Adapter pattern per provider — rejected: over-engineering for MVP

### 4. Streaming Implementation

**Decision**: Use Hono's streaming response with `ReadableStream` transformation. Provider adapters return async iterators; proxy transforms each chunk to OpenAI SSE format (`data: {json}\n\n`).

**Rationale**: Hono supports streaming natively. Keeps memory efficient for long responses. Matches OpenAI SSE format exactly.

### 5. Budget Guards at Proxy Layer

**Decision**: Extend `ApiClientBudget` with proxy-specific fields:
```typescript
export type ApiClientBudget = {
  requestsPerMin?: number;
  runsPerDay?: number;
  proxy?: {
    maxTokensPerRequest?: number;
    maxCostUsdPerRequest?: number;
    maxCostUsdPerDay?: number;
  };
};
```
Enforced in `authorizeRequest` for proxy endpoints.

**Rationale**: Reuses existing budget infrastructure. Per-request token/cost limits prevent runaway proxy calls. Daily cost cap aligns with existing `runsPerDay` pattern.

### 6. Observability Integration

**Decision**: Create proxy-specific trace spans via `ObservabilityEvidenceArtifacts.startSpan({ type: "proxy_request", name: "chat_completion", ... })`. Record metrics: `proxy_request_duration_ms`, `proxy_tokens_input`, `proxy_tokens_output`, `proxy_cost_usd`, `proxy_fallback_count`, `proxy_stream_chunks`.

**Rationale**: Reuses existing observability infrastructure. Enables cost/latency dashboards for proxy usage. Fallback count tracks routing health.

### 7. Worker Route Registration

**Decision**: Add route patterns in `wrangler.toml`:
```toml
[[routes]]
pattern = "api.example.com/v1/models*"
zone_name = "example.com"

[[routes]]
pattern = "api.example.com/v1/chat/completions*"
zone_name = "example.com"
```
Or use `workers.dev` subdomain patterns for dev.

**Rationale**: Standard Workers route registration. Keeps proxy on same domain as existing `/v1` API.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Model ID mapping drift (provider adds/removes models) | Admin API to sync provider models (`/api/providers/:id/models/sync` exists); mapping config versioning |
| Streaming backpressure / memory | Use `ReadableStream` with bounded queue; set max buffer |
| Provider format changes break normalization | Unit tests per provider; integration test with live providers in CI |
| Auth scope confusion (`proxy:write` vs `runs:write`) | Clear docs; separate admin UI sections |
| Fallback loops (A→B→A) | Track attempted providers in request context; max 3 fallbacks |
| Cost tracking accuracy for streamed responses | Accumulate tokens per chunk; finalize on stream end |
| Rate limiting bypass via multiple keys | Per-client rate limits enforced in `authorizeRequest` |

## Migration Plan

1. **Phase 1 - Core Infrastructure** (non-breaking):
   - Add `proxy:write` scope to `api-gateway.ts`
   - Create `proxy-model-mapping.json` config
   - Create `proxy-normalization.ts` with request/response/stream transforms
   - Add proxy budget fields to `ApiClientBudget`

2. **Phase 2 - Handlers**:
   - Implement `GET /v1/models` handler in `apps/worker/src/index.ts`
   - Implement `POST /v1/chat/completions` handler (non-streaming first)
   - Add streaming support
   - Integrate auth via `handlePublicV1` with `proxy:write` scope

3. **Phase 3 - Observability & Policies**:
   - Add proxy trace spans and metrics
   - Add budget guard enforcement in `authorizeRequest`
   - Add rate limiting for proxy endpoints

4. **Phase 4 - Config & Deploy**:
   - Add route patterns to `wrangler.toml`
   - Document model mapping config format
   - Deploy to staging, validate with OpenAI SDK client

**Rollback**: Revert wrangler routes and handler registrations; config file is additive.

## Open Questions

1. **Model aliasing**: Should `gpt-4` alias to latest `gpt-4o`? Requires version resolution logic.
2. **Provider-specific parameters**: How to pass `temperature`, `top_p`, `tools` to providers that don't support them? Normalization should drop unsupported params with warning.
3. **Response format for errors**: OpenAI error format vs platform error format? Use OpenAI format for proxy endpoints.
4. **Usage attribution**: Should proxy usage count toward `runs:write` budget or separate? Separate `proxy` budget namespace decided.
5. **Caching `/v1/models`**: Cache TTL? 5 min default, configurable via env var.