// @ts-nocheck
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export class SkillRegistry {
  constructor({ idFactory = defaultIdFactory } = {}) {
    this.idFactory = idFactory;
    this.skills = new Map();
    this.skillVersions = new Map();
    this.invocations = [];
  }

  discoverSkills(rootDir) {
    if (!existsSync(rootDir)) return [];
    return readdirSync(rootDir)
      .map((entry) => join(rootDir, entry))
      .filter((entryPath) => statSync(entryPath).isDirectory())
      .map((packagePath) => this.loadSkillPackage(packagePath));
  }

  loadSkillPackage(packagePath) {
    const manifestPath = join(packagePath, "skill.yaml");
    const instructionPath = join(packagePath, "SKILL.md");
    if (!existsSync(manifestPath)) throw new Error(`Missing skill.yaml: ${packagePath}`);
    if (!existsSync(instructionPath)) throw new Error(`Missing SKILL.md: ${packagePath}`);

    const metadata = parseYamlLite(readFileSync(manifestPath, "utf8"));
    const instructions = readFileSync(instructionPath, "utf8");
    validateSkillMetadata(metadata, packagePath);

    const skill = this.skills.get(metadata.id) || {
      id: metadata.id,
      name: metadata.name,
      description: metadata.description,
      status: "draft",
      createdAt: now()
    };
    this.skills.set(skill.id, skill);

    const versionId = `${metadata.id}@${metadata.version}`;
    const version = {
      id: versionId,
      skillId: metadata.id,
      version: metadata.version,
      packagePath,
      metadata,
      instructions,
      permissions: metadata.permissions || [],
      evals: metadata.evals || [],
      status: "draft",
      createdAt: now()
    };
    this.skillVersions.set(versionId, version);
    return version;
  }

  resolveBinding(binding) {
    const version = this.skillVersions.get(binding);
    if (!version) {
      throw new Error(`Unknown skill binding: ${binding}`);
    }
    return version;
  }

  createInvocationContext({ binding, inputRef, allowedAssets = [] }) {
    const version = this.resolveBinding(binding);
    return {
      skillVersionId: version.id,
      inputRef,
      instructions: version.instructions,
      metadata: version.metadata,
      permissions: version.permissions,
      allowedAssets,
      outputSchema: version.metadata.output_schema,
      inputSchema: version.metadata.input_schema
    };
  }

  recordInvocation(invocation) {
    const record = {
      id: invocation.id || this.idFactory("skill_invocation"),
      runId: invocation.runId,
      stepRunId: invocation.stepRunId,
      skillVersionId: invocation.skillVersionId,
      status: invocation.status,
      inputRef: invocation.inputRef,
      outputRef: invocation.outputRef,
      permissionDecisions: invocation.permissionDecisions || [],
      toolUsage: invocation.toolUsage || [],
      startedAt: invocation.startedAt,
      endedAt: invocation.endedAt,
      error: invocation.error,
      createdAt: now()
    };
    this.invocations.push(record);
    return record;
  }
}

function validateSkillMetadata(metadata, packagePath) {
  for (const field of ["id", "name", "version", "description"]) {
    if (typeof metadata[field] !== "string" || metadata[field].length === 0) {
      throw new Error(`Invalid skill metadata in ${packagePath}: ${field} is required`);
    }
  }
}

function parseYamlLite(content) {
  const result = {};
  let currentListKey = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listMatch && currentListKey) {
      result[currentListKey].push(parseScalar(listMatch[1]));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      if (value === "") {
        result[key] = [];
        currentListKey = key;
      } else {
        result[key] = parseScalar(value);
        currentListKey = null;
      }
    }
  }

  return result;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function defaultIdFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}
