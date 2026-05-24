# Agent Platform / Agent Gateway 規劃文件

**Date:** 2026-05-14
**Status:** Draft
**Source research:** `/Users/vincent/Work/research/ai/2026-05-14_12-04_agent-workflow-trends.md`

> Naming note: Agent Gateway 是早期工作名；對外產品名稱以 Agent Platform 為主。Gateway 指的是 provider / policy / runtime 邊界，不是產品只做 API gateway。

## 1. 產品定位

Agent Platform 是一個開源 AI workflow control plane，提供可操作的 agent workflow runtime、provider routing、policy control、evidence tracking 與 artifact generation，讓使用者透過 Web UI 定義、配置、執行、觀測、控制、驗證、產出與改善多種 AI agent workflows。

一句話定位：

> Open-source AI workflow control plane for creating, versioning, running, observing, and verifying auditable agent flows.

中文定位：

> 一個可配置的 AI Agent 工作流平台，統一管理 flows、模型、工具、資料來源、執行策略、驗證機制、證據與最終產物。

核心判斷：

- **Flow 是產品根資源，但產品不是 CRUD 後台。** 使用者先 define / configure flow，再從 flow 建立 run；providers、policies、skills、evals、memory、artifacts 都服務於 runtime loop。
- **Run 是 flow version 的執行實例。** Run 不應成為唯一產品入口。
- **Deep Research 是 seed flow / showcase。** 它驗證 runtime、evidence、artifact 與 policy contract，但不能限制產品形狀。

## 2. 使用者意圖

使用者真正想完成的不是「跟 AI 聊天」，而是：

- 用可控方式完成高價值工作，例如研究、審查、摘要、回覆、分析、提案。
- 不想自己選模型、搜尋工具、reader、connector、fallback、驗證流程。
- 希望結果可追蹤、可驗證、可重跑，而不是只拿到一段無法審計的生成文字。
- 希望團隊可以共用同一套 provider、policy、run history、evidence 與 artifact。

## 3. 趨勢判斷

根據 agent workflow 研究，2026 年主流方向已經從 single agent demo 轉向 workflow orchestration：

- **Workflow-first:** 先用可控流程，再逐步加入 autonomy。
- **Graph-based harness:** 用 nodes、edges、state、retries、handoff 管理長任務。
- **Multi-agent handoff:** specialist agents 在受控流程中交接，不做不可追蹤的自由群聊。
- **Guardrails / policy:** 成本、權限、provider、敏感資料、human approval 都變成一級配置。
- **Durable execution:** 長任務需要可恢復、可重試、可審計的 execution log。
- **Observability:** 每一步用了什麼 provider、工具、成本、輸出與 evidence 都要可追蹤。
- **Visual / low-code builder:** GUI 組 workflow 是 adoption 方向，但底層仍需要工程級 schema。

產品策略因此應該是：

- 不做空白 chatbot。
- 不只做模型 router。
- 不一開始做完全自由 DAG builder。
- 先做 command surface + Flow Library + seeded templates。
- Flow editor 第一版可以是結構化表單加 schema/YAML 檢視，不必一開始做拖拉式 visual DAG。
- Curated flows 應作為可複製模板，不應取代自訂 flow。

## 4. 系統分層

```text
Web UI
  ↓
Flow Definition Layer
  ↓
Skill System
  ↓
Learning Loop
  ↓
Evaluation System
  ↓
Observability System
  ↓
Policy Engine
  ↓
Context Management
  ↓
Memory System
  ↓
Runtime Controls
  ↓
AI Agent Harness
  ↓
MCP / Provider Router / A2A Adapter
  ↓
Evidence / Audit Store
  ↓
Artifact System
```

### 4.0 Cloudflare-first deployment mapping

正式架構改為 Cloudflare-first，本機 runtime 只保留為開發替身與測試 harness。

```text
Browser
  ↓
Cloudflare Workers + Workers Assets
  ↓
RunCoordinator Durable Object
  ↓
Cloudflare Workflows
  ↓
Cloudflare Queues for side jobs
  ↓
Flow Runtime / Policy / Provider Router / Skill System
  ↓
D1 metadata + KV cache + R2 artifacts/evidence + Workers AI/provider adapters
```

服務邊界：

| 平台能力 | Cloudflare 服務 | 責任 |
|----------|-----------------|------|
| Web console | Workers Assets | 服務 `apps/web` 靜態管理介面 |
| API gateway | Workers | `/api/health`、`/api/flows`、`/api/runs`、auth/policy/provider routing |
| Durable execution state | Durable Objects | 每個 run 一個 coordinator，維持單一寫入者與即時狀態 |
| Durable flow execution | Workflows | flow step execution、pause/resume、retry、step status |
| Background jobs | Queues | eval、artifact export、provider health、非阻塞 retry jobs |
| Relational contract | D1 | 既有 `packages/db/migrations` schema |
| Large output | R2 | report、evidence bundle、step output、proposal diff |
| Fast state/cache | KV | session、idempotency、provider health、UI run snapshot |
| Native model option | Workers AI | 可由 provider router 當作 LLM provider 之一 |

### 4.1 Web UI

負責讓使用者完成任務，而不是面對空白 prompt。

主要頁面：

- **Flows:** Flow Library、搜尋、建立、複製 seed flow、封存、查看最近 runs。
- **Flow Editor:** 編輯 metadata、input schema、steps、edges、presets、provider bindings、policy refs、artifact schema，並執行 publish validation。
- **Run:** 從 flow version 選 preset、填 inputs、檢查策略摘要、啟動 run、看 streaming progress。
- **Runs:** 查看歷史 run、active runs、step timeline、錯誤、成本、重跑、取消、刪除入口。
- **Skills:** 管理可版本化能力包，支援 list / detail / install / update / disable / eval。
- **Providers:** 管理 LLM、Search、Reader、Knowledge、Action providers，支援 create / update / disable / test readiness。
- **Policies:** 管理成本、權限、fallback、guardrails、verification，支援 create / update / version / apply。
- **Context:** 查看每個 step 的 context composition、token budget、compression 與 injected memory。
- **Memory:** 管理 procedural、episodic、semantic memory 的 scope、來源、衰減與審核狀態。
- **Evaluations:** 查看 skill / flow / artifact / regression eval 結果與趨勢。
- **Observability:** 查看 provider health、latency、cost、token、tool usage、retry、failure pattern。
- **Evidence:** 查看 sources、quotes、claims、confidence、conflicts。
- **Artifacts:** 管理 Markdown report、Notion page、Slack draft、GitHub comments、PDF/PPT。

