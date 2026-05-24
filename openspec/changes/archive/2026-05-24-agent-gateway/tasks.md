## 1. Project Foundation And Persistence

- [x] 1.1 Inventory the existing repository architecture, framework, storage conventions, and API patterns to choose the implementation locations for Agent Gateway.
- [x] 1.2 Add database migrations or schema definitions for flows, flow versions, presets, steps, edges, runs, step runs, checkpoints, run events, and artifact schemas.
- [x] 1.3 Add database migrations or schema definitions for skills, skill versions, skill files, skill bindings, skill invocations, skill permissions, and skill eval metadata.
- [x] 1.4 Add database migrations or schema definitions for providers, credential references, MCP servers, MCP tools, MCP resources, MCP prompts, provider calls, and tool invocations.
- [x] 1.5 Add database migrations or schema definitions for policies, guard rules, guard results, approval requests, loop signals, drift signals, escalation policies, and escalation records.
- [x] 1.6 Add database migrations or schema definitions for context snapshots, context blocks, context budgets, context assemblies, compression records, tool selections, memory items, memory scopes, and memory write proposals.
- [x] 1.7 Add database migrations or schema definitions for trace spans, trace events, metric points, evidence items, sources, claims, citations, conflicts, artifacts, artifact versions, eval suites, eval cases, eval runs, eval results, regression cases, learning events, and learning proposals.

## 2. Flow Runtime

- [x] 2.1 Implement flow definition loading and validation for versioned flows with input schema, presets, steps, edges, allowed capabilities, and artifact schemas.
- [x] 2.2 Implement run creation from a selected flow version, preset, and validated user inputs.
- [x] 2.3 Implement the single-process run queue and StepRun state transitions for pending, running, succeeded, failed, paused, canceled, and skipped states.
- [x] 2.4 Implement edge resolution so completed steps schedule the next eligible step based on status and conditions.
- [x] 2.5 Implement checkpoint persistence at step boundaries with completed steps, current step, remaining steps, outputs, evidence references, artifact references, token usage, cost, and approval state.
- [x] 2.6 Implement resume, cancel, and retry-step operations for FlowRun records.
- [x] 2.7 Add the Deep Research v1 flow definition with Quick, Standard, and Deep presets.
- [x] 2.8 Implement flow draft create, clone, edit, validate, publish, archive, and delete-empty-draft commands.
- [x] 2.9 Add API coverage for `GET/POST/PATCH/DELETE /api/flows`, `POST /api/flows/:id/clone`, `POST /api/flows/:id/versions`, and `POST /api/flows/:id/runs`.

## 3. Provider And MCP Tool Routing

- [x] 3.1 Implement provider registry CRUD for LLM, search, reader, knowledge, action, and verifier provider records.
- [x] 3.2 Implement provider capability metadata, credential reference handling, enabled state, health status, latency, cost, quota, and fallback chain fields.
- [x] 3.3 Implement initial LLM provider adapters for OpenAI and Anthropic.
- [x] 3.4 Implement one MVP search provider adapter and one Jina Reader adapter.
- [x] 3.5 Implement MCP server registration and discovery of tools, resources, prompts, schemas, descriptions, and permission scopes.
- [x] 3.6 Implement step-local tool selection that intersects flow permissions, skill permissions, provider availability, and policy constraints.
- [x] 3.7 Persist provider calls and tool invocations with linked run ID, step ID, input/output references, status, duration, cost, tokens, retries, fallback reason, and errors.
- [x] 3.8 Expose provider create, update, disable, re-enable, and readiness test commands through API and UI.

## 4. Skill Package System

- [x] 4.1 Implement skill package discovery for local skill folders containing `skill.yaml`, `SKILL.md`, and optional references, scripts, assets, and evals.
- [x] 4.2 Implement skill package validation for required metadata, version, instruction file, schemas, permissions, and eval references.
- [x] 4.3 Implement SkillVersion registration and explicit FlowStep-to-skill binding resolution.
- [x] 4.4 Implement skill invocation execution context loading, including skill instructions, relevant references, allowed assets, input schema, output schema, and permissions.
- [x] 4.5 Add built-in Deep Research skill packages for research-planner, source-ranker, citation-extractor, and report-synthesizer.
- [x] 4.6 Persist SkillInvocation records with input references, output references, permission decisions, tool usage, status, duration, and errors.
- [x] 4.7 Expose skill install, update, disable, eval, and flow-step binding commands through API and UI.

## 5. Policy And Runtime Controls

- [x] 5.1 Implement policy models for budget, provider allow/deny lists, quality requirements, security permissions, retry behavior, and human approval gates.
- [x] 5.2 Implement input guards for input length, unsupported content, and sensitive data detection placeholders.
- [x] 5.3 Implement tool guards for permission checks, JSON schema validation, rate limits, and external-write approval requirements.
- [x] 5.4 Implement output guards for output schema validation, artifact format validation, and citation requirement checks.
- [x] 5.5 Implement budget guards for token, cost, runtime, iteration, tool call, and parallel unit limits.
- [x] 5.6 Implement loop protection for repeated tool calls, similar outputs, no-progress detection, and circuit breaker state.
- [x] 5.7 Implement escalation records for retry with better context, provider/model escalation, alternate skill or strategy, and human review marker.
- [x] 5.8 Expose policy draft, publish/version, archive, and apply-to-flow commands through API and UI.

## 6. Context And Memory Management

