// Local dev ApiGatewayStore: clients/audit/usage persist to a JSON file in the
// state dir; short-window rate counters live in process memory (no D1/KV).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { webcrypto } from "node:crypto";
import type {
  ApiClientRecord,
  ApiClientUsage,
  ApiGatewayStore,
  AuditEntry
} from "../../runtime/src/api-gateway.js";

const crypto = webcrypto as unknown as Crypto;

type LocalGatewayState = {
  clients: ApiClientRecord[];
  audit: AuditEntry[];
  usage: Record<string, ApiClientUsage>; // key: `${clientId}:${windowKey}`
};

type ClientPatch = Partial<Pick<ApiClientRecord, "name" | "scopes" | "allowedFlows" | "rateLimit" | "budget" | "status">>;

function usageKey(clientId: string, windowKey: string): string {
  return `${clientId}:${windowKey}`;
}

export class LocalApiGatewayStore implements ApiGatewayStore {
  private storePath: string;
  private state: LocalGatewayState;
  private rateWindows = new Map<string, { count: number; expiresAt: number }>();

  constructor(storePath: string) {
    this.storePath = storePath;
    this.state = this.load();
  }

  private load(): LocalGatewayState {
    if (!existsSync(this.storePath)) {
      return { clients: [], audit: [], usage: {} };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf8")) as Partial<LocalGatewayState>;
      return {
        clients: Array.isArray(parsed.clients) ? parsed.clients : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
        usage: parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {}
      };
    } catch {
      return { clients: [], audit: [], usage: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(this.state, null, 2));
    renameSync(tempPath, this.storePath);
  }

  // --- ApiGatewayStore interface ---

  async getClientByPrefix(prefix: string): Promise<ApiClientRecord | undefined> {
    return this.state.clients.find((client) => client.keyPrefix === prefix);
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.state.audit.unshift(entry);
    this.state.audit = this.state.audit.slice(0, 500);
    this.persist();
  }

  async incrRateWindow(windowKey: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.rateWindows.get(windowKey);
    if (!existing || existing.expiresAt <= now) {
      const fresh = { count: 1, expiresAt: now + ttlSeconds * 1000 };
      this.rateWindows.set(windowKey, fresh);
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }

  async getUsage(clientId: string, windowKey: string): Promise<ApiClientUsage> {
    return this.state.usage[usageKey(clientId, windowKey)] || { costUsd: 0, tokens: 0, runs: 0 };
  }

  async addUsage(clientId: string, windowKey: string, delta: Partial<ApiClientUsage>): Promise<void> {
    const key = usageKey(clientId, windowKey);
    const current = this.state.usage[key] || { costUsd: 0, tokens: 0, runs: 0 };
    this.state.usage[key] = {
      costUsd: current.costUsd + (delta.costUsd || 0),
      tokens: current.tokens + (delta.tokens || 0),
      runs: current.runs + (delta.runs || 0)
    };
    this.persist();
  }

  // --- Admin CRUD helpers ---

  listClients(): ApiClientRecord[] {
    return [...this.state.clients].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getClientById(id: string): ApiClientRecord | undefined {
    return this.state.clients.find((client) => client.id === id);
  }

  insertClient(client: ApiClientRecord): ApiClientRecord {
    this.state.clients.push(client);
    this.persist();
    return client;
  }

  updateClient(id: string, patch: ClientPatch): ApiClientRecord | undefined {
    const existing = this.getClientById(id);
    if (!existing) return undefined;
    existing.name = patch.name ?? existing.name;
    existing.scopes = patch.scopes ?? existing.scopes;
    existing.allowedFlows = patch.allowedFlows ?? existing.allowedFlows;
    existing.rateLimit = patch.rateLimit ?? existing.rateLimit;
    existing.budget = patch.budget ?? existing.budget;
    existing.status = patch.status ?? existing.status;
    this.persist();
    return existing;
  }

  touchClient(id: string, ts: string): void {
    const existing = this.getClientById(id);
    if (existing) {
      existing.lastUsedAt = ts;
      this.persist();
    }
  }

  listAudit(clientId: string, limit = 50): AuditEntry[] {
    return this.state.audit.filter((entry) => entry.clientId === clientId).slice(0, limit);
  }

  getUsageSnapshot(clientId: string, windowKey: string): ApiClientUsage {
    return this.state.usage[usageKey(clientId, windowKey)] || { costUsd: 0, tokens: 0, runs: 0 };
  }

  newClientId(): string {
    return `client_${crypto.randomUUID()}`;
  }

  newAuditId(): string {
    return `audit_${crypto.randomUUID()}`;
  }
}