所有核心頁面都應先定義 command，而不是只定義 table / detail view：

- **Define:** create / clone / edit flow draft，validate，publish version。
- **Configure:** test / disable provider，version / apply policy，install / disable / eval skill，bind capabilities to steps。
- **Run:** create run from a specific flow version and preset.
- **Observe:** inspect timeline、step state、context、tool/provider calls、cost、latency、errors。
- **Control:** cancel、resume、retry-step、approve gate、use fallback。
- **Verify:** review claims、evidence、citations、policy violations、eval results，approve / reject。
- **Produce:** regenerate、version、approve、export artifacts。
- **Improve:** create eval case、skill proposal、policy suggestion、memory proposal from run evidence.

第一個可用畫面應是 Flow Library / Recent Runs dashboard：

- 顯示內建 seed flows 與使用者自訂 flows。
- 每個 flow card 顯示 published version、presets、最近 run status、provider readiness、policy summary。
- Primary actions 是 Create Flow、Clone Deep Research、Run Flow。
- Empty state 要引導下一步，不顯示 raw JSON 或只列內部狀態。

### 4.2 Flow Definition Layer

Flow 是產品的核心抽象。每個 flow 定義「要完成什麼任務」與「有哪些步驟」。

核心資料模型：

```text
Flow
FlowVersion
FlowInputSchema
FlowStep
FlowEdge
FlowPreset
ArtifactSchema
```

Define command 是 MVP 最核心路徑，不是後續增強：

- `GET /api/flows`：列出 seed、自訂、draft、published、archived flows。
- `POST /api/flows`：建立新 flow draft，或從 seed / existing flow clone。
- `GET /api/flows/:id`：讀取 flow metadata、versions、draft、presets、bindings、最近 runs。
- `PATCH /api/flows/:id`：更新 draft 的 metadata、input schema、steps、edges、presets、provider bindings、policy refs、artifact schemas。
- `DELETE /api/flows/:id`：刪除沒有 runs 的 draft；已有 runs 的 flow 只能 archive，保留 audit trail。
- `POST /api/flows/:id/versions`：publish draft，產生不可變 flow version。
- `POST /api/flows/:id/runs`：從指定 flow version / preset 建立 run。

Flow 狀態：

- `draft`：可編輯，不應用於正式 run，適合 validation preview。
- `published`：不可變，用於正式 run；run 必須保存 `flow_id` 與 `flow_version_id`。
- `archived`：不可新增 run，但保留歷史 run、evidence、artifacts 與 audit trail。

Flow editor 第一版應用結構化 command controls 管理複雜度：

- Metadata tab：name、description、owner、tags、visibility。
- Inputs tab：JSON schema / form fields、required、default、validation。
- Steps tab：step type、skill binding、provider requirements、tool permissions、retry policy。
- Edges tab：next step、condition、loop limit、failure path。
- Presets tab：Quick / Standard / Deep 或自訂 preset 的 budget、quality、freshness、verification。
- Policy tab：cost limit、provider fallback、guardrails、human approval。
- Artifacts tab：output types、schema、approval / export target。
- Validate / Publish：檢查 graph、schema、bindings、policy、artifact schema 後才能 publish。

範例：

```yaml
id: deep_research
name: Deep Research
version: 1
inputs:
  - id: topic
    type: string
    required: true
  - id: audience
    type: string
    required: false
  - id: freshness_days
    type: number
    default: 365
steps:
  - id: clarify
    type: agent
  - id: build_brief
    type: transform
  - id: plan
    type: agent
  - id: search
    type: tool_group
  - id: rank_sources
    type: agent
  - id: read_sources
    type: tool_group
  - id: extract_evidence
    type: agent
  - id: synthesize
    type: agent
  - id: verify
    type: verifier
  - id: export
    type: artifact
edges:
  - from: clarify
    to: build_brief
  - from: build_brief
    to: plan
  - from: plan
    to: search
  - from: verify
    to: search
    condition: coverage_insufficient
  - from: verify
    to: export
    condition: passed
artifacts:
  - markdown_report
  - evidence_bundle
```

### 4.3 Skill System

Skill 是可安裝、可版本化、可觸發、可審計的能力包。它不是 Flow，也不是 MCP tool，而是封裝某類工作「怎麼穩定完成」的程序性知識。

核心責任邊界：

```text
Flow = 任務編排
Skill = 能力包 / 方法論 / 執行指令
MCP = 工具與資料源連接
A2A = 外部 agent 委派協議
Policy = 成本、權限、驗證、人類審核
```

Skill 應採資料夾 package 結構：

```text
skills/
  citation-extractor/
    skill.yaml
    SKILL.md
    references/
      evidence-schema.md
      citation-rules.md
    scripts/
      validate_evidence.ts
    assets/
      report-template.md
    evals/
      trigger-cases.json
      golden-cases.json
```

`skill.yaml` 負責平台 metadata、版本、schema、權限與 eval 設定；`SKILL.md` 負責實際執行指令。這比只用 Markdown frontmatter 更適合平台化管理。

範例：

```yaml
id: citation-extractor
name: Citation Extractor
version: 1.0.0
description: Extracts claims, citations, excerpts, and source mappings from research material. Use when a flow needs evidence extraction, citation checking, or claim-to-source mapping.

triggers:
  phrases:
    - extract evidence
    - citation checking
    - claim source mapping
  step_types:
    - evidence_extract
    - verifier

input_schema: ./schemas/input.json
output_schema: ./schemas/output.json

permissions:
  mcp_tools:
    - reader.read_url
    - browser.fetch
  external_write: false

runtime:
  type: instruction_bundle
  entrypoint: SKILL.md

evals:
  trigger_cases: ./evals/trigger-cases.json
  golden_cases: ./evals/golden-cases.json
```

Progressive disclosure：

