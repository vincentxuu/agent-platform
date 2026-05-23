// @ts-nocheck
export const STEP_STATUSES = Object.freeze({
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  paused: "paused",
  canceled: "canceled",
  skipped: "skipped"
});

export const RUN_STATUSES = Object.freeze({
  active: "active",
  succeeded: "succeeded",
  failed: "failed",
  paused: "paused",
  canceled: "canceled"
});

export function validateFlowDefinition(flow) {
  const errors = [];

  if (!flow || typeof flow !== "object") {
    return ["Flow definition must be an object"];
  }

  requireString(flow.id, "id", errors);
  requireString(flow.name, "name", errors);
  requireInteger(flow.version, "version", errors);
  requireArray(flow.inputs, "inputs", errors);
  requireArray(flow.presets, "presets", errors);
  requireArray(flow.steps, "steps", errors);
  requireArray(flow.edges, "edges", errors);
  requireArray(flow.artifacts, "artifacts", errors);

  const stepIds = new Set();
  for (const [index, step] of (flow.steps || []).entries()) {
    requireString(step.id, `steps[${index}].id`, errors);
    requireString(step.type, `steps[${index}].type`, errors);
    if (step.id) {
      if (stepIds.has(step.id)) errors.push(`Duplicate step id: ${step.id}`);
      stepIds.add(step.id);
    }
  }

  for (const [index, edge] of (flow.edges || []).entries()) {
    requireString(edge.from, `edges[${index}].from`, errors);
    requireString(edge.to, `edges[${index}].to`, errors);
    if (edge.from && !stepIds.has(edge.from)) errors.push(`Edge references unknown from step: ${edge.from}`);
    if (edge.to && !stepIds.has(edge.to)) errors.push(`Edge references unknown to step: ${edge.to}`);
  }

  for (const [index, input] of (flow.inputs || []).entries()) {
    requireString(input.id, `inputs[${index}].id`, errors);
    requireString(input.type, `inputs[${index}].type`, errors);
  }

  for (const [index, preset] of (flow.presets || []).entries()) {
    requireString(preset.id, `presets[${index}].id`, errors);
    requireString(preset.name, `presets[${index}].name`, errors);
  }

  return errors;
}

export function assertValidFlowDefinition(flow) {
  const errors = validateFlowDefinition(flow);
  if (errors.length > 0) {
    throw new Error(`Invalid flow definition:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return flow;
}

export function validateFlowInputs(flow, inputValues) {
  const errors = [];
  const values = inputValues || {};

  for (const input of flow.inputs || []) {
    const value = values[input.id];
    if (input.required && (value === undefined || value === null || value === "")) {
      errors.push(`Missing required input: ${input.id}`);
      continue;
    }

    if (value !== undefined && value !== null) {
      if (input.type === "string" && typeof value !== "string") {
        errors.push(`Input ${input.id} must be a string`);
      }
      if (input.type === "number" && typeof value !== "number") {
        errors.push(`Input ${input.id} must be a number`);
      }
      if (input.type === "boolean" && typeof value !== "boolean") {
        errors.push(`Input ${input.id} must be a boolean`);
      }
    }
  }

  return errors;
}

export function findInitialStepIds(flow) {
  const targetStepIds = new Set(flow.edges.map((edge) => edge.to));
  return flow.steps.map((step) => step.id).filter((stepId) => !targetStepIds.has(stepId));
}

export function findNextStepIds(flow, fromStepId, stepOutput = {}) {
  return flow.edges
    .filter((edge) => edge.from === fromStepId)
    .filter((edge) => edge.condition ? Boolean(stepOutput[edge.condition]) : true)
    .map((edge) => edge.to);
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireInteger(value, path, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${path} must be an integer`);
  }
}

function requireArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
  }
}
