// @ts-nocheck
import { WorkflowEntrypoint } from "cloudflare:workers";
import { deepResearchFlow } from "../../../packages/core/src/deep-research-flow.js";
import { createId, D1AgentRepository } from "../../../packages/cloudflare/src/d1-repository.js";
import { CloudflareNativeKnowledgeProvider } from "../../../packages/knowledge/src/cloudflare-native.js";

export class DeepResearchWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const params = event.payload;

    const planned = await step.do("plan-flow-execution", async () => {
      await publishRunStatus(this.env, {
        ...params,
        status: "running",
        phase: "planning"
      });
      return {
        flowId: deepResearchFlow.id,
        version: deepResearchFlow.version,
        steps: deepResearchFlow.steps.map((flowStep) => flowStep.id)
      };
    });

    const evidence = await step.do("collect-evidence", async () => {
      await publishRunStatus(this.env, {
        ...params,
        status: "running",
        phase: "collecting_evidence",
        stepId: "search"
      });
      const knowledge = new CloudflareNativeKnowledgeProvider({ env: this.env });
      const chunks = await retrieveSafely(knowledge, {
        collectionId: "default",
        query: params.inputs.topic,
        runId: params.runId,
        stepRunId: params.stepRunId,
        topK: 8
      });
      const citations = await knowledge.cite(chunks);
      return {
        provider: knowledge.id,
        retrievedChunks: chunks,
        citations,
        note: chunks.length === 0
          ? "No indexed knowledge matched yet; search and reader providers can still populate evidence."
          : "Retrieved Cloudflare Vectorize-backed knowledge candidates."
      };
    });

    const artifacts = await step.do("write-artifacts", async () => {
      const exported = createArtifacts({ params, planned, evidence });
      for (const artifact of exported) {
        await this.env.ARTIFACTS.put(artifact.key, artifact.body, {
          httpMetadata: { contentType: artifact.contentType }
        });
      }
      const summaryKey = `runs/${params.runId}/artifacts/summary.json`;
      await this.env.ARTIFACTS.put(summaryKey, JSON.stringify({
        runId: params.runId,
        flowId: params.flowId,
        presetId: params.presetId,
        plannedSteps: planned.steps,
        evidence,
        artifacts: exported.map(({ body, ...artifact }) => artifact),
        createdAt: new Date().toISOString()
      }, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
      });
      await publishRunStatus(this.env, {
        ...params,
        status: "running",
        phase: "artifact_written",
        stepId: "export"
      });
      return [
        ...exported.map(({ body, ...artifact }) => artifact),
        {
          id: "summary_json",
          name: "Workflow Summary",
          type: "JSON",
          key: summaryKey,
          contentType: "application/json; charset=utf-8"
        }
      ];
    });

    await step.do("complete-run", async () => {
      await publishRunStatus(this.env, {
        ...params,
        status: "complete",
        phase: "complete",
        stepId: "export",
        artifacts
      });
      await this.env.RUN_QUEUE.send({
        type: "artifacts.created",
        runId: params.runId,
        artifacts
      });
      return { completed: true };
    });

    return {
      runId: params.runId,
      status: "complete",
      artifacts
    };
  }
}

function createArtifacts({ params, planned, evidence }) {
  const evidenceItems = createEvidenceItems(evidence);
  const sources = evidenceItems.map((item) => ({
    id: item.source,
    title: item.sourceTitle,
    url: item.sourceUrl,
    evidenceCount: 1
  }));
  const bundle = {
    runId: params.runId,
    topic: params.inputs.topic,
    audience: params.inputs.audience || "engineering leaders",
    freshnessDays: params.inputs.freshness_days || 365,
    provider: evidence.provider,
    plannedSteps: planned.steps,
    sources,
    evidence: evidenceItems,
    claims: evidenceItems.map((item, index) => ({
      id: `claim_${index + 1}`,
      text: item.claim,
      citation: item.source,
      confidence: item.confidence
    }))
  };
  const markdown = [
    `# ${params.inputs.topic}`,
    "",
    `Audience: ${bundle.audience}`,
    `Freshness window: ${bundle.freshnessDays} days`,
    "",
    `Cloudflare Workflow completed ${planned.steps.length} planned steps and exported ${evidenceItems.length} evidence-backed finding.`,
    "",
    "## Findings",
    "",
    ...evidenceItems.map((item, index) => `${index + 1}. ${item.claim} [${item.source}]`),
    "",
    "## Sources",
    "",
    ...sources.map((source) => `- ${source.title}: ${source.url}`)
  ].join("\n");

  return [
    {
      id: "markdown_report",
      name: "Deep Research Report",
      type: "Markdown",
      key: `runs/${params.runId}/artifacts/report.md`,
      contentType: "text/markdown; charset=utf-8",
      body: markdown
    },
    {
      id: "evidence_bundle",
      name: "Evidence Bundle",
      type: "JSON",
      key: `runs/${params.runId}/artifacts/evidence-bundle.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(bundle, null, 2)
    }
  ];
}

function createEvidenceItems(evidence) {
  const chunks = evidence.retrievedChunks?.length ? evidence.retrievedChunks : [];
  if (chunks.length === 0) {
    return [{
      claim: "Cloudflare Workflow completed without retrieved knowledge chunks.",
      source: "cloudflare-workflow",
      sourceTitle: "Cloudflare Workflow",
      sourceUrl: "cloudflare://workflow",
      excerpt: evidence.note || "No retrieved chunks were returned.",
      confidence: "low",
      conflicts: "none"
    }];
  }
  return chunks.slice(0, 4).map((chunk) => ({
    claim: `Retrieved evidence for "${chunk.text}".`,
    source: chunk.source?.id || chunk.id,
    sourceTitle: chunk.source?.provider || evidence.provider || "Cloudflare Knowledge",
    sourceUrl: chunk.source?.uri || `vectorize://${chunk.id}`,
    excerpt: chunk.text,
    confidence: chunk.score > 0.75 ? "high" : "medium",
    conflicts: "none"
  }));
}

async function publishRunStatus(env, status) {
  await persistRunStatus(env, status);
  const id = env.RUN_COORDINATOR.idFromName(status.runId);
  await env.RUN_COORDINATOR.get(id).fetch("https://run-coordinator.internal/workflow-status", {
    method: "POST",
    body: JSON.stringify(status)
  });
}

async function persistRunStatus(env, status) {
  if (!env.DB) return;
  const repository = new D1AgentRepository(env.DB);
  const durableStatus = status.status === "complete" ? "complete" : "active";
  await repository.updateRunStatus({
    id: status.runId,
    status: durableStatus,
    currentStepId: status.stepId,
    ended: status.status === "complete"
  });
  await repository.recordRunEvent({
    id: createId("event"),
    runId: status.runId,
    stepRunId: status.stepRunId,
    type: `workflow.${status.phase || status.status}`,
    payload: {
      status: status.status,
      phase: status.phase,
      stepId: status.stepId,
      artifacts: status.artifacts
    }
  });
}

async function retrieveSafely(provider, query) {
  try {
    return await provider.retrieve(query);
  } catch (error) {
    return [{
      id: "knowledge_retrieval_error",
      text: `Knowledge retrieval unavailable: ${error.message}`,
      score: 0,
      source: {
        id: "cloudflare-native",
        provider: provider.id
      },
      metadata: { error: error.message }
    }];
  }
}