```text
Level 1: skill.yaml metadata
  永遠可被 skill router 掃描，用來判斷是否 relevant。

Level 2: SKILL.md
  FlowStep 確認要使用此 skill 時才載入。

Level 3: references / scripts / assets
  SKILL.md 明確指向，且執行需要時才載入。
```

FlowStep 應以 explicit binding 為主、router trigger 為輔。Production flow 不應完全依賴模型自行判斷要不要載入 skill。

```yaml
steps:
  - id: extract_evidence
    type: skill
    uses: citation-extractor@1.0.0
    input:
      sources: "{{steps.read_sources.output}}"
```

核心資料模型：

```text
Skill
SkillVersion
SkillFile
SkillBinding
SkillRun
SkillInvocation
SkillPermission
SkillEval
SkillEvalRun
```

MVP 內建 skills：

- research-planner
- source-ranker
- citation-extractor
- report-synthesizer

### 4.4 Learning Loop

Learning Loop 從 FlowRun、StepRun、ToolInvocation、UserFeedback、EvalResult 中提取可重用改進，產生 memory update、skill proposal、policy suggestion 或 eval case。

它的原則是：

> Agent can propose learning, but production knowledge requires eval and human approval.

Learning Loop 不應讓 agent 直接修改 production skill / policy / memory，而是產生可審核 proposal。

輸出類型：

```text
MemoryUpdate
  小型、低風險的偏好、專案慣例、工具注意事項。

SkillProposal
  從成功/失敗 trajectory 提取新 skill，或建議修改既有 skill。

PolicySuggestion
  例如 provider 常失敗、某 tool 應加上限、某 flow 需要 approval gate。

EvalCase
  把真實失敗案例轉成 regression test。
```

觸發訊號：

- user_correction
- run_failed_then_succeeded
- step_retry_succeeded
- high_tool_count
- verifier_failure
- manual_feedback
- cost_outlier
- provider_failure

建議流程：

```text
Run completed
  -> learning candidate detector
  -> trace summarizer
  -> memory / skill / policy / eval proposal
  -> human review
  -> sandbox eval
  -> publish SkillVersion or policy update
```

可借鑑 Hermes Agent 的三個機制，但採更保守的工程化版本：

- **Nudge Engine:** 不以固定對話輪數為主，而是在 run completed、failed run recovered、user correction、step retry succeeded、5+ tool calls 等事件後觸發。
- **Curator:** 定期標記 stale skill、建議 archive / merge / patch，但不自動刪除 bundled 或 published skill。
- **Offline optimization:** Phase 3 可導入 GEPA / DSPy-style candidate generation，但只能產生 candidate SkillVersion，必須通過 eval 與人工審核。

核心資料模型：

```text
MemoryItem
MemoryScope
LearningEvent
LearningSignal
SkillProposal
SkillProposalDiff
SkillCuratorRun
EvalCase
EvalRun
SkillOptimizationRun
```

### 4.5 Evaluation System

Evaluation System 是全平台品質控制層，不只是 Learning Loop 的附屬功能。它負責評估 flow、step、skill、artifact、evidence 與 policy 是否達到可發布標準。

Eval 類型：

- **Flow eval:** 評估整條 workflow 是否完成任務、是否符合 preset 的品質與成本要求。
- **Step eval:** 評估單一步驟輸出是否符合 schema、是否可被下游 step 使用。
- **Skill eval:** 評估 skill trigger、functional correctness、output schema、tool permissions、成本與延遲。
- **Artifact eval:** 評估最終 report、PR review、draft、brief 等 artifact 的完整性、格式、可讀性與可採用性。
- **Evidence eval:** 評估 citation coverage、claim-to-source mapping、excerpt validity、conflict detection、source freshness。
- **Policy eval:** 評估 budget、provider allowlist、tool permission、approval gate、external write restriction 是否被正確執行。
- **Regression eval:** 將真實失敗案例、user correction、verifier failure 轉成固定測試，防止後續 skill / flow 版本回歸。

Eval 應支援三種執行時機：

```text
Pre-run
  檢查 flow / skill / policy / provider / MCP tool binding 是否有效。

In-run
  在 step boundary 執行 schema、policy、citation、coverage、budget verifier。

Post-run
  評估 artifact、evidence bundle、run trajectory、cost、latency 與 user feedback。
```

核心 scorecard：

```text
correctness
coverage
citation_quality
schema_validity
policy_compliance
cost_efficiency
latency
tool_selection_accuracy
retry_recovery
human_acceptance
```

Skill 發布 gate：

```text
SkillVersion draft
  -> trigger eval
  -> functional eval
  -> policy eval
  -> regression eval
  -> human review
  -> publish
```

核心資料模型：

```text
EvalSuite
EvalCase
EvalRun
EvalResult
EvalMetric
EvalJudge
EvalDataset
RegressionCase
QualityGate
```

MVP 應先支援：

- Skill trigger eval
- Skill output schema eval
- Evidence / citation eval
- Artifact format eval
- Policy permission eval
- Regression eval case extraction，但不一定要完整自動化 runner

### 4.6 Observability System

Observability System 負責讓使用者與開發者理解每次 run 發生了什麼、為什麼失敗、花了多少成本、用了哪些 skill / provider / MCP tools，以及品質訊號如何變化。

Trace 應能串起完整執行路徑：

```text
FlowRun
  -> StepRun
  -> SkillInvocation
  -> ProviderCall
  -> ToolInvocation
  -> VerifierResult
  -> ArtifactVersion
  -> EvidenceItem
```

每個 trace span / event 至少應記錄：

```text
id
parent_id
run_id
step_id
type
status
started_at
ended_at
duration_ms
input_ref
output_ref
error_type
error_message
provider
model
tokens_input
tokens_output
cost_usd
retry_count
policy_decision
evidence_refs
artifact_refs
```

Metrics 類型：

- **Cost:** total cost、cost per run、cost per step、cost per provider、cost per skill。
- **Latency:** p50 / p95 run latency、step latency、provider latency、tool latency。
- **Usage:** token usage、tool call count、MCP invocation count、skill usage count。
- **Reliability:** error rate、retry rate、fallback frequency、cancel rate、timeout rate。
- **Quality:** eval pass rate、citation coverage、verifier failure rate、human correction rate、artifact approval rate。
- **Provider health:** success rate、latency p95、quota errors、rate limit errors、fallback usage。
- **Skill health:** usage count、eval pass rate、cost trend、stale status、proposal count、regression failures。

