// @ts-nocheck
export class PolicyRuntimeControls {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.policies = new Map();
    this.guardResults = [];
    this.approvalRequests = [];
    this.loopSignals = [];
    this.circuitBreakers = new Map();
    this.escalationRecords = [];
  }

  registerPolicy(policy) {
    requireString(policy.id, "policy.id");
    requireString(policy.name, "policy.name");
    const record = {
      id: policy.id,
      name: policy.name,
      budget: policy.budget || {},
      providers: policy.providers || {},
      quality: policy.quality || {},
      security: policy.security || {},
      human: policy.human || {},
      retry: policy.retry || {},
      createdAt: now(),
      updatedAt: now()
    };
    this.policies.set(record.id, record);
    return record;
  }

  runInputGuards({ policyId, runId, stepRunId, inputs }) {
    const policy = this.requirePolicy(policyId);
    const results = [];
    const maxInputLength = policy.security.maxInputLength ?? 20000;
    const serialized = JSON.stringify(inputs || {});

    if (serialized.length > maxInputLength) {
      results.push(this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "input.length",
        status: "blocked",
        mode: "block",
        message: `Input length ${serialized.length} exceeds ${maxInputLength}`
      }));
    }

    if (policy.security.unsupportedContentPatterns?.some((pattern) => serialized.includes(pattern))) {
      results.push(this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "input.unsupported_content",
        status: "blocked",
        mode: "block",
        message: "Input matched unsupported content policy"
      }));
    }

    if (policy.security.sensitiveDataPatterns?.some((pattern) => serialized.includes(pattern))) {
      results.push(this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "input.sensitive_data",
        status: "warn",
        mode: "warn",
        message: "Input matched sensitive data placeholder policy"
      }));
    }

    return results.length > 0 ? results : [this.pass(runId, stepRunId, "input")];
  }

  runToolGuard({ policyId, runId, stepRunId, tool, input }) {
    const policy = this.requirePolicy(policyId);
    const allowedTools = policy.security.allowedTools || [];
    const externalWriteTools = policy.security.externalWriteTools || [];

    if (allowedTools.length > 0 && !allowedTools.includes(tool.name) && !allowedTools.includes(tool.permissionScope)) {
      return this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "tool.permission",
        status: "blocked",
        mode: "block",
        message: `Tool is not allowed: ${tool.name}`,
        metadata: { toolName: tool.name }
      });
    }

    const schemaResult = validateRequiredFields(tool.inputSchema, input || {});
    if (!schemaResult.valid) {
      return this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "tool.schema",
        status: "blocked",
        mode: "block",
        message: schemaResult.message,
        metadata: { toolName: tool.name }
      });
    }

    if (externalWriteTools.includes(tool.name) || externalWriteTools.includes(tool.permissionScope)) {
      const approval = this.createApprovalRequest({
        runId,
        stepRunId,
        actionType: "external_write",
        actionPayloadRef: `tool://${tool.name}`
      });
      return this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "tool.external_write_approval",
        status: "paused",
        mode: "block",
        message: `External write requires approval: ${tool.name}`,
        metadata: { approvalRequestId: approval.id }
      });
    }

    return this.pass(runId, stepRunId, "tool");
  }

  runOutputGuards({ policyId, runId, stepRunId, output, outputSchema, artifact }) {
    const policy = this.requirePolicy(policyId);
    const results = [];
    const outputSchemaResult = validateRequiredFields(outputSchema, output || {});

    if (outputSchema && !outputSchemaResult.valid) {
      results.push(this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "output.schema",
        status: "blocked",
        mode: "block",
        message: outputSchemaResult.message
      }));
    }

    if (artifact?.type === "markdown_report" && typeof artifact.content === "string" && !artifact.content.trim().startsWith("#")) {
      results.push(this.recordGuardResult({
        runId,
        stepRunId,
        guardType: "output.artifact_format",
        status: "blocked",
        mode: "block",
        message: "Markdown report artifacts must start with a heading"
      }));
    }

    if (policy.quality.citationRequired && Array.isArray(output?.claims)) {
      const unsupported = output.claims.filter((claim) => !claim.citations || claim.citations.length === 0);
      if (unsupported.length > 0) {
        results.push(this.recordGuardResult({
          runId,
          stepRunId,
          guardType: "output.citation_required",
          status: "blocked",
          mode: "block",
          message: `${unsupported.length} claims are missing citations`,
          metadata: { unsupportedClaims: unsupported.map((claim) => claim.id || claim.text) }
        }));
      }
    }

    return results.length > 0 ? results : [this.pass(runId, stepRunId, "output")];
  }

  runBudgetGuard({ policyId, runId, stepRunId, usage }) {
    const policy = this.requirePolicy(policyId);
    const budget = policy.budget;
    const checks = [
      ["budget.cost", usage.costUsd, budget.maxCostUsd],
      ["budget.tokens", usage.tokens, budget.maxTokens],
      ["budget.runtime", usage.runtimeMs, budget.maxRuntimeMs],
      ["budget.iterations", usage.iterations, budget.maxIterations],
      ["budget.tool_calls", usage.toolCalls, budget.maxToolCalls],
      ["budget.parallel_units", usage.parallelUnits, budget.maxParallelUnits]
    ];

    for (const [guardType, actual, limit] of checks) {
      if (limit !== undefined && actual !== undefined && actual > limit) {
        return this.recordGuardResult({
          runId,
          stepRunId,
          guardType,
          status: "blocked",
          mode: "block",
          message: `${guardType} ${actual} exceeds ${limit}`,
          metadata: { actual, limit }
        });
      }
    }

    return this.pass(runId, stepRunId, "budget");
  }

  detectLoop({ runId, stepRunId, recentToolCalls = [], recentOutputs = [], noProgress = false }) {
    const repeatedTool = hasRecentDuplicate(recentToolCalls);
    const repeatedOutput = hasRecentDuplicate(recentOutputs);
    if (!repeatedTool && !repeatedOutput && !noProgress) return null;

    const signal = {
      id: this.idFactory("loop_signal"),
      runId,
      stepRunId,
      signalType: repeatedTool ? "repeated_tool_call" : repeatedOutput ? "similar_output" : "no_progress",
      severity: "warning",
      metadata: { recentToolCalls, noProgress },
      createdAt: now()
    };
    this.loopSignals.push(signal);
    this.circuitBreakers.set(`${runId}:${stepRunId}`, {
      scope: "step",
      scopeRef: stepRunId,
      status: "open",
      openedAt: now()
    });
    return signal;
  }

  recordEscalation({ runId, stepRunId, reason, action, outcome, originalContextRef, metadata = {} }) {
    requireString(reason, "escalation.reason");
    requireString(action, "escalation.action");
    const record = {
      id: this.idFactory("escalation"),
      runId,
      stepRunId,
      reason,
      action,
      outcome,
      originalContextRef,
      metadata,
      createdAt: now()
    };
    this.escalationRecords.push(record);
    return record;
  }

  createApprovalRequest({ runId, stepRunId, actionType, actionPayloadRef }) {
    const request = {
      id: this.idFactory("approval"),
      runId,
      stepRunId,
      actionType,
      actionPayloadRef,
      status: "pending",
      requestedAt: now()
    };
    this.approvalRequests.push(request);
    return request;
  }

  recordGuardResult({ runId, stepRunId, guardType, status, mode, message, metadata = {} }) {
    const record = {
      id: this.idFactory("guard"),
      runId,
      stepRunId,
      guardType,
      status,
      mode,
      message,
      metadata,
      createdAt: now()
    };
    this.guardResults.push(record);
    return record;
  }

  pass(runId, stepRunId, guardType) {
    return this.recordGuardResult({
      runId,
      stepRunId,
      guardType,
      status: "passed",
      mode: "observe",
      message: `${guardType} guard passed`
    });
  }

  requirePolicy(policyId) {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`Unknown policy: ${policyId}`);
    return policy;
  }
}

