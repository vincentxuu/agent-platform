# External API + Access Control — Design

**Date:** 2026-06-03
**Status:** Draft (pending review)
**Topic:** 對外開放的程式化 API（`/v1`）讓其他服務觸發 flow run 並取回結果，並提供 API key / scope / rate limit / budget / audit 的管控機制。

## 1. 目標與範圍

讓外部服務能以程式方式使用本平台的 agent workflow runtime：

- **觸發 run**：指定 flow + preset + inputs 建立 run
- **取結果**：輪詢 run 狀態、下載 artifacts、讀取 evidence
- **探索**：列出該 key 可執行的 flows

所有對外存取都必須經過可管控、可審計的閘道。

### 非目標（YAGNI）

- 不做 OAuth / JWT / 多使用者帳號，只發靜態 API key
- `/v1` 不開放完整資源 CRUD（flows/providers/policies/skills 的管理留在內部 `/api`）
- 不做 run 完成的 webhook 回呼或 SSE 串流（MVP 採輪詢；保留未來擴充）
- 不做自動 key rotation（手動 revoke + 重新發行）

## 2. 架構決策

採「共用 gateway core + 雙後端各掛 `/v1`」（路線 A）。理由：本專案的本機 dev server（`scripts/local-dev-server.ts`）與 Cloudflare Worker（`apps/worker/src/index.ts`）共用同一組 API contract，前端 `apps/web` 不需替換即可切換後端。對外 API 與管控邏輯沿用此原則，使整套管控能在本機完整驗證，不必先部署到 Cloudflare。

- **公開命名空間 `/v1/*`**，與既有 admin `/api/*` 分離。
- **Bearer 認證**：`Authorization: Bearer ak_live_<random>`。
- **共用 gateway core**：`packages/runtime/src/api-gateway.ts`，為純邏輯 + 注入式儲存 adapter，可單元測試。
- **兩個後端各掛一層 middleware**：解析 key → 取得 client context → 依序執行管控 → 寫 audit → 呼叫既有 run/artifact handler。

## 3. 元件邊界

| 單元 | 職責 | 依賴 |
|------|------|------|
| `api-gateway.ts`（core） | key 雜湊與驗證、scope 檢查、rate-limit 判定、budget 判定、audit 記錄組裝 | `ApiGatewayStore` interface（注入） |
| `ApiGatewayStore`（interface） | `getClientByPrefix` / `recordAudit` / `incrRateWindow` / `getUsage` / `addUsage` | — |
| Worker store impl | D1（clients/audit/usage）+ KV（rate window，TTL） | `c.env.DB`、`c.env.CACHE` |
| Local store impl | state 目錄 JSON + in-memory rate window | local 檔案系統 |
| `/v1` middleware（×2 後端） | 串接 core + store，產出 HTTP 回應 | gateway core、既有 run handler |
| Admin `/api/api-clients`（×2 後端） | 發行 / 管理 / revoke / 查 audit | gateway store |
| Web UI「API Clients」區 | 操作介面 | 內部 `/api` |

判準：core 不知道 HTTP 與儲存細節；後端只負責 wiring。可單獨替換 store 而不影響 core。

## 4. 對外 API（`/v1`）

| Method + Path | Scope | 說明 |
|---------------|-------|------|
| `POST /v1/runs` | `runs:write` | body `{flowId, presetId, inputs}`；flow 須在 key 白名單內。回傳 `{runId, status}` |
| `GET /v1/runs/:id` | `runs:read` | run 狀態 / timeline / step state |
| `GET /v1/runs/:id/artifacts` | `artifacts:read` | artifact 清單 |
| `GET /v1/runs/:id/artifacts/:artifactId` | `artifacts:read` | 下載單一 artifact |
| `GET /v1/runs/:id/evidence` | `evidence:read` | evidence 清單 |
| `GET /v1/flows` | `flows:read` | 此 key 可執行的 flow（discovery） |

底層重用既有 `createRun` / `getRun` / artifact handler，不重寫執行邏輯。`run` 只能由建立它的 client 讀取（run 記錄 owner client_id）。

## 5. 資料模型

`packages/db/migrations/0010_api_gateway.sql`（worker；local 用對應 JSON 結構）：

```sql
CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL UNIQUE,        -- 例 ak_live_9f3c（查找用，非機密）
  key_hash TEXT NOT NULL,                 -- SHA-256(明碼)，明碼僅建立時回傳一次
  status TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  scopes_json TEXT NOT NULL DEFAULT '[]',
  allowed_flows_json TEXT NOT NULL DEFAULT '[]', -- 空陣列 = scope 內全部 flow
  rate_limit_json TEXT NOT NULL DEFAULT '{}',    -- {requestsPerMin, runsPerDay}
  budget_json TEXT NOT NULL DEFAULT '{}',        -- {maxCostUsd, maxTokens, window:"monthly"}
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS api_audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  run_id TEXT,
  status_code INTEGER NOT NULL,
  outcome TEXT NOT NULL,                   -- allow | deny:<reason>
  cost_usd REAL DEFAULT 0,
  tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_client_usage (
  client_id TEXT NOT NULL,
  window_key TEXT NOT NULL,               -- 例 2026-06（monthly）
  cost_usd REAL NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, window_key)
);
```

