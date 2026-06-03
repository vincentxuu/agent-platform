import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getCloudflareArchitectureSummary } from "../../cloudflare/src/service-map.js";
import { createProviderReadinessChecks } from "../../runtime/src/provider-catalog.js";

export type LocalPlatformPaths = {
  cwd: string;
  port: number;
  webRoot: string;
  localStateDir: string;
  runStorePath: string;
  flowStorePath: string;
  configStorePath: string;
  apiGatewayStorePath: string;
  wranglerPath: string;
  migrationsDir: string;
  localSourcesPath: string;
  devVarsPath: string;
};

export function createLocalPlatformPaths(options: {
  cwd?: string;
  port?: number;
  localStateDir?: string;
  devVarsPath?: string;
} = {}): LocalPlatformPaths {
  const cwd = options.cwd || process.cwd();
  const port = Number(options.port || process.env.PORT || "8787");
  const localStateDir = options.localStateDir || process.env.LOCAL_STATE_DIR || join(cwd, ".local");

  return {
    cwd,
    port,
    webRoot: join(cwd, "apps/web/dist"),
    localStateDir,
    runStorePath: join(localStateDir, "agent-platform-runs.json"),
    flowStorePath: join(localStateDir, "agent-platform-flows.json"),
    configStorePath: join(localStateDir, "agent-platform-config.json"),
    apiGatewayStorePath: join(localStateDir, "agent-platform-api-gateway.json"),
    wranglerPath: join(cwd, "wrangler.toml"),
    migrationsDir: join(cwd, "packages/db/migrations"),
    localSourcesPath: join(cwd, "fixtures/local-research-sources.json"),
    devVarsPath: options.devVarsPath || process.env.DEV_VARS_PATH || join(cwd, ".dev.vars")
  };
}

export function loadLocalDevVars(devVarsPath: string, env: NodeJS.ProcessEnv = process.env) {
  if (!existsSync(devVarsPath)) return [];

  const loaded: string[] = [];
  const lines = readFileSync(devVarsPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseDevVarLine(line);
    if (!parsed) continue;
    if (env[parsed.key] === undefined) {
      env[parsed.key] = parsed.value;
      loaded.push(parsed.key);
    }
  }
  return loaded;
}

export function createLocalHealthReport(paths: LocalPlatformPaths) {
  return {
    ok: true,
    runtime: "local-dev",
    persistence: {
      driver: "file",
      path: paths.runStorePath
    },
    services: [
      { service: "Workers", role: "API surface simulated by local-dev-server" },
      { service: "D1", role: "In-memory repository replacement" },
      { service: "R2", role: "In-memory artifact replacement" },
      { service: "Workflows", role: "Timed local run progression" }
    ]
  };
}

export function createLocalReadinessReport(options: {
  paths: LocalPlatformPaths;
  loadedDevVars: string[];
  runCount: number;
  env?: Record<string, unknown>;
}) {
  const env = options.env || process.env;
  const resourceChecks = createLocalCloudflareResourceChecks(options.paths);
  const providerChecks = createProviderReadinessChecks(env, { localWorkersAiReady: true });

  return {
    runtime: "local-dev",
    usableNow: true,
    local: {
      server: `http://127.0.0.1:${options.paths.port}`,
      devVars: {
        path: options.paths.devVarsPath,
        loaded: options.loadedDevVars.length > 0,
        keys: options.loadedDevVars
      },
      persistence: {
        driver: "file",
        path: options.paths.runStorePath,
        ready: existsSync(options.paths.runStorePath),
        runCount: options.runCount
      }
    },
    cloudflare: {
      deployReady: resourceChecks.every((check) => check.ready),
      resources: resourceChecks,
      services: getCloudflareArchitectureSummary()
    },
    providers: {
      liveProviderReady: providerChecks.some((check) => check.ready),
      configured: providerChecks
    }
  };
}

export function createLocalCloudflareResourceChecks(paths: LocalPlatformPaths) {
  const wrangler = existsSync(paths.wranglerPath) ? readFileSync(paths.wranglerPath, "utf8") : "";
  const migrationCount = existsSync(paths.migrationsDir)
    ? readdirSync(paths.migrationsDir).filter((file) => file.endsWith(".sql")).length
    : 0;

  return [
    {
      id: "d1",
      name: "D1 database_id",
      ready: !wrangler.includes('database_id = "00000000-0000-0000-0000-000000000000"'),
      detail: "Replace the placeholder D1 database_id in wrangler.toml before real Cloudflare deploy."
    },
    {
      id: "kv",
      name: "KV namespace id",
      ready: !wrangler.includes('id = "00000000000000000000000000000000"'),
      detail: "Replace the placeholder KV namespace id in wrangler.toml before real Cloudflare deploy."
    },
    {
      id: "migrations",
      name: "D1 migrations",
      ready: migrationCount > 0,
      detail: `${migrationCount} SQL migration files detected.`
    },
    {
      id: "assets",
      name: "Workers Assets build",
      ready: existsSync(paths.webRoot),
      detail: existsSync(paths.webRoot) ? "apps/web/dist exists." : "Run npm run build:web before serving Workers Assets."
    }
  ];
}

function parseDevVarLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const equalsIndex = assignment.indexOf("=");
  if (equalsIndex <= 0) return undefined;
  const key = assignment.slice(0, equalsIndex).trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) return undefined;
  const value = stripInlineComment(assignment.slice(equalsIndex + 1).trim());
  return { key, value: unquoteDevVarValue(value) };
}

function stripInlineComment(value: string) {
  if (value.startsWith("\"") || value.startsWith("'")) return value;
  const hashIndex = value.indexOf("#");
  return hashIndex === -1 ? value.trim() : value.slice(0, hashIndex).trim();
}

function unquoteDevVarValue(value: string) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
