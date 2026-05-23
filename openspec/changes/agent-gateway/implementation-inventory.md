## Repository Inventory

Task: `1.1 Inventory the existing repository architecture, framework, storage conventions, and API patterns to choose the implementation locations for Agent Gateway.`

### Current Repository Shape

- `README.md`: Product overview and MVP positioning.
- `agent-gateway-plan.md`: Detailed product and architecture planning document.
- `openspec/config.yaml`: OpenSpec configuration using the `spec-driven` schema.
- `openspec/changes/agent-gateway/`: Proposal, design, specs, and implementation checklist for this change.
- `openspec/specs/`: Empty at the time of inventory.
- `.codex/skills/` and `.claude/skills/`: Local OpenSpec workflow skills and command metadata.

No application source tree, package manifest, database migrations, API routes, frontend implementation, runtime modules, or test harness currently exist in the repository.

### Existing Framework And Storage Conventions

No framework or storage conventions are established yet. There is no `package.json`, no TypeScript configuration, no migration framework, no ORM, and no existing API or UI framework to extend.

### Implementation Location Decision

Because the repository is currently documentation-first, Agent Gateway implementation should start by introducing a new local-first app structure rather than modifying an existing application. The recommended initial layout is:

```text
apps/web/                  Web UI and local API routes
packages/core/             Shared domain types, validators, and runtime contracts
packages/db/               SQLite schema, migrations, and repository layer
packages/runtime/          Flow runtime, queue, guards, context, providers, skills
packages/evals/            Eval runner and quality gate utilities
skills/                    Built-in local skill packages
fixtures/                  Deep Research fixtures and test data
```

This layout keeps the MVP modular while preserving the design requirement that the first deployment can run as a local-first monolith.

### Immediate Implication For Remaining Tasks

Tasks `1.2` through `1.7` should first establish the database and shared type foundation in the new implementation structure. Runtime, provider, skill, policy, context, observability, eval, and UI tasks can then build on those shared schemas instead of inventing parallel data contracts.
