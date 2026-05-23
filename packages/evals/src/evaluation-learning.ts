// @ts-nocheck
export class EvaluationLearningLoop {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.evalSuites = [];
    this.evalCases = [];
    this.evalRuns = [];
    this.evalResults = [];
    this.qualityGates = [];
    this.learningSignals = [];
    this.proposals = [];
  }

  createEvalSuite({ name, targetType, checks = [] }) {
    const suite = { id: this.idFactory("eval_suite"), name, targetType, checks, createdAt: now() };
    this.evalSuites.push(suite);
    return suite;
  }

  createEvalCase({ evalSuiteId, name, input = {}, expected = {}, metadata = {} }) {
    const testCase = { id: this.idFactory("eval_case"), evalSuiteId, name, input, expected, metadata, createdAt: now() };
    this.evalCases.push(testCase);
    return testCase;
  }

  runEvalSuite({ evalSuiteId, targetRef, evaluator }) {
    const suite = this.evalSuites.find((candidate) => candidate.id === evalSuiteId);
    if (!suite) throw new Error(`Unknown eval suite: ${evalSuiteId}`);
    const run = { id: this.idFactory("eval_run"), evalSuiteId, targetRef, status: "running", startedAt: now(), createdAt: now() };
    this.evalRuns.push(run);

    const cases = this.evalCases.filter((candidate) => candidate.evalSuiteId === evalSuiteId);
    for (const testCase of cases) {
      const result = evaluator(testCase);
      this.evalResults.push({
        id: this.idFactory("eval_result"),
        evalRunId: run.id,
        evalCaseId: testCase.id,
        status: result.status,
        score: result.score ?? (result.status === "passed" ? 1 : 0),
        message: result.message,
        metrics: result.metrics || {},
        createdAt: now()
      });
    }

    const runResults = this.evalResults.filter((result) => result.evalRunId === run.id);
    run.status = runResults.every((result) => result.status === "passed") ? "passed" : "failed";
    run.endedAt = now();
    return run;
  }

  createQualityGate({ targetType, targetRef, evalSuiteId, required = true }) {
    const gate = {
      id: this.idFactory("quality_gate"),
      targetType,
      targetRef,
      evalSuiteId,
      required,
      status: "pending",
      createdAt: now()
    };
    this.qualityGates.push(gate);
    return gate;
  }

  evaluateQualityGate(gateId, evalRunId) {
    const gate = this.qualityGates.find((candidate) => candidate.id === gateId);
    const run = this.evalRuns.find((candidate) => candidate.id === evalRunId);
    if (!gate) throw new Error(`Unknown quality gate: ${gateId}`);
    if (!run) throw new Error(`Unknown eval run: ${evalRunId}`);
    gate.status = run.status === "passed" ? "passed" : "blocked";
    gate.evalRunId = evalRunId;
    gate.updatedAt = now();
    return gate;
  }

  canPromote(targetRef) {
    return this.qualityGates
      .filter((gate) => gate.targetRef === targetRef && gate.required)
      .every((gate) => gate.status === "passed");
  }

  captureLearningSignal({ runId, stepRunId, signalType, severity = "info", payload = {} }) {
    const signal = { id: this.idFactory("learning_signal"), runId, stepRunId, signalType, severity, payload, createdAt: now() };
    this.learningSignals.push(signal);
    return signal;
  }

  createProposal({ type, title, sourceRunId, payload = {}, rationale }) {
    const proposal = {
      id: this.idFactory("proposal"),
      type,
      title,
      sourceRunId,
      payload,
      rationale,
      status: "pending",
      createdAt: now()
    };
    this.proposals.push(proposal);
    return proposal;
  }
}

export function createMvpEvalSuites(loop) {
  const skill = loop.createEvalSuite({ name: "Skill output schema", targetType: "skill", checks: ["output_schema"] });
  loop.createEvalCase({ evalSuiteId: skill.id, name: "Skill returns required fields", expected: { required: ["summary"] } });

  const evidence = loop.createEvalSuite({ name: "Evidence citation coverage", targetType: "artifact", checks: ["citation_coverage"] });
  loop.createEvalCase({ evalSuiteId: evidence.id, name: "Claims have citations", expected: { minCitationCoverage: 1 } });

  const policy = loop.createEvalSuite({ name: "Policy permission enforcement", targetType: "policy", checks: ["tool_permission"] });
  loop.createEvalCase({ evalSuiteId: policy.id, name: "Unauthorized tools are blocked", expected: { blocked: true } });

  return { skill, evidence, policy };
}

export function basicEvaluator(testCase) {
  if (testCase.expected.required) {
    return testCase.input && testCase.expected.required.every((field) => testCase.input[field] !== undefined)
      ? { status: "passed" }
      : { status: "failed", message: "Missing required output field" };
  }
  if (testCase.expected.minCitationCoverage !== undefined) {
    const claims = testCase.input.claims || [];
    const covered = claims.filter((claim) => claim.citations?.length > 0).length;
    const coverage = claims.length === 0 ? 0 : covered / claims.length;
    return coverage >= testCase.expected.minCitationCoverage
      ? { status: "passed", score: coverage }
      : { status: "failed", score: coverage, message: "Citation coverage below threshold" };
  }
  if (testCase.expected.blocked !== undefined) {
    return testCase.input.blocked === testCase.expected.blocked
      ? { status: "passed" }
      : { status: "failed", message: "Policy permission behavior mismatch" };
  }
  return { status: "passed" };
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}