export function createStandardResearchPolicy() {
  return {
    id: "research_standard",
    name: "Research Standard",
    budget: {
      maxCostUsd: 3,
      maxTokens: 100000,
      maxRuntimeMs: 30 * 60 * 1000,
      maxIterations: 4,
      maxToolCalls: 50,
      maxParallelUnits: 5
    },
    providers: {
      llm: {
        planner: ["openai", "anthropic"],
        synthesizer: ["openai"],
        verifier: ["anthropic", "openai"]
      },
      search: ["mvp-search"],
      reader: ["jina-reader"]
    },
    quality: {
      minSourcesPerSubquestion: 3,
      citationRequired: true,
      conflictCheck: true,
      staleSourceCheck: true
    },
    security: {
      maxInputLength: 12000,
      allowedTools: ["search.web", "reader.read_url", "search:read", "reader:read"],
      externalWriteTools: [],
      sensitiveDataPatterns: ["SECRET=", "PRIVATE_KEY"]
    },
    human: {
      approvalRequiredBeforeActions: false,
      approvalRequiredBeforeExternalWrite: true
    },
    retry: {
      maxRetries: 2,
      backoffMs: 1000
    }
  };
}

function validateRequiredFields(schema, value) {
  if (!schema?.required) return { valid: true };
  for (const field of schema.required) {
    if (value[field] === undefined || value[field] === null || value[field] === "") {
      return { valid: false, message: `Missing required field: ${field}` };
    }
  }
  return { valid: true };
}

function hasRecentDuplicate(values) {
  if (values.length < 2) return false;
  return values.at(-1) === values.at(-2);
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}
