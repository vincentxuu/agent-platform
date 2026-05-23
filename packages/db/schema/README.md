# Agent Gateway Database Schema

This directory contains the initial SQLite schema contract for the Agent Gateway MVP.

The schema is intentionally split by OpenSpec task area:

- `0001_flow_runtime.sql`
- `0002_skill_packages.sql`
- `0003_provider_tool_routing.sql`
- `0004_policy_runtime_controls.sql`
- `0005_context_memory_management.sql`
- `0006_observability_evidence_artifacts_evals.sql`

These migrations define the persistence surface before an ORM or migration runner has been selected. Future implementation can wrap these tables with a repository layer without changing the OpenSpec data contract.
