## Context

Agent Gateway introduces a local-first agent workflow platform for controlled, auditable, evidence-backed work. The proposal adds multiple cross-cutting subsystems: flow runtime, skill packages, provider/MCP routing, policy controls, context and memory, observability, evidence, artifacts, evaluation, learning proposals, and Web UI surfaces.

The MVP should prove the platform through a Deep Research flow without over-building a fully generic visual workflow builder or cloud orchestration layer. The first implementation should favor explicit command surfaces, durable local records, clear permission boundaries, and inspectable run history over autonomous free-form agent behavior or read-only dashboards.

Primary constraints:

- Run locally with local credentials, local database, local evidence, and local artifacts.
- Support future workflow expansion without rewriting the runtime.
- Make provider calls, tool calls, skill invocations, evidence, costs, and artifacts traceable.
- Keep skill, memory, policy, and learning updates reviewable instead of automatically modifying production behavior.
- Use a practical MVP execution model first, with a migration path to a durable workflow engine later.

## Goals / Non-Goals

**Goals:**

- Define the MVP architecture for a command-complete workflow loop: define flows, configure providers/policies/skills, run flows, observe execution, control failures, verify evidence, produce artifacts, and capture improvement proposals.
- Establish stable data boundaries between flows, skills, providers, policies, context, memory, evals, traces, evidence, and artifacts.
- Support an initial Deep Research flow end to end: topic input, planning, search, reading, evidence extraction, synthesis, verification, Markdown report, JSON evidence bundle, trace, checkpoint, and eval capture.
- Keep the system local-first and Docker-deployable with SQLite as the initial persistence layer.
- Preserve extensibility for future flows, visual builder, advanced dashboards, external connectors, A2A delegation, and durable execution engines.

**Non-Goals:**

- No fully free-form drag-and-drop DAG builder in the MVP.
- No marketplace, cloud sync, team RBAC, billing, or organization shared learning in the MVP.
- No automatic production updates to skills, memory, policies, or evals from the learning loop.
- No A2A external agent delegation on the MVP path.
- No broad connector catalog; start with the minimum provider/search/reader/MCP integrations required for Deep Research.

## Decisions

### 1. Use A Local-First Monolith With Modular Runtime Boundaries

Agent Gateway will start as a local-first application with a Web UI, local API routes, a local SQLite database, local credentials, local artifact storage, and Docker deployment support.

Rationale: provider credentials, internal sources, evidence bundles, and run traces are sensitive. A local-first model reduces trust barriers and allows the MVP to validate runtime behavior before adding cloud synchronization or multi-tenant concerns.

Alternatives considered:

- Cloud-first SaaS: better collaboration primitives, but adds credential trust, tenancy, RBAC, billing, and deployment complexity too early.
- CLI-only runtime: simpler to implement, but misses the core product value of observable, controllable workflow execution through a UI.

### 2. Represent Work As Versioned Flows With Presets And Explicit Steps

Flows will be stored as versioned definitions containing input schema, presets, steps, edges, artifact schema, and allowed capabilities. Users must be able to create or clone a draft, edit it through structured controls, validate bindings, and publish an immutable version. Runs reference a specific FlowVersion and FlowPreset so behavior can be audited and reproduced.

Rationale: the product should guide users through task-specific workflows rather than expose a blank chat surface. Versioned flow definitions also let future flows reuse the same runtime and skill packages.

Alternatives considered:

- Chat-first sessions with hidden orchestration: easier initial UI, but weak auditability and poor repeatability.
- Fully dynamic DAG builder first: flexible, but too much surface area before the workflow model is proven.

### 3. Execute MVP Runs With A Single-Process Queue And State-Machine Runtime

The MVP runtime will use a single-process queue that creates a FlowRun, enqueues StepRuns, resolves skill/policy/tool bindings, assembles context, runs guards, executes the step, persists outputs, saves checkpoints, records trace events, evaluates boundaries, and resolves the next edge.

Rationale: this keeps the runtime understandable while still using graph/state-machine semantics. The data model should be compatible with a later migration to Temporal, Inngest, Cloudflare Workflows, or AWS Step Functions.

Alternatives considered:

- Durable workflow engine immediately: stronger reliability, but adds operational and conceptual overhead before the run model is stable.
- One large agent loop: fastest prototype, but hard to checkpoint, inspect, evaluate, or constrain.

### 4. Model Skills As Versioned Packages, Not Tools Or Flows

