// @ts-nocheck
export const deepResearchFlow = {
  id: "deep_research",
  name: "Deep Research",
  version: 1,
  description: "Evidence-backed research workflow that produces a Markdown report and JSON evidence bundle.",
  inputs: [
    { id: "topic", type: "string", required: true },
    { id: "audience", type: "string", required: false },
    { id: "freshness_days", type: "number", required: false, default: 365 }
  ],
  presets: [
    {
      id: "quick",
      name: "Quick",
      policy: {
        max_cost_usd: 1,
        max_iterations: 2,
        min_sources_per_subquestion: 1,
        citation_required: true
      }
    },
    {
      id: "standard",
      name: "Standard",
      policy: {
        max_cost_usd: 3,
        max_iterations: 4,
        min_sources_per_subquestion: 3,
        citation_required: true,
        conflict_check: true
      }
    },
    {
      id: "deep",
      name: "Deep",
      policy: {
        max_cost_usd: 8,
        max_iterations: 6,
        min_sources_per_subquestion: 5,
        citation_required: true,
        conflict_check: true,
        stale_source_check: true
      }
    }
  ],
  steps: [
    { id: "clarify", type: "agent", skill: "research-planner@1.0.0" },
    { id: "build_brief", type: "transform" },
    { id: "plan", type: "agent", skill: "research-planner@1.0.0" },
    { id: "search", type: "tool_group", providerRole: "search" },
    { id: "rank_sources", type: "agent", skill: "source-ranker@1.0.0" },
    { id: "read_sources", type: "tool_group", providerRole: "reader" },
    { id: "extract_evidence", type: "agent", skill: "citation-extractor@1.0.0" },
    { id: "synthesize", type: "agent", skill: "report-synthesizer@1.0.0" },
    { id: "verify", type: "verifier" },
    { id: "export", type: "artifact" }
  ],
  edges: [
    { from: "clarify", to: "build_brief" },
    { from: "build_brief", to: "plan" },
    { from: "plan", to: "search" },
    { from: "search", to: "rank_sources" },
    { from: "rank_sources", to: "read_sources" },
    { from: "read_sources", to: "extract_evidence" },
    { from: "extract_evidence", to: "synthesize" },
    { from: "synthesize", to: "verify" },
    { from: "verify", to: "search", condition: "coverage_insufficient" },
    { from: "verify", to: "export", condition: "passed" }
  ],
  artifacts: [
    { id: "markdown_report", type: "markdown_report" },
    { id: "evidence_bundle", type: "json_evidence_bundle" }
  ]
};