UI 視圖：

- Run timeline
- Step detail
- Cost breakdown
- Provider health
- MCP tool usage
- Skill health
- Eval trends
- Failure pattern explorer

技術選型：

- MVP 可先用 SQLite trace tables + structured JSON event log。
- 事件格式應接近 OpenTelemetry span model，方便未來接 OpenTelemetry、LangSmith、Arize Phoenix 或自建 trace store。
- Evidence / Audit Store 與 Observability 要分工清楚：Observability 解釋 execution，Evidence 解釋 claims and sources。

核心資料模型：

```text
TraceSpan
TraceEvent
MetricPoint
RunMetric
ProviderMetric
SkillMetric
ToolMetric
QualityMetric
ErrorRecord
```

### 4.7 Policy Engine

Policy 決定 flow 可以怎麼跑。它應該和 flow definition 分離，讓同一個 flow 可以套不同策略。

Policy 類型：

- **Budget policy:** max cost、max tokens、max iterations、max runtime。
- **Provider policy:** allowlist、denylist、fallback chain、region、data residency。
- **Quality policy:** min sources、citation required、conflict check、freshness check。
- **Security policy:** sensitive data redaction、tool permission、least privilege。
- **Human policy:** approval gates、manual review、risk threshold。
- **Retry policy:** retry count、backoff、fallback provider、skip behavior。

範例：

```yaml
id: research_standard
budget:
  max_cost_usd: 3
  max_iterations: 4
  max_parallel_units: 5
providers:
  llm:
    planner: [anthropic, openai]
    synthesizer: [openai, gemini]
    verifier: [gemini, anthropic]
  search:
    order: [tavily, exa, jina]
    fallback: true
  reader:
    order: [jina_reader, firecrawl, browser]
quality:
  min_sources_per_subquestion: 3
  citation_required: true
  conflict_check: true
  stale_source_check: true
human:
  approval_required_before_actions: false
  approval_required_before_external_write: true
```

### 4.8 Context Management

Context Management 是 harness 的核心子系統，負責在每一次模型呼叫前組裝「最小但足夠」的 context。它不是 prompt template，而是動態決定哪些 instruction、skill、tool definition、memory、evidence、artifact、run state 應該進入 context window。

核心策略：

```text
Write
  把中間結果、決策、觀察、artifact refs 寫到 context window 外部，等待未來按需選取。

Select
  從 memory、evidence、tool registry、run state、artifact history 中選出當前 step 需要的資訊。

Compress
  將長工具輸出、舊 step outputs、歷史對話、evidence bundle 壓縮成高訊號摘要。

Isolate
  用 skill context、subagent context、sandbox context 或 step-local state 隔離高噪音任務。
```

Context block taxonomy：

```text
Instructional
  system prompt、policy summary、skill instruction、output contract。

Dynamic
  user input、current time、runtime env、provider status。

Historical
  run history、previous decisions、conversation summary、checkpoint summary。

Retrieval-based
  memory retrieval、RAG chunks、sources、evidence items。

Environmental
  available tools、MCP capabilities、filesystem / connector state。

Exemplary
  few-shot examples、golden outputs、artifact templates。

Task State
  current step、completed steps、open questions、pending approvals、retry history。
```

Context assembly pipeline：

```text
StepRun starts
  -> load FlowStep + SkillBinding + Policy
  -> determine context budget
  -> select relevant memory / evidence / artifacts
  -> select allowed tools
  -> compress oversized blocks
  -> assemble prompt + tool definitions
  -> record ContextSnapshot
  -> model call
```

Token budget 應分配到區塊，而不是任由 prompt 無限制膨脹：

```text
instructions: 10-15%
skill instructions: 10-20%
tool definitions: 10-20%
task state: 10-15%
retrieval / evidence: 25-40%
scratchpad / working notes: 10-20%
response budget: reserved separately
```

Tool definitions 也是 context，應由 ToolSelector 動態掛載：

- 單次模型呼叫只掛當前 step / skill 可用的工具子集。
- 工具描述要自包含，說明何時使用、輸入限制、常見錯誤。
- 工具之間語義重疊時，應由 ToolOverlapDetection 標示並要求描述修正。
- MCP tool 的 raw schema 不一定直接進 prompt，可先轉成 model-friendly description。

核心資料模型：

```text
ContextSnapshot
ContextBlock
ContextBudget
ContextAssembly
ContextCompression
ContextInjection
ToolSelection
ToolDescription
ToolOverlapWarning
```

### 4.9 Memory System

Memory 是 harness 資產，不只是 Learning Loop 的輸出。Agent Platform 應 local-first 擁有 memory，避免把使用者偏好、團隊規則、run history 與 workflow know-how 鎖在外部 provider。

Memory 類型：

```text
Procedural Memory
  怎麼做某類工作：skills、rules、playbooks、policy defaults、workflow conventions。

Episodic Memory
  發生過的事件：FlowRun summary、user correction、failure recovery、provider incident。

Semantic Memory
  去脈絡化事實：project facts、org knowledge、domain facts、stable user preferences。
```

Memory scope：

```text
org_id
user_id
project_id
flow_id
skill_id
session_id
source_run_id
```

Retrieval strategy：

- Procedural memory 數量少、長期有效，應以 explicit binding 或 high-priority retrieval 進入 context。
- Episodic memory 需結合 recency、relevance、outcome、decay，避免舊事件污染當前任務。
- Semantic memory 需支援 entity / keyword / vector 多訊號檢索，並有 freshness / superseded 標記。
- Memory write 分 hot path 與 offline path：hot path 只寫低風險 episodic record；procedural / semantic 更新應走 proposal + review。

Memory lifecycle：

```text
capture
  從 run events、user feedback、artifact edits、verifier failures 擷取候選記憶。

classify
  判斷 procedural / episodic / semantic，套用 scope。

dedupe
  和既有 memory 做相似度與 entity 比對。

approve
  高風險或長期 procedural memory 需 human review。

retrieve
  Context Manager 在 step boundary 依 scope 和 task 取回。

decay / archive
  Episodic memory 依時間和使用率衰減；過期 memory 不刪除，先 archive。
```

