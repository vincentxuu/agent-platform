## ADDED Requirements

### Requirement: Configurable run policies
The system SHALL support policies for budget, provider allow/deny lists, quality requirements, security permissions, retry behavior, and human approval gates.

#### Scenario: Apply preset policy
- **WHEN** a user selects a flow preset before starting a run
- **THEN** the system applies the preset policy to all eligible runtime decisions for that run

### Requirement: Runtime guard pipeline
The system SHALL enforce input, tool, output, and budget guards during step execution.

#### Scenario: Block unauthorized tool invocation
- **WHEN** a step attempts to invoke a tool outside its flow, skill, or policy permissions
- **THEN** the runtime blocks the invocation and records a GuardResult

#### Scenario: Enforce budget limit
- **WHEN** a run would exceed its max cost, token, runtime, or iteration limit
- **THEN** the runtime stops or pauses the run according to policy and records the budget guard outcome

### Requirement: Human approval controls
The system SHALL require explicit approval before policy-marked high-risk actions such as external writes.

#### Scenario: External write requires approval
- **WHEN** a step attempts a GitHub, Slack, Notion, email, or other external write action requiring approval
- **THEN** the system creates an approval request and does not perform the action until approved

### Requirement: Loop and drift protection
The system SHALL detect repeated tool calls, repeated similar outputs, no-progress loops, and intent or policy drift.

#### Scenario: Repeated tool calls detected
- **WHEN** a step repeatedly invokes equivalent tools without producing new useful output
- **THEN** the runtime records a loop signal and applies the configured stop, retry, fallback, or escalation behavior

### Requirement: Escalation records
The system SHALL record escalations to stronger models, better context, alternative strategy, or human review with cause and outcome.

#### Scenario: Escalate after verifier failure
- **WHEN** a verifier fails due to insufficient evidence coverage
- **THEN** the runtime records the escalation reason and executes the configured recovery path
