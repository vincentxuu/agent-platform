// @ts-nocheck
import {
  RUN_STATUSES,
  STEP_STATUSES,
  assertValidFlowDefinition,
  findInitialStepIds,
  findNextStepIds,
  validateFlowInputs
} from "../../core/src/flow.js";

export class InMemoryFlowRuntime {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.runs = new Map();
    this.stepRuns = new Map();
    this.checkpoints = new Map();
    this.events = new Map();
  }

  createRun({ flow, presetId, inputs }) {
    assertValidFlowDefinition(flow);

    const preset = flow.presets.find((candidate) => candidate.id === presetId);
    if (!preset) {
      throw new Error(`Unknown preset: ${presetId}`);
    }

    const inputErrors = validateFlowInputs(flow, inputs);
    if (inputErrors.length > 0) {
      throw new Error(`Invalid flow inputs:\n${inputErrors.map((error) => `- ${error}`).join("\n")}`);
    }

    const runId = this.idFactory("run");
    const initialStepIds = findInitialStepIds(flow);
    const run = {
      id: runId,
      flowId: flow.id,
      flowVersion: flow.version,
      presetId,
      status: RUN_STATUSES.active,
      inputs,
      currentStepIds: initialStepIds,
      completedStepIds: [],
      remainingStepIds: flow.steps.map((step) => step.id),
      outputs: {},
      artifactRefs: [],
      evidenceRefs: [],
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      createdAt: now()
    };

    this.runs.set(runId, run);
    this.events.set(runId, []);
    for (const stepId of initialStepIds) {
      this.createStepRun(runId, stepId);
    }
    this.recordEvent(runId, "run.created", { presetId, initialStepIds });
    this.saveCheckpoint(runId);

    return run;
  }

  createStepRun(runId, stepId) {
    const run = this.requireRun(runId);
    const stepRun = {
      id: this.idFactory("step"),
      runId,
      stepId,
      status: STEP_STATUSES.pending,
      attempt: 1,
      createdAt: now()
    };
    this.stepRuns.set(stepRun.id, stepRun);
    this.recordEvent(run.id, "step.created", { stepRunId: stepRun.id, stepId });
    return stepRun;
  }

  startStep(stepRunId) {
    const stepRun = this.requireStepRun(stepRunId);
    stepRun.status = STEP_STATUSES.running;
    stepRun.startedAt = now();
    this.recordEvent(stepRun.runId, "step.started", { stepRunId, stepId: stepRun.stepId });
    return stepRun;
  }

  completeStep({ flow, stepRunId, output = {} }) {
    assertValidFlowDefinition(flow);
    const stepRun = this.requireStepRun(stepRunId);
    const run = this.requireRun(stepRun.runId);

    stepRun.status = STEP_STATUSES.succeeded;
    stepRun.output = output;
    stepRun.endedAt = now();

    run.outputs[stepRun.stepId] = output;
    run.completedStepIds = unique([...run.completedStepIds, stepRun.stepId]);
    run.remainingStepIds = run.remainingStepIds.filter((stepId) => stepId !== stepRun.stepId);

    const nextStepIds = findNextStepIds(flow, stepRun.stepId, output);
    run.currentStepIds = nextStepIds;
    for (const nextStepId of nextStepIds) {
      this.createStepRun(run.id, nextStepId);
    }

    if (nextStepIds.length === 0) {
      run.status = RUN_STATUSES.succeeded;
      run.endedAt = now();
    }

    this.recordEvent(run.id, "step.succeeded", { stepRunId, stepId: stepRun.stepId, nextStepIds });
    this.saveCheckpoint(run.id);
    return { run, stepRun, nextStepIds };
  }

  failStep(stepRunId, error) {
    const stepRun = this.requireStepRun(stepRunId);
    const run = this.requireRun(stepRun.runId);
    stepRun.status = STEP_STATUSES.failed;
    stepRun.error = normalizeError(error);
    stepRun.endedAt = now();
    run.status = RUN_STATUSES.failed;
    run.error = stepRun.error;
    this.recordEvent(run.id, "step.failed", { stepRunId, stepId: stepRun.stepId, error: stepRun.error });
    this.saveCheckpoint(run.id);
    return { run, stepRun };
  }

  cancelRun(runId) {
    const run = this.requireRun(runId);
    run.status = RUN_STATUSES.canceled;
    run.endedAt = now();
    for (const stepRun of this.stepRuns.values()) {
      if (stepRun.runId === runId && [STEP_STATUSES.pending, STEP_STATUSES.running].includes(stepRun.status)) {
        stepRun.status = STEP_STATUSES.canceled;
        stepRun.endedAt = now();
      }
    }
    this.recordEvent(runId, "run.canceled", {});
    this.saveCheckpoint(runId);
    return run;
  }

  retryStep(stepRunId) {
    const failedStep = this.requireStepRun(stepRunId);
    if (failedStep.status !== STEP_STATUSES.failed) {
      throw new Error(`Only failed steps can be retried: ${stepRunId}`);
    }
    const retry = {
      ...failedStep,
      id: this.idFactory("step"),
      status: STEP_STATUSES.pending,
      attempt: failedStep.attempt + 1,
      error: undefined,
      startedAt: undefined,
      endedAt: undefined,
      createdAt: now()
    };
    const run = this.requireRun(failedStep.runId);
    run.status = RUN_STATUSES.active;
    run.currentStepIds = [failedStep.stepId];
    this.stepRuns.set(retry.id, retry);
    this.recordEvent(run.id, "step.retry_created", { originalStepRunId: stepRunId, retryStepRunId: retry.id });
    this.saveCheckpoint(run.id);
    return retry;
  }

  resumeLatestCheckpoint(runId) {
    const run = this.requireRun(runId);
    const checkpoint = this.checkpoints.get(runId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for run: ${runId}`);
    }
    run.status = RUN_STATUSES.active;
    run.currentStepIds = checkpoint.currentStepIds;
    run.remainingStepIds = checkpoint.remainingStepIds;
    this.recordEvent(runId, "run.resumed", { checkpointId: checkpoint.id });
    return { run, checkpoint };
  }

  saveCheckpoint(runId) {
    const run = this.requireRun(runId);
    const checkpoint = {
      id: this.idFactory("checkpoint"),
      runId,
      completedStepIds: [...run.completedStepIds],
      currentStepIds: [...run.currentStepIds],
      remainingStepIds: [...run.remainingStepIds],
      keyOutputs: run.outputs,
      tokenUsage: run.tokenUsage,
      costUsd: run.costUsd,
      artifactRefs: [...run.artifactRefs],
      evidenceRefs: [...run.evidenceRefs],
      createdAt: now()
    };
    this.checkpoints.set(runId, checkpoint);
    this.recordEvent(runId, "checkpoint.saved", { checkpointId: checkpoint.id });
    return checkpoint;
  }

  recordEvent(runId, type, payload) {
    const event = { id: this.idFactory("event"), runId, type, payload, createdAt: now() };
    const events = this.events.get(runId) || [];
    events.push(event);
    this.events.set(runId, events);
    return event;
  }

  requireRun(runId) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  requireStepRun(stepRunId) {
    const stepRun = this.stepRuns.get(stepRunId);
    if (!stepRun) throw new Error(`Unknown step run: ${stepRunId}`);
    return stepRun;
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { type: error.name, message: error.message };
  }
  return { type: "Error", message: String(error) };
}
