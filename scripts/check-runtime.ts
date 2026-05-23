// @ts-nocheck
import { deepResearchFlow } from "../packages/core/src/deep-research-flow.js";
import { assertValidFlowDefinition } from "../packages/core/src/flow.js";
import { InMemoryFlowRuntime } from "../packages/runtime/src/flow-runtime.js";
import {
  ProviderRegistry,
  createMvpMcpTools,
  createMvpProviderAdapters
} from "../packages/runtime/src/provider-tool-routing.js";
import {
  PolicyRuntimeControls,
  createStandardResearchPolicy
} from "../packages/runtime/src/policy-runtime-controls.js";
import { ContextMemoryManager } from "../packages/runtime/src/context-memory.js";
import { ObservabilityEvidenceArtifacts } from "../packages/runtime/src/observability-evidence-artifacts.js";
import { SkillRegistry } from "../packages/runtime/src/skill-packages.js";
import {
  EvaluationLearningLoop,
  basicEvaluator,
  createMvpEvalSuites
} from "../packages/evals/src/evaluation-learning.js";
import { CloudflareNativeKnowledgeProvider } from "../packages/knowledge/src/cloudflare-native.js";
import { LlamaIndexKnowledgeProvider } from "../packages/knowledge/src/llamaindex-adapter.js";

assertValidFlowDefinition(deepResearchFlow);

let counter = 0;
const runtime = new InMemoryFlowRuntime({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});

const run = runtime.createRun({
  flow: deepResearchFlow,
  presetId: "standard",
  inputs: {
    topic: "agent workflow orchestration",
    audience: "engineering leaders",
    freshness_days: 365
  }
});

const firstStep = [...runtime.stepRuns.values()].find((stepRun) => stepRun.runId === run.id && stepRun.stepId === "clarify");
if (!firstStep) {
  throw new Error("Expected initial clarify step run");
}

runtime.startStep(firstStep.id);
const result = runtime.completeStep({ flow: deepResearchFlow, stepRunId: firstStep.id, output: { brief_created: true } });

if (!result.nextStepIds.includes("build_brief")) {
  throw new Error("Expected clarify step to schedule build_brief");
}

if (!runtime.checkpoints.get(run.id)) {
  throw new Error("Expected checkpoint after step completion");
}

const providerRegistry = new ProviderRegistry({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});

for (const provider of createMvpProviderAdapters()) {
  providerRegistry.registerProvider(provider);
}

const searchProvider = providerRegistry.selectProvider({ type: "search", role: "search" });
if (!searchProvider) {
  throw new Error("Expected MVP search provider");
}

const server = providerRegistry.registerMcpServer({ name: "mvp-tools", transport: "local" });
providerRegistry.discoverMcpTools(server.id, createMvpMcpTools());
const tools = providerRegistry.selectStepTools({
  flowAllowedTools: ["search.web", "reader.read_url"],
  skillAllowedTools: ["search:read"],
  policyAllowedTools: ["search.web"]
});

if (tools.length !== 1 || tools[0].name !== "search.web") {
  throw new Error("Expected step-local search tool selection");
}

providerRegistry.recordProviderCall({
  runId: run.id,
  stepRunId: firstStep.id,
  providerId: searchProvider.id,
  role: "search",
  status: "succeeded"
});

providerRegistry.recordToolInvocation({
  runId: run.id,
  stepRunId: firstStep.id,
  mcpToolId: tools[0].id,
  toolName: tools[0].name,
  status: "succeeded"
});

if (providerRegistry.providerCalls.length !== 1 || providerRegistry.toolInvocations.length !== 1) {
  throw new Error("Expected provider call and tool invocation logs");
}