Skills will be installed packages with `skill.yaml`, `SKILL.md`, optional references/scripts/assets/evals, permissions, trigger metadata, and versioned SkillVersion records. Flow steps should bind skills explicitly in production paths, with routing triggers used as assistive metadata rather than sole dispatch authority.

Rationale: skills encode procedural knowledge and quality contracts. Keeping them separate from flows and MCP tools lets the platform version, evaluate, permit, and audit how work is performed.

Alternatives considered:

- Markdown-only skills: simple, but insufficient for platform metadata, permissions, schema, and evals.
- Treat skills as MCP tools: conflates instructions/methodology with external capabilities.

### 5. Centralize Provider And MCP Tool Routing

Provider management and MCP discovery will be handled through registries that track provider type, capabilities, credentials, health, fallback order, cost, latency, and tool/resource/prompt metadata. Tool selection will be step-local and policy-aware.

Rationale: users should not manually choose models, search tools, readers, fallback chains, and verification providers for every run. Central routing also gives policy, observability, and eval systems one place to inspect decisions.

Alternatives considered:

- Hard-code provider calls per step: faster for one flow, but prevents provider health tracking and reusable routing.
- Expose every MCP tool to every step: maximizes capability but weakens context quality and permission boundaries.

### 6. Enforce Policy Through Runtime Guards

Policies define budget, provider, quality, security, human approval, and retry constraints. Runtime guards enforce those policies at input, tool, output, and budget boundaries. Guard results are persisted and attached to run traces.

Rationale: policy must be more than configuration. It should actively constrain tool use, external writes, cost, loops, schema validity, and citation requirements.

Alternatives considered:

- Prompt-only policy instructions: easy to add, but unreliable and hard to audit.
- Global static policy: simpler, but cannot support flow/preset-specific behavior.

### 7. Build Context From Bounded Blocks

Each model call receives a ContextSnapshot assembled from typed ContextBlocks: instructions, skill guidance, tool descriptions, task state, history, memory, evidence, artifacts, environment, examples, and dynamic run data. Context budgets are allocated per block category and oversized content is compressed or referenced.

Rationale: context is a runtime resource. Bounded assembly avoids tool overload, stale memory injection, and prompt bloat while preserving inspectability.

Alternatives considered:

- Static prompt templates: predictable but too rigid for multi-step workflows.
- Always include all available memory/tools/history: convenient but degrades model behavior and increases cost.

### 8. Treat Memory As Reviewable Runtime Asset

Memory will support procedural, episodic, and semantic records with explicit scopes. The MVP will capture episodic run summaries and support memory write proposals, while long-lived procedural/semantic updates require review.

Rationale: memory can improve continuity, but polluted memory creates long-term quality and safety problems. A proposal/review flow keeps production behavior controlled.

Alternatives considered:

- Automatic memory writes for all corrections and facts: convenient but high risk.
- No memory in MVP: simpler, but misses a core platform primitive and weakens context management design.

### 9. Use Trace-First Observability With Evidence And Artifact Links

Every run records a hierarchy from FlowRun to StepRun, SkillInvocation, ProviderCall, ToolInvocation, GuardResult, VerifierResult, EvidenceItem, and ArtifactVersion. Metrics derive from those records for cost, latency, tokens, retries, fallback, tool usage, eval pass rate, citation coverage, and failures.

Rationale: plain logs are not enough. Users need to understand what happened, why it happened, what it cost, which providers/tools were used, and which claims support the final artifact.

Alternatives considered:

- Append-only text logs: easy to implement, but poor for UI inspection and metrics.
- Adopt external observability tooling immediately: useful later, but local structured records should be the source of truth first.

### 10. Make Evidence And Artifacts First-Class Outputs

The Deep Research MVP will produce at least a Markdown report and JSON evidence bundle. Evidence items link claims, sources, excerpts, retrieval time, confidence, conflicts, supporting step, and artifact references. Artifacts are versioned and traceable to run outputs and evidence.

Rationale: the platform differentiates itself by making results auditable and reusable, not just generated text.

Alternatives considered:

- Store final response only: faster, but fails the verification and auditability goals.
- Full document/PDF/PPT pipeline in MVP: valuable, but Markdown plus JSON evidence is enough to validate the core model first.

### 11. Gate Learning Through Proposals And Evals

The learning loop will detect signals from failures, retries, corrections, eval results, cost outliers, provider failures, and verifier failures. It may create MemoryUpdate, SkillProposal, PolicySuggestion, or EvalCase proposals, but production changes require review and evaluation.

Rationale: agent-generated improvements need external validation. This keeps self-improvement useful without making runtime behavior unpredictable.

