import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

type RunStatus = "queued" | "running" | "complete" | "failed" | "canceled";

type TimelineItem = {
  stepId: string;
  status: string;
  attempt: number;
};

type EvidenceItem = {
  claim: string;
  source: string;
  sourceTitle: string;
  sourceUrl: string;
  excerpt: string;
  confidence: string;
  conflicts: string;
  review?: {
    status: string;
    note: string;
    updatedAt: string;
  };
};

type ArtifactItem = {
  id: string;
  name: string;
  type: string;
  version?: number;
  content?: unknown;
  downloadUrl: string;
  versions?: Array<unknown>;
};

type RunView = {
  id: string;
  flowId: string;
  presetId: string;
  status: RunStatus;
  currentStepId: string;
  topic: string;
  audience: string;
  freshnessDays: number;
  createdAt: string;
  updatedAt: string;
  timeline: TimelineItem[];
  evidence: EvidenceItem[];
  artifacts: ArtifactItem[];
  detail: Record<string, unknown>;
};

type ManagementConfig = {
  flow: {
    defaultPreset: string;
    defaultAudience: string;
    defaultFreshnessDays: number;
  };
  policy: {
    maxCostUsd: number;
    maxIterations: number;
    citationRequired: boolean;
    allowedProviders: string[];
  };
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    credentialRef: string;
    models: string[];
    activeModel: string;
  }>;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    activeVersion: string;
    availableVersions: string[];
    permissions: string[];
    evals: string[];
    source: string;
  }>;
};