Rate-limit 短窗計數放 KV（worker，含 TTL）/ in-memory（local），不落 D1。

## 6. 管控流程（middleware，每個 `/v1` 請求）

1. 取 `Authorization: Bearer`；以 prefix 查 client；SHA-256 比對 hash。失敗 → **401**
2. `status === 'active'`？revoked → **401**（一律視為無效 key）
3. route 所需 scope 是否在 `scopes`？否 → **403**
4. （`POST /v1/runs`）`flowId` 是否在 `allowed_flows`（或白名單為空）？否 → **403**
5. rate limit：window counter +1；超過 `requestsPerMin` 或 `runsPerDay` → **429** + `Retry-After`
6. budget：**僅對建立 run 的請求（`POST /v1/runs`）檢查**；當期 `api_client_usage` vs `maxCostUsd` / `maxTokens`，已超過 → **402** `code: budget_exceeded`。唯讀請求（狀態 / artifact / evidence）豁免 budget，client 超預算後仍可取回已付費的結果。
7. 執行既有 handler
8. run 完成、cost/tokens 結算後（掛在 observability/cost 結算點），`addUsage` 歸戶到該 client 當期 window
9. 寫 `api_audit_log`（allow 或 deny + 原因 + status code）

budget 比對沿用 `packages/runtime/src/policy-runtime-controls.ts` 既有的 `maxCostUsd` / `maxTokens` 形狀。

## 7. 管理面（內部 `/api`，沿用既有 admin contract）

| Method + Path | 說明 |
|---------------|------|
| `GET /api/api-clients` | 清單（不含機密，只有 prefix） |
| `POST /api/api-clients` | 建立，**回傳明碼一次** |
| `PATCH /api/api-clients/:id` | 更新 name / scopes / allowed_flows / rate_limit / budget |
| `POST /api/api-clients/:id/revoke` | 失效 |
| `GET /api/api-clients/:id/audit` | 該 client 的 audit log 與當期 usage |

## 8. Web UI

Manage 群組下新增「**API Clients**」區：

- 清單（name、prefix、status、scopes、當期 budget 用量）
- 建立：表單設 name / scopes / allowed flows / rate limit / budget → 建立後一次性顯示明碼（複製按鈕 + 「只顯示這一次」警告）
- 編輯 scope / limit / budget；revoke
- 檢視 audit log 與 budget 用量

## 9. 消費端整合（其他服務怎麼接）

1. Admin 在 UI 發 key，取得 `ak_live_…`（一次性），交給對方服務當 secret 存放。
2. 對方以 base URL（本機 `http://127.0.0.1:8787`，部署後 `https://<worker-url>`）+ Bearer 呼叫：

```bash
# 觸發
curl -X POST $BASE/v1/runs -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"flowId":"deep_research","presetId":"standard","inputs":{"topic":"...","audience":"...","freshnessDays":365}}'
# 輪詢
curl $BASE/v1/runs/$RUN_ID -H "Authorization: Bearer $KEY"
# 取產出
curl $BASE/v1/runs/$RUN_ID/artifacts/markdown_report -H "Authorization: Bearer $KEY"
```

3. 管控訊號：`429`(+`Retry-After`/`X-RateLimit-*`)、`402`(`budget_exceeded`)、`403`(scope/flow)、`401`(無效/revoke)，對方據此退避或處理。

## 10. 錯誤與契約

- 統一 JSON error：`{ "error": string, "code": string }`
- HTTP 碼：401（未認證）、403（scope/flow 不允許）、404、422（輸入錯誤）、429（rate limit）、402（budget）、500
- Headers：`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`，429 另加 `Retry-After`
- 明碼絕不落地或重複回傳，只存 `key_prefix` + `key_hash`

## 11. 測試

- 新增 `scripts/check-public-api.ts`，接進 `npm run check`：
  - 發 client → 不帶 key（401）→ 帶 key 建 run（200）→ 缺 scope（403）→ flow 不在白名單（403）→ 觸發 rate limit（429）→ 超 budget（402）→ audit log 有對應記錄 → revoke 後（401）
- `scripts/check-worker-runtime.ts` 加一條 `/v1` smoke（建 key、建 run、取 artifact）
- core（`api-gateway.ts`）可獨立單測 scope / rate / budget 判定

## 12. 交付切片（建議實作順序）

1. gateway core + `ApiGatewayStore` interface + 單測
2. migration `0010` + worker/local store impl
3. admin `/api/api-clients` CRUD（×2 後端）
4. `/v1` middleware + endpoints（×2 後端），含 cost 歸戶 hook
5. `scripts/check-public-api.ts` + worker smoke
6. Web UI「API Clients」區