Alternatives considered:

- Fully automatic skill or policy updates: attractive long term, but unsafe for early product behavior.
- No learning capture: simpler, but loses valuable run feedback and regression opportunities.

### 12. Define UI Around Workflows, Inspection, And Control

The Web UI should expose command surfaces for Define, Configure, Run, Observe, Control, Verify, Produce, and Improve across Run, Flows, Skills, Providers, Policies, Context, Memory, Runs, Evaluations, Observability, Evidence, and Artifacts. The first experience should be a usable workflow loop, not a marketing-style landing page, empty chat, or read-only admin dashboard.

Rationale: the target user wants controllable work execution and auditability. The UI must make run progress, provider usage, evidence, cost, retries, context composition, and artifacts visible, and it must expose the commands needed to change state when the workflow needs definition, configuration, recovery, verification, or improvement.

Alternatives considered:

- Chat-first UI: familiar, but misaligned with flow-based execution.
- Admin dashboard first: easier to build around tables, but read-only views do not prove the platform.

## Risks / Trade-offs

- Overly broad MVP scope -> Keep Deep Research as the first end-to-end flow and defer advanced dashboards, builder, external action connectors, marketplace, cloud sync, and A2A.
- Capability boundaries too coarse or too fine -> Use the proposal capability list as the spec contract, then refine each spec around user-observable behavior rather than database table boundaries.
- Single-process queue reliability limits -> Persist checkpoints, run events, and step outputs in SQLite so runs can resume locally; design records for future durable engine migration.
- Context overload or stale retrieval -> Require ContextSnapshot records, context budgets, tool subset selection, and compression decisions for every model step.
- Memory pollution -> Treat long-lived memory writes as proposals requiring review; limit MVP automatic capture to scoped episodic summaries.
- Provider/tool permission leaks -> Enforce per-flow and per-skill tool permissions through runtime guards before invocation.
- Evidence quality gaps -> Require citation/evidence evals and make unsupported claims visible instead of silently accepting them.
- Observability degenerates into logging -> Store structured trace spans/events and derive metrics/views from them.
- Skill quality drift -> Version SkillVersion records and require trigger/output/policy/regression evals before publishing.
- Guard rules blocking valid work -> Support warn/block outcomes and record GuardResult details so policies can be tuned.

## Migration Plan

1. Scaffold the local database schema and persistence layer for the MVP records: flows, runs, steps, skills, providers, MCP tools, policies, context snapshots, guard results, checkpoints, traces, metrics, evidence, artifacts, evals, memory, and learning proposals.
2. Implement the FlowRuntime and single-process queue with StepRun state transitions, checkpoint persistence, event streaming, cancellation, resume, and retry-step support.
3. Add provider registry, MCP server/tool discovery, credential references, provider capability records, tool selection, and invocation logging.
4. Add skill package loading for local packages, built-in Deep Research skills, skill permission checks, and SkillInvocation records.
5. Add policy evaluation and runtime guards for input length, tool permissions, schema validation, budget limits, retries, loop protection, and external write approval markers.
6. Add context assembly with ContextBlocks, budget allocation, tool subset selection, compression records, and ContextSnapshot inspection.
7. Add Deep Research v1 flow with Quick, Standard, and Deep presets and the end-to-end path from topic input to Markdown report and JSON evidence bundle.
8. Add evidence extraction, citation validation, artifact versioning, and basic evals for skill output schema, evidence/citation coverage, artifact format, policy permissions, and regression case capture.
9. Add Web UI command surfaces needed for the first workflow loop: flow create/clone/edit/validate/publish, provider test/disable, policy version/apply, skill install/eval/disable, run creation, timeline inspection, retry/cancel/resume, evidence approve/reject, artifact regenerate/export, and improvement proposal creation.
10. Keep rollback simple during MVP: migrations should be additive where possible, flow definitions are versioned, and failed runs remain inspectable without being deleted.

## Open Questions

- Which search provider should be first for the MVP: Tavily or Exa?
- Which framework and runtime conventions should the local Web UI/API use in this repository?
- How much of provider credential storage should be encrypted locally in the MVP versus referenced from environment variables?
- What is the minimum viable evidence schema for citation quality without overbuilding claim verification?
- Should Deep Research v1 include a clarify step, or should it rely on required input fields and presets for the first release?
- What level of semantic memory retrieval is required for MVP, if any, beyond scoped episodic summaries and reviewable proposals?
- Which eval runner should execute schema/artifact/policy checks initially: in-process TypeScript utilities, external scripts, or a dedicated eval worker?