- [x] 6.1 Implement ContextBlock types for instructions, skill guidance, tool descriptions, task state, history, retrieval/evidence, artifacts, environment, examples, and dynamic run data.
- [x] 6.2 Implement ContextSnapshot assembly for every model-backed step.
- [x] 6.3 Implement context budget allocation by block category and response reserve.
- [x] 6.4 Implement compression or reference records for oversized tool output, old step output, evidence bundles, and artifact history.
- [x] 6.5 Implement dynamic tool description injection using the step-local tool selection result.
- [x] 6.6 Implement scoped memory records for procedural, episodic, and semantic memory with source run and freshness metadata.
- [x] 6.7 Implement episodic run summary capture on run completion.
- [x] 6.8 Implement reviewable MemoryWriteProposal creation for long-lived procedural or semantic memory suggestions.

## 7. Observability, Evidence, And Artifacts

- [x] 7.1 Implement structured TraceSpan and TraceEvent recording across FlowRun, StepRun, SkillInvocation, ProviderCall, ToolInvocation, GuardResult, VerifierResult, EvidenceItem, and ArtifactVersion records.
- [x] 7.2 Implement derived metrics for cost, latency, tokens, retries, fallback usage, tool usage, provider health, skill health, and quality signals.
- [x] 7.3 Implement evidence storage for claims, sources, excerpts, citations, conflicts, confidence, retrieved-at time, supporting step, and artifact references.
- [x] 7.4 Implement claim-to-source linking for Deep Research synthesis outputs.
- [x] 7.5 Implement Markdown report artifact generation and storage.
- [x] 7.6 Implement JSON evidence bundle artifact generation and storage.
- [x] 7.7 Implement artifact versioning so regenerated artifacts create new versions without deleting prior versions.
- [x] 7.8 Expose evidence approve, reject, and annotate commands through API and UI.
- [x] 7.9 Expose artifact approve, reject, regenerate, and export commands through API and UI.

## 8. Evaluation And Learning Loop

- [x] 8.1 Implement eval suite, eval case, eval run, eval result, eval metric, regression case, and quality gate records.
- [x] 8.2 Implement skill trigger eval and skill output schema eval execution for built-in Deep Research skills.
- [x] 8.3 Implement evidence and citation evals for coverage, excerpt validity, unsupported claims, and conflicts.
- [x] 8.4 Implement artifact format evals for Markdown report and JSON evidence bundle outputs.
- [x] 8.5 Implement policy permission evals that verify unauthorized tool invocations are blocked.
- [x] 8.6 Implement learning signal capture for user correction, verifier failure, provider failure, retry success, cost outlier, and manual feedback.
- [x] 8.7 Implement reviewable proposal records for memory updates, skill changes, policy suggestions, and new eval cases.
- [x] 8.8 Ensure skill publication or promotion is blocked when required quality gates fail.
- [x] 8.9 Expose eval case creation from failed/corrected runs and reviewable improvement proposal commands through API and UI.

## 9. Web UI

- [x] 9.1 Implement the flow selection and run input UI for Deep Research.
- [x] 9.2 Implement preset selection and policy/provider summary before starting a run.
- [x] 9.3 Implement run timeline with streaming progress and step status.
- [x] 9.4 Implement step detail view with skill invocation, provider calls, tool invocations, guard results, errors, retries, cost, latency, tokens, and retry-step action.
- [x] 9.5 Implement context snapshot view showing selected context blocks, budgets, tool descriptions, compression records, and memory injections.
- [x] 9.6 Implement evidence viewer showing sources, excerpts, claims, citations, confidence, conflicts, and linked artifacts.
- [x] 9.7 Implement artifact viewer for Markdown reports and JSON evidence bundles with version history and export actions.
- [x] 9.8 Implement initial read-only management views for flows, skills, providers, policies, memory, evals, observability, evidence, and artifacts.
- [x] 9.9 Replace read-only management panels with command-complete surfaces for Define, Configure, Control, Verify, Produce, and Improve.
- [x] 9.10 Ensure empty states and primary actions lead to commands such as Create Flow, Clone Deep Research, Test Provider, Publish Policy, Run Eval, Regenerate Artifact, or Create Improvement Proposal.

## 10. Integration And Verification

- [x] 10.1 Add an end-to-end Deep Research fixture that runs from topic input through planning, search, reading, evidence extraction, synthesis, verification, report generation, evidence bundle generation, trace, checkpoint, and eval capture.
- [x] 10.2 Add tests for flow version reproducibility, step lifecycle, checkpoint/resume, cancel, and retry-step behavior.
- [x] 10.3 Add tests for skill package validation, explicit skill binding, skill invocation tracking, and built-in skill execution.
- [x] 10.4 Add tests for provider fallback, MCP discovery, step-local tool selection, and invocation logging.
- [x] 10.5 Add tests for policy guards, budget enforcement, loop protection, escalation recording, and external-write approval blocking.
- [x] 10.6 Add tests for context snapshot assembly, budget allocation, compression records, scoped memory capture, and memory write proposals.
- [x] 10.7 Add tests for evidence linking, artifact versioning, metrics derivation, and run trace inspection.
- [x] 10.8 Add tests for eval execution, learning signal capture, reviewable proposal creation, and quality gate enforcement.
- [x] 10.9 Run OpenSpec validation for the `agent-gateway` change and fix any proposal, design, spec, or task format issues.
- [x] 10.10 Add end-to-end tests for create/clone/edit/validate/publish flow, provider test/disable, policy publish/apply, skill eval/bind, evidence approval, artifact regenerate/export, and improvement proposal creation.
