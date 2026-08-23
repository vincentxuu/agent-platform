<div align="center">

# Agent Platform

**開源 AI 工作流控制平台，用於建立、版本化、執行、觀測與驗證可審計的 agent flows。**

[![CI](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/agent-platform/agent-platform/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early_preview-orange.svg)

[快速開始](#快速開始) · [架構](#架構) · [提供者](#提供者) · [部署](#部署到-cloudflare) · [API](#外部-api-v1) · [文件](#文件)

[English](README.md) · [繁體中文](README.zh-TW.md)

</div>

Agent Platform 是一個 **local-first、可部署到 Cloudflare** 的 AI agent 工作流控制平台。它提供結構化的 runtime，讓你能 **定義、配置、執行、觀測、控制、驗證、產出與改善** 多步驟的 agent flows —— 不是一個空白的聊天機器人。Deep Research 是內建的種子 flow，展示完整的運行循環。

> [!IMPORTANT]
> Agent Platform 處於早期預覽階段 (`0.1.0`)。API、schema 與部署行為可能變更。這不是託管服務；你需要部署到自己的 Cloudflare 帳號。

## 指令一覽

| 指令 | 功能 | 入口 |
|------|------|------|
| **Define** | 建立/複製/編輯 flow draft、驗證、發布不可變版本 | Web UI → Define / `POST /api/flows` |
| **Configure** | 新增/測試/停用 providers、版本化 policies、安裝/eval skills、綁定到 steps | Web UI → Manage / `POST /api/providers`, `/api/policies`, `/api/skills` |
| **Run** | 從特定 flow version + preset 啟動 run（含輸入驗證） | Web UI → Run / `POST /api/flows/:id/runs` |
| **Observe** | Timeline、step 詳情、provider/tool 調用、成本、延遲、tokens、context 快照 | Web UI → Timeline, Observability / `GET /api/runs/:id/observability` |
| **Control** | 取消、恢復、重試單一 step、外部寫入需人工核准 | Web UI → Timeline actions / `POST /api/runs/:id/cancel\|retry-step` |
| **Verify** | 審閱 evidence、claims、citations、confidence、conflicts；approve/reject | Web UI → Evidence / `GET /api/runs/:id/evidence/:index` |
| **Produce** | 產生 Markdown 報告、JSON evidence bundles；版本化、重新產生、匯出 | Web UI → Artifacts / `GET /api/runs/:id/artifacts/:id` |
| **Improve** | 從 runs 產生 eval cases、skill proposals、policy suggestions、memory proposals | Web UI → Improve / `GET /api/improvements` |

## 快速開始

需求：Node.js 22+、pnpm 10、Git。本機開發**不需要 Cloudflare 帳號**。

```bash
git clone https://github.com/agent-platform/agent-platform.git
cd agent-platform
pnpm install
cp .dev.vars.example .dev.vars   # 選填：加入 provider keys
npm run dev
```

Agent Platform 會在 **http://127.0.0.1:8787** 啟動本機 API server + Web UI。

- **無 provider keys**：使用 `fixtures/local-research-sources.json` 跑 deterministic offline Deep Research（完整 evidence、artifacts、trace）。
- **有 keys**：在 Web UI → Manage → Providers 設定（存入 D1）或寫在 `.dev.vars`。

### 執行你的第一個 Deep Research

1. 開啟 http://127.0.0.1:8787
2. 點選 **Run** → 選 **Deep Research** → 選 preset（Quick/Standard/Deep）
3. 輸入主題，點擊 **Start run**
4. 觀看 streaming timeline → 完成後開啟 **Evidence** / **Artifacts**

## 架構

```text
Web UI → Flow Definition → Skill System → Learning Loop
       → Evaluation → Observability → Policy Engine → Context Management
       → Memory System → Knowledge/RAG → Runtime Controls → AI Agent Harness
       → MCP / Provider Router / A2A Adapter → Evidence/Audit Store → Artifact System
```

| 層級 | 職責 |
|------|------|
| **Web UI** | React + Vite + TanStack Query + i18n (zh-Hant/en)，8 大指令的操作介面 |
| **Flow Runtime** | 版本化 flows、step DAG、checkpoints、resume/retry-step、presets |
| **Skill System** | 版本化套件（skill.yaml + SKILL.md）、明確 step 綁定、呼叫追蹤 |
| **Provider Router** | Groundlane MCP server 提供 `web_search`、`web_fetch`、`web_extract`；12 search adapters、RRF fusion、預算控制 |
| **Policy Engine** | 預算、allow/deny、guards（input/tool/output）、迴圈保護、人工核准、escalation |
| **Context/Memory** | 類型化 context blocks、預算分配、壓縮、程序性/情景性/語義性記憶、可審核寫入 |
| **Observability** | 結構化 traces、衍生指標、evidence store（claims↔sources）、artifact 版本化 |
| **Evaluation** | Eval suites/cases、quality gates（阻擋 skill 發布）、學習信號 → 可審核 proposals |
| **外部 API** | `/v1` Bearer auth、scoped API keys、rate limits、成本預算、audit log |

## 提供者

Provider catalog 定義在 `packages/runtime/src/provider-config.json`。Search/Reader/Browser 透過 **Groundlane MCP server**（獨立部署或本機）。

| 能力 | Providers（已實作 adapters） |
|------|------------------------------|
| **LLM** | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Cerebras, NVIDIA, Ollama, Ollama Cloud, Workers AI |
| **Search** | Tavily, Exa, Parallel, Browserbase, Brave, Firecrawl, SerpAPI, Linkup, Serper, You.com, Bing, Jina Search |
| **Reader** | Jina Reader, Mozilla Readability（本機 fallback） |
| **Browser** | Local Playwright, Browserless（可選） |
| **Knowledge/RAG** | Cloudflare Vectorize（原生）、LlamaIndex（adapter） |
| **Vector Store** | Vectorize（Cloudflare-native） |

**搜尋層特性（via Groundlane）：**
- 策略：`balanced`（2-provider RRF fusion）、`deep`（多 provider fusion）、`fallback`
- Canonical URL 去重、per-host 限制、tracking parameter 移除
- 每 provider 月度嘗試預算、health-aware routing

## OpenAI 相容代理 API (`/v1`) — 直接模型存取

標準 OpenAI 相容端點，透過平台的路由、備援、預算與可觀測性直接存取 LLM：

```bash
# 驗證（同樣的 API key 系統，需 `proxy:write` scope）
export PROXY_KEY="ak_live_..."
BASE="https://<your-worker>.workers.dev/v1"
```

**端點：**
| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/v1/models` | 列出可用模型（所有提供者） |
| `POST` | `/v1/chat/completions` | 對話完成（支援 streaming + 非 streaming） |

**列出模型：**
```bash
curl $BASE/v1/models -H "Authorization: Bearer $PROXY_KEY"
```

**對話完成（非 streaming）：**
```bash
curl -X POST $BASE/v1/chat/completions -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "用一段話解釋量子運算"}],
    "temperature": 0.7,
    "max_tokens": 200
  }'
