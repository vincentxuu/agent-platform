// HTTP- and storage-agnostic gateway core for the public /v1 API.
//
// The core never imports HTTP frameworks or storage drivers. Backends inject an
// ApiGatewayStore implementation (D1+KV for the Worker, JSON+in-memory for the
// local dev server) and translate GatewayDecision into HTTP responses.

export type ApiScope =
  | "runs:write"
  | "runs:read"
  | "artifacts:read"
  | "evidence:read"
  | "flows:read";

export type ApiClientStatus = "active" | "revoked";

export type ApiClientRateLimit = {
  requestsPerMin?: number;
  runsPerDay?: number;
};

export type ApiClientBudget = {
  maxCostUsd?: number;
  maxTokens?: number;
  window?: "monthly";
};

export type ApiClientRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  status: ApiClientStatus;
  scopes: ApiScope[];
  allowedFlows: string[];
  rateLimit: ApiClientRateLimit;
  budget: ApiClientBudget;
  createdAt: string;
  lastUsedAt?: string;
};

// Public (non-secret) projection of a client, safe to return from admin APIs.
export type ApiClientPublic = Omit<ApiClientRecord, "keyHash">;

export type ApiClientUsage = {
  costUsd: number;
  tokens: number;
  runs: number;
};

export type RateWindowKind = "requestsPerMin" | "runsPerDay";

export type AuditEntry = {
  id: string;
  clientId?: string;
  ts: string;
  method: string;
  path: string;
  runId?: string;
  statusCode: number;
  outcome: string; // allow | deny:<reason>
  costUsd: number;
  tokens: number;
};

export interface ApiGatewayStore {
  // Resolve a client by its public key prefix (e.g. ak_live_9f3c).
  getClientByPrefix(prefix: string): Promise<ApiClientRecord | undefined>;
  // Persist an audit entry.
  recordAudit(entry: AuditEntry): Promise<void>;
  // Increment a short-window rate counter and return the new count.
  // windowKey identifies the bucket (client + kind + time bucket); ttlSeconds is
  // how long the counter should live (window length).
  incrRateWindow(windowKey: string, ttlSeconds: number): Promise<number>;
  // Current period usage for a client (budget window).
  getUsage(clientId: string, windowKey: string): Promise<ApiClientUsage>;
  // Attribute additional usage to a client for the current period.
  addUsage(clientId: string, windowKey: string, delta: Partial<ApiClientUsage>): Promise<void>;
}

export type GatewayRequest = {
  method: string;
  path: string;
  authorization?: string;
  requiredScope: ApiScope;
  // Only present for POST /v1/runs.
  flowId?: string;
  // Whether this request counts against the runsPerDay budget (run creation).
  countsAsRun?: boolean;
  now?: Date;
};

export type RateLimitHeaders = {
  "X-RateLimit-Limit"?: string;
  "X-RateLimit-Remaining"?: string;
  "X-RateLimit-Reset"?: string;
  "Retry-After"?: string;
};

// Flat shape (not a discriminated union) so callers work without
// strictNullChecks-based narrowing. On allow, `client` is set and the
// error/code/statusCode/reason fields are absent.
export type GatewayDecision = {
  allowed: boolean;
  client?: ApiClientRecord;
  headers: RateLimitHeaders;
  statusCode?: number;
  error?: string;
  code?: string;
  reason?: string;
};

export const API_SCOPES: ApiScope[] = [
  "runs:write",
  "runs:read",
  "artifacts:read",
  "evidence:read",
  "flows:read"
];

const KEY_PREFIX_NAMESPACE = "ak_live_";

