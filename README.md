# Agent Platform

AI Agent Platform with provider routing, policy control, evidence tracking, and artifact generation.

## 產品定位

Agent Platform 不是單一萬能聊天機器人，而是一個可配置的 AI Agent 工作流閘道，統一管理模型、工具、資料來源、執行策略、驗證機制與最終產物。

使用者的真正目標不是「跟 AI 聊天」，而是：

- 用可控方式完成高價值工作，例如研究、審查、摘要、回覆、分析、提案
- 希望結果可追蹤、可驗證、可重跑，而不是只拿到一段無法審計的生成文字
- 希望團隊可以共用同一套 provider、policy、run history、evidence 與 artifact

## 系統分層

```
Web UI → Flow Definition → Skill System → Learning Loop
→ Evaluation → Observability → Policy Engine → Context Management
→ Memory System → Runtime Controls → AI Agent Harness
→ MCP / Provider Router / A2A Adapter → Evidence / Audit Store → Artifact System
```

## 核心功能

| 功能 | 說明 |
|------|------|
| **Run** | 選 flow、填 inputs、選 preset、啟動 run、看 streaming progress |
| **Flow Management** | 管理 workflow template、版本、輸入欄位、step graph |
| **Skill System** | 可安裝、可版本化、可觸發、可審計的能力包 |
| **Provider Router** | 統一管理 LLM、Search、Reader、Knowledge、Action providers |
| **Policy Engine** | 成本、權限、fallback、guardrails、verification 配置 |
| **Evidence Store** | 每個結論可追到來源與執行紀錄 |
| **Observability** | 完整 trace、cost、latency、token、tool usage 追蹤 |
| **Memory System** | Procedural、Episodic、Semantic 三層記憶管理 |

## MVP 範圍

**第一版以 Deep Research 為 showcase，底層保持通用 Flow 抽象。**

### 內建 Flows

- Deep Research（含 Quick / Standard / Deep 三個 presets）

### 內建 Skills

- `research-planner`
- `source-ranker`
- `citation-extractor`
- `report-synthesizer`

### 支援 Providers

- **LLM:** OpenAI、Anthropic
- **Search:** Tavily 或 Exa
- **Reader:** Jina Reader

## 設計原則

- **Flow-first，不做空白 chatbot**
- **Cloudflare-first runtime**：Workers / D1 / KV / R2 / Queues / Durable Objects / Workers AI 作為正式部署架構，本機 runtime 保留為開發與測試替身
- **Evidence-backed outputs**：每個主要 claim 都有 citation
- **Policy as configuration**：成本、權限、provider、human approval 都是一級配置
- **Durable execution**：長任務可恢復、可重試、可審計

## 文件

- [`agent-gateway-plan.md`](./agent-gateway-plan.md) — 完整規劃文件，包含系統分層、資料模型、API shape、技術架構與風險分析

## Cloudflare 架構

第一版部署目標改為 Cloudflare 全家桶：

| 層 | Cloudflare 服務 | 綁定 | 用途 |
|----|-----------------|------|------|
| Edge/API | Workers | `fetch` | API、policy check、provider routing、queue dispatch |
| Web UI | Workers Assets | `ASSETS` | 同一個 edge app 服務管理介面 |
| Relational store | D1 | `DB` | flows、runs、steps、policy、skills、evidence metadata、evals |
| Object store | R2 | `ARTIFACTS` | 大型 artifacts、evidence bundle、report exports、step outputs |
| Vector store | Vectorize | `VECTORIZE` | chunk embeddings、semantic memory、RAG retrieval |
| Ephemeral/cache | KV | `CACHE` | session、provider health、idempotency key、run status cache |
| Durable workflow | Workflows | `DEEP_RESEARCH_WORKFLOW` | Deep Research 多步驟執行、step retry、pause/resume |
| Async work | Queues | `RUN_QUEUE` | eval、export、provider health、retry 等背景 jobs |
| Run coordination | Durable Objects | `RUN_COORDINATOR` | 單一 run 的狀態協調、checkpoint fan-out、streaming 狀態 |
| Model runtime | Workers AI | `AI` | policy 允許時使用 Cloudflare 原生模型 |

`wrangler.toml` 是部署入口，`apps/worker/src/index.ts` 提供 Cloudflare Worker API，`apps/worker/src/workflow.ts` 定義 Deep Research Workflow，`packages/cloudflare/src/*` 放 Cloudflare adapter 與服務映射。專案 source code 以 TypeScript 為準，前端由 Vite build 成 Workers Assets。

## 開發檢查

```bash
npm run check
```

目前檢查包含 core runtime、web shell、local API smoke test 與 Cloudflare binding / worker 架構檢查。local API smoke test 會用隔離的 `.tmp/local-api-check` 狀態目錄啟動本機 server，實際驗證 readiness、輸入錯誤、run completion、artifact download 與刪除流程。

本機可用模式會先 build Workers Assets 與 TypeScript，然後啟動一個本機 API server，用同一個 Web UI 跑 Deep Research run、timeline、evidence 與 artifact 檢視；這條路徑不需要先配置 Cloudflare resource ID：

```bash
npm run dev
```

啟動後開啟 `http://127.0.0.1:8787`。

