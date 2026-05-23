## ADDED Requirements

### Requirement: Provider registry
The system SHALL maintain provider records for LLM, search, reader, knowledge, action, and verifier providers with capability metadata, credential references, health, latency, cost, and quota status.

#### Scenario: Select a provider for a step
- **WHEN** a step requests a provider role such as planner, search, reader, synthesizer, or verifier
- **THEN** the system selects an allowed provider that matches the step, preset, policy, and current provider health

### Requirement: MCP server and tool discovery
The system SHALL discover MCP servers, tools, resources, and prompts and store their schemas, descriptions, and permission scopes.

#### Scenario: Discover MCP tools
- **WHEN** an operator registers an MCP server
- **THEN** the system lists available tools and stores model-friendly metadata for runtime tool selection

### Requirement: Step-local tool selection
The system SHALL expose only the tool subset allowed by the flow, skill, and policy for the current step.

#### Scenario: Restrict tools for a skill step
- **WHEN** a citation-extractor skill step allows reader and evidence tools only
- **THEN** the runtime makes only those permitted tools available to the model call

### Requirement: Provider and tool fallback
The system SHALL support fallback chains for provider or tool failures and record the reason for each fallback.

#### Scenario: Search provider fails
- **WHEN** the primary search provider returns an error or exceeds policy limits
- **THEN** the runtime tries the next allowed fallback and records the failed provider, fallback provider, and outcome

### Requirement: Invocation logging
The system SHALL record provider calls and tool invocations with inputs, outputs, status, duration, cost, token usage, retries, errors, and linked run/step IDs.

#### Scenario: Inspect provider cost
- **WHEN** a user reviews a completed run
- **THEN** the system shows provider and tool usage grouped by run and step with cost and latency details
