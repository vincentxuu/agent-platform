# Agent Platform

Open-source AI workflow control plane for creating, versioning, running, observing, and verifying auditable agent flows.

## 產品定位

Agent Platform 是 **local-first、Cloudflare-deployable** 的開源 AI workflow control plane。它不是單一萬能聊天機器人，也不是只有一個 Deep Research demo，而是用來建立、管理、執行與驗證可審計 agent flows 的平台。

Agent Platform 的產品主體不是 CRUD 後台，而是一個可操作的 agent workflow runtime。它要把一次性 prompt 變成可定義、可執行、可觀測、可控制、可驗證、可產出、可改善的工作流程。Flow 是最核心的一級資源；Provider、Policy、Skill、Run、Evidence、Artifact、Eval、Memory 都是支撐這條 runtime loop 的可操作資產。Deep Research 是第一個內建 seed flow / showcase，不是產品邊界。

使用者的真正目標不是「跟 AI 聊天」，而是：

- 用可控方式完成高價值工作，例如研究、審查、摘要、回覆、分析、提案
- 希望結果可追蹤、可驗證、可重跑，而不是只拿到一段無法審計的生成文字
- 希望團隊可以共用同一套 provider、policy、run history、evidence 與 artifact

## 核心產品模型

| 資源 | 說明 |
|------|------|
| **Flow** | 可管理的 workflow 定義，包含 metadata、input schema、steps、edges、presets、provider bindings、policy refs、artifact schemas |
| **Flow Version** | 可發布、可回溯、可從 run 追溯的不可變版本；draft 可編輯，published 版本用於正式 runs |
| **Run** | 某個 flow version 的一次執行，可建立、查看、取消、重試 step、刪除 / 保留；保存 timeline、step outputs、cost、latency、provider calls、tool invocations |
| **Evidence** | 支撐 claims 的來源、摘錄、confidence、conflict 與 claim-to-source mapping；主要 lifecycle 是 review、annotate、approve、reject |
| **Artifact** | Flow 的正式輸出，例如 Markdown report、JSON evidence bundle、Slack draft、GitHub comment、PDF/PPT；支援版本、重新產生、核准、匯出 |
| **Provider** | LLM、Search、Reader、Knowledge、Action providers 的 capability、credential 與 health 設定；可新增、停用、測試、輪替 credential |
| **Policy** | 成本、權限、fallback、guardrails、verification、human approval 等可重用策略；可建立、編輯、套用、版本化 |
| **Skill** | 可安裝、可版本化、可審計的能力包，供 flow steps 綁定與評估；可安裝、升級、停用、執行 eval |

## 核心操作模型

產品驗收不應停在「有資料、有列表、有詳情」。每個核心能力都必須有使用者可觸發的 command，以及 command 後可追蹤的狀態變更：

| 操作 | 使用者要能做什麼 | 驗收重點 |
|------|------------------|----------|
| **Define** | 建立 / 複製 / 編輯 flow draft，設定 inputs、steps、tools、providers、policy、artifact schema，validate 後 publish 成 version | Flow 不只是 seed fixture；使用者能產生可執行 flow version |
| **Configure** | 新增 / 測試 / 停用 provider，建立 / 版本化 policy，安裝 / 停用 / eval skill，並把它們綁到 flow steps | 設定會被 runtime 使用，不只是顯示 readiness |
| **Run** | 從指定 flow version + preset 建立 run，填 inputs，開始執行 | Run 必須引用固定 flow version、preset、policy、provider binding |
| **Observe** | 查看 timeline、step state、tool calls、provider calls、cost、latency、errors、context snapshot | 能重建執行路徑，不只是 final output |
| **Control** | cancel、resume、retry step、approve gate、套用 fallback 或調整下一步策略 | 長任務不是黑盒，失敗時有操作入口 |
| **Verify** | review evidence、claims、citations、policy violations、eval results，approve / reject evidence 或 artifact | 產出可審計，不盲信生成文字 |
| **Produce** | 產生 artifact，支援 version、regenerate、approve、export | Artifact 是正式輸出，不是聊天回覆 |
| **Improve** | 從失敗 run、feedback、eval result 產生 eval case、skill proposal、policy suggestion、memory proposal | 學習 loop 可審核，不自動污染 production behavior |

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
| **Define** | Flow library、create / clone flow、flow editor、validate、publish version |
| **Configure** | Providers、policies、skills、tool permissions、runtime bindings |
| **Run** | 從 flow version 選 preset、填 inputs、啟動 run、看 streaming progress |
| **Observe / Control** | Timeline、step detail、context、cost、errors、cancel、resume、retry-step、approval gate |
| **Verify** | Evidence、claims、citations、policy violations、eval results、approve / reject |
| **Produce** | Markdown report、JSON evidence bundle、artifact version、regenerate、export |
| **Improve** | Eval cases、skill proposals、policy suggestions、memory proposals |
| **Flow Versioning** | 管理 draft / published / archived 狀態，讓每個 run 可追溯到固定 flow version |
| **Skill System** | 可安裝、可版本化、可觸發、可審計的能力包 |
| **Provider Router** | 統一管理 LLM、Search、Reader、Knowledge、Action providers |
| **Policy Engine** | 成本、權限、fallback、guardrails、verification 配置 |
| **Evidence Store** | 每個結論可追到來源與執行紀錄 |
| **Observability** | 完整 trace、cost、latency、token、tool usage 追蹤 |
| **Memory System** | Procedural、Episodic、Semantic 三層記憶管理 |