```

**對話完成（streaming）：**
```bash
curl -X POST $BASE/v1/chat/completions -H "Authorization: Bearer $PROXY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "寫一首關於雲的俳句"}],
    "stream": true
  }'
```

**OpenAI SDK (Python)：**
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-worker>.workers.dev/v1",
    api_key="ak_live_..."
)

# 非 streaming
response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "寫一首關於雲的俳句"}],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

**模型 ID 格式：**
- 短名稱：`gemini-3.5-flash`、`llama-3.3-70b-versatile`、`claude-3.5-sonnet`
- 提供者前綴：`gemini/gemini-3.5-flash`、`groq/llama-3.3-70b-versatile`、`anthropic/claude-3-5-sonnet-latest`
- 短名稱會自動解析到最佳提供者（依 `proxy-model-mapping.json` 的優先順序）

**功能：**
- 自動提供者備援（主要 → 備援鏈）
- Provider readiness 檢查（只路由到健康的提供者）
- 使用量歸屬到 API key（budget、rate limit）
- OpenTelemetry 追蹤（`proxy` spans、fallback 事件）

---

## 外部 API (`/v1`) — Flow 執行

供其他服務程式化存取。與管理用 `/api` 分離。

```bash
# 在 Web UI → API Clients 發行 key（scope、允許的 flows、rate limit、budget）
export KEY="ak_live_..."

# 建立 run
curl -X POST $BASE/v1/runs -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"deep_research","presetId":"standard","inputs":{"topic":"agent memory systems","audience":"engineers","freshnessDays":365}}'

# 輪詢直到完成
curl $BASE/v1/runs/$RUN_ID -H "Authorization: Bearer $KEY"