export function App() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [topic, setTopic] = useState("代理工作流編排");
  const [audience, setAudience] = useState("工程管理者");
  const [freshnessDays, setFreshnessDays] = useState(365);
  const [presetId, setPresetId] = useState("standard");
  const [runError, setRunError] = useState("");

  const health = useApiQuery(["health"], "/api/health", { refetchInterval: 15_000 });
  const readiness = useApiQuery(["readiness"], "/api/readiness", { refetchInterval: 15_000 });
  const config = useApiQuery(["config"], "/api/config");
  const skills = useApiQuery(["skills"], "/api/skills");
  const runs = useApiQuery(["runs"], "/api/runs", { refetchInterval: 3_000 });
  const selectedRun = useApiQuery(["run", selectedRunId], selectedRunId ? `/api/runs/${selectedRunId}` : undefined, {
    refetchInterval: (query) => {
      const data = query.state.data as { run?: RunView } | undefined;
      const status = data?.run?.status;
      return status === "running" || status === "queued" ? 1200 : false;
    }
  });
  const observability = useApiQuery(
    ["observability", selectedRunId],
    selectedRunId ? `/api/runs/${selectedRunId}/observability` : undefined,
    { refetchInterval: selectedRun.data?.run?.status === "running" ? 2_000 : false }
  );

  const activeRun: RunView | undefined = selectedRun.data?.run ?? runs.data?.runs?.[0];
  const activeConfig: ManagementConfig | undefined = config.data?.config;

  useEffect(() => {
    if (activeConfig) {
      setAudience((current) => current || activeConfig.flow.defaultAudience);
      setFreshnessDays(activeConfig.flow.defaultFreshnessDays);
      setPresetId(activeConfig.flow.defaultPreset);
    }
  }, [activeConfig]);

  useEffect(() => {
    if (!selectedRunId && runs.data?.runs?.[0]?.id) {
      setSelectedRunId(runs.data.runs[0].id);
    }
  }, [runs.data, selectedRunId]);

  const startRun = useMutation({
    mutationFn: () => apiPost("/api/runs", {
      presetId,
      inputs: {
        topic,
        audience,
        freshness_days: freshnessDays
      }
    }),
    onSuccess: async (payload) => {
      setRunError("");
      const runId = payload?.run?.id;
      if (runId) setSelectedRunId(runId);
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      if (runId) await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    onError: (error) => setRunError(error instanceof Error ? error.message : t("run.startFailed"))
  });

  const retryRun = useRunAction(selectedRunId, `/api/runs/${selectedRunId}/retry-step`);
  const cancelRun = useRunAction(selectedRunId, `/api/runs/${selectedRunId}/cancel`);
  const clearRuns = useMutation({
    mutationFn: () => apiDelete("/api/runs"),
    onSuccess: async () => {
      setSelectedRunId(undefined);
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });

  const policySummary = useMemo(() => ({
    runtime: health.data?.runtime || "unknown",
    usableNow: readiness.data?.usableNow,
    liveProviderReady: readiness.data?.providers?.liveProviderReady,
    policy: activeConfig?.policy,
    providers: activeConfig?.providers?.filter((provider) => provider.enabled).map((provider) => `${provider.name}:${provider.activeModel}`)
  }), [activeConfig, health.data, readiness.data]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <h1>Agent Platform</h1>
        <nav>
          <a href="#run">{t("nav.run")}</a>
          <a href="#timeline">{t("nav.timeline")}</a>
          <a href="#observability">{t("nav.observability")}</a>
          <a href="#context">{t("nav.context")}</a>
          <a href="#evidence">{t("nav.evidence")}</a>
          <a href="#artifacts">{t("nav.artifacts")}</a>
          <a href="#manage">{t("nav.manage")}</a>
        </nav>
        <label className="language-switcher">
          {t("language.label")}
          <select value={i18n.resolvedLanguage || i18n.language} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
            <option value="zh-Hant">{t("language.zhHant")}</option>
            <option value="en">{t("language.en")}</option>
          </select>
        </label>
      </aside>

      <section className="workspace">
        <section id="run" className="panel">
          <div className="panel-heading">
            <div>
              <h2>{t("run.title")}</h2>
              <p className="muted">{t("run.subtitle")}</p>
            </div>
            <span id="runtime-status" className="status">{runtimeLabel(health.data?.runtime, t)}</span>
          </div>
          <form className="run-form" onSubmit={(event) => {
            event.preventDefault();
            startRun.mutate();
          }}>
            <label>
              {t("run.flow")}
              <select id="flow-select" value="deep_research" disabled>
                <option value="deep_research">{t("run.flowDeepResearch")}</option>
              </select>
            </label>
            <label>
              {t("run.topic")}
              <input id="topic-input" value={topic} onChange={(event) => setTopic(event.target.value)} />
            </label>
            <label>
              {t("run.audience")}
              <input id="audience-input" value={audience} onChange={(event) => setAudience(event.target.value)} />
            </label>
            <label>
              {t("run.freshnessDays")}
              <input
                id="freshness-input"
                type="number"
                min="1"
                step="1"
                value={freshnessDays}
                onChange={(event) => setFreshnessDays(Number(event.target.value))}
              />
            </label>
            <label>
              {t("run.preset")}
              <select id="preset-select" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                <option value="quick">{t("run.quick")}</option>
                <option value="standard">{t("run.standard")}</option>
                <option value="deep">{t("run.deep")}</option>
              </select>
            </label>
            <button type="submit" disabled={startRun.isPending}>{startRun.isPending ? t("run.starting") : t("run.start")}</button>
          </form>
          {runError ? <div className="error-box">{runError}</div> : null}
          <pre className="summary">{JSON.stringify(policySummary, null, 2)}</pre>
          <div className="subsection">
            <div className="panel-heading compact">
              <h3>{t("run.recentRuns")}</h3>
              <button type="button" className="secondary" onClick={() => clearRuns.mutate()} disabled={clearRuns.isPending}>{t("run.clear")}</button>
            </div>
            <RunHistory runs={runs.data?.runs || []} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
          </div>
        </section>

        <section id="timeline" className="panel">
          <div className="panel-heading">
            <h2>{t("timeline.title")}</h2>
            <div className="button-row">
              <button type="button" onClick={() => retryRun.mutate({})} disabled={!selectedRunId || retryRun.isPending}>{t("timeline.retry")}</button>
              <button type="button" className="secondary" onClick={() => cancelRun.mutate({})} disabled={!selectedRunId || cancelRun.isPending}>{t("timeline.cancel")}</button>
            </div>
          </div>
          <Timeline run={activeRun} />
          <pre className="summary">{JSON.stringify(activeRun?.detail || { status: "idle" }, null, 2)}</pre>
        </section>

        <section id="context" className="panel">
          <h2>{t("context.title")}</h2>
          <div className="grid">
            {(activeRun?.detail?.contextBlocks as Array<Record<string, unknown>> | undefined || fallbackContextBlocks()).map((item, index) => (
              <InfoCard key={index} title={String(item.type || item.source || `context-${index + 1}`)} meta={`${item.tokens || "-"} tokens`} body={String(item.source || item.detail || t("context.runtimeContext"))} />
            ))}
          </div>
        </section>

        <section id="observability" className="panel">
          <h2>{t("observability.title")}</h2>
          <Observability report={observability.data?.observability} />
        </section>

        <section id="evidence" className="panel">
          <h2>{t("evidence.title")}</h2>
          <Evidence runId={activeRun?.id} evidence={activeRun?.evidence || []} />
        </section>

        <section id="artifacts" className="panel">
          <h2>{t("artifacts.title")}</h2>
          <Artifacts runId={activeRun?.id} artifacts={activeRun?.artifacts || []} />
        </section>

        <section id="manage" className="panel">
          <h2>{t("manage.title")}</h2>
          <Management config={activeConfig} readiness={readiness.data} skills={skills.data} />
        </section>
      </section>
    </main>
  );
}

function RunHistory({ runs, selectedRunId, onSelect }: { runs: RunView[]; selectedRunId?: string; onSelect: (runId: string) => void }) {
  const { t } = useTranslation();
  if (runs.length === 0) return <div className="empty">{t("run.noRuns")}</div>;
  return (
    <div className="run-history">
      {runs.map((run) => (
        <button key={run.id} type="button" className={run.id === selectedRunId ? "history-item active" : "history-item"} onClick={() => onSelect(run.id)}>
          <strong>{run.topic}</strong>
          <span>{t(`statuses.${run.status}`, run.status)} · {run.presetId} · {new Date(run.createdAt).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function Timeline({ run }: { run?: RunView }) {
  const { t } = useTranslation();
  const timeline = run?.timeline || [];
  if (timeline.length === 0) return <ol className="timeline"><li className="waiting">{t("timeline.waitingForRun")}</li></ol>;
  return (
    <ol className="timeline">
      {timeline.map((item) => (
        <li key={item.stepId} className={item.status}>
          <strong>{t(`steps.${item.stepId}`, item.stepId)}</strong>
          <span>{t(`statuses.${item.status}`, item.status)} · {t("timeline.attempt")} {item.attempt}</span>
        </li>
      ))}
    </ol>
  );
}

function Observability({ report }: { report?: Record<string, any> }) {
  const { t } = useTranslation();
  const metrics = report?.metrics || {};
  const providerCalls = report?.providerCalls || [];
  const toolInvocations = report?.toolInvocations || [];
  return (
    <div className="grid">
      <InfoCard title={t("observability.providerCalls")} meta={String(metrics.providerCallCount || 0)} body={`${t("observability.tokens")} ${metrics.totalTokens || 0} · ${t("observability.cost")} $${metrics.totalCostUsd || 0}`} />
      <InfoCard title={t("observability.toolInvocations")} meta={String(metrics.toolInvocationCount || 0)} body={`${t("observability.latency")} ${metrics.totalLatencyMs || 0}ms · ${t("observability.retries")} ${metrics.retryCount || 0}`} />
      {[...providerCalls, ...toolInvocations].slice(0, 6).map((item: Record<string, unknown>) => (
        <InfoCard key={String(item.id)} title={String(item.provider || item.tool)} meta={String(item.status)} body={`${t("observability.step")} ${item.stepId} · $${item.costUsd || 0}`} />
      ))}
    </div>
  );
}

function Evidence({ runId, evidence }: { runId?: string; evidence: EvidenceItem[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: ({ index, status }: { index: number; status: string }) => apiPatch(`/api/runs/${runId}/evidence/${index}`, { status, note: t("evidence.reviewedNote") }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["run", runId] })
  });

  if (!runId) return <div className="empty">{t("evidence.selectRun")}</div>;
  if (evidence.length === 0) return <div className="empty">{t("evidence.empty")}</div>;
  return (
    <div className="grid">
      {evidence.map((item, index) => (
        <article className="card" key={`${item.source}-${index}`}>
          <div className="card-heading">
            <h3>{item.sourceTitle || item.source}</h3>
            <span className="status">{item.confidence}</span>
          </div>
          <p>{item.claim}</p>
          <p className="muted">{item.excerpt}</p>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a>
          <div className="button-row">
            {["accepted", "watch", "rejected"].map((status) => (
              <button key={status} type="button" className="secondary" onClick={() => review.mutate({ index, status })}>{status}</button>
            ))}
          </div>
          {item.review ? <small>{t("evidence.review")}: {item.review.status} · {item.review.note}</small> : null}
        </article>
      ))}
    </div>
  );
}

function Artifacts({ runId, artifacts }: { runId?: string; artifacts: ArtifactItem[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const regenerate = useMutation({
    mutationFn: () => apiPost(`/api/runs/${runId}/artifacts/regenerate`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["run", runId] })
  });

  if (!runId) return <div className="empty">{t("artifacts.selectRun")}</div>;
  return (
    <>
      <div className="button-row section-actions">
        <button type="button" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>{t("artifacts.regenerate")}</button>
      </div>
      <div className="grid">
        {artifacts.length === 0 ? <div className="empty">{t("artifacts.empty")}</div> : artifacts.map((artifact) => (
          <article className="card" key={artifact.id}>
            <div className="card-heading">
              <h3>{artifact.name}</h3>
              <span className="status">{artifact.type} v{artifact.version || 1}</span>
            </div>
            <pre className="summary compact">{JSON.stringify(artifact.content || artifact, null, 2)}</pre>
            <div className="button-row">
              <a className="button-link" href={artifact.downloadUrl}>{t("artifacts.download")}</a>
              <ArtifactVersionButton runId={runId} artifactId={artifact.id} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ArtifactVersionButton({ runId, artifactId }: { runId: string; artifactId: string }) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<string>("");
  return (
    <>
      <button type="button" className="secondary" onClick={async () => {
        const payload = await apiGet(`/api/runs/${runId}/artifacts/${artifactId}/diff`).catch((error) => ({ error: error.message }));
        setDiff(JSON.stringify(payload.diff || payload, null, 2));
      }}>{t("artifacts.diff")}</button>
      {diff ? <pre className="summary compact">{diff}</pre> : null}
    </>
  );
}

function Management({ config, readiness, skills }: { config?: ManagementConfig; readiness?: Record<string, any>; skills?: Record<string, any> }) {
  const { t } = useTranslation();
  if (!config) return <div className="empty">{t("manage.loading")}</div>;
  return (
    <div className="management">
      <article className="card">
        <h3>{t("manage.openSourceRuntime")}</h3>
        <p>{t("manage.localUsable")}：{String(readiness?.usableNow)} · {t("manage.cloudflareDeployReady")}：{String(readiness?.cloudflare?.deployReady)}</p>
      </article>
      <article className="card">
        <h3>{t("manage.providers")}</h3>
        <div className="provider-list">
          {config.providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} allowed={config.policy.allowedProviders.includes(provider.id)} />
          ))}
        </div>
      </article>
      <article className="card">
        <h3>{t("manage.skillVersions")}</h3>
        <div className="grid tight">
          {(skills?.skills || config.skills).map((skill: ManagementConfig["skills"][number]) => (
            <InfoCard key={skill.id} title={skill.name} meta={`${skill.activeVersion} · ${skill.source}`} body={skill.description} />
          ))}
        </div>
      </article>
    </div>
  );
}

function ProviderRow({ provider, allowed }: { provider: ManagementConfig["providers"][number]; allowed: boolean }) {
  const { t } = useTranslation();
  const [result, setResult] = useState("");
  return (
    <div className="provider-row">
      <strong>{provider.name}</strong>
      <span>{provider.enabled ? t("manage.enabled") : t("manage.disabled")} · {allowed ? t("manage.policyAllowed") : t("manage.blocked")}</span>
      <span>{provider.activeModel}</span>
      <code>{provider.credentialRef}</code>
      <button type="button" className="secondary" onClick={async () => {
        setResult(t("manage.testing"));
        const payload = await apiPost(`/api/providers/${provider.id}/test`, {}).catch((error) => ({ detail: error.message }));
        setResult(payload.ready ? t("manage.ready", { model: payload.activeModel }) : t("manage.notReady", { detail: payload.detail || payload.error }));
      }}>{t("manage.test")}</button>
      {result ? <small className="provider-test-result">{result}</small> : null}
    </div>
  );
}

function InfoCard({ title, meta, body }: { title: string; meta?: string; body: string }) {
  return (
    <article className="card">
      <div className="card-heading">
        <h3>{title}</h3>
        {meta ? <span className="status">{meta}</span> : null}
      </div>
      <p>{body}</p>
    </article>
  );
}

function useRunAction(runId: string | undefined, path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost(path, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      if (runId) await queryClient.invalidateQueries({ queryKey: ["run", runId] });
    }
  });
}

function useApiQuery<TData = any>(queryKey: unknown[], path?: string, options: Record<string, unknown> = {}) {
  return useQuery({
    queryKey,
    queryFn: () => apiGet<TData>(path || ""),
    enabled: Boolean(path),
    ...options
  });
}

async function apiGet<TPayload = any>(path: string): Promise<TPayload> {
  const response = await fetch(path);
  return readResponse(response);
}

async function apiPost<TPayload = any>(path: string, body: Record<string, unknown>): Promise<TPayload> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return readResponse(response);
}

async function apiPatch<TPayload = any>(path: string, body: Record<string, unknown>): Promise<TPayload> {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return readResponse(response);
}

async function apiDelete<TPayload = any>(path: string): Promise<TPayload> {
  const response = await fetch(path, { method: "DELETE" });
  return readResponse(response);
}

async function readResponse<TPayload = any>(response: Response): Promise<TPayload> {
  const contentType = response.headers.get("content-type") || "";
  const payload: any = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? `\n${payload.details.map((item: string) => `- ${item}`).join("\n")}` : "";
    throw new Error(`${payload.error || response.statusText}${details}`);
  }
  return payload as TPayload;
}

function runtimeLabel(runtime: string | undefined, t: (key: string) => string) {
  if (runtime === "cloudflare") return t("runtime.cloudflare");
  if (runtime === "local-dev") return t("runtime.local");
  return t("runtime.offline");
}

function fallbackContextBlocks() {
  return [
    { type: "instructions", tokens: 84, source: "system" },
    { type: "skill_guidance", tokens: 120, source: "research-planner@1.0.0" },
    { type: "tool_descriptions", tokens: 64, source: "search.web" },
    { type: "retrieval_evidence", tokens: 420, source: "selected sources" }
  ];
}
