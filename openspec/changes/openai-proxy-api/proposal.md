## Why

External clients and internal services need a standard OpenAI-compatible API to consume the agent platform's provider capabilities without tight coupling to internal flow/skill architectures. This proxy exposes `/v1/models` and `/v1/chat/completions` endpoints that route to existing provider adapters, enabling any OpenAI SDK client to use the platform's multi-provider routing, fallback chains, budget guards, and observability — all behind a familiar interface.

## What Changes

- **New**: OpenAI-compatible proxy endpoints (`GET /v1/models`, `POST /v1/chat/completions`)
- **New**: Model routing layer mapping OpenAI model IDs to internal provider adapters with fallback chains
- **New**: Request/response normalization between OpenAI format and internal provider formats
- **New**: Streaming support (SSE) for chat completions
- **New**: Authentication via existing API key system with `proxy:write` scope
- **New**: Budget guards and rate limiting applied at proxy layer
- **New**: Observability integration (traces, metrics) for proxy requests
- **New**: Cloudflare Worker route registration for `/v1/*` paths

## Capabilities

### New Capabilities
- `openai-proxy-api`: Exposes OpenAI-compatible REST endpoints for model listing and chat completions, with streaming, auth, routing, normalization, budget guards, and observability
- `provider-model-mapping`: Maps OpenAI model identifiers (e.g., `gpt-4o`, `claude-3.5-sonnet`) to internal provider adapters with capability metadata, fallback priority, and cost tracking

### Modified Capabilities
- `provider-tool-routing`: Extends provider selection logic to support proxy-layer routing with model-to-provider mapping and fallback chains
- `policy-runtime-controls`: Adds proxy-specific budget guards (per-request token limits, cost ceilings) and rate limiting policies
- `observability-evidence-artifacts`: Adds proxy request traces, latency/cost metrics, and streaming chunk observability

## Impact

**Code affected:**
- New Worker entry points: `src/proxy/` (routes, handlers, normalization)
- Provider registry extensions: `src/providers/registry.ts` (model mapping)
- Auth middleware: `src/auth/` (scope validation for `proxy:write`)
- Policy engine: `src/policy/` (budget guards for proxy requests)
- Observability: `src/observability/` (proxy trace integration)
- Wrangler config: `wrangler.jsonc` (route registration for `/v1/*`)

**Dependencies:**
- Existing provider adapters (OpenAI, Anthropic, etc.)
- API key management system
- Policy runtime controls
- Observability infrastructure

**APIs:**
- New public endpoints: `GET /v1/models`, `POST /v1/chat/completions`
- Internal: model mapping config, proxy-specific policy config

**Breaking changes:** None — additive proxy layer only