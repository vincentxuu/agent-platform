## Purpose
Define trace, metrics, evidence, artifact versioning, and export behavior for auditable Agent Gateway outputs.

## Requirements

### Requirement: Structured run trace
The system SHALL record a structured trace hierarchy linking FlowRun, StepRun, SkillInvocation, ProviderCall, ToolInvocation, GuardResult, VerifierResult, EvidenceItem, and ArtifactVersion records.

#### Scenario: Inspect run timeline
- **WHEN** a user opens a run timeline
- **THEN** the system shows ordered steps with linked skill, provider, tool, guard, evidence, and artifact records

### Requirement: Runtime metrics
The system SHALL derive cost, latency, token, retry, fallback, tool usage, provider health, skill health, and quality metrics from structured runtime records.

#### Scenario: Review cost breakdown
- **WHEN** a user views run observability
- **THEN** the system shows total cost and cost by step, provider, skill, and tool

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
