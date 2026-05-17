# Agent Platform

一個以 Flow 為核心的 AI Agent Workflow Platform。讓使用者透過 Web GUI 選擇、配置、執行、監控與驗證多種 AI agent workflows。

> A flow-based AI Agent Gateway with provider routing, policy control, agent harness execution, evidence tracking, and artifact generation.

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
- **Local-first runtime**：本機 Web GUI、本機 DB、本機 credentials、Docker deployable
- **Evidence-backed outputs**：每個主要 claim 都有 citation
- **Policy as configuration**：成本、權限、provider、human approval 都是一級配置
- **Durable execution**：長任務可恢復、可重試、可審計

## 文件

- [`agent-gateway-plan.md`](./agent-gateway-plan.md) — 完整規劃文件，包含系統分層、資料模型、API shape、技術架構與風險分析

## 狀態

**Status:** Draft  
**Date:** 2026-05-14
