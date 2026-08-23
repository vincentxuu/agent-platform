<div align="center">

# Agent Platform

**Open-source AI workflow control plane for creating, versioning, running, observing, and verifying auditable agent flows.**

[![CI](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[Quick start](#quick-start) · [How to Use](#how-to-use) · [Architecture](#architecture) · [Providers](#providers) · [Deploy](#deploy-to-cloudflare) · [API](#external-api-v1) · [Docs](#documentation)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

Agent Platform is a local-first, Cloudflare-deployable control plane for AI agent workflows. It gives you a structured runtime to **define, configure, run, observe, control, verify, produce, and improve** multi-step agent flows — not a blank chatbot. Deep Research is the built-in seed flow demonstrating the full loop.

> [!IMPORTANT]
> Agent Platform is an early preview (`0.1.0`). APIs, schemas, and deployment behavior may change. It is not a hosted service; you deploy it to your own Cloudflare account.

## Commands at a glance

| Command | What it does | Entry point |
| --- | --- | --- |
| **Define** | Create/clone/edit flow drafts, validate, publish immutable versions | Web UI → Define / `POST /api/flows` |
| **Configure** | Add/test/disable providers, version policies, install/eval skills, bind to steps | Web UI → Manage / `POST /api/providers`, `/api/policies`, `/api/skills` |
| **Run** | Start a run from a specific flow version + preset with validated inputs | Web UI → Run / `POST /api/flows/:id/runs` |
| **Observe** | Timeline, step detail, provider/tool calls, cost, latency, tokens, context snapshots | Web UI → Timeline, Observability / `GET /api/runs/:id/observability` |
| **Control** | Cancel, resume, retry-step, approval gates for external writes | Web UI → Timeline actions / `POST /api/runs/:id/cancel\|retry-step` |
| **Verify** | Review evidence, claims, citations, confidence, conflicts; approve/reject | Web UI → Evidence / `GET /api/runs/:id/evidence/:index` |
| **Produce** | Generate Markdown reports, JSON evidence bundles; version, regenerate, export | Web UI → Artifacts / `GET /api/runs/:id/artifacts/:id` |
| **Improve** | Create eval cases, skill proposals, policy suggestions, memory proposals from runs | Web UI → Improve / `GET /api/improvements` |

## How to Use

Agent Platform has three primary interfaces:

### 1. Web UI (Primary) — For Humans

The main way to interact with Agent Platform is through the web console:

```bash
# Local development
npm run dev
# → http://127.0.0.1:8787

# Production
open https://<your-worker>.workers.dev
```

**Core workflow:**
1. **Configure** → Manage → Providers (add API keys), Policies (budgets, guards), Skills
2. **Define** → Create/clone flows, set inputs/steps/presets, publish versions
3. **Run** → Select flow + preset, fill inputs, start
4. **Observe** → Timeline, step details, costs, context snapshots
5. **Control** → Cancel, resume, retry-step, approval gates
6. **Verify** → Evidence, claims, citations, approve/reject
7. **Produce** → Artifacts (Markdown, JSON bundles), version, export
8. **Improve** → Create eval cases, skill/policy/memory proposals from runs

**First run (Deep Research seed flow):**
1. Open Web UI → **Run** tab
2. Select **Deep Research** flow
3. Choose preset (Quick/Standard/Deep)
4. Enter topic → **Start run**
5. Watch streaming timeline → Open **Evidence** / **Artifacts** when done

### 2. External API (`/v1`) — For Services

See [External API (`/v1`)](#external-api-v1) for full reference (auth, cURL examples, endpoint table, error codes).

### 3. OpenAI-Compatible Proxy API (`/v1`) — For Direct Model Access

See [OpenAI-Compatible Proxy API (`/v1`)](#openai-compatible-proxy-api-v1) for full reference (auth, list models, chat completion streaming + non-streaming, OpenAI SDK usage, model routing + fallback table, model mapping config, policy controls, error codes).

### 4. Local Development

```bash
git clone https://github.com/agent-platform/agent-platform.git
cd agent-platform
pnpm install
cp .env.example .env   # fill in your API keys
npm run dev
# → http://127.0.0.1:8787
```

- Without provider keys: deterministic offline Deep Research (fixtures)
- With keys: configure in Web UI → Manage → Providers or `.dev.vars`

### 5. Production Deployment

See [Deploy to Cloudflare](#deploy-to-cloudflare) for full reference (wrangler auth + resource provisioning + secret setup + deploy + CI/CD).

## Quick start

Requirements: Node.js 22+, pnpm 10, Git. No Cloudflare account needed for local development.

```bash
git clone https://github.com/agent-platform/agent-platform.git
cd agent-platform
pnpm install
cp .dev.vars.example .dev.vars   # optional: add provider keys
npm run dev
```

Agent Platform starts a local API server + Web UI at **http://127.0.0.1:8787**.

- Without provider keys: runs use `fixtures/local-research-sources.json` for deterministic offline Deep Research (full evidence, artifacts, trace).
- With keys: configure in Web UI → Manage → Providers (stored in D1) or `.dev.vars`.

### Run your first Deep Research

1. Open http://127.0.0.1:8787
2. Click **Run** → Select **Deep Research** → Choose preset (Quick/Standard/Deep)
3. Enter a topic, click **Start run**
4. Watch streaming timeline → Open **Evidence** / **Artifacts** when complete

## Architecture

```text
Web UI → Flow Definition → Skill System → Learning Loop
       → Evaluation → Observability → Policy Engine → Context Management
       → Memory System → Knowledge/RAG → Runtime Controls → AI Agent Harness
       → MCP / Provider Router / A2A Adapter → Evidence/Audit Store → Artifact System
```

| Layer | Responsibility |
|-------|----------------|
| **Web UI** | React + Vite + TanStack Query + i18n (zh-Hant/en), command surfaces for all 8 operations |
| **Flow Runtime** | Versioned flows, step DAG, checkpoints, resume/retry-step, presets |
| **Skill System** | Versioned packages (skill.yaml + SKILL.md), explicit step bindings, invocation tracking |
| **Provider Router** | Groundlane MCP server for `web_search`, `web_fetch`, `web_extract`; 12 search adapters, RRF fusion, budgets |
| **Policy Engine** | Budget, allow/deny, guards (input/tool/output), loop protection, human approval gates, escalation |
| **Context/Memory** | Typed context blocks, budget allocation, compression, procedural/episodic/semantic memory, reviewable writes |
| **Observability** | Structured traces, derived metrics, evidence store (claims↔sources), artifact versioning |
| **Evaluation** | Eval suites/cases, quality gates (blocks skill promotion), learning signals → reviewable proposals |
| **External API** | `/v1` Bearer auth, scoped API keys, rate limits, cost budgets, audit log |

## Why Agent Platform?

- **Flow-first, not a blank chatbot:** Define controlled workflows first, then add autonomy incrementally.
- **Command surface is MVP:** All 8 core commands (Define→Improve) are invocable from day one, not bolted on later.
- **Local-first developer experience:** `git clone && pnpm install && npm run dev` runs the full demo — no cloud resources required.
- **Cloudflare production-grade runtime:** Workers/D1/KV/R2/Vectorize/Queues/Workflows/DO/Workers AI as a complete deployment stack.
- **Evidence-backed outputs:** Every major claim has a citation you can trace.
- **Policy as configuration:** Cost, permissions, providers, human approval are first-class config, not hardcoded logic.
- **Durable execution:** Long-running tasks are recoverable, retryable, and auditable.

## Security and limitations

Web retrieval carries SSRF risk. Agent Platform treats user URLs, redirects, provider-returned URLs, browser subresources, WebSockets, and DNS answers as untrusted. **Keep authentication enabled, preserve default limits, and apply an outbound network policy in production.**

Agent Platform does **not** guarantee CAPTCHA solving, invisible automation, or access to content the operator is not authorized to retrieve. Rendering JavaScript is not proof of anti-bot bypass.

## Providers

Provider catalog in `packages/runtime/src/provider-config.json`. Search/Reader/Browser via **Groundlane MCP server** (separate deployment or local).

| Capability | Providers (adapters implemented) |
| --- | --- |
| **LLM** | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Cerebras, NVIDIA, Ollama, Ollama Cloud, Workers AI |
| **Search** | Tavily, Exa, Parallel, Browserbase, Brave, Firecrawl, SerpAPI, Linkup, Serper, You.com, Bing, Jina Search |
| **Reader** | Jina Reader, Mozilla Readability (local fallback) |
| **Browser** | Local Playwright, Browserless (opt-in) |
| **Knowledge/RAG** | Cloudflare Vectorize (native), LlamaIndex (adapter) |
| **Vector Store** | Vectorize (Cloudflare-native) |

**Search layer features (via Groundlane):**
- Strategies: `balanced` (2-provider RRF fusion), `deep` (multi-provider fusion), `fallback`
- Canonical URL deduplication, per-host limits, tracking parameter stripping
- Monthly attempt budgets per provider, health-aware routing

## Deploy to Cloudflare

Production topology: **Cloudflare Workers + Workers Assets + D1 + KV + R2 + Vectorize + Queues + Workflows + Durable Objects + Workers AI**.

```bash
# 1. Authenticate
wrangler login
wrangler whoami

# 2. Create resources (run once)
wrangler d1 create agent-platform
wrangler kv namespace create CACHE
wrangler r2 bucket create agent-platform-artifacts
wrangler vectorize create agent-platform-knowledge --dimensions=1536 --metric=cosine
wrangler queues create agent-platform-runs
# Note: Workflows & Durable Objects created on first deploy

# 3. Update wrangler.toml with returned IDs (database_id, kv id, etc.)

# 4. Set secrets (provider keys, auth tokens)
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
# ... other provider keys
wrangler secret put AUTH_SECRET   # for API key signing

# 5. Deploy
npm run build:web
wrangler d1 migrations apply agent-platform --remote
wrangler deploy
```

**Verify:**
```bash
curl https://<your-worker>.workers.dev/api/health
curl https://<your-worker>.workers.dev/api/readiness
```

CI/CD: Pushes to `main` auto-deploy after `npm run check` passes (requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` GitHub secrets).

## External API (`/v1`)

Programmatic access for other services. Separate from admin `/api`.

```bash
# Issue an API key in Web UI → API Clients (scope, allowed flows, rate limit, budget)
export KEY="ak_live_..."

# Create a run
curl -X POST $BASE/v1/runs -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"deep_research","presetId":"standard","inputs":{"topic":"agent memory systems","audience":"engineers","freshnessDays":365}}'

# Poll until complete
curl $BASE/v1/runs/$RUN_ID -H "Authorization: Bearer $KEY"

# Download artifact
curl $BASE/v1/runs/$RUN_ID/artifacts/markdown_report -H "Authorization: Bearer $KEY"
```

| Method + Path | Scope | Description |
|---------------|-------|-------------|
| `POST /v1/runs` | `runs:write` | Create run (flow must be in key's allowlist) |
| `GET /v1/runs/:id` | `runs:read` | Run status/timeline (only creator can read) |
| `GET /v1/runs/:id/artifacts[/:artifactId]` | `artifacts:read` | Artifact list/download |
| `GET /v1/runs/:id/evidence` | `evidence:read` | Evidence list |
| `GET /v1/flows` | `flows:read` | Discover flows allowed by key |

Errors: `401` invalid/revoked, `403` scope/flow not allowed, `429` rate limited (`Retry-After`, `X-RateLimit-*`), `402` budget exceeded (blocks run creation only).

## OpenAI-Compatible Proxy API (`/v1`)

**Base URL:** `https://<your-worker>.workers.dev/v1` (or `http://127.0.0.1:8787/v1` locally)

Standard OpenAI-compatible endpoints for direct model access via the platform's multi-provider routing, fallback chains, budget guards, and observability.

### Authentication

Uses the same API key system as the External API with `proxy:write` scope.

```bash
# Issue an API key in Web UI → API Clients with proxy:write scope
export KEY="ak_live_..."

# Or use a dedicated proxy key
export PROXY_KEY="ak_live_..."
```

### Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/models` | List available models (aggregated from all providers) |
| `POST` | `/v1/chat/completions` | Chat completions (streaming + non-streaming) |

### Example: List Models

```bash
curl $BASE/v1/models -H "Authorization: Bearer $PROXY_KEY"
```

Response:
```json
{
  "object": "list",
  "data": [
    { "id": "gpt-4o", "object": "model", "created": 1699999999, "owned_by": "agent-platform" },
    { "id": "claude-3.5-sonnet", "object": "model", "created": 1699999999, "owned_by": "agent-platform" },
    { "id": "openai/gpt-4o", "object": "model", "created": 1699999999, "owned_by": "openai" },
    { "id": "anthropic/claude-3.5-sonnet", "object": "model", "created": 1699999999, "owned_by": "anthropic" }
  ]
}
```

### Example: Chat Completion (Non-Streaming)

```bash
curl -X POST $BASE/v1/chat/completions -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant"},
      {"role": "user", "content": "Explain quantum computing in one paragraph"}
    ],
    "temperature": 0.7,
    "max_tokens": 200
  }'
```

### Example: Chat Completion (Streaming)

```bash
curl -X POST $BASE/v1/chat/completions -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Write a haiku about clouds"}],
    "stream": true
  }'
```

Response (SSE format):
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1699999999,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Soft"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1699999999,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"white"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1699999999,"model":"gpt-4o","choices":[{"index":0,"delta":{"content":"clouds"},"finish_reason":null}]}

data: {"id":"chatcmpl-...","object":"chat.completion.chunk","created":1699999999,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

### OpenAI SDK Usage

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-worker>.workers.dev/v1",
    api_key="ak_live_..."
)

# Non-streaming
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="claude-3.5-sonnet",
    messages=[{"role": "user", "content": "Count to 10"}],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

### Model Routing & Fallback

Models are routed through the platform's proxy layer with automatic fallback:

| Model | Primary Provider | Fallback Chain |
| --- | --- | --- |
| `gpt-4o` | OpenAI | OpenRouter -> Azure OpenAI |
| `claude-3.5-sonnet` | Anthropic | OpenRouter |
| `gemini-2.0-flash` | Google Gemini | OpenRouter |
| `llama-3.3-70b` | Groq, Cerebras, NVIDIA | OpenRouter, Ollama Cloud |
| `nemotron-3-ultra` | OpenRouter, NVIDIA, Ollama Cloud | OpenRouter (free), Groq |

Free models (verified via [free-llm-models](https://github.com/vincentxuu/free-llm-models)):
- `nemotron-3-ultra`, `gpt-oss-120b`, `gpt-oss-20b` (OpenRouter/NVIDIA/Groq/Ollama Cloud)
- `glm-5.2` (OpenRouter), `hy3` (OpenCode Zen)
- `deepseek-v4-flash` (OpenCode Zen)

### Model Mapping Configuration

Model-to-provider mappings defined in `packages/runtime/src/proxy-model-mapping.json`:

```json
{
  "version": 1,
  "models": {
    "gpt-4o": {
      "providers": ["openai"],
      "fallback": ["openrouter", "azure-openai"]
    },
    "claude-3.5-sonnet": {
      "providers": ["anthropic"],
      "fallback": ["openrouter"]
    }
  }
}
```

- `providers`: Primary providers to try in order
- `fallback`: Fallback providers if primary fails (max 3 attempts total)
- Providers must be registered in `provider-config.json` and enabled
- Health checks automatically exclude down providers

### Policy Controls

Proxy requests respect policy configuration:

```json
{
  "proxy": {
    "allowedModels": ["gpt-4o", "claude-3.5-sonnet", "gemini-2.0-flash"],
    "deniedModels": ["gpt-4"],
    "budget": {
      "maxCostUsd": 10.00,
      "maxTokens": 1000000,
      "maxDailyCost": 5.00,
      "maxDailyTokens": 500000,
      "maxRequestsPerMinute": 60
    }
  }
}
```

### Error Responses

OpenAI-compatible error format:

```json
{
  "error": {
    "message": "Proxy budget exceeded",
    "type": "budget_exceeded",
    "code": "budget_exceeded"
  }
}
```

Common error codes:
- `400` `invalid_request` — Invalid JSON, missing fields
- `401` `unauthorized` — Invalid/missing API key
- `402` `budget_exceeded` — Proxy budget limit reached
- `403` `forbidden` — Model not allowed by policy
- `404` `model_not_found` — Model not in mapping
- `429` `rate_limited` — Rate limit exceeded (headers: `Retry-After`, `X-RateLimit-*`)
- `502` `provider_unavailable` — All providers failed

## Run modes

| Mode | Best for | Entry point |
| --- | --- | --- |
| Local Node | Development, evaluation, offline demo | `npm run dev` |
| Cloudflare Worker | Production, team sharing | [Deploy](#deploy-to-cloudflare) |

## Project status

- Current version: `0.1.0` early preview; no stable API guarantee yet.
- Implemented: 8 command surfaces, flow versioning, 4 built-in skills, 10 LLM + 12 search + 2 reader + 2 browser providers, Groundlane MCP integration, policy guards, evidence/artifact versioning, eval/quality gates, learning loop, external `/v1` API, full Cloudflare deployment.
- Next: Visual flow editor, more built-in flows/skills, multi-tenancy (Org/Project), streaming artifacts, A2A handoff.

## Documentation

- [`agent-gateway-plan.md`](./agent-gateway-plan.md) — Full product & architecture specification
- [`openspec/specs/`](./openspec/specs/) — 7 capability specs (flow-runtime, skill-packages, provider-tool-routing, policy-runtime-controls, observability-evidence-artifacts, context-memory-management, evaluation-learning-loop)
- [`openspec/changes/`](./openspec/changes/) — Spec-driven change history

## Contributing

Use GitHub Issues for bugs and feature proposals. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a PR.

## License

Agent Platform is licensed under the [Apache License 2.0](LICENSE).