核心資料模型：

```text
MemoryItem
MemoryScope
MemorySource
MemoryEmbedding
MemoryRetrieval
MemoryWriteProposal
MemoryDecayPolicy
MemoryArchive
```

### 4.10 Runtime Controls

Runtime Controls 是 Policy Engine 在執行期的落地機制，包含 guard pipeline、checkpoint / resume、loop protection、escalation controller。它們確保長任務可中斷、可恢復、可防失控。

Guard pipeline：

```text
Input Guards
  PII detection、prompt injection、input length、unsupported content。

Tool Guards
  permission check、JSON schema validation、rate limit、external write approval、sensitive operation confirmation。

Output Guards
  output schema、citation validation、format validation、toxicity / unsafe content、hallucination check。

Budget Guards
  token、cost、runtime、iteration、tool call count、parallel unit limit。
```

Checkpoint / Resume：

```text
Checkpoint
  run_id
  step_id
  completed_steps
  current_step
  remaining_steps
  key_findings
  intermediate_outputs
  context_summary
  token_usage
  cost_usd
  tool_call_count
  artifact_refs
  evidence_refs
  approval_state
```

MVP 可先用 SQLite checkpoint + human-readable progress summary；未來再接 Temporal、Inngest、Cloudflare Workflows 或 AWS Step Functions。

Loop protection：

```text
max_iterations
repeated_tool_call_detection
output_similarity_detection
no_progress_detector
circuit_breaker
cooldown / pause
```

Drift detection：

```text
original_intent_adherence
step_goal_adherence
policy_drift
context_degradation
tool_selection_drift
```

Escalation controller：

```text
fast model
  -> retry with better context
  -> stronger model
  -> alternative skill / strategy
  -> human review
```

Escalation 不是 provider failure fallback。它應記錄升級原因、原始 context、失敗模式、成本與最終結果，供 eval、observability 和 learning loop 使用。

核心資料模型：

```text
GuardRule
GuardResult
Checkpoint
ResumeRequest
LoopSignal
CircuitBreakerState
DriftSignal
EscalationPolicy
EscalationRecord
```

### 4.11 AI Agent Harness

Agent Harness 是中間真正的執行核心。它把 flow + skill + policy 轉成可控、可恢復、可觀測的任務執行。

負責能力：

- **Plan:** 拆解任務、建立子問題、定義停止條件。
- **Context Manager:** 組裝 context blocks、控制 token budget、壓縮與隔離 context。
- **Memory Manager:** 管理 procedural、episodic、semantic memory 的寫入、檢索、衰減與審核。
- **Tool Registry / Tool Selector:** 從 MCP / local tools 中選出 step-local tool subset。
- **Guard Pipeline:** 執行 input、tool、output、budget guards。
- **Checkpoint Manager:** 保存 run / step 狀態，支援 resume。
- **Loop Protection:** 偵測重複工具呼叫、相似輸出、無進展與 circuit breaker。
- **Escalation Controller:** 在品質不足或失敗時升級模型、策略或 human review。
- **Skill calls:** 載入 SkillVersion、檢查 schema / permissions、記錄 SkillInvocation。
- **Tool calls:** 呼叫 search、reader、browser、GitHub、Notion、Slack、SQL 等工具。
- **Model calls:** 根據 step role 選不同 provider/model。
- **State:** 保存 run state、step state、intermediate outputs。
- **Control loop:** 決定繼續、回退、重試、handoff、停止。
- **Guardrails:** 套用 policy、敏感資料檢查、權限檢查。
- **Verification:** 執行 citation、coverage、test、policy verifier。
- **Artifact output:** 組裝最終產物。

Harness 不應該是一個巨大 while loop，而應該是 graph/state-machine runtime。

設計原則：

> Harness components encode assumptions about model limitations. Each component should be measurable, replaceable, and periodically revalidated.

核心 runtime 資料模型：

```text
FlowRun
StepRun
AgentInvocation
ToolInvocation
ProviderCall
RunState
RunEvent
ApprovalRequest
VerifierResult
ContextSnapshot
Checkpoint
GuardResult
EscalationRecord
```

### 4.12 MCP / Provider Router / A2A Adapter

此層統一管理模型 provider、MCP tool server 與外部 agent adapter。MCP 應優先支援，A2A 則先預留 schema，等跨系統或跨組織 agent 協作需求明確後再接入。

Provider 類型：

- **LLM providers:** OpenAI、Anthropic、Gemini、OpenRouter、Groq、Together、Ollama。
- **Search providers:** Tavily、Exa、Jina Search、Brave、SerpAPI。
- **Reader providers:** Jina Reader、Firecrawl、browser、direct fetch。
- **Knowledge providers:** Notion、Slack、GitHub、Google Drive、local files、SQL。
- **Action providers:** GitHub issue/comment、Slack message、Notion page、Asana task、email。
- **Verifier providers:** citation checker、test runner、lint/typecheck、policy checker。

MCP integration 應支援：

- MCP server registry
- tool / resource / prompt discovery
- per-flow allowed tools
- per-skill tool permissions
- invocation logs
- credential scope

核心資料模型：

```text
McpServer
McpTool
McpResource
McpPrompt
ToolInvocation
```

Provider Router 應支援：

- auth / credential management
- quota / cost tracking
- latency / success rate tracking
- health check
- fallback chain
- model alias
- provider capability discovery
- per-flow provider binding

A2A Adapter 應先預留：

```text
ExternalAgent
ExternalAgentCapability
AgentTask
AgentMessage
AgentDelegationRun
```

A2A 不應進 MVP 主路徑。它牽涉遠端 agent identity、capability discovery、auth、trust boundary、callback / streaming、failure handling、cost ownership 與 audit trail，適合 Phase 3。

### 4.13 Evidence / Audit Store

Evidence 是與一般 agent platform 拉開差異的核心。每個重要結論都應能追到來源與執行紀錄。

核心資料模型：

```text
EvidenceItem
Source
Excerpt
Claim
Citation
Conflict
ConfidenceScore
AuditEvent
```

