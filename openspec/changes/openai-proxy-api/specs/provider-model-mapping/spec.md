## ADDED Requirements

### Requirement: Model mapping configuration
The system SHALL load model mapping configuration from `packages/runtime/src/proxy-model-mapping.json` mapping OpenAI model IDs to provider entries with fallback priority.

#### Scenario: Load model mapping config
- **WHEN** the proxy initializes
- **THEN** the system loads and parses `proxy-model-mapping.json` into an in-memory mapping structure

#### Scenario: Config validation
- **WHEN** config is loaded
- **THEN** the system validates each mapping has `openaiModelId`, `providerId`, `providerModelId`, `fallbackPriority` (positive integer), and that `providerId` exists in provider catalog

#### Scenario: Invalid config rejected
- **WHEN** config has duplicate `openaiModelId` with same `fallbackPriority`, missing required fields, or unknown `providerId`
- **THEN** the system logs error and refuses to start proxy endpoints

### Requirement: Model routing with fallback chains
The system SHALL route chat completion requests to providers based on model mapping config, attempting fallbacks in priority order on failure.

#### Scenario: Primary provider selected
- **WHEN** a request specifies `model: "gpt-4o"` mapped to provider `openai` priority 1
- **THEN** the system routes to OpenAI provider with model `gpt-4o`

#### Scenario: Fallback on provider error
- **WHEN** primary provider returns 5xx, timeout, or authentication error
- **THEN** the system tries next priority provider for same `openaiModelId`

#### Scenario: Fallback on budget/rate limit
- **WHEN** primary provider returns 429 or budget guard triggers
- **THEN** the system tries next priority provider

#### Scenario: All fallbacks exhausted
- **WHEN** all mapped providers for a model fail
- **THEN** the system returns 502 with OpenAI-format error `{ error: { message: "All providers unavailable", type: "server_error", code: "providers_exhausted" } }` and records fallback attempts in observability

#### Scenario: Max fallback limit
- **WHEN** more than 3 fallback attempts would be made
- **THEN** the system stops at 3 and returns error to prevent fallback loops

### Requirement: Model list aggregation
The system SHALL aggregate model list from mapping config and provider catalog for `GET /v1/models`.

#### Scenario: Model list includes mapped models
- **WHEN** `GET /v1/models` is called
- **THEN** response includes all unique `openaiModelId` from mapping config with `owned_by` set to provider name

#### Scenario: Model list reflects provider readiness
- **WHEN** a mapped provider is disabled or unready
- **THEN** its models are excluded from list or marked with `permission: "denied"` (OpenAI extension)