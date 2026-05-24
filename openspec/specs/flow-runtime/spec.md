## Purpose
Define versioned flow definitions, run lifecycle behavior, checkpoints, controls, and the Deep Research MVP flow.

## Requirements

### Requirement: Versioned flow definitions
The system SHALL define flows as versioned templates containing input schema, presets, steps, edges, allowed capabilities, and artifact schemas.

#### Scenario: Define a runnable flow version
- **WHEN** a user creates or clones a flow draft, edits required inputs, presets, steps, edges, provider bindings, policy references, skill bindings, and artifact schemas, then publishes it
- **THEN** the system validates the draft and stores an immutable flow version that can be selected for new runs

#### Scenario: Reject invalid flow publication
- **WHEN** a user tries to publish a flow draft with missing inputs, broken edges, unresolved skill bindings, unavailable providers, invalid policy references, or invalid artifact schemas
- **THEN** the system rejects publication and reports the validation errors without creating a runnable version

#### Scenario: Preserve run reproducibility
- **WHEN** a run starts from a flow version and preset
- **THEN** the run SHALL reference that exact flow version and preset for later audit and replay

### Requirement: Step-based run lifecycle
The system SHALL execute each flow run as ordered step runs whose state transitions are persisted.

#### Scenario: Start a flow run
- **WHEN** a user submits valid flow inputs and selects a preset
- **THEN** the system creates a FlowRun, creates the first StepRun, and records the run as active

#### Scenario: Complete a step
- **WHEN** a step finishes successfully
- **THEN** the system records the step output, emits a run event, and schedules the next eligible step

### Requirement: Checkpoint, resume, and retry-step controls
The system SHALL persist checkpoints and allow interrupted runs to resume or retry an individual failed step.

#### Scenario: Save a checkpoint
- **WHEN** a step reaches a boundary after execution or failure
- **THEN** the system stores completed steps, current step, remaining steps, key outputs, artifact references, evidence references, token usage, cost, and approval state

#### Scenario: Resume latest checkpoint
- **WHEN** a user resumes an interrupted run
- **THEN** the system restores the latest checkpoint and continues from the next valid step without discarding prior trace history

### Requirement: Deep Research MVP flow
The system SHALL include a Deep Research flow that produces a Markdown report and JSON evidence bundle from a user topic.

#### Scenario: Complete Deep Research
- **WHEN** a user runs Deep Research with a valid topic and preset
- **THEN** the system plans research, gathers sources, extracts evidence, synthesizes findings, verifies coverage, and exports the configured artifacts
