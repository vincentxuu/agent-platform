## ADDED Requirements

### Requirement: Workflow-centered run experience
The Web UI SHALL let users select a flow, enter inputs, select a preset, review policy/provider summary, start a run, and watch streaming progress.

#### Scenario: Start Deep Research from UI
- **WHEN** a user selects Deep Research, enters a topic, chooses a preset, and starts the run
- **THEN** the UI creates a run and displays its timeline progress

### Requirement: Run inspection views
The Web UI SHALL provide run timeline, step detail, provider/tool usage, context snapshot, checkpoint, error, cost, latency, token, retry, and re-run controls.

#### Scenario: Inspect failed step
- **WHEN** a run step fails
- **THEN** the UI shows the error, related provider/tool calls, guard results, checkpoint state, and retry-step action

### Requirement: Evidence and artifact viewers
The Web UI SHALL let users inspect evidence, claims, citations, confidence, conflicts, artifacts, artifact versions, and export outputs.

#### Scenario: Review report evidence
- **WHEN** a user opens a Markdown report artifact
- **THEN** the UI allows the user to inspect supporting evidence for claims in the report

### Requirement: Platform management surfaces
The Web UI SHALL provide management views for flows, skills, providers, policies, context, memory, evaluations, observability, evidence, and artifacts.

#### Scenario: Manage provider configuration
- **WHEN** an operator opens the Providers view
- **THEN** the UI shows provider type, credential status, health, latency, cost, fallback configuration, and enabled state

### Requirement: Local-first operating model
The Web UI SHALL make local-first runtime state visible, including local provider credential status, local run history, local evidence, and local artifacts.

#### Scenario: View local artifact state
- **WHEN** a user opens the Artifacts view
- **THEN** the UI lists artifacts stored locally with run links, version history, and export actions