範例：

```json
{
  "claim": "Graph-based orchestration is becoming a mainstream agent harness pattern.",
  "source_url": "https://www.langchain.com/langgraph",
  "excerpt": "...",
  "retrieved_at": "2026-05-14T12:04:00+08:00",
  "confidence": "high",
  "supports_step": "synthesize",
  "artifact_id": "artifact_123"
}
```

### 4.14 Artifact System

Flow 的輸出不應只是一段聊天回覆，而應是 artifact。

第一批 artifact 類型：

- Markdown report
- JSON evidence bundle
- Notion document draft
- Slack draft
- GitHub PR review summary
- GitHub issue
- CSV / spreadsheet analysis
- PDF / PPT export

Artifact 應支援：

- versioning
- source traceability
- regenerate from step
- export
- diff
- approval status

## 5. Agent UX 設計

這個產品應避免「純 chat」。使用者應該用小格子配置大任務，背後由 flow 包裝成完整 prompt / policy / execution graph。

### 5.1 使用者流程

1. 進入 Flow Library，瀏覽 seed flows 與自訂 flows。
2. 建立新 Flow，或複製 Deep Research seed flow 作為起點。
3. 在 Flow Editor 維護 inputs、steps、edges、presets、provider bindings、policy refs、artifact schema。
4. Validate / Publish flow，產生可執行 version。
5. 從 flow version 選擇 Preset，例如 Quick、Standard、Deep、Enterprise。
6. 填必要欄位，例如 topic、audience、freshness、output format。
7. 檢查策略摘要，例如 sources、budget、providers、verification。
8. 開始執行。
9. 在 Run Timeline 看每一步進度。
10. 在 Evidence Viewer 檢查來源與 claim。
11. 在 Artifact Viewer 編輯、核准、匯出。

### 5.2 可控性設計

- 使用者可在執行前調整 provider / budget / verification level。
- 使用者可在需要時批准 external write actions。
- 使用者可針對某個 step 重跑，而不是整個 flow 重來。
- 使用者可把 artifact 回退到前一版。
- 使用者可查看每個 claim 的 evidence，不必盲信最終報告。
- 使用者可複製既有 flow 形成新的 draft，而不是直接修改歷史版本。
- 使用者可封存 flow，但不能破壞已有 run 的 audit trail。

## 6. MVP 範圍

第一版必須同時做到 command surface 與 Deep Research showcase。Deep Research 是 seed flow，用來證明 runtime、evidence、artifact、policy 與 observability；command surface 則證明這不是 hardcoded demo 或單一執行表單。

### 6.1 MVP 必做

- Web UI
- Flow Library / Recent Runs dashboard
- Define：create / clone flow draft，edit inputs / steps / edges / presets / provider bindings / policy refs / artifact schema，validate，publish immutable version
- Configure：create / test / disable provider，version / apply policy，install / disable / eval skill，bind capability to flow step
- Run：`POST /api/flows/:id/runs` 作為主要入口，run 必須引用 fixed flow version / preset / bindings
- Observe：timeline、step detail、context snapshot、provider/tool calls、cost、latency、token、retry、error
- Control：cancel、resume、retry-step、approval gate、checkpoint recovery
- Verify：evidence / citation / claim review，policy violation review，eval result review，approve / reject evidence or artifact
- Produce：Markdown report、JSON evidence bundle、artifact versioning、regenerate、approve、export
- Improve：從 failed run / feedback / eval result 建立 eval case、skill proposal、policy suggestion、memory proposal
- Deep Research seed flow
- Quick / Standard / Deep 三個 presets
- Local skill package support
- Built-in skills: research-planner、source-ranker、citation-extractor、report-synthesizer
- MCP server registry + tool discovery
- Per-flow allowed tools
- Per-skill MCP tool permissions
- Provider management
- LLM providers: OpenAI、Anthropic
- Search providers: Tavily 或 Exa 二選一
- Reader providers: Jina Reader
- FlowRun / StepRun / ProviderCall logging
- SkillRun / SkillInvocation logging
- ToolInvocation logging
- TraceSpan / RunEvent structured logging
- Basic metrics: cost、latency、token、retry、tool count
- ContextSnapshot logging
- Basic context budget tracking
- ToolSelector: per-step / per-skill tool subset
- Basic guard pipeline: input length、tool permission、schema validation、budget guard
- SQLite checkpoint + resume from latest checkpoint
- Loop protection: max iterations、repeated tool call detection
- Basic escalation record: retry with better context、provider/model escalation、human review marker
- Memory scopes schema + episodic run summary capture
- Skill trigger eval + output schema eval
- Evidence / citation eval
- Artifact format eval
- Policy permission eval
- Evidence Store
- Markdown report artifact
- JSON evidence bundle
- Run timeline
- Basic policy: max cost、max iterations、provider fallback、citation required
- Learning Loop trace capture，先保留 proposal 入口，不自動發布 skill / memory / policy

### 6.2 MVP 暫不做

- 完全自由拖拉式 DAG builder
- 多人即時協作 flow editor
- Team permission / RBAC
- Cloud sync
- Marketplace
- 自動發布 self-learning workflow
- A2A external agent delegation
- Offline skill optimization / GEPA
- Skill marketplace
- Organization shared learning
- Full semantic memory / vector search
- Advanced context compaction
- Fully automated escalation strategy optimization
- 複雜 billing
- 所有 connector
- 長時間 durable execution engine 整合

### 6.3 第二階段

- Visual workflow builder
- Advanced YAML/JSON editor
- Flow diff / review / approval workflow
- Human approval gates
- Notion / Slack / GitHub connectors
- Cost dashboard
- Artifact diff
- Skill proposal review
- Memory update proposal
- Memory retrieval UI + semantic memory
- Context budget dashboard
- Guard configuration UI
- Checkpoint browser / manual resume
- Loop and drift detection dashboard
- Escalation analytics
- Eval case extraction
- Eval dashboard
- Provider / skill health dashboard
- Failure pattern explorer
- Curator dashboard
- Temporal / Inngest / Cloudflare Workflows integration
- PR Review flow
- Sales Brief flow
- Compliance Review flow

### 6.4 第三階段