// --- Key generation / hashing -------------------------------------------------

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// Generate a fresh API key. Returns the plaintext (returned to the caller once)
// plus the stored prefix and SHA-256 hash. The prefix embeds enough randomness
// to look up the record without exposing the secret.
export async function generateApiKey(): Promise<{ plaintext: string; keyPrefix: string; keyHash: string }> {
  const prefixToken = randomHex(4); // 8 hex chars
  const secret = randomHex(24); // 48 hex chars
  const keyPrefix = `${KEY_PREFIX_NAMESPACE}${prefixToken}`;
  const plaintext = `${keyPrefix}_${secret}`;
  const keyHash = await sha256Hex(plaintext);
  return { plaintext, keyPrefix, keyHash };
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// Extract the lookup prefix from a presented bearer token. The token shape is
// ak_live_<prefixToken>_<secret>; the prefix used for lookup is the first two
// underscore-delimited segments after the namespace (ak_live_<prefixToken>).
export function extractKeyPrefix(token: string): string | undefined {
  if (!token.startsWith(KEY_PREFIX_NAMESPACE)) return undefined;
  const rest = token.slice(KEY_PREFIX_NAMESPACE.length);
  const prefixToken = rest.split("_")[0];
  if (!prefixToken) return undefined;
  return `${KEY_PREFIX_NAMESPACE}${prefixToken}`;
}

export function parseBearer(authorization?: string): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : undefined;
}

// --- Time-window helpers ------------------------------------------------------

