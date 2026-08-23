## MODIFIED Requirements

### Requirement: Configurable run policies
The system SHALL support policies for budget, provider allow/deny lists, quality requirements, security permissions, retry behavior, and human approval gates.

#### Scenario: Configure policy version
- **WHEN** an operator creates or updates a policy draft and publishes it
- **THEN** the system stores a versioned policy that can be bound to a flow or preset and referenced by future runs

#### Scenario: Apply preset policy
- **WHEN** a user selects a flow preset before starting a run
- **THEN** the system applies the preset policy to all eligible runtime decisions for that run

#### Scenario: Configure proxy policy
- **WHEN** an operator creates or updates a policy with `proxy` section containing `maxTokensPerRequest`, `maxCostUsdPerRequest`, `maxCostUsdPerDay`, `allowedModels`, `deniedModels`
- **THEN** the system stores a versioned policy that can be bound to API clients for proxy request enforcement

### Requirement: Runtime guard pipeline
The system SHALL enforce input, tool, output, and budget guards during step execution.

#### Scenario: Block unauthorized tool invocation
- **WHEN** a step attempts to invoke a tool outside its flow, skill, or policy permissions
- **THEN** the runtime blocks the invocation and records a GuardResult

#### Scenario: Enforce budget limit
- **WHEN** a run would exceed its max cost, token, runtime, or iteration limit
- **THEN** the runtime stops or pauses the run according to policy and records the budget guard outcome

#### Scenario: Enforce proxy budget guard
- **WHEN** a proxy request would exceed client's `proxy.maxTokensPerRequest`, `proxy.maxCostUsdPerRequest`, or `proxy.maxCostUsdPerDay`
- **THEN** the runtime rejects the request with 429 and records the budget guard outcome with `guardType: "proxy_budget"`

#### Scenario: Enforce proxy rate limit
- **WHEN** a proxy request would exceed client's `requestsPerMin` rate limit
- **THEN** the runtime rejects the request with 429 and `Retry-After` header and records the rate limit guard outcome with `guardType: "proxy_rate_limit"`

#### Scenario: Enforce proxy model allow/deny list
- **WHEN** a proxy request specifies a model not in policy `allowedModels` (if configured) or in `deniedModels`
- **THEN** the runtime rejects the request with 403 and records the guard outcome with `guardType: "proxy_model_policy"`

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

## ADDED Requirements

### Requirement: Proxy-specific budget tracking
The system SHALL track proxy request costs and tokens separately from flow run budgets, attributed to the API client.

#### Scenario: Accumulate proxy usage
- **WHEN** a proxy request completes successfully
- **THEN** the system increments the client's proxy usage counters for tokens (input/output), cost (USD), and request count

#### Scenario: Proxy daily budget enforcement
- **WHEN** a client's accumulated proxy cost for the current day exceeds `proxy.maxCostUsdPerDay`
- **THEN** subsequent proxy requests are rejected with 429 until the daily window resets