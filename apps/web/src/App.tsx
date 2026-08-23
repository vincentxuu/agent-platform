import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, Boxes, CheckCircle2, CirclePlay, FileOutput, FileText, Gauge, History, KeyRound, Layers3, Plus, Search, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

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
  alphaXivUrl?: string;
  arxivId?: string;
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

type FlowSummary = {
  id: string;
  name: string;
  description?: string;
  status: string;
  source?: string;
  version: number;
  hasDraft?: boolean;
  presets: Array<{ id: string; name: string }>;
  steps: Array<{ id: string; type: string; skill?: string; providerRole?: string; providerId?: string; model?: string }>;
  artifacts: Array<{ id: string; type: string }>;
  definition?: Record<string, unknown>;
  draft?: Record<string, unknown>;
  updatedAt?: string;
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
  policies?: Array<{
    id: string;
    name: string;
    status: string;
    version: number;
    draft: {
      maxCostUsd: number;
      maxIterations: number;
      citationRequired: boolean;
      allowedProviders: string[];
    };
  }>;
  improvementProposals?: Array<{
    id: string;
    type: string;
    status: string;
    summary: string;
    evalCase: {
      id: string;
      status: string;
    };
    createdAt: string;
  }>;
  providers: Array<{
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    credentialRef: string;
    credentialConfigured?: boolean;
    credentialSource?: string;
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

type ManagedProvider = ManagementConfig["providers"][number];

const stepStarterCards = [
  { id: "search", icon: Search, type: "tool_group", providerRole: "search", skill: "", labelKey: "searchStep", detailKey: "searchStepDetail" },
  { id: "read", icon: BookOpen, type: "tool_group", providerRole: "reader", skill: "", labelKey: "readStep", detailKey: "readStepDetail" },
  { id: "extract", icon: Sparkles, type: "agent", providerRole: "", skill: "citation-extractor@1.0.0", labelKey: "extractStep", detailKey: "extractStepDetail" },
  { id: "summarize", icon: FileText, type: "agent", providerRole: "", skill: "report-synthesizer@1.0.0", labelKey: "summarizeStep", detailKey: "summarizeStepDetail" },
  { id: "verify", icon: CheckCircle2, type: "verifier", providerRole: "", skill: "", labelKey: "verifyStep", detailKey: "verifyStepDetail" },
  { id: "export", icon: FileOutput, type: "artifact", providerRole: "", skill: "", labelKey: "exportStep", detailKey: "exportStepDetail" }
] as const;

const artifactStarterCards = [
  { id: "markdown_report", type: "markdown_report", labelKey: "markdownReport", detailKey: "markdownReportDetail" },
  { id: "evidence_bundle", type: "json_evidence_bundle", labelKey: "evidenceBundle", detailKey: "evidenceBundleDetail" }
] as const;

const stepSkillOptions = [
  { value: "", labelKey: "noneOption" },
  { value: "research-planner@1.0.0", labelKey: "researchPlannerSkill" },
  { value: "source-ranker@1.0.0", labelKey: "sourceRankerSkill" },
  { value: "citation-extractor@1.0.0", labelKey: "citationExtractorSkill" },
  { value: "report-synthesizer@1.0.0", labelKey: "reportSynthesizerSkill" },
  { value: "__custom__", labelKey: "customOption" }
] as const;

const providerRoleOptions = [
  { value: "", labelKey: "noneOption" },
  { value: "llm", labelKey: "llmRole" },
  { value: "search", labelKey: "searchRole" },
  { value: "reader", labelKey: "readerRole" },
  { value: "artifact", labelKey: "artifactRole" },
  { value: "__custom__", labelKey: "customOption" }
] as const;

const navGroups = [
  {
    key: "workspace",
    items: [
      { id: "run", key: "run", badge: "01", icon: CirclePlay },
      { id: "define", key: "define", badge: "02", icon: Layers3 }
    ]
  },
  {
    key: "operations",
    items: [
      { id: "timeline", key: "timeline", badge: "03", icon: History },
      { id: "observability", key: "observability", badge: "04", icon: Gauge },
      { id: "context", key: "context", badge: "05", icon: Boxes }
    ]
  },
  {
    key: "review",
    items: [
      { id: "evidence", key: "evidence", badge: "06", icon: ShieldCheck },
      { id: "artifacts", key: "artifacts", badge: "07", icon: FileText },
      { id: "api_keys", key: "apiKeys", badge: "08", icon: KeyRound },
      { id: "manage", key: "manage", badge: "09", icon: Settings2 }
    ]
  }
] as const;

export function App() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [activeSection, setActiveSection] = useState("run");
  const [topic, setTopic] = useState("代理工作流編排");
  const [audience, setAudience] = useState("工程管理者");
  const [freshnessDays, setFreshnessDays] = useState(365);
  const [presetId, setPresetId] = useState("standard");
  const [selectedFlowId, setSelectedFlowId] = useState("deep_research");
  const [runError, setRunError] = useState("");

  const health = useApiQuery(["health"], "/api/health", { refetchInterval: 15_000 });
  const readiness = useApiQuery(["readiness"], "/api/readiness", { refetchInterval: 15_000 });
  const config = useApiQuery(["config"], "/api/config");
  const flows = useApiQuery(["flows"], "/api/flows");
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
  const flowList: FlowSummary[] = flows.data?.flows || [];
  const activeFlow = flowList.find((flow) => flow.id === selectedFlowId) || flowList[0];

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

  useEffect(() => {
    const sectionIds = navGroups.flatMap((group) => group.items.map((item) => item.id));
    const updateFromHash = () => {
      const hashId = window.location.hash.replace("#", "");
      if (sectionIds.includes(hashId as typeof sectionIds[number])) setActiveSection(hashId);
    };
    updateFromHash();
    window.addEventListener("hashchange", updateFromHash);
    return () => {
      window.removeEventListener("hashchange", updateFromHash);
    };
  }, []);

  const startRun = useMutation({
    mutationFn: () => apiPost(`/api/flows/${selectedFlowId}/runs`, {
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
      <a className="skip-link" href="#run">{t("nav.skipToContent")}</a>
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">AP</div>
            <div>
              <h1 className="m-0 text-[17px] font-semibold leading-tight">Agent Platform</h1>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">{t("nav.console")}</p>
            </div>
          </div>
          <a className="sidebar-primary-action" href="#run">
            <span>{t("nav.startRun")}</span>
            <strong>{activeRun?.status ? t(`statuses.${activeRun.status}`, activeRun.status) : t("statuses.idle")}</strong>
          </a>
          <nav className="sidebar-nav" aria-label={t("nav.primary")}>
            {navGroups.map((group) => (
              <div className="nav-group" key={group.key}>
                <p className="nav-group-label">{t(`nav.groups.${group.key}`)}</p>
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={activeSection === item.id ? "active" : ""}
                    aria-current={activeSection === item.id ? "page" : undefined}
                  >
                    <span className="nav-badge" aria-hidden="true">
                      <item.icon size={15} strokeWidth={2.2} />
                    </span>
                    <span>
                      <strong>{t(`nav.${item.key}`)}</strong>
                      <small>{item.badge} · {t(`nav.descriptions.${item.key}`)}</small>
                    </span>
                  </a>
                ))}
              </div>
            ))}
        </nav>
          <div className="sidebar-footer">
            <div className="runtime-pill">
              <span>{t("nav.runtime")}</span>
              <strong>{runtimeLabel(health.data?.runtime, t)}</strong>
            </div>
            <Label className="language-switcher">
              <span>{t("language.label")}</span>
              <Select value={i18n.resolvedLanguage || i18n.language} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
                <option value="zh-Hant">{t("language.zhHant")}</option>
                <option value="en">{t("language.en")}</option>
              </Select>
            </Label>
          </div>
        </div>
      </aside>

      <section className="workspace" id="main-content">
        {activeSection === "run" ? <section id="run" className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("run.title")}</h2>
              <p className="muted">{t("run.subtitle")}</p>
            </div>
            <Badge id="runtime-status" variant="success">{runtimeLabel(health.data?.runtime, t)}</Badge>
          </div>
          <form className="run-form" onSubmit={(event) => {
            event.preventDefault();
            startRun.mutate();
          }}>
            <Label>
              {t("run.flow")}
              <Select id="flow-select" value={selectedFlowId} onChange={(event) => {
                setSelectedFlowId(event.target.value);
                const nextFlow = flowList.find((flow) => flow.id === event.target.value);
                if (nextFlow?.presets?.[0]?.id) setPresetId(nextFlow.presets[0].id);
              }}>
                {flowList.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </Select>
            </Label>
            <Label>
              {t("run.topic")}
              <Input id="topic-input" value={topic} onChange={(event) => setTopic(event.target.value)} />
            </Label>
            <Label>
              {t("run.audience")}
              <Input id="audience-input" value={audience} onChange={(event) => setAudience(event.target.value)} />
            </Label>
            <Label>
              {t("run.freshnessDays")}
              <Input
                id="freshness-input"
                type="number"
                min="1"
                step="1"
                value={freshnessDays}
                onChange={(event) => setFreshnessDays(Number(event.target.value))}
              />
            </Label>
            <Label>
              {t("run.preset")}
              <Select id="preset-select" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
                {(activeFlow?.presets || [{ id: "standard", name: t("run.standard") }]).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                ))}
              </Select>
            </Label>
            <Button type="submit" disabled={startRun.isPending}>{startRun.isPending ? t("run.starting") : t("run.start")}</Button>
          </form>
          {runError ? <div className="error-box">{runError}</div> : null}
          <pre className="summary">{JSON.stringify(policySummary, null, 2)}</pre>
          {activeFlow ? <FlowRunInfo flow={activeFlow} /> : null}
          <div className="subsection">
            <div className="panel-heading compact">
              <h3 className="mb-3 text-base font-semibold tracking-normal">{t("run.recentRuns")}</h3>
              <Button type="button" variant="secondary" onClick={() => clearRuns.mutate()} disabled={clearRuns.isPending}>{t("run.clear")}</Button>
            </div>
            <RunHistory runs={runs.data?.runs || []} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
          </div>
        </section> : null}

        {activeSection === "define" ? <section id="define" className="panel">
          <FlowDefine flows={flowList} providers={activeConfig?.providers || []} selectedFlowId={selectedFlowId} onSelect={setSelectedFlowId} />
        </section> : null}

        {activeSection === "timeline" ? <section id="timeline" className="panel">
          <div className="panel-heading">
            <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("timeline.title")}</h2>
            <div className="button-row">
              <Button type="button" onClick={() => retryRun.mutate({})} disabled={!selectedRunId || retryRun.isPending}>{t("timeline.retry")}</Button>
              <Button type="button" variant="secondary" onClick={() => cancelRun.mutate({})} disabled={!selectedRunId || cancelRun.isPending}>{t("timeline.cancel")}</Button>
            </div>
          </div>
          <Timeline run={activeRun} />
          <pre className="summary">{JSON.stringify(activeRun?.detail || { status: "idle" }, null, 2)}</pre>
        </section> : null}

        {activeSection === "context" ? <section id="context" className="panel">
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("context.title")}</h2>
          <div className="grid">
            {(activeRun?.detail?.contextBlocks as Array<Record<string, unknown>> | undefined || fallbackContextBlocks()).map((item, index) => (
              <InfoCard key={index} title={String(item.type || item.source || `context-${index + 1}`)} meta={`${item.tokens || "-"} tokens`} body={String(item.source || item.detail || t("context.runtimeContext"))} />
            ))}
          </div>
        </section> : null}

        {activeSection === "observability" ? <section id="observability" className="panel">
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("observability.title")}</h2>
          <Observability report={observability.data?.observability} />
        </section> : null}

        {activeSection === "evidence" ? <section id="evidence" className="panel">
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("evidence.title")}</h2>
          <Evidence runId={activeRun?.id} evidence={activeRun?.evidence || []} />
        </section> : null}

        {activeSection === "artifacts" ? <section id="artifacts" className="panel">
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("artifacts.title")}</h2>
          <Artifacts runId={activeRun?.id} artifacts={activeRun?.artifacts || []} />
        </section> : null}

        {activeSection === "api_keys" ? <section id="api_keys" className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("apiClients.title")}</h2>
              <p className="muted">{t("apiClients.subtitle")}</p>
            </div>
          </div>
          <ApiClients flows={flowList} />
        </section> : null}

        {activeSection === "manage" ? <section id="manage" className="panel">
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("manage.title")}</h2>
          <Management config={activeConfig} readiness={readiness.data} skills={skills.data} />
        </section> : null}
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
        <SelectableCard
          key={run.id}
          active={run.id === selectedRunId}
          title={run.topic}
          meta={`${t(`statuses.${run.status}`, run.status)} · ${run.presetId} · ${new Date(run.createdAt).toLocaleString()}`}
          onClick={() => onSelect(run.id)}
        />
      ))}
    </div>
  );
}