export function monthlyWindowKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function minuteBucket(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function dayBucket(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function secondsUntilNextMinute(date: Date): number {
  return 60 - date.getUTCSeconds();
}

function secondsUntilNextDay(date: Date): number {
  const endOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0);
  return Math.max(1, Math.ceil((endOfDay - date.getTime()) / 1000));
}

// --- Pure decision helpers (unit-testable without a store) --------------------

export function hasScope(client: ApiClientRecord, scope: ApiScope): boolean {
  return client.scopes.includes(scope);
}

export function isFlowAllowed(client: ApiClientRecord, flowId: string): boolean {
  // Empty allow-list means every flow within scope is permitted.
  if (!client.allowedFlows || client.allowedFlows.length === 0) return true;
  return client.allowedFlows.includes(flowId);
}

export function isBudgetExceeded(usage: ApiClientUsage, budget: ApiClientBudget): boolean {
  if (typeof budget.maxCostUsd === "number" && usage.costUsd >= budget.maxCostUsd) return true;
  if (typeof budget.maxTokens === "number" && usage.tokens >= budget.maxTokens) return true;
  return false;
}

function denyResponse(
  statusCode: number,
  error: string,
  code: string,
  reason: string,
  headers: RateLimitHeaders = {},
  client?: ApiClientRecord
): GatewayDecision {
  return { allowed: false, statusCode, error, code, reason, headers, client };
}

// --- Main authorization pipeline ----------------------------------------------

export async function authorizeRequest(store: ApiGatewayStore, request: GatewayRequest): Promise<GatewayDecision> {
  const now = request.now ?? new Date();

  // 1. Resolve key + compare hash.
  const token = parseBearer(request.authorization);
  if (!token) {
    return denyResponse(401, "Missing or invalid API key", "unauthorized", "missing_key");
  }
  const prefix = extractKeyPrefix(token);
  if (!prefix) {
    return denyResponse(401, "Missing or invalid API key", "unauthorized", "malformed_key");
  }
  const client = await store.getClientByPrefix(prefix);
  if (!client) {
    return denyResponse(401, "Missing or invalid API key", "unauthorized", "unknown_key");
  }
  const presentedHash = await sha256Hex(token);
  if (presentedHash !== client.keyHash) {
    return denyResponse(401, "Missing or invalid API key", "unauthorized", "hash_mismatch");
  }

  // 2. Revoked keys are treated as invalid.
  if (client.status !== "active") {
    return denyResponse(401, "Missing or invalid API key", "unauthorized", "revoked", {}, client);
  }

  // 3. Scope check.
  if (!hasScope(client, request.requiredScope)) {
    return denyResponse(403, `Missing required scope: ${request.requiredScope}`, "forbidden", `scope:${request.requiredScope}`, {}, client);
  }

  // 4. Flow allow-list (only for run creation).
  if (request.flowId !== undefined && !isFlowAllowed(client, request.flowId)) {
    return denyResponse(403, `Flow is not allowed for this key: ${request.flowId}`, "forbidden", `flow:${request.flowId}`, {}, client);
  }

  // 5. Rate limit (per-minute request count + per-day run count).
  const rateHeaders: RateLimitHeaders = {};
  const requestsPerMin = client.rateLimit?.requestsPerMin;
  if (typeof requestsPerMin === "number" && requestsPerMin > 0) {
    const windowKey = `rate:${client.id}:rpm:${minuteBucket(now)}`;
    const ttl = secondsUntilNextMinute(now);
    const count = await store.incrRateWindow(windowKey, ttl);
    const remaining = Math.max(0, requestsPerMin - count);
    rateHeaders["X-RateLimit-Limit"] = String(requestsPerMin);
    rateHeaders["X-RateLimit-Remaining"] = String(remaining);
    rateHeaders["X-RateLimit-Reset"] = String(ttl);
    if (count > requestsPerMin) {
      rateHeaders["Retry-After"] = String(ttl);
      return denyResponse(429, "Rate limit exceeded", "rate_limited", "requests_per_min", rateHeaders, client);
    }
  }

  const runsPerDay = client.rateLimit?.runsPerDay;
  if (request.countsAsRun && typeof runsPerDay === "number" && runsPerDay > 0) {
    const windowKey = `rate:${client.id}:rpd:${dayBucket(now)}`;
    const ttl = secondsUntilNextDay(now);
    const count = await store.incrRateWindow(windowKey, ttl);
    if (count > runsPerDay) {
      rateHeaders["Retry-After"] = String(ttl);
      return denyResponse(429, "Daily run limit exceeded", "rate_limited", "runs_per_day", rateHeaders, client);
    }
  }

  // 6. Budget check against current period usage. Only run-creating requests
  // consume budget, so read-only requests (status/artifact/evidence polls) are
  // exempt — a client that blew its budget can still retrieve already-paid-for
  // results.
  const budget = client.budget || {};
  if (request.countsAsRun && (typeof budget.maxCostUsd === "number" || typeof budget.maxTokens === "number")) {
    const usage = await store.getUsage(client.id, monthlyWindowKey(now));
    if (isBudgetExceeded(usage, budget)) {
      return denyResponse(402, "Budget exceeded", "budget_exceeded", "budget", rateHeaders, client);
    }
  }

  return { allowed: true, client, headers: rateHeaders };
}

// Attribute settled cost/tokens for a completed run to the owning client.
export async function attributeRunUsage(
  store: ApiGatewayStore,
  clientId: string,
  usage: Partial<ApiClientUsage>,
  now: Date = new Date()
): Promise<void> {
  await store.addUsage(clientId, monthlyWindowKey(now), {
    costUsd: usage.costUsd || 0,
    tokens: usage.tokens || 0,
    runs: usage.runs || 0
  });
}

// --- Normalization helpers for admin input -----------------------------------

export function normalizeScopes(input: unknown): ApiScope[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(API_SCOPES);
  const out: ApiScope[] = [];
  for (const item of input) {
    if (typeof item === "string" && valid.has(item) && !out.includes(item as ApiScope)) {
      out.push(item as ApiScope);
    }
  }
  return out;
}

export function normalizeAllowedFlows(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === "string" && item.trim() && !out.includes(item.trim())) {
      out.push(item.trim().slice(0, 64));
    }
  }
  return out.slice(0, 100);
}

export function normalizeRateLimit(input: unknown): ApiClientRateLimit {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rateLimit: ApiClientRateLimit = {};
  if (Number.isFinite(Number(source.requestsPerMin)) && Number(source.requestsPerMin) > 0) {
    rateLimit.requestsPerMin = Math.floor(Number(source.requestsPerMin));
  }
  if (Number.isFinite(Number(source.runsPerDay)) && Number(source.runsPerDay) > 0) {
    rateLimit.runsPerDay = Math.floor(Number(source.runsPerDay));
  }
  return rateLimit;
}

export function normalizeBudget(input: unknown): ApiClientBudget {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const budget: ApiClientBudget = { window: "monthly" };
  if (Number.isFinite(Number(source.maxCostUsd)) && Number(source.maxCostUsd) > 0) {
    budget.maxCostUsd = Number(source.maxCostUsd);
  }
  if (Number.isFinite(Number(source.maxTokens)) && Number(source.maxTokens) > 0) {
    budget.maxTokens = Math.floor(Number(source.maxTokens));
  }
  return budget;
}

export function toPublicClient(client: ApiClientRecord): ApiClientPublic {
  const { keyHash, ...rest } = client;
  return rest;
}