const skillRegistry = new SkillRegistry({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const skills = skillRegistry.discoverSkills("skills");
if (skills.length !== 4) {
  throw new Error(`Expected 4 built-in skills, found ${skills.length}`);
}

const invocationContext = skillRegistry.createInvocationContext({
  binding: "research-planner@1.0.0",
  inputRef: "input://run_1/topic"
});

if (!invocationContext.instructions.includes("research plan")) {
  throw new Error("Expected research-planner instructions");
}

skillRegistry.recordInvocation({
  runId: run.id,
  stepRunId: firstStep.id,
  skillVersionId: invocationContext.skillVersionId,
  status: "succeeded",
  inputRef: invocationContext.inputRef,
  outputRef: "output://step_1"
});

if (skillRegistry.invocations.length !== 1) {
  throw new Error("Expected skill invocation log");
}

const policyControls = new PolicyRuntimeControls({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const policy = policyControls.registerPolicy(createStandardResearchPolicy());

const inputGuardResults = policyControls.runInputGuards({
  policyId: policy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  inputs: run.inputs
});
if (inputGuardResults.some((result) => result.status === "blocked")) {
  throw new Error("Expected input guards to pass");
}

const toolGuardResult = policyControls.runToolGuard({
  policyId: policy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  tool: tools[0],
  input: { query: "agent workflow orchestration" }
});
if (toolGuardResult.status !== "passed") {
  throw new Error("Expected allowed tool guard to pass");
}

const blockedToolResult = policyControls.runToolGuard({
  policyId: policy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  tool: { name: "github.create_issue", permissionScope: "github:write", inputSchema: { required: ["title"] } },
  input: { title: "Draft issue" }
});
if (blockedToolResult.status !== "blocked") {
  throw new Error("Expected unauthorized tool guard to block");
}

const outputGuardResults = policyControls.runOutputGuards({
  policyId: policy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  output: { claims: [{ id: "claim_1", citations: ["evidence_1"] }] },
  outputSchema: { required: ["claims"] },
  artifact: { type: "markdown_report", content: "# Report\n\nEvidence-backed report." }
});
if (outputGuardResults.some((result) => result.status === "blocked")) {
  throw new Error("Expected output guards to pass");
}

const budgetGuardResult = policyControls.runBudgetGuard({
  policyId: policy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  usage: { costUsd: 1, tokens: 1000, runtimeMs: 100, iterations: 1, toolCalls: 1, parallelUnits: 1 }
});
if (budgetGuardResult.status !== "passed") {
  throw new Error("Expected budget guard to pass");
}

const loopSignal = policyControls.detectLoop({
  runId: run.id,
  stepRunId: firstStep.id,
  recentToolCalls: ["search.web", "search.web"]
});
if (!loopSignal || loopSignal.signalType !== "repeated_tool_call") {
  throw new Error("Expected repeated tool call loop signal");
}

const externalWritePolicy = policyControls.registerPolicy({
  ...createStandardResearchPolicy(),
  id: "external_write_test",
  name: "External Write Test",
  security: {
    ...createStandardResearchPolicy().security,
    allowedTools: ["github.create_issue", "github:write"],
    externalWriteTools: ["github.create_issue"]
  }
});
const approvalGuardResult = policyControls.runToolGuard({
  policyId: externalWritePolicy.id,
  runId: run.id,
  stepRunId: firstStep.id,
  tool: { name: "github.create_issue", permissionScope: "github:write", inputSchema: { required: ["title"] } },
  input: { title: "Draft issue" }
});
if (approvalGuardResult.status !== "paused" || policyControls.approvalRequests.length !== 1) {
  throw new Error("Expected external write approval request");
}

policyControls.recordEscalation({
  runId: run.id,
  stepRunId: firstStep.id,
  reason: "verifier_failed_insufficient_evidence",
  action: "retry_with_better_context",
  outcome: "scheduled",
  originalContextRef: "context://snapshot_1"
});
if (policyControls.escalationRecords.length !== 1) {
  throw new Error("Expected escalation record");
}

const contextMemory = new ContextMemoryManager({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const contextBlocks = [
  contextMemory.createBlock({ type: "instructions", sourceRef: "system", content: "Run Deep Research with citations.", priority: 100 }),
  contextMemory.createBlock({ type: "skill_guidance", sourceRef: invocationContext.skillVersionId, content: invocationContext.instructions, priority: 90 }),
  contextMemory.createBlock({ type: "task_state", sourceRef: firstStep.id, content: { currentStep: firstStep.stepId }, priority: 80 }),
  contextMemory.createBlock({ type: "retrieval_evidence", sourceRef: "evidence://oversized", content: "evidence ".repeat(5000), priority: 70 })
];
const snapshot = contextMemory.assembleSnapshot({
  runId: run.id,
  stepRunId: firstStep.id,
  blocks: contextBlocks,
  totalBudgetTokens: 1200,
  responseBudgetTokens: 200,
  selectedTools: tools
});
if (!snapshot.blocks.some((block) => block.type === "tool_descriptions")) {
  throw new Error("Expected dynamic tool descriptions in context snapshot");
}
if (snapshot.compressions.length === 0) {
  throw new Error("Expected compression record for oversized evidence");
}

const episodicMemory = contextMemory.captureEpisodicRunSummary({
  run,
  summary: "Deep Research run planned an agent workflow orchestration brief."
});
if (episodicMemory.type !== "episodic" || episodicMemory.sourceRunId !== run.id) {
  throw new Error("Expected scoped episodic run summary");
}

const memoryProposal = contextMemory.proposeMemoryWrite({
  memoryType: "procedural",
  proposedContent: "Deep Research should preserve citation IDs through synthesis.",
  scopes: [{ type: "flow", ref: run.flowId }],
  sourceRunId: run.id,
  rationale: "Citation IDs are needed for artifact evidence inspection."
});
if (memoryProposal.status !== "pending") {
  throw new Error("Expected pending memory write proposal");
}

const observability = new ObservabilityEvidenceArtifacts({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const span = observability.startSpan({ runId: run.id, stepRunId: firstStep.id, type: "step", name: "clarify" });
observability.recordEvent({ runId: run.id, traceSpanId: span.id, type: "step.started" });
observability.finishSpan(span.id, { outputRef: "output://clarify" });
observability.deriveMetrics({
  runId: run.id,
  providerCalls: providerRegistry.providerCalls,
  toolInvocations: providerRegistry.toolInvocations,
  skillInvocations: skillRegistry.invocations,
  guardResults: policyControls.guardResults
});
if (observability.metricPoints.length === 0) {
  throw new Error("Expected derived metrics");
}

const source = observability.addSource({
  url: "https://example.com/agent-workflows",
  title: "Agent workflow orchestration",
  provider: "mvp-search"
});
const evidence = observability.addEvidence({
  runId: run.id,
  stepRunId: firstStep.id,
  sourceId: source.id,
  excerpt: "Workflow orchestration improves traceability.",
  confidence: "high",
  supportsStep: "synthesize"
});
const claim = observability.addClaim({
  runId: run.id,
  text: "Workflow orchestration improves traceability.",
  confidence: "high"
});
observability.linkClaimToEvidence({
  claimId: claim.id,
  evidenceItemId: evidence.id,
  citationText: source.url
});
if (claim.status !== "supported") {
  throw new Error("Expected claim to be supported by evidence");
}

const reportArtifact = observability.createArtifact({ runId: run.id, type: "markdown_report", name: "Deep Research Report" });
const reportContent = observability.createMarkdownReport({ title: "Deep Research Report", claims: [claim] });
const reportVersion = observability.addArtifactVersion({
  artifactId: reportArtifact.id,
  content: reportContent,
  sourceStepRunId: firstStep.id,
  evidenceRefs: [evidence.id]
});
observability.addArtifactVersion({
  artifactId: reportArtifact.id,
  content: `${reportContent}\nUpdated.`,
  sourceStepRunId: firstStep.id,
  evidenceRefs: [evidence.id]
});
if (reportVersion.version !== 1 || observability.artifactVersions.at(-1).version !== 2) {
  throw new Error("Expected artifact versioning");
}

const bundleArtifact = observability.createArtifact({ runId: run.id, type: "json_evidence_bundle", name: "Evidence Bundle" });
const bundle = observability.createEvidenceBundle({ runId: run.id });
observability.addArtifactVersion({
  artifactId: bundleArtifact.id,
  content: JSON.stringify(bundle, null, 2),
  sourceStepRunId: firstStep.id,
  evidenceRefs: [evidence.id]
});
if (!bundle.claims.length || !bundle.evidence.length) {
  throw new Error("Expected JSON evidence bundle content");
}

const evalLoop = new EvaluationLearningLoop({
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const evalSuites = createMvpEvalSuites(evalLoop);
evalLoop.evalCases.find((testCase) => testCase.evalSuiteId === evalSuites.skill.id).input = { summary: "ok" };
const skillEvalRun = evalLoop.runEvalSuite({
  evalSuiteId: evalSuites.skill.id,
  targetRef: "research-planner@1.0.0",
  evaluator: basicEvaluator
});
const gate = evalLoop.createQualityGate({
  targetType: "skill",
  targetRef: "research-planner@1.0.0",
  evalSuiteId: evalSuites.skill.id
});
evalLoop.evaluateQualityGate(gate.id, skillEvalRun.id);
if (!evalLoop.canPromote("research-planner@1.0.0")) {
  throw new Error("Expected passing quality gate to allow skill promotion");
}

evalLoop.evalCases.find((testCase) => testCase.evalSuiteId === evalSuites.evidence.id).input = {
  claims: [{ citations: [evidence.id] }]
};
const evidenceEvalRun = evalLoop.runEvalSuite({
  evalSuiteId: evalSuites.evidence.id,
  targetRef: reportVersion.id,
  evaluator: basicEvaluator
});
if (evidenceEvalRun.status !== "passed") {
  throw new Error("Expected evidence eval to pass");
}

const signal = evalLoop.captureLearningSignal({
  runId: run.id,
  stepRunId: firstStep.id,
  signalType: "verifier_failure",
  severity: "warning",
  payload: { reason: "insufficient_sources" }
});
if (!signal.id) {
  throw new Error("Expected learning signal");
}
const proposal = evalLoop.createProposal({
  type: "eval_case",
  title: "Add regression case for insufficient sources",
  sourceRunId: run.id,
  payload: { signalId: signal.id },
  rationale: "Verifier failure should become a regression case."
});
if (proposal.status !== "pending") {
  throw new Error("Expected reviewable learning proposal");
}

const failingSuite = evalLoop.createEvalSuite({ name: "Failing skill gate", targetType: "skill", checks: ["output_schema"] });
evalLoop.createEvalCase({ evalSuiteId: failingSuite.id, name: "Missing summary", input: {}, expected: { required: ["summary"] } });
const failingRun = evalLoop.runEvalSuite({ evalSuiteId: failingSuite.id, targetRef: "bad-skill@1.0.0", evaluator: basicEvaluator });
const failingGate = evalLoop.createQualityGate({ targetType: "skill", targetRef: "bad-skill@1.0.0", evalSuiteId: failingSuite.id });
evalLoop.evaluateQualityGate(failingGate.id, failingRun.id);
if (evalLoop.canPromote("bad-skill@1.0.0")) {
  throw new Error("Expected failed quality gate to block skill promotion");
}

const fakeVectors = [];
const knowledgeProvider = new CloudflareNativeKnowledgeProvider({
  env: {
    AI: {
      async run() {
        return { data: [[0.1, 0.2, 0.3]] };
      }
    },
    VECTORIZE: {
      async upsert(vectors) {
        fakeVectors.push(...vectors);
      },
      async query() {
        return {
          matches: fakeVectors.slice(0, 1).map((vector) => ({
            id: vector.id,
            score: 0.91,
            metadata: vector.metadata
          }))
        };
      }
    },
    ARTIFACTS: {
      async put(key) {
        this.lastKey = key;
      }
    }
  },
  idFactory(prefix) {
    counter += 1;
    return `${prefix}_${counter}`;
  }
});
const ingestResult = await knowledgeProvider.ingest({
  collectionId: "default",
  title: "Workflow notes",
  uri: "memory://workflow-notes",
  text: "Workflow orchestration improves traceability by preserving steps, outputs, and evidence."
});
if (ingestResult.chunkCount !== 1 || fakeVectors.length !== 1) {
  throw new Error("Expected Cloudflare-native knowledge ingest to upsert vectors");
}
const retrieved = await knowledgeProvider.retrieve({ query: "traceable workflow evidence", collectionId: "default" });
if (retrieved.length !== 1 || retrieved[0].source.provider !== "cloudflare-native") {
  throw new Error("Expected Cloudflare-native knowledge retrieval result");
}
const citations = await knowledgeProvider.cite(retrieved);
if (citations.length !== 1 || citations[0].chunkId !== retrieved[0].id) {
  throw new Error("Expected retrieved chunks to convert to citations");
}

const llamaIndexAdapter = new LlamaIndexKnowledgeProvider();
let llamaIndexBlocked = false;
try {
  await llamaIndexAdapter.retrieve({ query: "adapter boundary" });
} catch (error) {
  llamaIndexBlocked = error.message.includes("requires an injected LlamaIndex index");
}
if (!llamaIndexBlocked) {
  throw new Error("Expected LlamaIndex adapter to require injected framework objects");
}

console.log("runtime check passed");
