## Why

Agent workflows are moving from one-off chat interactions toward controlled, auditable orchestration with provider routing, policy controls, evidence tracking, and reusable artifacts. Agent Gateway should establish a local-first AI agent platform that lets users run high-value workflows without manually choosing models, tools, readers, fallbacks, verification steps, and output formats for every task.

## What Changes

- Introduce Agent Gateway as a flow-based agent workflow platform centered on curated flows, strategy presets, step timelines, evidence-backed outputs, and reusable artifacts.
- Add a generic flow/run model that can power a Deep Research MVP first while remaining extensible to PR review, sales brief, compliance review, and other future workflows.
- Add a command-driven product surface for Define, Configure, Run, Observe, Control, Verify, Produce, and Improve workflows so the MVP cannot be satisfied by read-only management panels.
- Add versioned skill packages with metadata, instructions, permissions, files, evals, and explicit flow-step bindings.
- Add provider and MCP tool management with per-flow allowed tools, per-skill permissions, provider capability metadata, health tracking, fallback chains, and invocation logs.
- Add policy and runtime controls for budget limits, tool permissions, guard checks, checkpoint/resume, loop protection, escalation records, and human approval markers.
- Add context and memory management so each step receives a bounded, relevant context assembled from instructions, skills, tools, run state, evidence, artifacts, and scoped memory.
- Add observability, evidence, and artifact systems that make every run traceable from flow step to provider call, tool call, claim, source, and final artifact version.
- Add evaluation and learning-loop foundations for skill output checks, evidence/citation checks, artifact format checks, policy permission checks, regression case capture, and reviewable improvement proposals.
- Add the initial Web UI information architecture for running flows, inspecting timeline/context/evidence/artifacts, and managing flows, skills, providers, policies, memory, evals, and observability.

## Capabilities

### New Capabilities

- `flow-runtime`: Defines flow templates, flow versions, input schemas, presets, step graphs, run lifecycle, step execution, retry/re-run behavior, checkpoint/resume, and the Deep Research MVP flow.
- `skill-packages`: Defines installable, versioned skill packages with `skill.yaml`, `SKILL.md`, supporting files, permissions, eval bindings, explicit flow-step usage, and skill invocation tracking.
- `provider-tool-routing`: Defines provider management, MCP server/tool discovery, provider capability metadata, tool selection, per-flow and per-skill tool permissions, credential scope, fallback chains, and provider/tool invocation records.
- `policy-runtime-controls`: Defines budget, provider, quality, security, retry, and human approval policies plus guard pipeline behavior, loop protection, drift signals, escalation records, and approval requests.
- `context-memory-management`: Defines context block taxonomy, context budget allocation, dynamic tool/context selection, compression, context snapshots, memory types, memory scopes, retrieval rules, and reviewable memory write proposals.
- `observability-evidence-artifacts`: Defines run trace hierarchy, metrics, event logs, provider/skill/tool health views, evidence items, sources, claims, citations, conflicts, artifact versions, exports, diffs, and source traceability.
- `evaluation-learning-loop`: Defines eval suites, cases, scorecards, quality gates, skill/evidence/artifact/policy/regression evals, learning signals, and reviewable proposals for memory, skill, policy, and eval improvements.
- `agent-gateway-web-ui`: Defines the local-first Web UI command surfaces for Define, Configure, Run, Observe, Control, Verify, Produce, and Improve across flows, skills, providers, policies, context, memory, runs, evaluations, observability, evidence, and artifacts.

### Modified Capabilities

None. There are no existing OpenSpec capabilities in `openspec/specs/` to modify.

## Impact

- Affected systems: Web UI, local API routes, flow runtime, skill registry, provider registry, MCP integration, policy engine, context assembly, memory storage, evaluation runner, learning proposal workflow, evidence store, artifact store, and observability pipeline.
- Affected storage: introduces SQLite-backed tables for flows, runs, steps, skills, providers, MCP tools, policies, context snapshots, memory, evals, traces, metrics, evidence, artifacts, checkpoints, guard results, escalation records, and learning proposals.
- Affected APIs: introduces endpoints for flows, runs, run events, context, checkpoints, resume/cancel/retry-step, skills, evals, observability, memory proposals, guards, MCP servers/tools, providers, policies, evidence, artifacts, and learning proposals.
- Dependencies: requires local-first provider credentials and initial integrations for OpenAI/Anthropic LLMs, one search provider, Jina Reader, MCP server discovery, and structured logging/evaluation utilities.
- MVP scope: prioritize a command-complete Deep Research path: define or clone a flow, configure providers/policies/skills, run it, observe timeline/context/evidence/artifacts, control failures, verify evidence, produce artifacts, and capture improvement proposals without automatic production updates.