function SelectableCard({ active, title, meta, onClick }: { active?: boolean; title: string; meta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "history-item grid min-h-[76px] w-full min-w-0 content-center gap-1.5 whitespace-normal rounded-md border border-input bg-card px-3.5 py-3 text-left text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary bg-emerald-50 shadow-[inset_3px_0_0_var(--color-primary)]"
      )}
      onClick={onClick}
    >
      <strong className="block min-w-0 leading-snug text-foreground [overflow-wrap:anywhere]">{title}</strong>
      <span className="block min-w-0 text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">{meta}</span>
    </button>
  );
}

function FlowRunInfo({ flow }: { flow: FlowSummary }) {
  const { t } = useTranslation();
  return (
    <div className="flow-run-info">
      <InfoCard
        title={t("run.selectedFlowInfo")}
        meta={`${flow.steps.length} ${t("run.steps")} · ${flow.artifacts.length} ${t("run.outputs")}`}
        body={`${flow.name}: ${flow.description || ""}`}
      />
      <div className="grid tight">
        {flow.steps.map((step) => (
          <InfoCard
            key={step.id}
            title={t(`steps.${step.id}`, step.id)}
            meta={step.type}
            body={step.skill ? `${t("run.skill")} ${step.skill}` : t("run.runtimeStep")}
          />
        ))}
      </div>
    </div>
  );
}

