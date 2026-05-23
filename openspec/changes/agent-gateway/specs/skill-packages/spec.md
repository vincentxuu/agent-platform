## ADDED Requirements

### Requirement: Versioned skill package structure
The system SHALL load skills from versioned packages containing `skill.yaml`, `SKILL.md`, and optional references, scripts, assets, and evals.

#### Scenario: Load a valid skill package
- **WHEN** a skill package includes valid metadata, instructions, permissions, and version information
- **THEN** the system registers a SkillVersion and makes it available for eligible flow steps

#### Scenario: Reject invalid skill package
- **WHEN** a skill package is missing required metadata or instruction files
- **THEN** the system rejects the package and records a validation error

### Requirement: Explicit skill bindings
The system SHALL support explicit flow-step bindings to a skill version and SHALL NOT rely solely on model-chosen skill routing for production flows.

#### Scenario: Execute a bound skill
- **WHEN** a flow step declares `uses: <skill>@<version>`
- **THEN** the runtime loads that skill version and applies its instructions, schemas, permissions, and assets to the step execution

### Requirement: Skill invocation tracking
The system SHALL record each skill invocation with input references, output references, permission decisions, tool usage, status, duration, and errors.

#### Scenario: Inspect skill usage
- **WHEN** a user opens a step detail view for a run
- **THEN** the system shows which skill version ran, which tools it was allowed to use, and whether invocation succeeded or failed

### Requirement: Built-in Deep Research skills
The system SHALL include built-in research-planner, source-ranker, citation-extractor, and report-synthesizer skills for the Deep Research MVP.

#### Scenario: Run built-in research skills
- **WHEN** the Deep Research flow reaches a planning, ranking, evidence extraction, or synthesis step
- **THEN** the runtime invokes the corresponding built-in skill package version