本機 run history 會持久化到 `.local/agent-platform-runs.json`，重啟 dev server 後仍可在 Recent Runs 打開舊 run 與下載 artifacts；`.local/` 已被 git ignore。

如果要用另一個狀態目錄啟動本機 server，可設定 `LOCAL_STATE_DIR=/path/to/state npm run dev`。自動化檢查會使用這個能力避免污染互動開發資料。

沒有 provider key 時，本機 server 會使用 `fixtures/local-research-sources.json` 產生 deterministic offline research：完成的 run 會包含多筆 evidence、source title / URL、Markdown findings、sources section，以及 JSON evidence bundle。這能驗證產品流程與 artifact contract；真正的 live search / reader / LLM 呼叫仍需要在 readiness 中配置對應 provider key。

本機 provider key 可放在 `.dev.vars`，格式可參考 `.dev.vars.example`。`npm run dev` 會載入 `.dev.vars` 中尚未由 shell 設定的變數，`GET /api/readiness` 只顯示已載入的 key 名稱，不回傳 secret value。自動化檢查可用 `DEV_VARS_PATH=/path/to/.dev.vars` 指向隔離的設定檔。

本機 API 目前支援：

- `POST /api/runs` 建立 Deep Research run
- `GET /api/runs/:id` 查看 run timeline、step detail、evidence、artifacts
- `DELETE /api/runs/:id` 刪除單一 local run
- `DELETE /api/runs` 清空 local run history
- `POST /api/runs/:id/cancel` 取消進行中的 run
- `POST /api/runs/:id/retry-step` 從目前 step 或指定 `stepId` 重新執行
- `GET /api/runs/:id/artifacts/:artifactId` 下載 Markdown report 或 JSON evidence bundle
- `GET /api/readiness` 查看本機持久化、Cloudflare resource placeholder、provider key 配置狀態

Cloudflare Worker 也維持同一組 Web UI API contract：`/api/readiness`、run list/create/detail、delete/clear、cancel、retry-step，以及 R2 artifact download。Worker Workflow 會輸出 Markdown report、JSON evidence bundle、summary JSON 三個 R2 artifacts，並把 running / complete 狀態與 workflow events 寫回 D1。這讓同一個 `apps/web` build 在本機 server 與 Cloudflare Worker 後端之間切換時，不需要替換前端程式。

前端 Workers Assets build：

```bash
npm run build:web
```

Cloudflare deploy readiness 檢查：

```bash
npm run cloudflare:readiness
```

這個命令會讀取 `wrangler.toml`、檢查 Workers Assets build、D1 / KV resource IDs、D1 migrations、R2、Vectorize、Queue、Workflow 設定，並列出缺少 resource 時要執行的 `wrangler` setup commands。當 `wrangler.toml` 還有 placeholder resource IDs 時，這個命令會回傳非 0；完成 resource setup 後，`npm run check` 會要求 Cloudflare deploy readiness 通過。

`npm run check` 也會執行 `wrangler deploy --dry-run`，確認 Worker、Workflow、Durable Object class、Workers Assets 與 bindings 可以被 Wrangler 成功 bundle，但不會上傳部署。

`npm run check:worker-runtime` 會在隔離的 `.tmp/worker-runtime-check` 狀態目錄套用本機 D1 migrations、啟動 `wrangler dev --local`，並實際驗證 Worker `/api/readiness`、輸入錯誤、run create / complete、R2 artifact download、retry、cancel、delete。這是本機 Cloudflare runtime smoke test，不會使用遠端 Cloudflare resource。

完成 Cloudflare resource 建立後，部署順序是：

```bash
npm run cloudflare:setup:plan
npm run cloudflare:setup:apply -- --yes
npm run cloudflare:readiness
npm run build:web
npx wrangler deploy --dry-run
npx wrangler d1 migrations apply agent-platform --remote
npx wrangler deploy
npm run cloudflare:smoke:remote -- --url https://<worker-url>
npm run cloudflare:smoke:remote -- --url https://<worker-url> --create-run --yes
```

`cloudflare:setup:plan` 只列出遠端 setup/deploy plan，不會碰 Cloudflare。輸出會區分 blocking setup commands（D1 / KV placeholder 必須先解決）與 provisioning commands（R2 / Vectorize / Queue 這類以名稱綁定的資源建立）。`cloudflare:setup:apply -- --yes` 才會執行 setup/provisioning；`cloudflare:deploy:remote -- --yes` 會在 blocking setup 清空後執行 build、dry-run、remote migrations、deploy。

如果要把部署與 smoke test 合併成一條命令：

```bash
npm run cloudflare:deploy:remote -- --yes --smoke-url https://<worker-url>
npm run cloudflare:deploy:remote -- --yes --smoke-url https://<worker-url> --smoke-create-run
```

部署後可用 `cloudflare:smoke:remote` 驗證遠端 Worker。預設是 read-only smoke test，只檢查 `/api/health`、`/api/readiness`、`/api/flows`；加上 `--create-run --yes` 才會建立一筆 Deep Research run、等待 complete、下載 Markdown report / evidence bundle / summary JSON artifacts，最後刪除該 run。也可以用 `AGENT_PLATFORM_URL=https://<worker-url>` 取代 `--url`。

## 狀態

**Status:** Draft  
**Date:** 2026-05-14