# 下載 artifact
curl $BASE/v1/runs/$RUN_ID/artifacts/markdown_report -H "Authorization: Bearer $KEY"
```

| Method + Path | Scope | 說明 |
|---------------|-------|------|
| `POST /v1/runs` | `runs:write` | 建立 run（flow 必須在 key 白名單內） |
| `GET /v1/runs/:id` | `runs:read` | Run 狀態/timeline（只有建立者可讀） |
| `GET /v1/runs/:id/artifacts[/:artifactId]` | `artifacts:read` | Artifact 列表/下載 |
| `GET /v1/runs/:id/evidence` | `evidence:read` | Evidence 列表 |
| `GET /v1/flows` | `flows:read` | 發現 key 允許的 flows |

錯誤碼：`401` 無效/已撤銷、`403` scope/flow 不允許、`429` 率限制（含 `Retry-After`、`X-RateLimit-*`）、`402` 預算超支（僅阻擋建立 run，唯讀請求豁免）。

## 部署到 Cloudflare

生產拓撲：**Cloudflare Workers + Workers Assets + D1 + KV + R2 + Vectorize + Queues + Workflows + Durable Objects + Workers AI**。

```bash
# 1. 認證
pnpm exec wrangler login
pnpm exec wrangler whoami

# 2. 建立資源（僅需一次）
pnpm exec wrangler d1 create agent-platform
pnpm exec wrangler kv namespace create CACHE
pnpm exec wrangler r2 bucket create agent-platform-artifacts
pnpm exec wrangler vectorize create agent-platform-knowledge --dimensions=1536 --metric=cosine
pnpm exec wrangler queues create agent-platform-runs
# 注意：Workflows & Durable Objects 會在首次 deploy 時自動建立

# 3. 將回傳的 IDs 寫入 wrangler.toml（database_id、kv id 等）

# 4. 設定 secrets（provider keys、auth tokens）
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler secret put ANTHROPIC_API_KEY
# ... 其他 provider keys
pnpm exec wrangler secret put AUTH_SECRET   # API key 簽章用

# 5. 部署
npm run build:web
pnpm exec wrangler d1 migrations apply agent-platform --remote
pnpm exec wrangler deploy
```

**驗證：**
```bash
curl https://<your-worker>.workers.dev/api/health
curl https://<your-worker>.workers.dev/api/readiness
```

CI/CD：推送到 `main` 會在 `npm run check` 通過後自動部署（需 GitHub secrets：`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`）。

## 執行模式

| 模式 | 適用場景 | 入口 |
|------|----------|------|
| Local Node | 開發、評估、離線 demo | `npm run dev` |
| Cloudflare Worker | 生產環境、團隊共用 | [部署](#部署到-cloudflare) |

## 專案狀態

- 目前版本：`0.1.0` early preview；無穩定 API 保證。
- 已實作：8 大指令介面、flow 版本化、4 內建 skills、10 LLM + 12 search + 2 reader + 2 browser providers、Groundlane MCP 整合、policy guards、evidence/artifact 版本化、eval/quality gates、學習循環、外部 `/v1` API、完整 Cloudflare 部署。
- 規劃中：視覺化 flow editor、更多內建 flows/skills、多租戶（Org/Project）、streaming artifacts、A2A handoff。

## 安全性與限制

Web retrieval 具有 SSRF 風險。Agent Platform 將使用者 URLs、redirects、provider 回傳 URLs、browser subresources、WebSockets、DNS 答案視為不可信。**請保持認證啟用、保留預設限制、在生產環境套用出站網路政策。**

本專案**不保證** CAPTCHA 破解、隱形自動化、或存取操作員無授權的內容。渲染 JavaScript 不代表繞過反機器人機制。

## 文件

- [`agent-gateway-plan.md`](./agent-gateway-plan.md) — 完整產品與架構規格
- [`openspec/specs/`](./openspec/specs/) — 7 大能力規格（flow-runtime、skill-packages、provider-tool-routing、policy-runtime-controls、observability-evidence-artifacts、context-memory-management、evaluation-learning-loop）
- [`openspec/changes/`](./openspec/changes/) — Spec-driven 變更歷史

## 貢獻

回報 bug 與功能建議請用 GitHub Issues。開 PR 前請閱讀 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 授權

Agent Platform 採用 [Apache License 2.0](LICENSE)。