// @ts-nocheck
export const CONTEXT_BLOCK_TYPES = Object.freeze([
  "instructions",
  "skill_guidance",
  "tool_descriptions",
  "task_state",
  "history",
  "retrieval_evidence",
  "artifacts",
  "environment",
  "examples",
  "dynamic_run_data"
]);

export class ContextMemoryManager {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.snapshots = [];
    this.memoryItems = [];
    this.memoryWriteProposals = [];
    this.retrievals = [];
  }

  createBlock({ type, sourceRef, content, tokenCount = estimateTokens(content), priority = 0, metadata = {} }) {
    if (!CONTEXT_BLOCK_TYPES.includes(type)) {
      throw new Error(`Unknown context block type: ${type}`);
    }
    return {
      id: this.idFactory("context_block"),
      type,
      sourceRef,
      content,
      tokenCount,
      priority,
      metadata,
      createdAt: now()
    };
  }

  assembleSnapshot({ runId, stepRunId, blocks, totalBudgetTokens = 8000, responseBudgetTokens = 1200, selectedTools = [] }) {
    const budgets = allocateBudgets(totalBudgetTokens, responseBudgetTokens);
    const selectedBlocks = [];
    const compressions = [];

    for (const block of [...blocks].sort((a, b) => b.priority - a.priority)) {
      const budget = budgets[block.type] || budgets.dynamic_run_data;
      const used = selectedBlocks.filter((candidate) => candidate.type === block.type).reduce((sum, candidate) => sum + candidate.tokenCount, 0);
      if (used + block.tokenCount <= budget.allocatedTokens) {
        selectedBlocks.push(block);
      } else {
        const compressed = this.compressBlock(block, Math.max(64, budget.allocatedTokens - used));
        selectedBlocks.push(compressed.block);
        compressions.push(compressed.record);
      }
    }

    if (selectedTools.length > 0) {
      selectedBlocks.push(this.createBlock({
        type: "tool_descriptions",
        sourceRef: "tool-selection",
        content: selectedTools.map((tool) => `${tool.name}: ${tool.modelDescription || tool.description || ""}`).join("\n"),
        priority: 100,
        metadata: { toolIds: selectedTools.map((tool) => tool.id || tool.name) }
      }));
    }

    const snapshot = {
      id: this.idFactory("context_snapshot"),
      runId,
      stepRunId,
      totalBudgetTokens,
      responseBudgetTokens,
      budgets,
      blocks: selectedBlocks,
      compressions,
      createdAt: now()
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  compressBlock(block, targetTokens) {
    const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
    const compressedContent = content.split(/\s+/).slice(0, targetTokens).join(" ");
    const compressedBlock = {
      ...block,
      id: this.idFactory("context_block"),
      content: compressedContent,
      tokenCount: estimateTokens(compressedContent),
      metadata: { ...block.metadata, compressedFrom: block.id }
    };
    return {
      block: compressedBlock,
      record: {
        id: this.idFactory("context_compression"),
        sourceRef: block.id,
        compressedRef: compressedBlock.id,
        method: "truncate_words",
        originalTokens: block.tokenCount,
        compressedTokens: compressedBlock.tokenCount,
        createdAt: now()
      }
    };
  }

  createMemoryItem({ type, content, summary, scopes = [], sourceRunId, freshness = "current", status = "active" }) {
    if (!["procedural", "episodic", "semantic"].includes(type)) {
      throw new Error(`Unknown memory type: ${type}`);
    }
    const item = {
      id: this.idFactory("memory"),
      type,
      content,
      summary,
      scopes,
      sourceRunId,
      freshness,
      status,
      createdAt: now(),
      updatedAt: now()
    };
    this.memoryItems.push(item);
    return item;
  }

  captureEpisodicRunSummary({ run, summary }) {
    return this.createMemoryItem({
      type: "episodic",
      content: { runId: run.id, summary },
      summary,
      scopes: [
        { type: "flow", ref: run.flowId },
        { type: "run", ref: run.id }
      ],
      sourceRunId: run.id
    });
  }

  proposeMemoryWrite({ memoryType, proposedContent, scopes = [], sourceRunId, rationale }) {
    const proposal = {
      id: this.idFactory("memory_proposal"),
      memoryType,
      proposedContent,
      scopes,
      sourceRunId,
      status: "pending",
      rationale,
      createdAt: now()
    };
    this.memoryWriteProposals.push(proposal);
    return proposal;
  }
}

export function allocateBudgets(totalBudgetTokens, responseBudgetTokens) {
  const available = Math.max(0, totalBudgetTokens - responseBudgetTokens);
  return {
    instructions: budget(available, 0.12),
    skill_guidance: budget(available, 0.14),
    tool_descriptions: budget(available, 0.12),
    task_state: budget(available, 0.10),
    history: budget(available, 0.08),
    retrieval_evidence: budget(available, 0.28),
    artifacts: budget(available, 0.08),
    environment: budget(available, 0.03),
    examples: budget(available, 0.03),
    dynamic_run_data: budget(available, 0.02),
    response: { allocatedTokens: responseBudgetTokens, usedTokens: 0 }
  };
}

function budget(total, fraction) {
  return { allocatedTokens: Math.floor(total * fraction), usedTokens: 0 };
}

function estimateTokens(content) {
  if (!content) return 0;
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3));
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}