## MVP 範圍

**第一版必須把 Define -> Configure -> Run -> Observe -> Control -> Verify -> Produce 做成可用主線。Deep Research 只是內建 seed flow，用來展示完整 runtime loop；它不能取代使用者定義與配置 flow 的能力。**

### MVP 必做

- Define：建立 / 複製 flow draft，編輯 metadata、input schema、steps、edges、presets、provider bindings、policy refs、artifact schemas，validate 後 publish
- Configure：新增 / 測試 / 停用 provider；建立 / 版本化 / 套用 policy；安裝 / 停用 / eval skill；把設定綁到 flow steps
- Run：從 flow detail / version 建立 run，而不是只從 hardcoded Deep Research form 建立
- Observe：timeline、step detail、provider calls、tool usage、cost、latency、context snapshot、retry、error
- Control：cancel、resume、retry-step、approval gate；失敗時能從 checkpoint 接續
- Verify：每個主要 claim 可追到來源、摘錄與 confidence；可 approve / reject evidence 或 artifact
- Produce：Markdown report、JSON evidence bundle 與 summary artifact 可 version、regenerate、export
- Improve：從 failed run / feedback / eval result 產生 eval case、skill proposal、policy suggestion、memory proposal

### 內建 Flows

- Deep Research seed flow（含 Quick / Standard / Deep 三個 presets）

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
- **Command surface 是 MVP，不是第二階段**：使用者必須能觸發 Define、Configure、Run、Observe、Control、Verify、Produce、Improve 的核心 commands；Deep Research 只是一個內建模板
- **Local-first contributor experience**：`git clone`、`npm install`、`npm run dev` 後即可看到完整 Deep Research demo run，不需要先建立 Cloudflare 帳號或 resource
- **Cloudflare-deployable production runtime**：Workers / D1 / KV / R2 / Vectorize / Queues / Workflows / Durable Objects / Workers AI 作為正式部署架構，Cloudflare 是 production preset / deploy target，不是唯一可執行 runtime
- **React + Vite Web UI**：前端是 React SPA，使用 TanStack Query 管理 API-driven state、polling、retry 與 artifact loading，build 後由 Workers Assets 或本機 server 提供
- **Framework-based i18n**：Web UI 使用 `i18next` / `react-i18next` / browser language detector，預設支援 `zh-Hant` 與 `en`
- **Hono Worker API**：Cloudflare Worker API 以 Hono route table 管理，保留與本機 server 相同的 API contract
- **Evidence-backed outputs**：每個主要 claim 都有 citation
- **Policy as configuration**：成本、權限、provider、human approval 都是一級配置
- **Durable execution**：長任務可恢復、可重試、可審計

## 專案結構

| 路徑 | 說明 |
|------|------|
| `apps/web` | React + Vite SPA，使用 TanStack Query 與 react-i18next |
| `apps/worker` | Hono-based Cloudflare Worker API 與 Workflow entrypoint |
| `packages/core` | Flow definitions、runtime contracts、policy/provider 抽象 |
| `packages/runtime` | 本機 runtime、provider catalog、workflow runtime support |
| `packages/local` | Local filesystem / in-memory adapters、`.dev.vars` 載入、local readiness report |
| `packages/cloudflare` | D1、KV、R2、Vectorize、Workers service map 等 Cloudflare adapters |
| `packages/db` | D1 schema 與 migrations |
| `fixtures` | 本機 deterministic Deep Research demo data |

## Web UI 資訊架構

第一個可用畫面應是 Flow Library / Recent Runs dashboard，而不是 raw JSON policy dump 或單一 run form。主要導覽以產品資源排列：

- **Flows**：flow library、create flow、flow editor、version / preset / policy binding
- **Runs**：run history、active runs、run detail、retry / cancel / delete
- **Evidence**：sources、claims、quotes、confidence、conflicts
- **Artifacts**：reports、bundles、exports、approval status
- **Providers**：provider list、detail、create / update、credential readiness、health test、disable
- **Policies**：policy list、detail、create / update、version、budget、fallback、guardrails、verification、human approval
- **Skills**：installed skills、versions、install / update / disable、permissions、eval status
- **Observability**：cost、latency、tokens、tool usage、provider health

