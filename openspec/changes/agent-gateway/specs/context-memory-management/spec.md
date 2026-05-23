## ADDED Requirements

### Requirement: Context snapshots
The system SHALL assemble and persist a ContextSnapshot for each model call using typed ContextBlocks.

#### Scenario: Assemble step context
- **WHEN** a model-backed step starts
- **THEN** the system records the selected instructions, skill guidance, tool descriptions, task state, history, memory, evidence, artifacts, and dynamic run data used for that call

### Requirement: Context budget allocation
The system SHALL allocate context budget across block categories and compress or reference oversized content.

#### Scenario: Compress oversized evidence
- **WHEN** selected evidence exceeds the retrieval or evidence budget for a model call
- **THEN** the system compresses the evidence or stores references and records the compression decision

### Requirement: Dynamic tool and context selection
The system SHALL select only context blocks and tool descriptions relevant to the current step, skill, and policy.

#### Scenario: Select step-local tool descriptions
- **WHEN** a step can use only search tools
- **THEN** the ContextSnapshot includes only the allowed search tool descriptions and excludes unrelated action tools

### Requirement: Scoped memory model
The system SHALL support procedural, episodic, and semantic memory records scoped by organization, user, project, flow, skill, session, or source run.

#### Scenario: Capture episodic run summary
- **WHEN** a run completes
- **THEN** the system stores a scoped episodic summary with source run reference and retrieval metadata

### Requirement: Reviewable memory writes
The system SHALL create reviewable proposals for long-lived procedural or semantic memory updates.

#### Scenario: Propose procedural memory update
- **WHEN** a learning signal suggests a reusable workflow rule
- **THEN** the system creates a MemoryWriteProposal instead of directly changing production memory