- A2A external agent delegation
- Offline skill optimization
- Skill A/B testing
- Organization-level shared learnings
- Skill marketplace

## 7. 初始 Flow Roadmap

### Research Flows

- Deep Research
- Quick Research
- Competitor Research
- Literature Review
- Source Audit
- Market Intelligence

### Engineering Flows

- PR Review
- CI Failure Diagnosis
- Dependency Risk Review
- Release Note Generator
- Incident Postmortem

### Business Flows

- Sales Account Brief
- RFP / Proposal Draft
- Customer Support Reply
- Meeting Prep
- Weekly Report

### Knowledge Flows

- Notion Knowledge Capture
- Slack Digest
- Document Comparison
- Policy Q&A
- Internal Search Brief

## 8. 技術架構建議

### 8.1 Cloudflare-first runtime

初期部署目標改為 Cloudflare-first：

- Workers 提供 API gateway、policy boundary 與 provider router
- Workers Assets 服務 Web GUI
- D1 保存 flow/run/step/policy/skill/evidence/eval metadata
- R2 保存大型 evidence、artifact、report 與 step output
- KV 保存 session、idempotency key、provider health 與短期 run snapshot
- Workflows 執行 Deep Research 這類長任務 flow step、retry、pause/resume
- Queues 執行 eval、export、provider health、非阻塞 retry 等背景 jobs
- Durable Objects 管理單一 run 的即時狀態協調與 checkpoint fan-out
- Workers AI 作為 provider router 可選的 edge model provider

本機 in-memory runtime 保留為開發、單元檢查與 adapter contract 測試替身。

### 8.2 API shape

```text
GET    /api/flows
POST   /api/flows
GET    /api/flows/:id
PATCH  /api/flows/:id
DELETE /api/flows/:id
POST   /api/flows/:id/clone
GET    /api/flows/:id/versions
POST   /api/flows/:id/versions
GET    /api/flows/:id/versions/:version_id
POST   /api/flows/:id/runs
POST   /api/runs               # compatibility alias; new UI should prefer /api/flows/:id/runs
GET    /api/runs
GET    /api/runs/:id
GET    /api/runs/:id/events
GET    /api/runs/:id/context
GET    /api/runs/:id/checkpoints
POST   /api/runs/:id/resume
POST   /api/runs/:id/cancel
POST   /api/runs/:id/retry-step
GET    /api/skills
POST   /api/skills
GET    /api/skills/:id
PATCH  /api/skills/:id
DELETE /api/skills/:id
GET    /api/skills/:id/versions/:version
POST   /api/skills/:id/evals
GET    /api/evals
POST   /api/evals
GET    /api/evals/:id
PATCH  /api/evals/:id
DELETE /api/evals/:id
POST   /api/evals/run
GET    /api/evals/:id/runs
GET    /api/observability/runs/:id/trace
GET    /api/observability/metrics
GET    /api/memory
POST   /api/memory/proposals
GET    /api/guards
POST   /api/guards
GET    /api/mcp/servers
POST   /api/mcp/servers
GET    /api/mcp/servers/:id/tools
GET    /api/providers
POST   /api/providers
GET    /api/providers/:id
PATCH  /api/providers/:id
DELETE /api/providers/:id
POST   /api/providers/:id/test
GET    /api/policies
POST   /api/policies
GET    /api/policies/:id
PATCH  /api/policies/:id
DELETE /api/policies/:id
GET    /api/policies/:id/versions
GET    /api/evidence?run_id=...
GET    /api/evidence/:id
PATCH  /api/evidence/:id
GET    /api/artifacts?run_id=...
GET    /api/artifacts/:id
PATCH  /api/artifacts/:id
POST   /api/artifacts/:id/regenerate
POST   /api/artifacts/:id/export
GET    /api/learning/proposals
POST   /api/learning/proposals/:id/approve
```

API 設計原則：

- API 必須覆蓋 command surface，不只覆蓋 read model。
- 對可管理資產使用一致 REST shape：`GET collection`、`POST collection`、`GET item`、`PATCH item`、`DELETE item`。
- `DELETE` 對有 audit trail 的資源應實作為 archive / disable，而不是破壞性刪除。
- Run / Evidence / Artifact 不是任意 CRUD：Run 側重 create/read/cancel/retry/delete；Evidence 側重 review/annotate/approve/reject；Artifact 側重 version/regenerate/approve/export。
- 會影響執行結果的資源需要 version 或 audit record，run 必須保存引用版本。

### 8.3 Storage

初期可用 SQLite / D1：

```text
flows
flow_versions
flow_drafts
flow_presets
flow_steps
flow_edges
flow_artifact_schemas
flow_provider_bindings
flow_policy_bindings
policies
providers
credentials
skills
skill_versions
skill_files
skill_bindings
skill_runs
skill_invocations
skill_permissions
skill_evals
skill_eval_runs
eval_suites
eval_cases
eval_runs
eval_results
eval_metrics
regression_cases
quality_gates
mcp_servers
mcp_tools
mcp_resources
mcp_prompts
context_snapshots
context_blocks
context_budgets
context_assemblies
context_compressions
context_injections
tool_selections
tool_descriptions
tool_overlap_warnings
flow_runs
step_runs
provider_calls
tool_invocations
run_events
guard_rules
guard_results
checkpoints
resume_requests
loop_signals
circuit_breaker_states
drift_signals
escalation_policies
escalation_records
trace_spans
trace_events
metric_points
run_metrics
provider_metrics
skill_metrics
tool_metrics
quality_metrics
error_records
evidence_items
sources
claims
artifacts
artifact_versions
approval_requests
memory_items
memory_scopes
memory_sources
memory_embeddings
memory_retrievals
memory_write_proposals
memory_decay_policies
memory_archives
learning_events
learning_signals
skill_proposals
skill_proposal_diffs
```

### 8.4 Execution

MVP 可先用單 process queue：

```text
Run request
  -> create FlowRun
  -> enqueue first StepRun
  -> resolve SkillVersion / policy / MCP permissions
  -> assemble context snapshot
  -> run input / budget guards
  -> execute step
  -> run tool / output guards
  -> save checkpoint
  -> persist event/output
  -> detect loop / drift / escalation signals
  -> resolve next edge
  -> enqueue next StepRun
  -> verify/export/finish
  -> capture learning signals
```

