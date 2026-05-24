## ADDED Requirements

### Requirement: Workflow-centered run experience
The Web UI SHALL let users select a flow, enter inputs, select a preset, review policy/provider summary, start a run, and watch streaming progress.

#### Scenario: Define and publish flow from UI
- **WHEN** a user creates or clones a flow, edits its inputs, steps, bindings, policies, presets, and artifact schema, then selects publish
- **THEN** the UI sends the define command, displays validation errors if present, and shows the published flow version when successful

#### Scenario: Start Deep Research from UI
- **WHEN** a user selects Deep Research, enters a topic, chooses a preset, and starts the run
- **THEN** the UI creates a run and displays its timeline progress

### Requirement: Run inspection views
The Web UI SHALL provide run timeline, step detail, provider/tool usage, context snapshot, checkpoint, error, cost, latency, token, retry, and re-run controls.

#### Scenario: Control interrupted run
- **WHEN** a run is active, paused, or failed
- **THEN** the UI exposes the valid cancel, resume, retry-step, or approval actions and shows the resulting state change

#### Scenario: Inspect failed step
- **WHEN** a run step fails
- **THEN** the UI shows the error, related provider/tool calls, guard results, checkpoint state, and retry-step action

### Requirement: Evidence and artifact viewers
The Web UI SHALL let users inspect evidence, claims, citations, confidence, conflicts, artifacts, artifact versions, and export outputs.

#### Scenario: Verify evidence and artifact
- **WHEN** a user reviews evidence or an artifact version
- **THEN** the UI allows approve, reject, annotate, regenerate, or export actions according to the artifact and evidence state

#### Scenario: Review report evidence
- **WHEN** a user opens a Markdown report artifact
- **THEN** the UI allows the user to inspect supporting evidence for claims in the report

### Requirement: Platform command surfaces
The Web UI SHALL provide command surfaces for defining flows, configuring skills/providers/policies, reviewing context/memory/evaluations/observability/evidence/artifacts, and creating improvement proposals.

#### Scenario: Configure provider
- **WHEN** an operator creates, updates, tests, disables, or re-enables a provider
- **THEN** the UI persists the command, displays readiness or validation results, and updates flow validation/runtime availability

#### Scenario: Manage provider configuration
- **WHEN** an operator opens the Providers view
- **THEN** the UI shows provider type, credential status, health, latency, cost, fallback configuration, and enabled state

#### Scenario: Create improvement proposal
- **WHEN** a user converts feedback, a failed run, or an eval result into an improvement proposal
- **THEN** the UI records a reviewable eval case, skill proposal, policy suggestion, or memory proposal without changing production behavior automatically

### Requirement: Local-first operating model
The Web UI SHALL make local-first runtime state visible, including local provider credential status, local run history, local evidence, and local artifacts.

#### Scenario: View local artifact state
- **WHEN** a user opens the Artifacts view
- **THEN** the UI lists artifacts stored locally with run links, version history, and export actions
