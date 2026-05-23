// @ts-nocheck
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const expectNotReady = args.has("--expect-not-ready");

const wranglerPath = join(process.cwd(), "wrangler.toml");
const webRoot = join(process.cwd(), "apps/web/dist");
const migrationsDir = join(process.cwd(), "packages/db/migrations");
const wrangler = readFileSync(wranglerPath, "utf8");

const config = {
  workerName: readScalar("name") || "agent-platform",
  d1DatabaseName: readBlockScalar("d1_databases", "database_name") || "agent-platform",
  d1DatabaseId: readBlockScalar("d1_databases", "database_id") || "",
  kvNamespaceId: readBlockScalar("kv_namespaces", "id") || "",
  r2BucketName: readBlockScalar("r2_buckets", "bucket_name") || "agent-platform-artifacts",
  vectorizeIndexName: readBlockScalar("vectorize", "index_name") || "agent-platform-knowledge",
  queueName: readBlockScalar("queues.producers", "queue") || "agent-platform-runs",
  workflowName: readBlockScalar("workflows", "name") || "agent-platform-deep-research"
};

const migrationCount = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).length
  : 0;

const checks = [
  check("wrangler.toml", existsSync(wranglerPath), "wrangler.toml exists."),
  check("workers-assets", existsSync(webRoot), "apps/web/dist exists. Run npm run build:web before deploy."),
  check(
    "d1-database-id",
    !isPlaceholderD1(config.d1DatabaseId),
    isPlaceholderD1(config.d1DatabaseId)
      ? "Replace the placeholder D1 database_id in wrangler.toml."
      : "D1 database_id is configured."
  ),
  check(
    "kv-namespace-id",
    !isPlaceholderKv(config.kvNamespaceId),
    isPlaceholderKv(config.kvNamespaceId)
      ? "Replace the placeholder KV namespace id in wrangler.toml."
      : "KV namespace id is configured."
  ),
  check("d1-migrations", migrationCount > 0, `${migrationCount} D1 migration files detected.`),
  check("r2-bucket", Boolean(config.r2BucketName), `R2 bucket binding targets ${config.r2BucketName}.`),
  check("vectorize-index", Boolean(config.vectorizeIndexName), `Vectorize binding targets ${config.vectorizeIndexName}.`),
  check("queue", Boolean(config.queueName), `Queue binding targets ${config.queueName}.`),
  check("workflow", Boolean(config.workflowName), `Workflow binding targets ${config.workflowName}.`)
];

const blockingSetupCommands = createBlockingSetupCommands(config);
const provisioningCommands = createProvisioningCommands(config);
const ready = checks.every((item) => item.ready);
const report = {
  ready,
  workerName: config.workerName,
  checks,
  blockingSetupCommands,
  provisioningCommands,
  setupCommands: [...blockingSetupCommands, ...provisioningCommands],
  deployCommands: [
    "npm run build:web",
    "npx wrangler deploy --dry-run",
    `npx wrangler d1 migrations apply ${config.d1DatabaseName} --remote`,
    "npx wrangler deploy"
  ]
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printTextReport(report);
}

if (!ready && !expectNotReady) {
  process.exitCode = 1;
}

function check(id, ready, detail) {
  return { id, ready, detail };
}

function createBlockingSetupCommands(config) {
  const commands = [];
  if (isPlaceholderD1(config.d1DatabaseId)) {
    commands.push(`npx wrangler d1 create ${config.d1DatabaseName} --binding DB --update-config`);
  }
  if (isPlaceholderKv(config.kvNamespaceId)) {
    commands.push("npx wrangler kv namespace create CACHE --binding CACHE --update-config");
  }
  return commands;
}

function createProvisioningCommands(config) {
  const commands = [];
  commands.push(`npx wrangler r2 bucket create ${config.r2BucketName}`);
  commands.push(`npx wrangler vectorize create ${config.vectorizeIndexName} --preset @cf/baai/bge-small-en-v1.5 --binding VECTORIZE --update-config`);
  commands.push(`npx wrangler queues create ${config.queueName}`);
  return commands;
}

function printTextReport(report) {
  console.log(`Cloudflare deploy readiness for ${report.workerName}`);
  console.log("");
  for (const item of report.checks) {
    console.log(`${item.ready ? "OK" : "SETUP"} ${item.id}: ${item.detail}`);
  }
  console.log("");
  if (!report.ready) {
    console.log("Blocking setup commands:");
    for (const command of report.blockingSetupCommands) console.log(`  ${command}`);
    if (report.blockingSetupCommands.length === 0) console.log("  none");
    console.log("");
    console.log("Provisioning commands for named resources:");
    for (const command of report.provisioningCommands) console.log(`  ${command}`);
    console.log("");
  }
  console.log("Deploy commands:");
  for (const command of report.deployCommands) console.log(`  ${command}`);
}

function readScalar(key) {
  const match = wrangler.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1];
}

function readBlockScalar(blockName, key) {
  const block = findTomlBlock(blockName);
  if (!block) return undefined;
  const match = block.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1];
}

function findTomlBlock(blockName) {
  const lines = wrangler.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[[${blockName}]]`);
  if (start === -1) return undefined;
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("[")) break;
    block.push(line);
  }
  return block.join("\n");
}

function isPlaceholderD1(value) {
  return !value || value === "00000000-0000-0000-0000-000000000000";
}

function isPlaceholderKv(value) {
  return !value || value === "00000000000000000000000000000000";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
