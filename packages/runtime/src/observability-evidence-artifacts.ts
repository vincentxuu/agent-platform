// @ts-nocheck
export class ObservabilityEvidenceArtifacts {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.traceSpans = [];
    this.traceEvents = [];
    this.metricPoints = [];
    this.sources = [];
    this.evidenceItems = [];
    this.claims = [];
    this.citations = [];
    this.conflicts = [];
    this.artifacts = [];
    this.artifactVersions = [];
  }

  startSpan({ runId, stepRunId, type, name, parentId, inputRef, metadata = {} }) {
    const span = {
      id: this.idFactory("span"),
      parentId,
      runId,
      stepRunId,
      type,
      name,
      status: "running",
      inputRef,
      metadata,
      startedAt: now(),
      createdAt: now()
    };
    this.traceSpans.push(span);
    return span;
  }

  finishSpan(spanId, { status = "succeeded", outputRef, error } = {}) {
    const span = this.requireSpan(spanId);
    span.status = status;
    span.outputRef = outputRef;
    span.error = error;
    span.endedAt = now();
    span.durationMs = Date.parse(span.endedAt) - Date.parse(span.startedAt);
    return span;
  }

  recordEvent({ runId, traceSpanId, type, payload = {} }) {
    const event = { id: this.idFactory("trace_event"), traceSpanId, runId, type, payload, createdAt: now() };
    this.traceEvents.push(event);
    return event;
  }

  deriveMetrics({ runId, providerCalls = [], toolInvocations = [], skillInvocations = [], guardResults = [] }) {
    const metrics = [
      ["cost.total_usd", sum(providerCalls, "costUsd") + sum(toolInvocations, "costUsd")],
      ["usage.provider_calls", providerCalls.length],
      ["usage.tool_invocations", toolInvocations.length],
      ["usage.skill_invocations", skillInvocations.length],
      ["reliability.guard_blocks", guardResults.filter((result) => result.status === "blocked").length],
      ["reliability.retry_count", sum(providerCalls, "retryCount") + sum(toolInvocations, "retryCount")]
    ];
    return metrics.map(([name, value]) => this.recordMetric(name, value, { runId }));
  }

  recordMetric(metricName, value, dimensions = {}) {
    const point = {
      id: this.idFactory("metric"),
      metricName,
      metricType: "gauge",
      value,
      dimensions,
      measuredAt: now()
    };
    this.metricPoints.push(point);
    return point;
  }

  addSource(source) {
    const record = {
      id: source.id || this.idFactory("source"),
      url: source.url,
      title: source.title,
      provider: source.provider,
      retrievedAt: source.retrievedAt || now(),
      metadata: source.metadata || {},
      createdAt: now()
    };
    this.sources.push(record);
    return record;
  }

  addEvidence({ runId, stepRunId, sourceId, excerpt, confidence = "medium", supportsStep, metadata = {} }) {
    const item = {
      id: this.idFactory("evidence"),
      runId,
      stepRunId,
      sourceId,
      excerpt,
      confidence,
      supportsStep,
      metadata,
      createdAt: now()
    };
    this.evidenceItems.push(item);
    return item;
  }

  addClaim({ runId, artifactVersionId, text, confidence = "medium", status = "unverified" }) {
    const claim = {
      id: this.idFactory("claim"),
      runId,
      artifactVersionId,
      text,
      confidence,
      status,
      createdAt: now()
    };
    this.claims.push(claim);
    return claim;
  }

  linkClaimToEvidence({ claimId, evidenceItemId, citationText, status = "valid" }) {
    const citation = {
      id: this.idFactory("citation"),
      claimId,
      evidenceItemId,
      citationText,
      status,
      createdAt: now()
    };
    this.citations.push(citation);
    const claim = this.claims.find((candidate) => candidate.id === claimId);
    if (claim) claim.status = "supported";
    return citation;
  }

  createMarkdownReport({ title, claims }) {
    const lines = [`# ${title}`, ""];
    for (const claim of claims) {
      const citations = this.citations.filter((citation) => citation.claimId === claim.id);
      const citationText = citations.map((citation) => `[${citation.evidenceItemId}]`).join(" ");
      lines.push(`- ${claim.text}${citationText ? ` ${citationText}` : ""}`);
    }
    return `${lines.join("\n")}\n`;
  }

  createEvidenceBundle({ runId }) {
    return {
      runId,
      sources: this.sources,
      evidence: this.evidenceItems.filter((item) => item.runId === runId),
      claims: this.claims.filter((claim) => claim.runId === runId),
      citations: this.citations,
      conflicts: this.conflicts
    };
  }

  createArtifact({ runId, type, name }) {
    const artifact = {
      id: this.idFactory("artifact"),
      runId,
      type,
      name,
      status: "draft",
      createdAt: now(),
      updatedAt: now()
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  addArtifactVersion({ artifactId, content, sourceStepRunId, evidenceRefs = [] }) {
    const existing = this.artifactVersions.filter((version) => version.artifactId === artifactId);
    const version = {
      id: this.idFactory("artifact_version"),
      artifactId,
      version: existing.length + 1,
      content,
      sourceStepRunId,
      evidenceRefs,
      createdAt: now()
    };
    this.artifactVersions.push(version);
    return version;
  }

  requireSpan(spanId) {
    const span = this.traceSpans.find((candidate) => candidate.id === spanId);
    if (!span) throw new Error(`Unknown trace span: ${spanId}`);
    return span;
  }
}

function sum(items, field) {
  return items.reduce((total, item) => total + (item[field] || 0), 0);
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}
