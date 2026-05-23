// @ts-nocheck
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const applySetup = args.has("--apply-setup");
const deploy = args.has("--deploy");
const yes = args.has("--yes");
const smokeUrl = normalizeUrl(readArg("--smoke-url") || process.env.AGENT_PLATFORM_URL || "");
const smokeCreateRun = args.has("--smoke-create-run");

const wranglerPath = join(process.cwd(), "wrangler.toml");
const migrationsDir = join(process.cwd(), "packages/db/migrations");
const webRoot = join(process.cwd(), "apps/web/dist");
const wrangler = readFileSync(wranglerPath, "utf8");

const config = {
  workerName: readScalar("name") || "agent-platform",
  d1DatabaseName: readBlockScalar("d1_databases", "database_name") || "agent-platform",
  d1DatabaseId: readBlockScalar("d1_databases", "database_id") || "",
  kvNamespaceId: readBlockScalar("kv_namespaces", "id") || "",
  r2BucketName: readBlockScalar("r2_buckets", "bucket_name") || "agent-platform-artifacts",
  vectorizeIndexName: readBlockScalar("vectorize", "index_name") || "agent-platform-knowledge",
  queueName: readBlockScalar("queues.producers", "queue") || "agent-platform-runs"
};

const migrationCount = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).length
  : 0;
const blockingSetupCommands = createBlockingSetupCommands(config);
const provisioningCommands = createProvisioningCommands(config);
const deployCommands = [
  ["npm", "run", "build:web"],
  ["npx", "wrangler", "deploy", "--dry-run"],
  ["npx", "wrangler", "d1", "migrations", "apply", config.d1DatabaseName, "--remote"],
  ["npx", "wrangler", "deploy"]
];
const remoteSmokeCommand = smokeUrl
  ? createRemoteSmokeCommand(smokeUrl, smokeCreateRun)
  : undefined;
const report = {
  workerName: config.workerName,
  mode: applySetup ? "apply-setup" : deploy ? "deploy" : "plan",
  readyForRemoteDeploy: blockingSetupCommands.length === 0 && migrationCount > 0 && existsSync(webRoot),
  checks: [
    { id: "workers-assets", ready: existsSync(webRoot), detail: existsSync(webRoot) ? "apps/web/dist exists." : "Run npm run build:web." },
    { id: "d1-database-id", ready: !isPlaceholderD1(config.d1DatabaseId), detail: isPlaceholderD1(config.d1DatabaseId) ? "D1 database_id is still a placeholder." : "D1 database_id is configured." },
    { id: "kv-namespace-id", ready: !isPlaceholderKv(config.kvNamespaceId), detail: isPlaceholderKv(config.kvNamespaceId) ? "KV namespace id is still a placeholder." : "KV namespace id is configured." },
    { id: "d1-migrations", ready: migrationCount > 0, detail: `${migrationCount} migration files detected.` }
  ],
  blockingSetupCommands: blockingSetupCommands.map(formatCommand),
  provisioningCommands: provisioningCommands.map(formatCommand),
  setupCommands: [...blockingSetupCommands, ...provisioningCommands].map(formatCommand),
  deployCommands: deployCommands.map(formatCommand),
  remoteSmokeCommand: remoteSmokeCommand ? formatCommand(remoteSmokeCommand) : undefined
};

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printReport(report);
}

if (applySetup || deploy) {
  requireYes();
  await runCommand(["npx", "wrangler", "whoami"]);
}

if (applySetup) {
  for (const command of [...blockingSetupCommands, ...provisioningCommands]) {
    await runSetupCommand(command);
  }
  console.log("Cloudflare setup commands finished. Re-run npm run cloudflare:readiness before remote deploy.");
}

if (deploy) {
  if (blockingSetupCommands.length > 0) {
    throw new Error("Remote deploy is blocked because wrangler.toml still has placeholder resource IDs. Run npm run cloudflare:setup:apply -- --yes first, then re-run readiness.");
  }
  if (smokeCreateRun && !smokeUrl) {
    throw new Error("Remote lifecycle smoke requires --smoke-url or AGENT_PLATFORM_URL.");
  }
  for (const command of deployCommands) {
    await runCommand(command);
  }
  if (remoteSmokeCommand) {
    await runCommand(remoteSmokeCommand);
  } else {
    console.log("Remote deploy finished without smoke verification. Set AGENT_PLATFORM_URL or pass --smoke-url to validate the deployed Worker.");
  }
}

function createBlockingSetupCommands(config) {
  const commands = [];
  if (isPlaceholderD1(config.d1DatabaseId)) {
    commands.push(["npx", "wrangler", "d1", "create", config.d1DatabaseName, "--binding", "DB", "--update-config"]);
  }
  if (isPlaceholderKv(config.kvNamespaceId)) {
    commands.push(["npx", "wrangler", "kv", "namespace", "create", "CACHE", "--binding", "CACHE", "--update-config"]);
  }
  return commands;
}

function createProvisioningCommands(config) {
  const commands = [];
  commands.push(["npx", "wrangler", "r2", "bucket", "create", config.r2BucketName]);
  commands.push(["npx", "wrangler", "vectorize", "create", config.vectorizeIndexName, "--preset", "@cf/baai/bge-small-en-v1.5", "--binding", "VECTORIZE", "--update-config"]);
  commands.push(["npx", "wrangler", "queues", "create", config.queueName]);
  return commands;
}