未來再抽象到 durable engine：

- Temporal
- Inngest
- Cloudflare Workflows
- AWS Step Functions

## 9. 成功指標

產品層：

- 使用者能在 5 分鐘內建立或複製第一個 flow draft。
- 使用者能發布 flow version，並從該 version 建立 run。
- 使用者能在 5 分鐘內完成第一個 Deep Research run。
- 使用者能清楚看懂每一步用了什麼 provider。
- 使用者能從每個結論追到 evidence。
- 使用者能重跑單一步驟。
- 使用者能複製一個 preset 並調整策略。
- 使用者能封存 flow 且仍可查看既有 runs。
- 使用者能查看每個 run 的 trace、成本、latency、token、retry 與 tool usage。
- 使用者能查看 flow / skill / artifact 的 eval 結果。
- 使用者能查看每個 step 的 context composition 與 tool subset。
- 使用者能從 checkpoint 恢復中斷的 run。

品質層：

- 每個 report 至少 80% 主要 claims 有 citation。
- 每個 subquestion 至少有指定數量來源。
- Provider failure 可 fallback 或清楚標示失敗。
- Run event log 可完整重建執行路徑。
- Skill output 符合 output schema。
- Policy / permission eval 能擋下未授權 tool invocation。
- Regression cases 可從失敗 run 轉入 eval suite。
- Context budget utilization 可追蹤，超過門檻會觸發 compression 或 block。
- Loop protection 能停止重複工具呼叫或無進展 run。
- Escalation record 能解釋為何升級模型、策略或 human review。

商業層：

- Command surface 成立，產品不被 Deep Research 單一案例綁死。
- Deep Research 作為第一個 killer flow。
- 後續新增 flow 不需重寫 runtime，只需新增 flow definition + step handlers。
- 後續新增 workflow 能重用既有 skill package 與 eval suite。
- Provider 整合可持續擴充。

## 10. 主要風險

- **過度平台化：** 一開始做太多自由配置，導致 MVP 過重。
- **視覺化 builder 過早：** 使用者需求未穩定前，拖拉式 DAG 會拖慢開發。
- **Provider 數量失控：** 支援很多 provider 但缺少 capability schema 與測試會增加維護成本。
- **Context 超載：** 如果沒有 context budget、tool subset 和 compression，模型會忽略重要指令或選錯工具。
- **Context 不足或過期：** Retrieval / memory 選錯會讓 agent 缺背景或使用舊資訊做決策。
- **Memory 污染：** 自動寫入錯誤或過期 memory 會長期影響後續 runs，procedural / semantic memory 必須走 proposal review。
- **Guard 規則過硬：** 過度嚴格的 guard 會讓正常 workflow 卡住，需要 warn / block 模式和逐步調整。
- **Checkpoint 不完整：** 如果只保存 step status，不保存 context summary、artifact refs、evidence refs，resume 後可能產生不一致。
- **Loop / drift 偵測不足：** 只靠 max iterations 會太晚發現失控，需加入 repeated tool call、no-progress、similarity 和 intent adherence signals。
- **Eval 覆蓋不足：** 只有 final artifact eval 會漏掉 tool selection、step output、policy violation 與 trajectory regression。
- **Observability 退化成 logging：** 如果沒有 metrics、trace hierarchy 與 dashboard taxonomy，使用者仍無法理解失敗原因與成本來源。
- **Skill 品質漂移：** 自動產生或修改 skill 若缺少 eval / review，會讓行為變得不可預測。
- **自我評估偏差：** Agent 對自己的表現常過度樂觀，Learning Loop 必須依賴外部 verifier、eval 或人工審核。
- **MCP 權限邊界不清：** Skill 若可任意呼叫 MCP tools，會造成資料外洩或不可逆 action 風險。
- **A2A 過早導入：** 外部 agent 委派牽涉 identity、trust、cost ownership 與 audit trail，不適合 MVP。
- **Evidence 驗證不足：** 如果 claim-to-source mapping 不可靠，產品會退化成一般報告生成器。
- **Long-running reliability：** 沒有 durable execution 時，長任務中斷會影響信任。
- **Credentials trust：** Provider key、OAuth token、內部資料 connector 都需要 local-first 與清楚權限邊界。

## 11. 建議下一步

1. 對外產品名稱使用 Agent Platform；Agent Gateway 保留為 runtime / provider boundary 概念。
2. 定義 Command Surface v1：Define、Configure、Run、Observe、Control、Verify、Produce、Improve 的 command、state transition、audit record。
3. 定義 Flow Define v1 schema：Flow、FlowDraft、FlowVersion、FlowStep、FlowEdge、FlowPreset、FlowArtifactSchema、FlowProviderBinding、FlowPolicyBinding。
4. 畫出 Web UI IA 與 Flow Library / Flow Editor / Run Detail wireframe。
5. 定義 Deep Research seed flow 的 v1 schema，作為可複製模板。
6. 定義 Skill package schema：`skill.yaml`、`SKILL.md`、permissions、evals。
7. 定義 Context Management v1：context block schema、budget allocation、tool selection、compression policy。
8. 定義 Memory System v1：procedural / episodic / semantic type、scope、write proposal、retrieval policy。
9. 定義 Runtime Controls v1：guard rules、checkpoint schema、loop detection、escalation records。
10. 定義 Evaluation System v1：scorecard、eval case schema、quality gates。
11. 定義 Observability v1：trace span schema、run metrics、provider / skill / tool / context metrics。
12. 定義 MCP server / tool discovery 與 ToolInvocation schema。
13. 定義 Provider capability schema。
14. 先做 local-first MVP，不碰 cloud sync。
15. 建立第一個 end-to-end path：create/clone flow -> edit draft -> validate -> publish version -> run -> evidence -> artifacts -> trace。
16. 建立 Deep Research run：topic -> assemble context -> plan skill -> select search MCP tool -> read -> extract evidence skill -> synthesize -> verify -> markdown artifact -> checkpoint / eval / trace。
17. 讓 Learning Loop 先只 capture trace / signal / proposal，不自動修改 production skill / memory / policy。