Empty states 必須指向下一個可執行動作，例如「Create flow」、「Clone Deep Research」、「Run selected flow」，避免只顯示內部狀態。

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

目前檢查包含 core runtime、React web shell、Playwright Web UI smoke test、local API smoke test、Cloudflare binding / worker 架構檢查與 Worker runtime smoke test。local API smoke test 會用隔離的 `.tmp/local-api-check` 狀態目錄啟動本機 server，實際驗證 readiness、輸入錯誤、run completion、artifact download 與刪除流程；Web UI smoke test 會用隔離的 `.tmp/web-ui-check` 狀態目錄啟動本機 server，實際打開 React UI、切換語言、建立 run，並檢查 timeline、evidence、artifact download link。

本機可用模式會先 build React Workers Assets 與 TypeScript，然後啟動一個本機 API server，用同一個 Web UI 跑 Deep Research run、timeline、evidence 與 artifact 檢視；這條路徑不需要先配置 Cloudflare resource ID：

```bash
npm run dev
```

啟動後開啟 `http://127.0.0.1:8787`。

本機 run history 會持久化到 `.local/agent-platform-runs.json`，重啟 dev server 後仍可在 Recent Runs 打開舊 run 與下載 artifacts；`.local/` 已被 git ignore。

如果要用另一個狀態目錄啟動本機 server，可設定 `LOCAL_STATE_DIR=/path/to/state npm run dev`。自動化檢查會使用這個能力避免污染互動開發資料。

沒有 provider key 時，本機 server 會使用 `fixtures/local-research-sources.json` 產生 deterministic offline research：完成的 run 會包含多筆 evidence、source title / URL、Markdown findings、sources section，以及 JSON evidence bundle。這能驗證產品流程與 artifact contract；真正的 live search / reader / LLM 呼叫仍需要在 readiness 中配置對應 provider key。

本機 provider key 可放在 `.dev.vars`，格式可參考 `.dev.vars.example`。`npm run dev` 會載入 `.dev.vars` 中尚未由 shell 設定的變數，`GET /api/readiness` 只顯示已載入的 key 名稱，不回傳 secret value。自動化檢查可用 `DEV_VARS_PATH=/path/to/.dev.vars` 指向隔離的設定檔。

本機 server 與 Cloudflare Worker 應收斂到同一組 command-driven Web UI API contract。已實作項目可先保留相容入口，但產品主線應以 Define / Configure / Run / Observe / Control / Verify / Produce / Improve commands 為準：

- `GET /api/flows` 列出 flows
- `POST /api/flows` 建立 flow draft
- `GET /api/flows/:id` 查看 flow definition、versions、presets 與最近 runs
- `PATCH /api/flows/:id` 更新 flow draft metadata、schema、steps、edges、presets、bindings
- `DELETE /api/flows/:id` 刪除尚未執行的 draft，或封存已有 runs 的 flow
- `POST /api/flows/:id/runs` 從 flow 建立 run
- `POST /api/runs` 建立 run（相容舊入口；應逐步收斂到 `POST /api/flows/:id/runs`）
- `GET /api/runs/:id` 查看 run timeline、step detail、evidence、artifacts
- `DELETE /api/runs/:id` 刪除單一 local run
- `DELETE /api/runs` 清空 local run history
- `POST /api/runs/:id/cancel` 取消進行中的 run
- `POST /api/runs/:id/retry-step` 從目前 step 或指定 `stepId` 重新執行
- `GET /api/runs/:id/artifacts/:artifactId` 下載 Markdown report 或 JSON evidence bundle
- `GET /api/readiness` 查看本機持久化、Cloudflare resource placeholder、provider key 配置狀態

Provider / Policy / Skill / Evidence / Artifact / Eval / Memory 等 API 必須提供會改變狀態的 command，而不是只有 read-only summary。例如 provider test / disable、policy version / apply、skill eval、evidence approve / reject、artifact regenerate / export、eval case proposal approval。

Cloudflare Worker 也維持同一組 Web UI API contract：command surface、`/api/readiness`、run list/create/detail、delete/clear、cancel、retry-step，以及 R2 artifact download。Worker Workflow 會輸出 Markdown report、JSON evidence bundle、summary JSON 三個 R2 artifacts，並把 flow / version / running / complete 狀態與 workflow events 寫回 D1。這讓同一個 `apps/web` build 在本機 server 與 Cloudflare Worker 後端之間切換時，不需要替換前端程式。

前端 Workers Assets build：

```bash
npm run build:web
```

Web UI i18n 由 `apps/web/src/i18n.ts` 管理，預設語系為繁體中文，並支援英文。新增語系時應沿用 i18next resource structure，避免在 React components 中硬編文案。

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