function printReport(report) {
  console.log(`Cloudflare remote deployment plan for ${report.workerName}`);
  console.log("");
  for (const item of report.checks) {
    console.log(`${item.ready ? "OK" : "SETUP"} ${item.id}: ${item.detail}`);
  }
  console.log("");
  console.log("Blocking setup commands:");
  for (const command of report.blockingSetupCommands) console.log(`  ${command}`);
  if (report.blockingSetupCommands.length === 0) console.log("  none");
  console.log("");
  console.log("Provisioning commands for named resources:");
  for (const command of report.provisioningCommands) console.log(`  ${command}`);
  console.log("");
  console.log("Deploy commands:");
  for (const command of report.deployCommands) console.log(`  ${command}`);
  if (report.remoteSmokeCommand) {
    console.log("");
    console.log("Remote smoke command:");
    console.log(`  ${report.remoteSmokeCommand}`);
  }
  console.log("");
  console.log("Default mode is plan-only. Use --apply-setup --yes or --deploy --yes to touch remote Cloudflare resources.");
  console.log("After deploy, pass --smoke-url or set AGENT_PLATFORM_URL to verify the deployed Worker.");
}

async function runCommand(command) {
  console.log(`$ ${formatCommand(command)}`);
  const child = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${formatCommand(command)} failed with exit code ${code}`);
  }
}

async function runSetupCommand(command) {
  const commandText = formatCommand(command);
  if (commandText.includes("wrangler d1 create")) {
    const existingId = await findD1DatabaseId(config.d1DatabaseName);
    if (existingId) {
      updateWranglerBlockScalar("d1_databases", "database_id", existingId);
      console.log(`Reusing existing D1 database ${config.d1DatabaseName}: ${existingId}`);
      return;
    }
    await runCommand(command);
    const createdId = await findD1DatabaseId(config.d1DatabaseName);
    if (createdId) updateWranglerBlockScalar("d1_databases", "database_id", createdId);
    return;
  }

  if (commandText.includes("wrangler kv namespace create")) {
    const existingId = await findKvNamespaceId("CACHE");
    if (existingId) {
      updateWranglerBlockScalar("kv_namespaces", "id", existingId);
      console.log(`Reusing existing KV namespace CACHE: ${existingId}`);
      return;
    }
    await runCommand(command);
    const createdId = await findKvNamespaceId("CACHE");
    if (createdId) updateWranglerBlockScalar("kv_namespaces", "id", createdId);
    return;
  }

  if (commandText.includes("wrangler r2 bucket create") && await r2BucketExists(config.r2BucketName)) {
    console.log(`R2 bucket already exists: ${config.r2BucketName}`);
    return;
  }

  if (commandText.includes("wrangler vectorize create") && await vectorizeIndexExists(config.vectorizeIndexName)) {
    console.log(`Vectorize index already exists: ${config.vectorizeIndexName}`);
    return;
  }

  if (commandText.includes("wrangler queues create") && await queueExists(config.queueName)) {
    console.log(`Queue already exists: ${config.queueName}`);
    return;
  }

  await runCommand(command);
}

async function findD1DatabaseId(name) {
  const output = await runCommandCapture(["npx", "wrangler", "d1", "list", "--json"]);
  const databases = JSON.parse(output);
  return databases.find((database) => database.name === name)?.uuid;
}

async function findKvNamespaceId(title) {
  const output = await runCommandCapture(["npx", "wrangler", "kv", "namespace", "list"]);
  const namespaces = JSON.parse(output);
  return namespaces.find((namespace) => namespace.title === title)?.id;
}

async function r2BucketExists(name) {
  const output = await runCommandCapture(["npx", "wrangler", "r2", "bucket", "list"]);
  return new RegExp(`^name:\\s+${escapeRegExp(name)}$`, "m").test(output);
}

async function vectorizeIndexExists(name) {
  const output = await runCommandCapture(["npx", "wrangler", "vectorize", "list", "--json"]);
  const indexes = JSON.parse(output);
  return indexes.some((index) => index.name === name);
}

async function queueExists(name) {
  const output = await runCommandCapture(["npx", "wrangler", "queues", "list"]);
  return new RegExp(`│\\s+[^│]+\\s+│\\s+${escapeRegExp(name)}\\s+│`).test(output);
}

async function runCommandCapture(command) {
  const child = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code !== 0) {
    throw new Error(`${formatCommand(command)} failed with exit code ${code}:\n${output}`);
  }
  return output;
}

function updateWranglerBlockScalar(blockName, key, value) {
  const current = readFileSync(wranglerPath, "utf8");
  const escapedBlock = escapeRegExp(blockName);
  const escapedKey = escapeRegExp(key);
  const next = current.replace(
    new RegExp(`(^\\[\\[${escapedBlock}\\]\\]\\n[\\s\\S]*?^${escapedKey}\\s*=\\s*")[^"]+(")`, "m"),
    `$1${value}$2`
  );
  if (next === current) {
    throw new Error(`Could not update ${blockName}.${key} in wrangler.toml`);
  }
  writeFileSync(wranglerPath, next);
}

function requireYes() {
  if (!yes) {
    throw new Error("Remote Cloudflare commands require --yes. Re-run with --yes after reviewing the plan.");
  }
}

function createRemoteSmokeCommand(url, createRun) {
  const command = ["node", ".tmp/tsc/scripts/check-remote-worker.js", "--url", url];
  if (createRun) {
    command.push("--create-run", "--yes");
  }
  return command;
}

function formatCommand(command) {
  return command.map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" ");
}

function readArg(name) {
  const rawArgs = process.argv.slice(2);
  const index = rawArgs.indexOf(name);
  return index === -1 ? undefined : rawArgs[index + 1];
}

function normalizeUrl(value) {
  return value.trim().replace(/\/+$/, "");
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
