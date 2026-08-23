<div align="center">

# Agent Platform

**Open-source AI workflow control plane for creating, versioning, running, observing, and verifying auditable agent flows.**

[![CI](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[Quick start](#quick-start) · [Architecture](#architecture) · [Providers](#providers) · [Deploy](#deploy-to-cloudflare) · [API](#external-api-v1) · [Docs](#documentation)

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
pnpm exec wrangler login
pnpm exec wrangler whoami

# 2. Create resources (run once)
pnpm exec wrangler d1 create agent-platform
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler r2 bucket create agent-platform-artifacts
pnpm exec wrangler vectorize create agent-platform-knowledge --dimensions=1536 --metric=cosine
pnpm exec wrangler queues create agent-platform-runs
# Note: Workflows & Durable Objects created on first deploy

# 3. Update wrangler.toml with returned IDs (database_id, kv id, etc.)

# 4. Set secrets (provider keys, auth tokens)
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put ANTHROPIC_API_KEY
# ... other provider keys
pnpm exec wrangler secret put AUTH_SECRET   # for API key signing

# 5. Deploy
npm run build:web
pnpm exec wrangler d1 migrations apply agent-platform --remote
pnpm exec wrangler deploy
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

## Run modes

| Mode | Best for | Entry point |
|------|----------|-------------|
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