function FlowDefine({ flows, providers, selectedFlowId, onSelect }: { flows: FlowSummary[]; providers: ManagedProvider[]; selectedFlowId: string; onSelect: (flowId: string) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selected = flows.find((flow) => flow.id === selectedFlowId) || flows[0];
  const [draftText, setDraftText] = useState("");
  const [commandResult, setCommandResult] = useState("");
  const [flowFilter, setFlowFilter] = useState("");
  const [newStep, setNewStep] = useState({ id: "", type: "agent", skill: "", skillCustom: "", providerRole: "", providerRoleCustom: "", providerId: "", providerCustom: "", model: "", modelCustom: "" });
  const [newArtifact, setNewArtifact] = useState({ id: "markdown_report", type: "markdown_report" });
  const [artifactPreset, setArtifactPreset] = useState("markdown_report");
  const draftDefinition = useMemo(() => parseDraftDefinition(draftText), [draftText]);
  const effectiveProviderRole = getEffectiveProviderRole(newStep.type, newStep.providerRole === "__custom__" ? newStep.providerRoleCustom : newStep.providerRole);
  const providerOptions = providers.filter((provider) => !effectiveProviderRole || provider.type === effectiveProviderRole);
  const selectedProvider = providers.find((provider) => provider.id === newStep.providerId);
  const modelOptions = selectedProvider?.models || [];
  const filteredFlows = flows.filter((flow) => {
    const query = flowFilter.trim().toLowerCase();
    if (!query) return true;
    return `${flow.name} ${flow.status} ${flow.description || ""}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    if (selected) {
      setDraftText(JSON.stringify(selected.draft || selected.definition || selected, null, 2));
      setCommandResult("");
    }
  }, [selected?.id, selected?.updatedAt, selected?.hasDraft]);

  useEffect(() => {
    const current = flows.find((flow) => flow.id === selectedFlowId);
    if (current?.source !== "built-in") return;
    const latestDraft = flows
      .filter((flow) => flow.source === "user" && flow.hasDraft)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    if (latestDraft) onSelect(latestDraft.id);
  }, [flows, selectedFlowId, onSelect]);

  const refreshFlows = async () => {
    await queryClient.invalidateQueries({ queryKey: ["flows"] });
  };

  const createFlow = useMutation({
    mutationFn: () => apiPost("/api/flows", {
      name: "Untitled Flow",
      id: `custom_flow_${Date.now().toString(36)}`
    }),
    onSuccess: async (payload) => {
      setCommandResult(t("define.created"));
      if (payload.flow) {
        queryClient.setQueryData(["flows"], (current: any) => ({
          ...(current || {}),
          flows: [payload.flow, ...((current?.flows || []) as FlowSummary[]).filter((flow) => flow.id !== payload.flow.id)]
        }));
        onSelect(payload.flow.id);
      }
      await refreshFlows();
    },
    onError: (error) => setCommandResult(error instanceof Error ? error.message : t("define.failed"))
  });

  const cloneFlow = useMutation({
    mutationFn: () => apiPost(`/api/flows/${selectedFlowId}/clone`, { id: `${selectedFlowId}_copy_${Date.now().toString(36)}` }),
    onSuccess: async (payload) => {
      setCommandResult(t("define.cloned"));
      if (payload.flow) {
        queryClient.setQueryData(["flows"], (current: any) => ({
          ...(current || {}),
          flows: [payload.flow, ...((current?.flows || []) as FlowSummary[]).filter((flow) => flow.id !== payload.flow.id)]
        }));
        onSelect(payload.flow.id);
      }
      await refreshFlows();
    },
    onError: (error) => setCommandResult(error instanceof Error ? error.message : t("define.failed"))
  });

  const saveDraft = useMutation({
    mutationFn: () => apiPatch(`/api/flows/${selectedFlowId}`, { definition: normalizeBuilderDefinition(JSON.parse(draftText)) }),
    onSuccess: async (payload) => {
      setCommandResult(payload.validation?.length ? `${t("define.savedWithErrors")}\n${payload.validation.join("\n")}` : t("define.saved"));
      await refreshFlows();
    },
    onError: (error) => setCommandResult(error instanceof Error ? error.message : t("define.failed"))
  });

  const publishDraft = useMutation({
    mutationFn: () => apiPost(`/api/flows/${selectedFlowId}/versions`, {}),
    onSuccess: async (payload) => {
      setCommandResult(t("define.published", { version: payload.version }));
      await refreshFlows();
    },
    onError: (error) => setCommandResult(error instanceof Error ? error.message : t("define.failed"))
  });

  const archiveFlow = useMutation({
    mutationFn: () => apiDelete(`/api/flows/${selectedFlowId}`),
    onSuccess: async () => {
      setCommandResult(t("define.archived"));
      await refreshFlows();
    },
    onError: (error) => setCommandResult(error instanceof Error ? error.message : t("define.failed"))
  });

  if (!selected) return <div className="empty">{t("define.empty")}</div>;
  const canEdit = selected.source !== "built-in";

  const updateDraft = (updater: (definition: Record<string, any>) => Record<string, any>) => {
    const current = draftDefinition || selected.draft || selected.definition || selected;
    setDraftText(JSON.stringify(updater({ ...current }), null, 2));
  };

  const addStep = () => {
    const id = sanitizeUiId(newStep.id);
    if (!id) return;
    const skill = newStep.skill === "__custom__" ? newStep.skillCustom : newStep.skill;
    const providerRole = newStep.providerRole === "__custom__" ? newStep.providerRoleCustom : newStep.providerRole;
    const providerId = newStep.providerId === "__custom__" ? newStep.providerCustom : newStep.providerId;
    const model = newStep.model === "__custom__" ? newStep.modelCustom : newStep.model;
    updateDraft((definition) => {
      const steps = Array.isArray(definition.steps) ? definition.steps : [];
      if (steps.some((step: any) => step.id === id)) return definition;
      const step: Record<string, string> = { id, type: newStep.type };
      if (skill.trim()) step.skill = skill.trim();
      if (providerRole.trim()) step.providerRole = providerRole.trim();
      if (providerId.trim()) step.providerId = providerId.trim();
      if (model.trim()) step.model = model.trim();
      return normalizeBuilderDefinition({ ...definition, steps: [...steps, step] });
    });
    setNewStep({ id: "", type: "agent", skill: "", skillCustom: "", providerRole: "", providerRoleCustom: "", providerId: "", providerCustom: "", model: "", modelCustom: "" });
  };

  const addStarterStep = (starter: typeof stepStarterCards[number]) => {
    updateDraft((definition) => {
      const steps = Array.isArray(definition.steps) ? definition.steps : [];
      const id = createUniqueBuilderId(starter.id, steps.map((step: any) => step.id));
      const step: Record<string, string> = { id, type: starter.type };
      if (starter.skill) step.skill = starter.skill;
      if (starter.providerRole) step.providerRole = starter.providerRole;
      return normalizeBuilderDefinition({ ...definition, steps: [...steps, step] });
    });
  };

  const removeStep = (stepId: string) => {
    updateDraft((definition) => normalizeBuilderDefinition({
      ...definition,
      steps: (Array.isArray(definition.steps) ? definition.steps : []).filter((step: any) => step.id !== stepId)
    }));
  };

  const addArtifact = () => {
    const id = sanitizeUiId(newArtifact.id);
    if (!id) return;
    updateDraft((definition) => {
      const artifacts = Array.isArray(definition.artifacts) ? definition.artifacts : [];
      if (artifacts.some((artifact: any) => artifact.id === id)) return definition;
      return normalizeBuilderDefinition({ ...definition, artifacts: [...artifacts, { id, type: newArtifact.type || id }] });
    });
    setNewArtifact({ id: "evidence_bundle", type: "json_evidence_bundle" });
  };

  const addStarterArtifact = (starterId = artifactPreset) => {
    const starter = artifactStarterCards.find((candidate) => candidate.id === starterId) || artifactStarterCards[0];
    updateDraft((definition) => {
      const artifacts = Array.isArray(definition.artifacts) ? definition.artifacts : [];
      const id = createUniqueBuilderId(starter.id, artifacts.map((artifact: any) => artifact.id));
      return normalizeBuilderDefinition({ ...definition, artifacts: [...artifacts, { id, type: starter.type }] });
    });
  };

  const removeArtifact = (artifactId: string) => {
    updateDraft((definition) => normalizeBuilderDefinition({
      ...definition,
      artifacts: (Array.isArray(definition.artifacts) ? definition.artifacts : []).filter((artifact: any) => artifact.id !== artifactId)
    }));
  };

  return (
    <div className="define-surface">
      <div className="panel-heading">
        <div>
          <h2 className="mb-3 text-xl font-semibold tracking-normal">{t("define.title")}</h2>
          <p className="muted">{t("define.subtitle")}</p>
        </div>
        <div className="button-row">
          <Button type="button" onClick={() => createFlow.mutate()} disabled={createFlow.isPending}>{t("define.create")}</Button>
          <Button type="button" variant="secondary" onClick={() => cloneFlow.mutate()} disabled={cloneFlow.isPending}>{t("define.clone")}</Button>
        </div>
      </div>
      <div className="builder-intro">
        <div>
          <strong>{t("define.builderTitle")}</strong>
          <span>{t("define.builderBody")}</span>
        </div>
        <Badge variant="secondary">{t("define.builder")}</Badge>
      </div>
      <div className="flow-build-steps" aria-label={t("define.buildGuide")}>
        {["nameFlow", "addSteps", "addOutputs", "savePublish"].map((key, index) => (
          <div className="build-step" key={key}>
            <span>{index + 1}</span>
            <strong>{t(`define.${key}`)}</strong>
          </div>
        ))}
      </div>
      <div className="flow-command-grid">
        <aside className="flow-list-panel">
          <div className="flow-list-toolbar">
            <div>
              <strong>{t("define.flowLibrary")}</strong>
              <span>{t("define.flowLibraryHelp", { count: flows.length })}</span>
            </div>
            <Input value={flowFilter} placeholder={t("define.searchFlows")} onChange={(event) => setFlowFilter(event.target.value)} />
          </div>
          <div className="flow-list" role="list">
            {filteredFlows.map((flow) => (
              <SelectableCard
                key={flow.id}
                active={flow.id === selectedFlowId}
                title={flow.name}
                meta={`${flow.status} · v${flow.version || 0} · ${flow.steps?.length || 0} steps`}
                onClick={() => onSelect(flow.id)}
              />
            ))}
            {filteredFlows.length === 0 ? <div className="empty">{t("define.noMatchingFlows")}</div> : null}
          </div>
        </aside>
        <div className="flow-editor">
          <div className="builder-header">
            <div>
              <h3 className="mb-3 text-base font-semibold tracking-normal">{selected.name}</h3>
              <p>{canEdit ? t("define.editingDraft") : t("define.builtInReadOnly")}</p>
            </div>
            <Badge variant="success">{selected.hasDraft ? t("define.draft") : `${t("define.version")} ${selected.version}`}</Badge>
          </div>
          <div className="flow-builder">
            <div className="builder-fields">
              <Label>
                {t("define.flowName")}
                <Input
                  id="flow-name-input"
                  value={String(draftDefinition?.name || "")}
                  disabled={!canEdit}
                  onChange={(event) => updateDraft((definition) => ({ ...definition, name: event.target.value }))}
                />
              </Label>
              <Label>
                {t("define.flowDescription")}
                <Input
                  id="flow-description-input"
                  value={String(draftDefinition?.description || "")}
                  disabled={!canEdit}
                  onChange={(event) => updateDraft((definition) => ({ ...definition, description: event.target.value }))}
                />
              </Label>
            </div>
            <div className="builder-section-heading">
              <div>
                <h4 className="m-0 text-sm font-semibold">{t("define.stepsTitle")}</h4>
                <p>{t("define.stepsHelp")}</p>
              </div>
            </div>
            <FlowStepMap flow={{ ...selected, steps: (draftDefinition?.steps as FlowSummary["steps"]) || selected.steps }} providers={providers} onRemove={canEdit ? removeStep : undefined} />
            {canEdit ? <div className="builder-action-panel">
              <div className="builder-section-heading compact">
                <div>
                  <h4 className="m-0 text-sm font-semibold">{t("define.quickAddStep")}</h4>
                  <p>{t("define.quickAddStepHelp")}</p>
                </div>
              </div>
              <div className="step-palette">
                {stepStarterCards.map((starter) => (
                  <button type="button" className="step-palette-card" key={starter.id} onClick={() => addStarterStep(starter)}>
                    <starter.icon size={18} strokeWidth={2.2} />
                    <span>
                      <strong>{t(`define.${starter.labelKey}`)}</strong>
                      <small>{t(`define.${starter.detailKey}`)}</small>
                    </span>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <details className="custom-step-panel" open>
                <summary>{t("define.customStep")}</summary>
                <div className="builder-add-row">
                  <Label>
                    {t("define.stepIdLabel")}
                    <Input id="step-id-input" placeholder={t("define.stepId")} value={newStep.id} onChange={(event) => setNewStep({ ...newStep, id: event.target.value })} />
                  </Label>
                  <Label>
                    {t("define.stepType")}
                    <Select id="step-type-select" value={newStep.type} onChange={(event) => setNewStep({ ...newStep, type: event.target.value })}>
                      <option value="agent">agent</option>
                      <option value="tool_group">tool_group</option>
                      <option value="transform">transform</option>
                      <option value="verifier">verifier</option>
                      <option value="artifact">artifact</option>
                    </Select>
                  </Label>
                  <Label>
                    {t("define.stepSkillLabel")}
                    <Select id="step-skill-input" value={newStep.skill} onChange={(event) => setNewStep({ ...newStep, skill: event.target.value })}>
                      {stepSkillOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.value ? `${t(`define.${option.labelKey}`)} · ${option.value === "__custom__" ? t("define.customOption") : option.value}` : t(`define.${option.labelKey}`)}</option>
                      ))}
                    </Select>
                    {newStep.skill === "__custom__" ? (
                      <Input id="step-skill-custom-input" placeholder={t("define.stepSkill")} value={newStep.skillCustom} onChange={(event) => setNewStep({ ...newStep, skillCustom: event.target.value })} />
                    ) : null}
                  </Label>
                  <Label>
                    {t("define.providerRoleLabel")}
                    <Select id="step-provider-role-input" value={newStep.providerRole} onChange={(event) => setNewStep({ ...newStep, providerRole: event.target.value, providerId: "", model: "" })}>
                      {providerRoleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.value ? `${t(`define.${option.labelKey}`)} · ${option.value === "__custom__" ? t("define.customOption") : option.value}` : t(`define.${option.labelKey}`)}</option>
                      ))}
                    </Select>
                    {newStep.providerRole === "__custom__" ? (
                      <Input id="step-provider-role-custom-input" placeholder={t("define.providerRole")} value={newStep.providerRoleCustom} onChange={(event) => setNewStep({ ...newStep, providerRoleCustom: event.target.value })} />
                    ) : null}
                  </Label>
                  <Label>
                    {t("define.providerLabel")}
                    <Select
                      id="step-provider-input"
                      value={newStep.providerId}
                      onChange={(event) => {
                        const provider = providers.find((candidate) => candidate.id === event.target.value);
                        setNewStep({ ...newStep, providerId: event.target.value, providerCustom: "", model: provider?.activeModel || "", modelCustom: "" });
                      }}
                    >
                      <option value="">{t("define.providerAuto")}</option>
                      {providerOptions.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.name} · {provider.type}</option>
                      ))}
                      <option value="__custom__">{t("define.customProvider")}</option>
                    </Select>
                    {newStep.providerId === "__custom__" ? (
                      <Input id="step-provider-custom-input" placeholder={t("define.customProviderPlaceholder")} value={newStep.providerCustom} onChange={(event) => setNewStep({ ...newStep, providerCustom: event.target.value })} />
                    ) : null}
                  </Label>
                  <Label>
                    {t("define.modelLabel")}
                    <Select id="step-model-input" value={newStep.model} onChange={(event) => setNewStep({ ...newStep, model: event.target.value, modelCustom: "" })}>
                      <option value="">{t("define.modelAuto")}</option>
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                      <option value="__custom__">{t("define.customModel")}</option>
                    </Select>
                    {newStep.model === "__custom__" ? (
                      <Input id="step-model-custom-input" placeholder={t("define.customModelPlaceholder")} value={newStep.modelCustom} onChange={(event) => setNewStep({ ...newStep, modelCustom: event.target.value })} />
                    ) : null}
                  </Label>
                  <Button type="button" variant="secondary" onClick={addStep}>{t("define.addStep")}</Button>
                </div>
              </details>
            </div> : null}
            <div className="builder-section-heading">
              <div>
                <h4 className="m-0 text-sm font-semibold">{t("define.outputsTitle")}</h4>
                <p>{t("define.outputTemplateBody")}</p>
              </div>
            </div>
            <ArtifactMap artifacts={(draftDefinition?.artifacts as FlowSummary["artifacts"]) || selected.artifacts} onRemove={canEdit ? removeArtifact : undefined} />
            {canEdit ? <div className="builder-action-panel">
              <div className="artifact-picker-row">
                <Label>
                  {t("define.outputPreset")}
                  <Select value={artifactPreset} onChange={(event) => setArtifactPreset(event.target.value)}>
                    {artifactStarterCards.map((starter) => (
                      <option key={starter.id} value={starter.id}>{t(`define.${starter.labelKey}`)}</option>
                    ))}
                  </Select>
                </Label>
                <div className="artifact-preset-preview">
                  <strong>{t(`define.${artifactStarterCards.find((starter) => starter.id === artifactPreset)?.labelKey || "markdownReport"}`)}</strong>
                  <small>{t(`define.${artifactStarterCards.find((starter) => starter.id === artifactPreset)?.detailKey || "markdownReportDetail"}`)}</small>
                </div>
                <Button type="button" variant="secondary" onClick={() => addStarterArtifact()}>{t("define.addSelectedOutput")}</Button>
              </div>
              <div className="builder-add-row artifact-row">
                <Label>
                  {t("define.artifactIdLabel")}
                  <Input id="artifact-id-input" placeholder={t("define.artifactId")} value={newArtifact.id} onChange={(event) => setNewArtifact({ ...newArtifact, id: event.target.value })} />
                </Label>
                <Label>
                  {t("define.artifactType")}
                  <Select id="artifact-type-select" value={newArtifact.type} onChange={(event) => setNewArtifact({ ...newArtifact, type: event.target.value })}>
                    <option value="markdown_report">markdown_report</option>
                    <option value="json_evidence_bundle">json_evidence_bundle</option>
                    <option value="json">json</option>
                  </Select>
                </Label>
                <Button type="button" variant="secondary" onClick={addArtifact}>{t("define.addArtifact")}</Button>
              </div>
            </div> : null}
          </div>
          <details className="advanced-json">
            <summary>{t("define.advancedJson")}</summary>
            <Textarea rows={18} value={draftText} onChange={(event) => setDraftText(event.target.value)} disabled={selected.source === "built-in" && !selected.hasDraft} />
          </details>
          <div className="button-row">
            <Button type="button" onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending || selected.source === "built-in"}>{t("define.save")}</Button>
            <Button type="button" onClick={() => publishDraft.mutate()} disabled={publishDraft.isPending || !selected.hasDraft}>{t("define.publish")}</Button>
            <Button type="button" variant="secondary" onClick={() => archiveFlow.mutate()} disabled={archiveFlow.isPending || selected.source === "built-in"}>{t("define.archive")}</Button>
          </div>
          {commandResult ? <pre className="summary compact">{commandResult}</pre> : null}
        </div>
      </div>
    </div>
  );
}

function FlowStepMap({ flow, providers, onRemove }: { flow: FlowSummary; providers: ManagedProvider[]; onRemove?: (stepId: string) => void }) {
  const { t } = useTranslation();
  if (flow.steps.length === 0) {
    return <div className="builder-empty">{t("define.noSteps")}</div>;
  }
  return (
    <div className="flow-step-map">
      {flow.steps.map((step, index) => (
        <div className="flow-step-chip" key={step.id}>
          <span className="step-number">{index + 1}</span>
          <div>
            <strong>{t(`steps.${step.id}`, step.id)}</strong>
            <span>{step.type}</span>
            <small>{step.skill || step.providerRole || t("run.runtimeStep")}</small>
            <small>{formatStepRouting(step, providers, t)}</small>
          </div>
          {onRemove ? <button type="button" className="mini-danger" onClick={() => onRemove(step.id)}>{t("define.remove")}</button> : null}
        </div>
      ))}
    </div>
  );
}

function ArtifactMap({ artifacts, onRemove }: { artifacts: FlowSummary["artifacts"]; onRemove?: (artifactId: string) => void }) {
  const { t } = useTranslation();
  if (artifacts.length === 0) return <div className="builder-empty">{t("define.noArtifacts")}</div>;
  return (
    <div className="artifact-chip-list">
      {artifacts.map((artifact) => (
        <div className="artifact-chip" key={artifact.id}>
          <div>
            <strong>{artifact.id}</strong>
            <small>{artifact.type}</small>
          </div>
          {onRemove ? <button type="button" className="mini-danger" onClick={() => onRemove(artifact.id)}>{t("define.remove")}</button> : null}
        </div>
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
    mutationFn: ({ index, status, note }: { index: number; status: string; note: string }) => apiPatch(`/api/runs/${runId}/evidence/${index}`, { status, note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["run", runId] })
  });

  if (!runId) return <div className="empty">{t("evidence.selectRun")}</div>;
  if (evidence.length === 0) return <div className="empty">{t("evidence.empty")}</div>;
  return (
    <div className="grid">
      {evidence.map((item, index) => (
        <Card className="card" key={`${item.source}-${index}`}>
          <CardHeader className="pb-3">
            <div className="card-heading">
              <CardTitle>{item.sourceTitle || item.source}</CardTitle>
              <Badge variant="outline">{item.confidence}</Badge>
            </div>
          </CardHeader>
          <CardContent>
          <p>{item.claim}</p>
          <p className="muted">{item.excerpt}</p>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a>
          {item.alphaXivUrl ? <a href={item.alphaXivUrl} target="_blank" rel="noreferrer">alphaXiv: {item.alphaXivUrl}</a> : null}
          {item.arxivId ? <small>arXiv ID: {item.arxivId}</small> : null}
          <div className="button-row">
            <Button type="button" variant="secondary" onClick={() => review.mutate({ index, status: "accepted", note: t("evidence.approvedNote") })}>{t("evidence.approve")}</Button>
            <Button type="button" variant="secondary" onClick={() => review.mutate({ index, status: "rejected", note: t("evidence.rejectedNote") })}>{t("evidence.reject")}</Button>
            <Button type="button" variant="secondary" onClick={() => review.mutate({ index, status: "watch", note: t("evidence.annotatedNote") })}>{t("evidence.annotate")}</Button>
          </div>
          {item.review ? <small>{t("evidence.review")}: {item.review.status} · {item.review.note}</small> : null}
          </CardContent>
        </Card>
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
        <Button type="button" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>{t("artifacts.regenerate")}</Button>
      </div>
      <div className="grid">
        {artifacts.length === 0 ? <div className="empty">{t("artifacts.empty")}</div> : artifacts.map((artifact) => (
          <Card className="card" key={artifact.id}>
            <CardHeader className="pb-3">
              <div className="card-heading">
                <CardTitle>{artifact.name}</CardTitle>
                <Badge variant="outline">{artifact.type} v{artifact.version || 1}</Badge>
              </div>
            </CardHeader>
            <CardContent>
            <pre className="summary compact">{JSON.stringify(artifact.content || artifact, null, 2)}</pre>
            <div className="button-row">
              <a className="button-link" href={artifact.downloadUrl}>{t("artifacts.download")}</a>
              <ArtifactReviewButton runId={runId} artifact={artifact} status="accepted" label={t("artifacts.approve")} />
              <ArtifactReviewButton runId={runId} artifact={artifact} status="rejected" label={t("artifacts.reject")} />
              <ArtifactVersionButton runId={runId} artifactId={artifact.id} />
            </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function ArtifactReviewButton({ runId, artifact, status, label }: { runId: string; artifact: ArtifactItem; status: string; label: string }) {
  const queryClient = useQueryClient();
  const review = useMutation({
    mutationFn: () => apiPatch(`/api/runs/${runId}/artifacts/${artifact.id}`, {
      content: {
        ...(typeof artifact.content === "object" && artifact.content !== null ? artifact.content : { value: artifact.content || artifact.name }),
        review: {
          status,
          updatedAt: new Date().toISOString()
        }
      },
      note: `Artifact ${status}`
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["run", runId] })
  });
  return <Button type="button" variant="secondary" onClick={() => review.mutate()} disabled={review.isPending}>{label}</Button>;
}

function ArtifactVersionButton({ runId, artifactId }: { runId: string; artifactId: string }) {
  const { t } = useTranslation();
  const [diff, setDiff] = useState<string>("");
  return (
    <>
      <Button type="button" variant="secondary" onClick={async () => {
        const payload = await apiGet(`/api/runs/${runId}/artifacts/${artifactId}/diff`).catch((error) => ({ error: error.message }));
        setDiff(JSON.stringify(payload.diff || payload, null, 2));
      }}>{t("artifacts.diff")}</Button>
      {diff ? <pre className="summary compact">{diff}</pre> : null}
    </>
  );
}

function Management({ config, readiness, skills }: { config?: ManagementConfig; readiness?: Record<string, any>; skills?: Record<string, any> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const createProvider = useMutation({
    mutationFn: () => apiPost("/api/providers", {
      id: `custom-provider-${Date.now().toString(36)}`,
      name: "Custom Provider",
      enabled: false,
      credentialRef: "CUSTOM_PROVIDER_KEY",
      models: ["custom-model"],
      activeModel: "custom-model"
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] })
  });
  const createImprovement = useMutation({
    mutationFn: () => apiPost("/api/improvements", {
      type: "eval-case",
      summary: "Create a regression eval case from operator feedback."
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] })
  });
  if (!config) return <div className="empty">{t("manage.loading")}</div>;
  return (
    <div className="management">
      <Card>
        <CardHeader>
          <CardTitle>{t("manage.openSourceRuntime")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{t("manage.localUsable")}：{String(readiness?.usableNow)} · {t("manage.cloudflareDeployReady")}：{String(readiness?.cloudflare?.deployReady)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("manage.policies")}</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid tight">
          {(config.policies || []).map((policy) => <PolicyCard key={policy.id} policy={policy} />)}
        </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("manage.apiKeys")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiKeySetupPanel providers={config.providers} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="card-heading">
          <CardTitle>{t("manage.improvements")}</CardTitle>
          <Button type="button" variant="secondary" onClick={() => createImprovement.mutate()} disabled={createImprovement.isPending}>{t("manage.createImprovement")}</Button>
        </div>
        </CardHeader>
        <CardContent>
        <div className="grid tight">
          {(config.improvementProposals || []).map((proposal) => (
            <InfoCard key={proposal.id} title={proposal.summary} meta={`${proposal.type} · ${proposal.status}`} body={`${proposal.evalCase.id} · ${proposal.evalCase.status}`} />
          ))}
          {(config.improvementProposals || []).length === 0 ? <div className="empty">{t("manage.noImprovements")}</div> : null}
        </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="card-heading">
          <CardTitle>{t("manage.providers")}</CardTitle>
          <Button type="button" variant="secondary" onClick={() => createProvider.mutate()} disabled={createProvider.isPending}>{t("manage.createProvider")}</Button>
        </div>
        </CardHeader>
        <CardContent>
        <ModelCatalogPanel providers={config.providers} allowedProviders={config.policy.allowedProviders} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("manage.testModel")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelTestPanel providers={config.providers} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("manage.skillVersions")}</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="grid tight">
          {(skills?.skills || config.skills).map((skill: ManagementConfig["skills"][number]) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
        </CardContent>
      </Card>
    </div>
  );
}

const API_CLIENT_SCOPES = ["runs:write", "runs:read", "artifacts:read", "evidence:read", "flows:read", "proxy:write"] as const;

type ApiClient = {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes: string[];
  allowedFlows: string[];
  rateLimit: { requestsPerMin?: number; runsPerDay?: number };
  budget: { maxCostUsd?: number; maxTokens?: number; window?: string };
  createdAt: string;
  lastUsedAt?: string;
  usage?: { costUsd: number; tokens: number; runs: number };
};

function ApiClients({ flows }: { flows: FlowSummary[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const clientsQuery = useApiQuery(["api-clients"], "/api/api-clients");
  const clients: ApiClient[] = clientsQuery.data?.clients || [];

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["runs:write", "runs:read", "artifacts:read", "evidence:read", "flows:read"]);
  const [allowedFlows, setAllowedFlows] = useState("");
  const [requestsPerMin, setRequestsPerMin] = useState("60");
  const [runsPerDay, setRunsPerDay] = useState("100");
  const [maxCostUsd, setMaxCostUsd] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [error, setError] = useState("");
  const [plaintextKey, setPlaintextKey] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["api-clients"] });

  const createClient = useMutation({
    mutationFn: () => apiPost("/api/api-clients", {
      name: name.trim(),
      scopes,
      allowedFlows: allowedFlows.split(",").map((item) => item.trim()).filter(Boolean),
      rateLimit: {
        requestsPerMin: Number(requestsPerMin) || undefined,
        runsPerDay: Number(runsPerDay) || undefined
      },
      budget: {
        maxCostUsd: maxCostUsd ? Number(maxCostUsd) : undefined,
        maxTokens: maxTokens ? Number(maxTokens) : undefined
      }
    }),
    onSuccess: async (payload) => {
      setError("");
      setPlaintextKey(payload?.key || "");
      setName("");
      await refresh();
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : t("apiClients.createFailed"))
  });

  const toggleScope = (scope: string) => {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]);
  };

  const handleCreate = () => {
    if (!name.trim()) {
      setError(t("apiClients.nameRequired"));
      return;
    }
    createClient.mutate();
  };

  return (
    <div className="grid">
      {plaintextKey ? <ApiKeyReveal apiKey={plaintextKey} onClose={() => setPlaintextKey("")} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t("apiClients.create")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid tight">
            <div>
              <Label htmlFor="api-client-name">{t("apiClients.name")}</Label>
              <Input id="api-client-name" value={name} placeholder={t("apiClients.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label>{t("apiClients.scopes")}</Label>
              <div className="flex flex-wrap gap-2">
                {API_CLIENT_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={cn(
                      "rounded-md border border-input px-2.5 py-1 text-sm",
                      scopes.includes(scope) ? "border-primary bg-emerald-50 text-foreground" : "text-muted-foreground"
                    )}
                    aria-pressed={scopes.includes(scope)}
                    onClick={() => toggleScope(scope)}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="api-client-flows">{t("apiClients.allowedFlows")}</Label>
              <Input
                id="api-client-flows"
                value={allowedFlows}
                placeholder={flows.length ? flows.map((flow) => flow.id).slice(0, 2).join(", ") : t("apiClients.allowedFlowsPlaceholder")}
                onChange={(event) => setAllowedFlows(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="api-client-rpm">{t("apiClients.requestsPerMin")}</Label>
                <Input id="api-client-rpm" type="number" value={requestsPerMin} onChange={(event) => setRequestsPerMin(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="api-client-rpd">{t("apiClients.runsPerDay")}</Label>
                <Input id="api-client-rpd" type="number" value={runsPerDay} onChange={(event) => setRunsPerDay(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="api-client-cost">{t("apiClients.maxCostUsd")}</Label>
                <Input id="api-client-cost" type="number" value={maxCostUsd} onChange={(event) => setMaxCostUsd(event.target.value)} />
              </div>
              <div>
                <Label htmlFor="api-client-tokens">{t("apiClients.maxTokens")}</Label>
                <Input id="api-client-tokens" type="number" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
              </div>
            </div>
            <Button type="button" onClick={handleCreate} disabled={createClient.isPending}>
              {createClient.isPending ? t("apiClients.creating") : t("apiClients.create")}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </CardContent>
      </Card>

      {clientsQuery.isLoading ? <div className="empty">{t("apiClients.loading")}</div> : null}
      {!clientsQuery.isLoading && clients.length === 0 ? <div className="empty">{t("apiClients.empty")}</div> : null}
      {clients.map((client) => <ApiClientCard key={client.id} client={client} onChanged={refresh} />)}
    </div>
  );
}

function ApiKeyReveal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("apiClients.keyOnceTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-sm text-destructive">{t("apiClients.keyOnceWarning")}</p>
        <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm">{apiKey}</code>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="secondary" onClick={copy}>{copied ? t("apiClients.copied") : t("apiClients.copy")}</Button>
          <Button type="button" onClick={onClose}>{t("apiClients.close")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiClientCard({ client, onChanged }: { client: ApiClient; onChanged: () => void }) {
  const { t } = useTranslation();
  const [showAudit, setShowAudit] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit form state — initialised from client on open
  const [editName, setEditName] = useState("");
  const [editScopes, setEditScopes] = useState<string[]>([]);
  const [editAllowedFlows, setEditAllowedFlows] = useState("");
  const [editRequestsPerMin, setEditRequestsPerMin] = useState("");
  const [editRunsPerDay, setEditRunsPerDay] = useState("");
  const [editMaxCostUsd, setEditMaxCostUsd] = useState("");
  const [editMaxTokens, setEditMaxTokens] = useState("");
  const [editError, setEditError] = useState("");
  const [editSavedMsg, setEditSavedMsg] = useState("");

  const audit = useApiQuery(["api-client-audit", client.id], showAudit ? `/api/api-clients/${client.id}/audit` : undefined);

  const revoke = useMutation({
    mutationFn: () => apiPost(`/api/api-clients/${client.id}/revoke`, {}),
    onSuccess: () => onChanged()
  });

  const saveEdit = useMutation({
    mutationFn: () => apiPatch(`/api/api-clients/${client.id}`, {
      name: editName.trim(),
      scopes: editScopes,
      allowedFlows: editAllowedFlows.split(",").map((item) => item.trim()).filter(Boolean),
      rateLimit: {
        requestsPerMin: Number(editRequestsPerMin) || undefined,
        runsPerDay: Number(editRunsPerDay) || undefined
      },
      budget: {
        maxCostUsd: editMaxCostUsd ? Number(editMaxCostUsd) : undefined,
        maxTokens: editMaxTokens ? Number(editMaxTokens) : undefined
      }
    }),
    onSuccess: async () => {
      setEditError("");
      setEditSavedMsg(t("apiClients.editSaved"));
      setEditing(false);
      onChanged();
    },
    onError: (err) => {
      setEditSavedMsg("");
      setEditError(err instanceof Error ? err.message : t("apiClients.editFailed"));
    }
  });

  const openEdit = () => {
    setEditName(client.name);
    setEditScopes([...client.scopes]);
    setEditAllowedFlows(client.allowedFlows.join(", "));
    setEditRequestsPerMin(String(client.rateLimit?.requestsPerMin ?? ""));
    setEditRunsPerDay(String(client.rateLimit?.runsPerDay ?? ""));
    setEditMaxCostUsd(String(client.budget?.maxCostUsd ?? ""));
    setEditMaxTokens(String(client.budget?.maxTokens ?? ""));
    setEditError("");
    setEditSavedMsg("");
    setEditing(true);
  };

  const toggleEditScope = (scope: string) => {
    setEditScopes((current) => current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]);
  };

  const handleRevoke = () => {
    if (window.confirm(t("apiClients.revokeConfirm"))) revoke.mutate();
  };

  const usage = client.usage || { costUsd: 0, tokens: 0, runs: 0 };

  return (
    <Card>
      <CardHeader>
        <div className="card-heading">
          <CardTitle>{client.name}</CardTitle>
          <Badge>{client.status === "active" ? t("apiClients.active") : t("apiClients.revoked")}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="grid tight">
            <p className="text-sm font-medium">{t("apiClients.editTitle")}</p>
            <div>
              <Label htmlFor={`edit-name-${client.id}`}>{t("apiClients.name")}</Label>
              <Input
                id={`edit-name-${client.id}`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div>
              <Label>{t("apiClients.scopes")}</Label>
              <div className="flex flex-wrap gap-2">
                {API_CLIENT_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    className={cn(
                      "rounded-md border border-input px-2.5 py-1 text-sm",
                      editScopes.includes(scope) ? "border-primary bg-emerald-50 text-foreground" : "text-muted-foreground"
                    )}
                    aria-pressed={editScopes.includes(scope)}
                    onClick={() => toggleEditScope(scope)}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor={`edit-flows-${client.id}`}>{t("apiClients.allowedFlows")}</Label>
              <Input
                id={`edit-flows-${client.id}`}
                value={editAllowedFlows}
                placeholder={t("apiClients.allowedFlowsPlaceholder")}
                onChange={(e) => setEditAllowedFlows(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`edit-rpm-${client.id}`}>{t("apiClients.requestsPerMin")}</Label>
                <Input id={`edit-rpm-${client.id}`} type="number" value={editRequestsPerMin} onChange={(e) => setEditRequestsPerMin(e.target.value)} />
              </div>
              <div>
                <Label htmlFor={`edit-rpd-${client.id}`}>{t("apiClients.runsPerDay")}</Label>
                <Input id={`edit-rpd-${client.id}`} type="number" value={editRunsPerDay} onChange={(e) => setEditRunsPerDay(e.target.value)} />
              </div>
              <div>
                <Label htmlFor={`edit-cost-${client.id}`}>{t("apiClients.maxCostUsd")}</Label>
                <Input id={`edit-cost-${client.id}`} type="number" value={editMaxCostUsd} onChange={(e) => setEditMaxCostUsd(e.target.value)} />
              </div>
              <div>
                <Label htmlFor={`edit-tokens-${client.id}`}>{t("apiClients.maxTokens")}</Label>
                <Input id={`edit-tokens-${client.id}`} type="number" value={editMaxTokens} onChange={(e) => setEditMaxTokens(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => saveEdit.mutate()} disabled={saveEdit.isPending}>
                {saveEdit.isPending ? t("apiClients.savingEdit") : t("apiClients.saveEdit")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={saveEdit.isPending}>
                {t("apiClients.cancelEdit")}
              </Button>
            </div>
            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}
          </div>
        ) : (
          <>
            <div className="grid tight text-sm">
              <p><strong>{t("apiClients.prefix")}:</strong> <code>{client.keyPrefix}</code></p>
              <p><strong>{t("apiClients.scopes")}:</strong> {client.scopes.join(", ") || "—"}</p>
              <p><strong>{t("apiClients.allowedFlows")}:</strong> {client.allowedFlows.length ? client.allowedFlows.join(", ") : "*"}</p>
              <p><strong>{t("apiClients.rateLimit")}:</strong> {client.rateLimit?.requestsPerMin || "—"}/min · {client.rateLimit?.runsPerDay || "—"}/day</p>
              <p><strong>{t("apiClients.budget")}:</strong> {client.budget?.maxCostUsd ? `$${client.budget.maxCostUsd}` : "—"} · {client.budget?.maxTokens || "—"} tokens</p>
              <p><strong>{t("apiClients.usage")}:</strong> {t("apiClients.usageValue", { cost: usage.costUsd.toFixed(3), tokens: usage.tokens })}</p>
              <p><strong>{t("apiClients.lastUsedAt")}:</strong> {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : t("apiClients.never")}</p>
            </div>
            {editSavedMsg ? <p className="mt-2 text-sm text-emerald-600">{editSavedMsg}</p> : null}
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="secondary" onClick={openEdit}>{t("apiClients.edit")}</Button>
              {client.status === "active" ? (
                <Button type="button" variant="secondary" onClick={handleRevoke} disabled={revoke.isPending}>{t("apiClients.revoke")}</Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setShowAudit((current) => !current)}>
                {showAudit ? t("apiClients.hideAudit") : t("apiClients.viewAudit")}
              </Button>
            </div>
          </>
        )}
        {showAudit ? (
          <div className="mt-3 grid tight text-sm">
            {(audit.data?.audit || []).length === 0 ? <div className="empty">{t("apiClients.auditEmpty")}</div> : null}
            {(audit.data?.audit || []).map((entry: any) => (
              <InfoCard
                key={entry.id}
                title={`${entry.method} ${entry.path}`}
                meta={`${entry.outcome} · ${entry.statusCode}`}
                body={new Date(entry.ts).toLocaleString()}
              />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ApiKeySetupPanel({ providers }: { providers: ManagedProvider[] }) {
  const { t } = useTranslation();
  return (
    <div className="api-key-panel">
      <p className="muted">{t("manage.apiKeysHelp")}</p>
      {providers.map((provider) => <ApiKeyRow key={provider.id} provider={provider} />)}
    </div>
  );
}

function ApiKeyRow({ provider }: { provider: ManagedProvider }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const refs = provider.credentialRef.split(/\s+or\s+| 或 |,\s*/).map((item) => item.trim()).filter(Boolean);
  const secretRefs = refs.filter((ref) => /^[A-Z0-9_]+$/.test(ref));
  const [credentialRef, setCredentialRef] = useState(secretRefs[0] || refs[0] || provider.credentialRef);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };
  const saveCredential = useMutation({
    mutationFn: () => apiPost(`/api/providers/${provider.id}/credential`, { credentialRef, value }),
    onSuccess: async () => {
      setValue("");
      setStatus(t("manage.apiKeySaved"));
      await refresh();
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : t("manage.apiKeySaveFailed"))
  });
  const clearCredential = useMutation({
    mutationFn: () => apiDelete(`/api/providers/${provider.id}/credential`),
    onSuccess: async () => {
      setStatus(t("manage.apiKeyCleared"));
      await refresh();
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : t("manage.apiKeyClearFailed"))
  });

  return (
    <div className="api-key-row">
      <div>
        <strong>{provider.name}</strong>
        <span>{provider.credentialRef}</span>
        <small>{provider.credentialConfigured ? t("manage.apiKeyConfigured", { source: provider.credentialSource }) : t("manage.apiKeyMissing")}</small>
      </div>
      {secretRefs.length > 0 ? (
        <div className="api-key-form">
          <Label>
            {t("manage.credentialRef")}
            <Select value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)}>
              {secretRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
            </Select>
          </Label>
          <Label>
            {t("manage.apiKeyValue")}
            <Input
              type="password"
              value={value}
              placeholder={t("manage.apiKeyPlaceholder")}
              onChange={(event) => setValue(event.target.value)}
            />
          </Label>
          <div className="button-row">
            <Button type="button" onClick={() => saveCredential.mutate()} disabled={saveCredential.isPending || !value.trim()}>{t("manage.saveApiKey")}</Button>
            <Button type="button" variant="secondary" onClick={() => clearCredential.mutate()} disabled={clearCredential.isPending || !provider.credentialConfigured}>{t("manage.clearApiKey")}</Button>
          </div>
          <small>{t("manage.apiKeyStoredInConfig")}</small>
          <code>npx wrangler secret put {credentialRef}</code>
          {status ? <span className="status-line">{status}</span> : null}
        </div>
      ) : (
        <small>{t("manage.bindingConfigured")}</small>
      )}
    </div>
  );
}

function ModelCatalogPanel({ providers, allowedProviders }: { providers: ManagedProvider[]; allowedProviders: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="provider-catalog">
      {providers.map((provider) => (
        <ProviderCatalogRow key={provider.id} provider={provider} allowed={allowedProviders.includes(provider.id)} />
      ))}
      {providers.length === 0 ? <div className="empty">{t("manage.noProviders")}</div> : null}
    </div>
  );
}

function ProviderCatalogRow({ provider, allowed }: { provider: ManagedProvider; allowed: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customModel, setCustomModel] = useState("");
  const [result, setResult] = useState("");
  const enabledCount = provider.enabled ? provider.models.length : 0;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["config"] });
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };
  const updateProvider = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch(`/api/providers/${provider.id}`, body),
    onSuccess: async () => {
      await refresh();
      setResult(t("manage.saved"));
    },
    onError: (error) => setResult(error instanceof Error ? error.message : t("manage.saveFailed"))
  });
  const syncModels = useMutation({
    mutationFn: () => apiPost(`/api/providers/${provider.id}/models/sync`, {}),
    onSuccess: async (payload) => {
      await refresh();
      setResult(
        Number(payload.added) > 0
          ? t("manage.syncDone", { added: payload.added, existing: payload.existing, total: payload.total })
          : t("manage.syncNoChanges", { total: payload.total })
      );
    },
    onError: (error) => setResult(error instanceof Error ? `${t("manage.syncFailed")}: ${error.message}` : t("manage.syncFailed"))
  });
  const addModel = () => {
    const model = customModel.trim();
    if (!model) return;
    updateProvider.mutate({
      models: Array.from(new Set([...provider.models, model])),
      activeModel: model
    });
    setCustomModel("");
  };
  return (
    <div className="provider-catalog-row">
      <div className="provider-catalog-main">
        <strong>{provider.name}</strong>
        <span>{provider.enabled ? t("manage.enabled") : t("manage.disabled")} · {allowed ? t("manage.policyAllowed") : t("manage.blocked")} · {t("manage.modelsEnabled", { active: enabledCount, total: provider.models.length })}</span>
        <code>{provider.credentialRef}</code>
      </div>
      <Label>
        {t("manage.activeModel")}
        <Select value={provider.activeModel} onChange={(event) => updateProvider.mutate({ activeModel: event.target.value })}>
          {provider.models.map((model) => <option key={model} value={model}>{model}</option>)}
        </Select>
      </Label>
      <div className="model-chip-list">
        {provider.models.map((model) => (
          <button
            key={model}
            type="button"
            className={model === provider.activeModel ? "model-chip active" : "model-chip"}
            onClick={() => updateProvider.mutate({ activeModel: model })}
          >
            {model}
          </button>
        ))}
      </div>
      <div className="provider-catalog-actions">
        <Button type="button" variant="secondary" onClick={() => updateProvider.mutate({ enabled: !provider.enabled })} disabled={updateProvider.isPending}>
          {provider.enabled ? t("manage.disable") : t("manage.enable")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => syncModels.mutate()} disabled={syncModels.isPending}>{syncModels.isPending ? t("manage.syncing") : t("manage.syncModels")}</Button>
        <span className={syncModels.isError ? "provider-sync-status error" : "provider-sync-status"} role="status" aria-live="polite">
          {syncModels.isPending ? t("manage.syncing") : result || t("manage.syncIdle")}
        </span>
      </div>
      <div className="provider-add-model">
        <Input value={customModel} placeholder={t("manage.customModelPlaceholder")} onChange={(event) => setCustomModel(event.target.value)} />
        <Button type="button" variant="secondary" onClick={addModel} disabled={updateProvider.isPending}>{t("manage.addModel")}</Button>
      </div>
    </div>
  );
}

function ModelTestPanel({ providers }: { providers: ManagedProvider[] }) {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState(providers[0]?.id || "");
  const activeProvider = providers.find((provider) => provider.id === providerId) || providers[0];
  const [model, setModel] = useState(activeProvider?.activeModel || "");
  const [customModel, setCustomModel] = useState("");
  const [prompt, setPrompt] = useState(t("manage.defaultTestPrompt"));
  const [maxTokens, setMaxTokens] = useState(96);
  const [result, setResult] = useState("");

  useEffect(() => {
    if (activeProvider) setModel(activeProvider.activeModel || activeProvider.models[0] || "");
  }, [activeProvider?.id]);

  const testModel = useMutation({
    mutationFn: () => apiPost(`/api/providers/${activeProvider?.id}/models/test`, {
      model: customModel.trim() || model,
      prompt,
      maxTokens
    }),
    onSuccess: (payload) => setResult(JSON.stringify(payload, null, 2)),
    onError: (error) => setResult(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : t("manage.testFailed") }, null, 2))
  });

  if (!activeProvider) return <div className="empty">{t("manage.noProviders")}</div>;
  return (
    <div className="model-test-panel">
      <Label>
        {t("manage.provider")}
        <Select value={activeProvider.id} onChange={(event) => {
          setProviderId(event.target.value);
          setCustomModel("");
        }}>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </Select>
      </Label>
      <Label>
        {t("manage.model")}
        <Select value={model} onChange={(event) => setModel(event.target.value)}>
          {activeProvider.models.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
        </Select>
      </Label>
      <Label>
        {t("manage.customModel")}
        <Input value={customModel} placeholder={t("manage.customModelPlaceholder")} onChange={(event) => setCustomModel(event.target.value)} />
      </Label>
      <Label>
        {t("manage.maxTokens")}
        <Input type="number" min="16" max="512" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} />
      </Label>
      <Label className="model-test-prompt">
        {t("manage.prompt")}
        <Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </Label>
      <Button type="button" onClick={() => testModel.mutate()} disabled={testModel.isPending}>{testModel.isPending ? t("manage.testing") : t("manage.runModelTest")}</Button>
      {result ? <pre className="summary compact">{result}</pre> : null}
    </div>
  );
}

function PolicyCard({ policy }: { policy: NonNullable<ManagementConfig["policies"]>[number] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [result, setResult] = useState("");
  const publish = useMutation({
    mutationFn: () => apiPost(`/api/policies/${policy.id}/versions`, {}),
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      setResult(t("manage.policyPublished", { version: payload.version }));
    }
  });
  const apply = useMutation({
    mutationFn: () => apiPost(`/api/policies/${policy.id}/apply`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      setResult(t("manage.policyApplied"));
    }
  });
  return (
    <Card className="skill-card">
      <CardHeader className="pb-3">
        <div className="card-heading">
          <CardTitle>{policy.name}</CardTitle>
          <Badge variant="outline">{policy.status} v{policy.version}</Badge>
        </div>
      </CardHeader>
      <CardContent>
      <p>${policy.draft.maxCostUsd} · {policy.draft.maxIterations} iterations · {policy.draft.allowedProviders.join(", ")}</p>
      <div className="button-row">
        <Button type="button" variant="secondary" onClick={() => publish.mutate()} disabled={publish.isPending}>{t("manage.publishPolicy")}</Button>
        <Button type="button" variant="secondary" onClick={() => apply.mutate()} disabled={apply.isPending}>{t("manage.applyPolicy")}</Button>
      </div>
      {result ? <small>{result}</small> : null}
      </CardContent>
    </Card>
  );
}

function SkillCard({ skill }: { skill: ManagementConfig["skills"][number] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [result, setResult] = useState("");
  const toggleSkill = useMutation({
    mutationFn: () => apiPatch(`/api/skills/${skill.id}`, { enabled: !skill.enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["skills"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      setResult(!skill.enabled ? t("manage.enabled") : t("manage.disabled"));
    }
  });
  const runEval = useMutation({
    mutationFn: () => apiPost(`/api/skills/${skill.id}/evals`, {}),
    onSuccess: (payload) => setResult(payload.eval?.passed ? t("manage.evalPassed") : t("manage.evalBlocked")),
    onError: (error) => setResult(error instanceof Error ? error.message : t("manage.evalBlocked"))
  });
  return (
    <Card className="skill-card">
      <CardHeader className="pb-3">
        <div className="card-heading">
          <CardTitle>{skill.name}</CardTitle>
          <Badge variant="outline">{skill.activeVersion} · {skill.source}</Badge>
        </div>
      </CardHeader>
      <CardContent>
      <p>{skill.description}</p>
      <small>{skill.enabled ? t("manage.enabled") : t("manage.disabled")} · {skill.evals.join(", ")}</small>
      <div className="button-row">
        <Button type="button" variant="secondary" onClick={() => toggleSkill.mutate()} disabled={toggleSkill.isPending}>
          {skill.enabled ? t("manage.disable") : t("manage.enable")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => runEval.mutate()} disabled={runEval.isPending}>{t("manage.runEval")}</Button>
      </div>
      {result ? <small>{result}</small> : null}
      </CardContent>
    </Card>
  );
}

function InfoCard({ title, meta, body }: { title: string; meta?: string; body: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="card-heading">
          <CardTitle>{title}</CardTitle>
          {meta ? <Badge variant="secondary">{meta}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent>
        <p>{body}</p>
      </CardContent>
    </Card>
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

function parseDraftDefinition(value: string): Record<string, any> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBuilderDefinition(definition: Record<string, any>) {
  const steps = Array.isArray(definition.steps) ? definition.steps.filter((step: any) => step?.id && step?.type) : [];
  return {
    ...definition,
    steps,
    edges: steps.slice(0, -1).map((step: any, index: number) => ({ from: step.id, to: steps[index + 1].id })),
    artifacts: Array.isArray(definition.artifacts) ? definition.artifacts.filter((artifact: any) => artifact?.id && artifact?.type) : []
  };
}

function getEffectiveProviderRole(stepType: string, providerRole: string) {
  const role = providerRole.trim();
  if (role) return role;
  if (stepType === "agent" || stepType === "verifier") return "llm";
  if (stepType === "artifact") return "artifact";
  return "";
}

function formatStepRouting(step: FlowSummary["steps"][number], providers: ManagedProvider[], t: any) {
  const provider = providers.find((candidate) => candidate.id === step.providerId);
  if (provider) return `${t("define.routing")}: ${provider.name} / ${step.model || provider.activeModel || t("define.modelAuto")}`;
  const role = getEffectiveProviderRole(step.type, step.providerRole || "");
  return role ? `${t("define.routing")}: ${role} ${t("define.providerAuto")}` : `${t("define.routing")}: ${t("define.providerAuto")}`;
}

function sanitizeUiId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

function createUniqueBuilderId(base: string, existingIds: string[]) {
  const cleanBase = sanitizeUiId(base) || "step";
  if (!existingIds.includes(cleanBase)) return cleanBase;
  let index = 2;
  while (existingIds.includes(`${cleanBase}_${index}`)) index += 1;
  return `${cleanBase}_${index}`;
}
