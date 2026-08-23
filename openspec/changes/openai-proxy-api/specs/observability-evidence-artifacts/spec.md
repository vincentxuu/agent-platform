## MODIFIED Requirements

### Requirement: Structured run trace
The system SHALL record a structured trace hierarchy linking FlowRun, StepRun, SkillInvocation, ProviderCall, ToolInvocation, GuardResult, VerifierResult, EvidenceItem, and ArtifactVersion records.

#### Scenario: Inspect run timeline
- **WHEN** a user opens a run timeline
- **THEN** the system shows ordered steps with linked skill, provider, tool, guard, evidence, and artifact records

#### Scenario: Inspect proxy request trace
- **WHEN** a user opens proxy request observability
- **THEN** the system shows proxy request spans with type `proxy_request`, linked to client ID, model ID, provider ID, fallback chain, and streaming chunk details

### Requirement: Runtime metrics
The system SHALL derive cost, latency, token, retry, fallback, tool usage, provider health, skill health, and quality metrics from structured runtime records.

#### Scenario: Review cost breakdown
- **WHEN** a user views run observability
- **THEN** the system shows total cost and cost by step, provider, skill, and tool

#### Scenario: Review proxy metrics
- **WHEN** a user views proxy observability
- **THEN** the system shows total proxy cost, cost by model, cost by provider, latency percentiles, token usage, fallback rate, streaming chunk count, and error rate

### Requirement: Evidence store
The system SHALL store evidence items linking claims, sources, excerpts, citations, conflicts, confidence, retrieval time, supporting step, and artifact references.

#### Scenario: Review evidence item
- **WHEN** a user approves, rejects, or annotates an evidence item
- **THEN** the system records the review decision, reviewer, timestamp, and reason while preserving the original evidence record

#### Scenario: Trace claim to source
- **WHEN** a user selects a claim in a report artifact
- **THEN** the system shows the supporting sources, excerpts, citation status, confidence, and conflicts for that claim

### Requirement: Artifact versioning
The system SHALL store generated artifacts as versioned outputs linked to runs, steps, evidence, and source inputs.

#### Scenario: Approve or reject artifact
- **WHEN** a user approves or rejects an artifact version
- **THEN** the system records the decision, reviewer, timestamp, and linked evidence state without deleting prior versions

#### Scenario: Regenerate artifact
- **WHEN** a user regenerates a report from a step output
- **THEN** the system creates a new artifact version without deleting the previous version

### Requirement: MVP artifact formats
The system SHALL support Markdown report artifacts and JSON evidence bundle artifacts for the Deep Research MVP.

#### Scenario: Export Deep Research outputs
- **WHEN** Deep Research completes successfully
- **THEN** the system creates a Markdown report and JSON evidence bundle linked to the run

## ADDED Requirements

### Requirement: Proxy request metrics
The system SHALL emit metrics for every proxy request including duration, tokens, cost, fallback count, and streaming chunks.

#### Scenario: Record proxy request metrics
- **WHEN** a proxy request completes (success or error)
- **THEN** the system records: `proxy_request_duration_ms`, `proxy_tokens_input`, `proxy_tokens_output`, `proxy_cost_usd`, `proxy_fallback_count`, `proxy_stream_chunks` (0 for non-streaming), `proxy_status` (success/error), `proxy_model_id`, `proxy_provider_id`

#### Scenario: Aggregate proxy metrics by client
- **WHEN** viewing proxy observability dashboard
- **THEN** the system shows metrics aggregated by API client ID, model, and provider

### Requirement: Proxy request tracing
The system SHALL create trace spans for proxy requests with full context for debugging and auditing.

#### Scenario: Create proxy request span
- **WHEN** a proxy request is received
- **THEN** a span is created with: `type: "proxy_request"`, `name: "chat_completion" | "model_list"`, `clientId`, `modelId`, `providerId` (selected), `fallbackProviders` (attempted), `streaming`, `inputTokens`, `outputTokens`, `costUsd`, `durationMs`, `status`

#### Scenario: Link fallback attempts in trace
- **WHEN** a proxy request falls back to another provider
- **THEN** the span records each attempt with `attempt.providerId`, `attempt.status`, `attempt.error`, `attempt.durationMs`