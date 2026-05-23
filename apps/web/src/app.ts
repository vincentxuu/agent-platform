// @ts-nocheck
const state = {
  policy: {
    maxCostUsd: 3,
    maxIterations: 4,
    providers: ["OpenAI", "Anthropic", "MVP Search", "Jina Reader"],
    citationRequired: true
  },
  steps: [
    "clarify",
    "build_brief",
    "plan",
    "search",
    "rank_sources",
    "read_sources",
    "extract_evidence",
    "synthesize",
    "verify",
    "export"
  ],
  contextBlocks: [
    { type: "instructions", tokens: 84, source: "system" },
    { type: "skill_guidance", tokens: 120, source: "research-planner@1.0.0" },
    { type: "tool_descriptions", tokens: 64, source: "search.web" },
    { type: "retrieval_evidence", tokens: 420, source: "selected sources" },
    { type: "memory", tokens: 40, source: "episodic summary" }
  ],
  evidence: [],
  artifacts: [],
  artifactEdits: {},
  artifactDiffs: {},
  skills: [],
  skillBindings: [],
  observability: null,
  management: ["流程", "技能", "模型與工具", "政策", "記憶", "評測", "觀測", "證據", "產物"],
  config: null
};

const stepLabels = {
  clarify: "釐清需求",
  build_brief: "建立研究簡報",
  plan: "規劃研究路徑",
  search: "搜尋資料",
  rank_sources: "排序來源",
  read_sources: "閱讀來源",
  extract_evidence: "抽取證據",
  synthesize: "綜合結論",
  verify: "驗證結果",
  export: "輸出產物"
};

const statusLabels = {
  idle: "待命",
  queued: "排隊中",
  running: "執行中",
  pending: "等待中",
  succeeded: "完成",
  complete: "完成",
  failed: "失敗",
  canceled: "已取消",
  waiting: "等待中",
  blocked: "受阻",
  ready: "就緒",
  partial: "部分就緒"
};

const policySummary = document.querySelector("#policy-summary");
const timelineList = document.querySelector("#timeline-list");
const stepDetail = document.querySelector("#step-detail");
const contextView = document.querySelector("#context-view");
const observabilityView = document.querySelector("#observability-view");
const evidenceView = document.querySelector("#evidence-view");
const artifactView = document.querySelector("#artifact-view");
const managementView = document.querySelector("#management-view");
const runtimeStatus = document.querySelector("#runtime-status");
const runHistory = document.querySelector("#run-history");
const runError = document.querySelector("#run-error");
const clearRunsButton = document.querySelector("#clear-runs");
let pollTimer;
let currentRunId;
const topicInput = document.querySelector("#topic-input");
const audienceInput = document.querySelector("#audience-input");
const freshnessInput = document.querySelector("#freshness-input");
const presetSelect = document.querySelector("#preset-select");
const defaultFlowName = "深度研究";

audienceInput?.addEventListener("input", () => {
  if (audienceInput instanceof HTMLInputElement) audienceInput.dataset.userEdited = "true";
});

document.querySelector("#run-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showRunError("");
  const topic = topicInput instanceof HTMLInputElement ? topicInput.value : "";
  const audience = audienceInput instanceof HTMLInputElement ? audienceInput.value : "";
  const freshnessDays = freshnessInput instanceof HTMLInputElement ? Number(freshnessInput.value) : 365;
  const presetId = presetSelect instanceof HTMLSelectElement ? presetSelect.value : "standard";

  const runStart = await startRun({ topic, audience, freshnessDays, presetId });
  if (runStart && runStart.ok !== false) {
    renderTimeline("running");
    stepDetail.textContent = JSON.stringify({
      runtime: runtimeStatus.textContent,
      runId: runStart.run.id,
      stepRunId: runStart.stepRun.id,
      workflow: runStart.workflow,
      queued: runStart.queued,
      flow: defaultFlowName,
      providerCalls: 0,
      toolInvocations: 0,
      guardResults: "pending"
    }, null, 2);
    currentRunId = runStart.run.id;
    pollRun(currentRunId);
    loadRunHistory();
    return;
  }

  showRunError(runStart?.message || "無法開始執行。請確認本機開發伺服器或 Cloudflare Worker 正在運作。");
});

document.querySelector("#retry-step").addEventListener("click", async () => {
  if (!currentRunId) {
    stepDetail.textContent = "請先開始一個執行，再重試步驟。";
    return;
  }
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/retry-step`, { method: "POST" });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    stepDetail.textContent = message || "無法重試目前步驟。";
    return;
  }
  const payload = await response.json();
  if (isObject(payload) && payload.run) renderRun(payload.run);
  loadRunHistory();
  pollRun(currentRunId);
});

document.querySelector("#cancel-run").addEventListener("click", async () => {
  if (!currentRunId) {
    stepDetail.textContent = "請先開始一個執行，再取消。";
    return;
  }
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/cancel`, { method: "POST" });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    stepDetail.textContent = message || "無法取消目前執行。";
    return;
  }
  const payload = await response.json();
  if (isObject(payload) && payload.run) renderRun(payload.run);
  loadRunHistory();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
});

clearRunsButton?.addEventListener("click", async () => {
  if (!confirm("要清空所有執行紀錄嗎？")) return;
  const response = await fetch("/api/runs", { method: "DELETE" });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  currentRunId = undefined;
  state.evidence = [];
  state.artifacts = [];
  renderTimeline("idle");
  renderEvidence();
  renderArtifacts();
  stepDetail.textContent = "";
  loadRunHistory();
  renderManagement();
});

function render() {
  policySummary.textContent = JSON.stringify(state.policy, null, 2);
  detectRuntime();
  loadRunHistory();
  renderTimeline("idle");
  renderContext();
  renderObservability();
  renderEvidence();
  renderArtifacts();
  renderManagement();
}

function renderTimeline(status) {
  timelineList.innerHTML = "";
  state.steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = index === 0 && status === "running" ? "active" : "";
    const itemStatus = index === 0 && status === "running" ? "running" : "pending";
    item.innerHTML = `<span>${escapeHtml(labelStep(step))}</span><strong>${escapeHtml(labelStatus(itemStatus))}</strong>`;
    timelineList.appendChild(item);
  });
}

function renderContext() {
  contextView.innerHTML = state.contextBlocks.map((block) => card(block.type, `${block.tokens} tokens`, block.source)).join("");
}

function renderObservability() {
  if (!state.observability) {
    observabilityView.innerHTML = "<small>開始或開啟一個 run 後會顯示成本、token、provider/tool 使用與 trace。</small>";
    return;
  }
  const metrics = state.observability.metrics || {};
  const providerCalls = state.observability.providerCalls || [];
  const toolInvocations = state.observability.toolInvocations || [];
  const trace = state.observability.trace || [];
  observabilityView.innerHTML = [
    card("成本", `${metrics.totalCostUsd ?? 0} USD`, `Provider calls: ${metrics.providerCallCount ?? 0}\nTool invocations: ${metrics.toolInvocationCount ?? 0}`),
    card("Token / Latency", `${metrics.totalTokens ?? 0} tokens`, `Latency: ${metrics.totalLatencyMs ?? 0} ms\nRetries: ${metrics.retryCount ?? 0}`),
    card("Provider Calls", `${providerCalls.length} records`, providerCalls.map((call) => `${call.provider} · ${labelStep(call.stepId)} · ${call.status} · $${call.costUsd} · ${call.tokens} tokens`).join("\n") || "尚無 provider call"),
    card("Tool Invocations", `${toolInvocations.length} records`, toolInvocations.map((tool) => `${tool.tool} · ${labelStep(tool.stepId)} · ${tool.status} · ${tool.durationMs} ms`).join("\n") || "尚無 tool invocation"),
    card("Trace", `${trace.length} spans`, trace.map((span) => `${labelStep(span.stepId)} · ${labelStatus(span.status)} · ${span.durationMs} ms`).join("\n") || "尚無 trace")
  ].join("");
}

function renderEvidence() {
  evidenceView.innerHTML = state.evidence.map((item) => {
    const sourceLabel = item.sourceTitle || item.source;
    const sourceUrl = item.sourceUrl ? `\n${item.sourceUrl}` : "";
    const index = state.evidence.indexOf(item);
    const reviewStatus = item.review?.status || "watch";
    return `<article class="card evidence-card" data-evidence-index="${index}">
      <h3>${escapeHtml(item.claim)}</h3>
      <p>${escapeHtml(labelEvidenceReview(reviewStatus))} · ${escapeHtml(item.confidence)}</p>
      <pre>${escapeHtml(`${sourceLabel}${sourceUrl}\n${item.excerpt}`)}</pre>
      <label>Review
        <select class="evidence-review-status">
          ${["accepted", "watch", "rejected"].map((status) => `<option value="${status}" ${reviewStatus === status ? "selected" : ""}>${labelEvidenceReview(status)}</option>`).join("")}
        </select>
      </label>
      <label>備註
        <textarea class="evidence-review-note" rows="3">${escapeHtml(item.review?.note || "")}</textarea>
      </label>
      <button type="button" class="secondary evidence-save">儲存標註</button>
    </article>`;
  }).join("");
  for (const button of evidenceView.querySelectorAll(".evidence-save")) {
    button.addEventListener("click", saveEvidenceReview);
  }
}

function renderArtifacts() {
  const regenerate = currentRunId
    ? `<article class="card artifact-action"><h3>Review Summary</h3><p>依目前 Evidence 標註重新產生</p><button type="button" id="regenerate-artifacts">重新產生</button></article>`
    : "";
  artifactView.innerHTML = `${regenerate}${state.artifacts.map((artifact) => artifactCard(artifact)).join("")}`;
  document.querySelector("#regenerate-artifacts")?.addEventListener("click", regenerateArtifacts);
  for (const button of artifactView.querySelectorAll(".artifact-edit")) {
    button.addEventListener("click", startArtifactEdit);
  }
  for (const button of artifactView.querySelectorAll(".artifact-save")) {
    button.addEventListener("click", saveArtifactVersion);
  }
  for (const button of artifactView.querySelectorAll(".artifact-diff")) {
    button.addEventListener("click", loadArtifactDiff);
  }
}

function renderManagement() {
  managementView.innerHTML = "<small>載入操作設定...</small>";
  loadManagement();
}

async function loadManagement() {
  try {
    const [readinessResponse, configResponse, skillsResponse] = await Promise.all([
      fetch("/api/readiness"),
      fetch("/api/config"),
      fetch("/api/skills")
    ]);
    if (!readinessResponse.ok || !configResponse.ok || !skillsResponse.ok) return;
    const readiness = await readinessResponse.json();
    const configReport = await configResponse.json();
    const skillReport = await skillsResponse.json();
    if (!isObject(readiness) || !isObject(configReport) || !isObject(skillReport)) return;
    state.config = configReport.config;
    state.skills = Array.isArray(skillReport.skills) ? skillReport.skills : [];
    state.skillBindings = Array.isArray(skillReport.bindings) ? skillReport.bindings : [];
    applyConfigToRunForm(configReport.config);
    renderPolicyFromConfig(configReport.config);
    renderManagementWorkspace(readiness, configReport);
  } catch {
    managementView.innerHTML = state.management.map((item) => `<button type="button">${item}</button>`).join("");
  }
}

function renderManagementWorkspace(readiness, configReport) {
  managementView.innerHTML = [
    renderOperationFlow(configReport.operationFlow || {}),
    renderEditableSurfaceAudit(configReport.editableSurfaces || []),
    renderSkillManagement(),
    renderConfigForm(configReport.config || {}),
    renderReadiness(readiness)
  ].join("");
  document.querySelector("#management-config-form")?.addEventListener("submit", saveManagementConfig);
  document.querySelector("#skill-create-form")?.addEventListener("submit", createSkillDraft);
  for (const button of document.querySelectorAll(".skill-save")) {
    button.addEventListener("click", saveSkillVersion);
  }
}

function renderReadiness(readiness) {
  const local = readiness.local || {};
  const cloudflare = readiness.cloudflare || {};
  const providers = readiness.providers || {};
  const resources = Array.isArray(cloudflare.resources) ? cloudflare.resources : [];
  const providerChecks = Array.isArray(providers.configured) ? providers.configured : [];

  return `<section class="management-section"><h3>部署與 Provider 狀態</h3><div class="management-grid">${[
    readinessCard(
      "本機開發",
      readiness.usableNow ? "就緒" : "受阻",
      `${local.server || "本機伺服器"}\n持久化：${local.persistence?.ready ? "就緒" : "等待中"}\n執行數：${local.persistence?.runCount ?? 0}`
    ),
    readinessCard(
      "Cloudflare 部署",
      cloudflare.deployReady ? "就緒" : "需要設定",
      resources.map((item) => `${item.ready ? "OK" : "SETUP"} ${item.name}: ${item.detail}`).join("\n")
    ),
    readinessCard(
      "線上 Provider",
      providers.liveProviderReady ? "部分就緒" : "僅本機替身",
      providerChecks.map((item) => `${item.ready ? "OK" : "SETUP"} ${item.name}: ${item.detail}`).join("\n")
    )
  ].join("")}</div></section>`;
}

function readinessCard(title, status, body) {
  return `<article class="card readiness-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(status)}</p><pre>${escapeHtml(body)}</pre></article>`;
}

function renderOperationFlow(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  return `<section class="management-section">
    <div class="panel-heading compact"><h3>操作流程檢查</h3><span class="status">可操作地圖</span></div>
    <div class="flow-map">
      ${nodes.map((node, index) => `
        <article class="flow-node ${escapeHtml(node.status || "partial")}">
          <strong>${escapeHtml(node.label || node.id)}</strong>
          <span>${escapeHtml(labelOperationStatus(node.status))}</span>
          <small>${escapeHtml(node.detail || "")}</small>
        </article>
        ${index < nodes.length - 1 ? "<span class=\"flow-arrow\">→</span>" : ""}
      `).join("")}
    </div>
  </section>`;
}

function renderEditableSurfaceAudit(items) {
  return `<section class="management-section">
    <h3>可編輯性缺口</h3>
    <div class="management-grid">
      ${items.map((item) => `<article class="card ${item.editable ? "editable" : "readonly"}">
        <h3>${escapeHtml(item.label)}</h3>
        <p>${item.editable ? "可編輯" : "目前唯讀"}</p>
        <pre>${escapeHtml(item.detail)}</pre>
      </article>`).join("")}
    </div>
  </section>`;
}

function renderSkillManagement() {
  const bindingBySkill = new Map((state.skillBindings || []).map((binding) => [String(binding.defaultBinding || "").split("@")[0], binding]));
  return `<section class="management-section skill-management">
    <div class="panel-heading compact"><h3>技能版本管理</h3><span class="status">可編輯</span></div>
    <div class="management-grid">
      ${(state.skills || []).map((skill) => {
        const binding = bindingBySkill.get(skill.id);
        return `<article class="card skill-card" data-skill-id="${escapeHtml(skill.id)}">
          <h3>${escapeHtml(skill.name)}</h3>
          <p>${escapeHtml(skill.source || "built-in")} · ${escapeHtml(skill.id)}</p>
          <pre>${escapeHtml(`${skill.description || ""}\nActive: ${skill.id}@${skill.activeVersion}\nFlow binding: ${binding?.activeBinding || "未綁定"}\nPermissions: ${(skill.permissions || []).join(", ") || "none"}\nEvals: ${(skill.evals || []).join(", ") || "none"}`)}</pre>
          <label class="inline-check">
            <input class="skill-enabled" type="checkbox" ${skill.enabled ? "checked" : ""}>
            啟用
          </label>
          <label>Active version
            <input class="skill-version" value="${escapeHtml(skill.activeVersion)}" list="versions-${escapeHtml(skill.id)}">
            <datalist id="versions-${escapeHtml(skill.id)}">
              ${(skill.availableVersions || []).map((version) => `<option value="${escapeHtml(version)}"></option>`).join("")}
            </datalist>
          </label>
          <button type="button" class="secondary skill-save">儲存技能版本</button>
        </article>`;
      }).join("")}
      <form id="skill-create-form" class="card skill-card">
        <h3>新增草稿 Skill</h3>
        <label>Skill ID
          <input id="new-skill-id" placeholder="custom-research-checker">
        </label>
        <label>名稱
          <input id="new-skill-name" placeholder="Custom Research Checker">
        </label>
        <label>版本
          <input id="new-skill-version" value="0.1.0">
        </label>
        <label>描述
          <textarea id="new-skill-description" rows="3"></textarea>
        </label>
        <button type="submit">新增草稿</button>
        <div id="skill-save-status" class="status-line"></div>
      </form>
    </div>
  </section>`;
}

async function saveSkillVersion(event) {
  const cardElement = event.currentTarget.closest(".skill-card");
  const skillId = cardElement?.getAttribute("data-skill-id");
  if (!skillId) return;
  const response = await fetch(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled: Boolean(cardElement.querySelector(".skill-enabled")?.checked),
      activeVersion: cardElement.querySelector(".skill-version")?.value || "1.0.0"
    })
  });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  await loadManagement();
}

async function createSkillDraft(event) {
  event.preventDefault();
  const status = document.querySelector("#skill-save-status");
  const response = await fetch("/api/skills", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: document.querySelector("#new-skill-id")?.value || "",
      name: document.querySelector("#new-skill-name")?.value || "",
      version: document.querySelector("#new-skill-version")?.value || "0.1.0",
      description: document.querySelector("#new-skill-description")?.value || "",
      permissions: ["provider:llm"],
      evals: ["output-schema"]
    })
  });
  if (!response.ok) {
    if (status) status.textContent = await readErrorMessage(response);
    return;
  }
  if (status) status.textContent = "已新增草稿。";
  await loadManagement();
}

function renderConfigForm(config) {
  const flow = config.flow || {};
  const policy = config.policy || {};
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const allowedProviders = new Set(policy.allowedProviders || []);
  return `<form id="management-config-form" class="management-section config-form">
    <div class="panel-heading compact">
      <h3>可編輯設定</h3>
      <button type="submit">儲存設定</button>
    </div>
    <div class="management-grid">
      <article class="card">
        <h3>流程預設</h3>
        <label>預設策略
          <select id="config-default-preset">
            ${["quick", "standard", "deep"].map((preset) => `<option value="${preset}" ${flow.defaultPreset === preset ? "selected" : ""}>${labelPreset(preset)}</option>`).join("")}
          </select>
        </label>
        <label>預設讀者
          <input id="config-default-audience" value="${escapeHtml(flow.defaultAudience || "")}">
        </label>
        <label>預設新鮮度（天）
          <input id="config-default-freshness" type="number" min="1" step="1" value="${escapeHtml(flow.defaultFreshnessDays || 365)}">
        </label>
      </article>
      <article class="card">
        <h3>Policy</h3>
        <label>成本上限 USD
          <input id="config-max-cost" type="number" min="0.01" step="0.01" value="${escapeHtml(policy.maxCostUsd || 3)}">
        </label>
        <label>最大迭代
          <input id="config-max-iterations" type="number" min="1" step="1" value="${escapeHtml(policy.maxIterations || 4)}">
        </label>
        <label class="inline-check">
          <input id="config-citation-required" type="checkbox" ${policy.citationRequired ? "checked" : ""}>
          必須引用來源
        </label>
      </article>
      <article class="card provider-card">
        <h3>Providers</h3>
        ${providers.map((provider) => `<div class="provider-row" data-provider-id="${escapeHtml(provider.id)}">
          <label class="inline-check">
            <input class="provider-enabled" type="checkbox" ${provider.enabled ? "checked" : ""}>
            ${escapeHtml(provider.name)}
          </label>
          <label class="inline-check">
            <input class="provider-allowed" type="checkbox" ${allowedProviders.has(provider.id) ? "checked" : ""}>
            Policy 允許
          </label>
          <input class="provider-credential" value="${escapeHtml(provider.credentialRef || "")}" aria-label="${escapeHtml(provider.name)} credential reference">
        </div>`).join("")}
      </article>
    </div>
    <div id="config-save-status" class="status-line"></div>
  </form>`;
}

async function saveManagementConfig(event) {
  event.preventDefault();
  const providers = [...document.querySelectorAll(".provider-row")].map((row) => ({
    id: row.getAttribute("data-provider-id"),
    enabled: row.querySelector(".provider-enabled")?.checked,
    credentialRef: row.querySelector(".provider-credential")?.value || ""
  }));
  const allowedProviders = [...document.querySelectorAll(".provider-row")]
    .filter((row) => row.querySelector(".provider-allowed")?.checked)
    .map((row) => row.getAttribute("data-provider-id"))
    .filter(Boolean);
  const payload = {
    flow: {
      id: "deep_research",
      defaultPreset: document.querySelector("#config-default-preset")?.value || "standard",
      defaultAudience: document.querySelector("#config-default-audience")?.value || "工程管理者",
      defaultFreshnessDays: Number(document.querySelector("#config-default-freshness")?.value || 365)
    },
    policy: {
      maxCostUsd: Number(document.querySelector("#config-max-cost")?.value || 3),
      maxIterations: Number(document.querySelector("#config-max-iterations")?.value || 4),
      citationRequired: Boolean(document.querySelector("#config-citation-required")?.checked),
      allowedProviders
    },
    providers
  };
  const status = document.querySelector("#config-save-status");
  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      status.textContent = await readErrorMessage(response);
      return;
    }
    const configReport = await response.json();
    state.config = configReport.config;
    applyConfigToRunForm(configReport.config);
    renderPolicyFromConfig(configReport.config);
    status.textContent = "已儲存設定。";
  } catch {
    status.textContent = "儲存失敗，請確認 API 連線。";
  }
}

function applyConfigToRunForm(config) {
  if (!config?.flow) return;
  if (audienceInput instanceof HTMLInputElement && !audienceInput.dataset.userEdited) {
    audienceInput.value = config.flow.defaultAudience || audienceInput.value;
  }
  if (freshnessInput instanceof HTMLInputElement) {
    freshnessInput.value = String(config.flow.defaultFreshnessDays || freshnessInput.value);
  }
  if (presetSelect instanceof HTMLSelectElement) {
    presetSelect.value = config.flow.defaultPreset || presetSelect.value;
  }
}

function renderPolicyFromConfig(config) {
  if (!config?.policy) return;
  state.policy = {
    maxCostUsd: config.policy.maxCostUsd,
    maxIterations: config.policy.maxIterations,
    providers: (config.providers || []).filter((provider) => config.policy.allowedProviders?.includes(provider.id)).map((provider) => provider.name),
    citationRequired: config.policy.citationRequired
  };
  policySummary.textContent = JSON.stringify(state.policy, null, 2);
}

async function loadRunHistory() {
  try {
    const response = await fetch("/api/runs");
    if (!response.ok) return;
    const payload = await response.json();
    if (!isObject(payload) || !Array.isArray(payload.runs)) return;
    renderRunHistory(payload.runs);
  } catch {
    runHistory.innerHTML = "";
  }
}

function renderRunHistory(runs) {
  runHistory.innerHTML = "";
  if (runs.length === 0) {
    runHistory.innerHTML = "<small>尚無執行紀錄。</small>";
    return;
  }

  runs.slice(0, 6).forEach((run) => {
    const row = document.createElement("div");
    row.className = "run-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.innerHTML = `<span>${escapeHtml(run.topic || run.id)}<br><small>${escapeHtml(run.audience || "讀者")} · ${escapeHtml(run.freshnessDays || "新鮮度")} 天 · ${escapeHtml(labelPreset(run.presetId))} · ${escapeHtml(run.updatedAt || run.createdAt)}</small></span><strong>${escapeHtml(labelStatus(run.status))}</strong>`;
    button.addEventListener("click", () => openRun(run.id));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "×";
    deleteButton.title = `刪除 ${run.id}`;
    deleteButton.addEventListener("click", () => deleteRun(run.id));
    row.appendChild(button);
    row.appendChild(deleteButton);
    runHistory.appendChild(row);
  });
}

async function deleteRun(runId) {
  if (!confirm(`要刪除 ${runId} 嗎？`)) return;
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  if (currentRunId === runId) {
    currentRunId = undefined;
    state.evidence = [];
    state.artifacts = [];
    state.observability = null;
    renderTimeline("idle");
    renderObservability();
    renderEvidence();
    renderArtifacts();
    stepDetail.textContent = "";
  }
  loadRunHistory();
  renderManagement();
}

async function saveEvidenceReview(event) {
  if (!currentRunId) return;
  const cardElement = event.currentTarget.closest(".evidence-card");
  const evidenceIndex = cardElement?.getAttribute("data-evidence-index");
  if (evidenceIndex === null || evidenceIndex === undefined) return;
  const status = cardElement.querySelector(".evidence-review-status")?.value || "watch";
  const note = cardElement.querySelector(".evidence-review-note")?.value || "";
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/evidence/${encodeURIComponent(evidenceIndex)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, note })
  });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  const payload = await response.json();
  if (isObject(payload) && payload.run) renderRun(payload.run);
}

async function regenerateArtifacts() {
  if (!currentRunId) return;
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/artifacts/regenerate`, { method: "POST" });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  const payload = await response.json();
  if (isObject(payload) && payload.run) renderRun(payload.run);
}

async function openRun(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) return;
  const payload = await response.json();
  if (!isObject(payload)) return;
  const run = payload.run || payload.coordinator;
  if (!run) return;
  currentRunId = run.id;
  renderRun(run);
  loadObservability(run.id);
  if (run.status === "queued" || run.status === "running") {
    pollRun(run.id);
  }
}

function card(title, meta, body) {
  return `<article class="card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(meta)}</p><pre>${escapeHtml(body)}</pre></article>`;
}

function artifactCard(artifact) {
  const link = artifact.downloadUrl ? `<a href="${escapeHtml(artifact.downloadUrl)}">下載</a>` : "";
  const edit = state.artifactEdits[artifact.id];
  const diff = state.artifactDiffs[artifact.id];
  const editor = edit ? `<div class="artifact-editor">
    <label>編輯內容
      <textarea class="artifact-content" rows="10">${escapeHtml(edit.content || "")}</textarea>
    </label>
    <label>版本備註
      <input class="artifact-note" value="${escapeHtml(edit.note || "")}">
    </label>
    <button type="button" class="artifact-save" data-artifact-id="${escapeHtml(artifact.id)}">儲存版本</button>
  </div>` : "";
  const diffView = diff ? `<pre class="artifact-diff-view">${escapeHtml(formatArtifactDiff(diff))}</pre>` : "";
  return `<article class="card artifact-card" data-artifact-id="${escapeHtml(artifact.id)}">
    <h3>${escapeHtml(labelArtifact(artifact.name))}</h3>
    <p>${escapeHtml(artifact.type)} · 版本 ${escapeHtml(artifact.version)}</p>
    <div class="artifact-actions">
      ${link}
      <button type="button" class="secondary artifact-edit" data-artifact-id="${escapeHtml(artifact.id)}">編輯產物</button>
      <button type="button" class="secondary artifact-diff" data-artifact-id="${escapeHtml(artifact.id)}">版本差異</button>
    </div>
    ${editor}
    ${diffView}
  </article>`;
}

async function startArtifactEdit(event) {
  if (!currentRunId) return;
  const artifactId = event.currentTarget.getAttribute("data-artifact-id");
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (!artifact || !artifact.downloadUrl) return;
  const response = await fetch(artifact.downloadUrl);
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  state.artifactEdits[artifact.id] = {
    content: await response.text(),
    note: `手動編輯 ${new Date().toISOString()}`
  };
  renderArtifacts();
}

async function saveArtifactVersion(event) {
  if (!currentRunId) return;
  const artifactId = event.currentTarget.getAttribute("data-artifact-id");
  const cardElement = event.currentTarget.closest(".artifact-card");
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (!artifact || !cardElement) return;
  const rawContent = cardElement.querySelector(".artifact-content")?.value || "";
  const note = cardElement.querySelector(".artifact-note")?.value || "";
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/artifacts/${encodeURIComponent(artifact.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: artifact.type === "JSON" ? parseJsonInput(rawContent) : rawContent,
      note
    })
  });
  if (!response.ok) {
    showRunError(await readErrorMessage(response));
    return;
  }
  const payload = await response.json();
  delete state.artifactEdits[artifact.id];
  delete state.artifactDiffs[artifact.id];
  if (isObject(payload) && payload.run) renderRun(payload.run);
}

async function loadArtifactDiff(event) {
  if (!currentRunId) return;
  const artifactId = event.currentTarget.getAttribute("data-artifact-id");
  if (!artifactId) return;
  const response = await fetch(`/api/runs/${encodeURIComponent(currentRunId)}/artifacts/${encodeURIComponent(artifactId)}/diff`);
  if (!response.ok) {
    state.artifactDiffs[artifactId] = { lines: [{ type: "changed", before: "", after: await readErrorMessage(response) }] };
    renderArtifacts();
    return;
  }
  const payload = await response.json();
  state.artifactDiffs[artifactId] = payload.diff;
  renderArtifacts();
}

function parseJsonInput(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatArtifactDiff(diff) {
  const lines = Array.isArray(diff?.lines) ? diff.lines : [];
  if (lines.length === 0) return "最近兩版沒有內容差異。";
  return lines.map((line) => {
    if (line.type === "added") return `+ ${line.after || ""}`;
    if (line.type === "removed") return `- ${line.before || ""}`;
    return `~ ${line.before || ""}\n+ ${line.after || ""}`;
  }).join("\n");
}

async function detectRuntime() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("health check failed");
    const health = await response.json();
    if (!isObject(health)) throw new Error("Invalid health payload");
    runtimeStatus.textContent = health.runtime === "cloudflare" ? "Cloudflare" : "本機";
    state.policy.providers = ["Workers AI", "OpenAI", "Anthropic", "Cloudflare Search Adapter", "Jina Reader"];
    policySummary.textContent = JSON.stringify({
      ...state.policy,
      runtime: health.runtime,
      cloudflareServices: Array.isArray(health.services) ? health.services.map((service) => service.service) : []
    }, null, 2);
  } catch {
    runtimeStatus.textContent = "離線";
  }
}

async function startRun({ topic, audience, freshnessDays, presetId }) {
  try {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        presetId,
        inputs: {
          topic,
          audience,
          freshness_days: freshnessDays
        }
      })
    });
    if (!response.ok) {
      return { ok: false, message: await readErrorMessage(response) };
    }
    const payload = await response.json();
    return isObject(payload) ? payload : null;
  } catch {
    return null;
  }
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    if (!isObject(payload)) return "";
    const details = Array.isArray(payload.details) ? `\n${payload.details.map((item) => `- ${item}`).join("\n")}` : "";
    return `${translateError(payload.error || "請求失敗")}${details}`;
  } catch {
    return response.statusText || "請求失敗";
  }
}

function showRunError(message) {
  if (!(runError instanceof HTMLElement)) return;
  if (!message) {
    runError.hidden = true;
    runError.textContent = "";
    return;
  }
  runError.hidden = false;
  runError.textContent = message;
}

async function pollRun(runId) {
  if (pollTimer) clearInterval(pollTimer);
  const refresh = async () => {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (!isObject(payload)) return;
    const run = payload.run || payload.coordinator;
    if (!run) return;

    renderRun(run);
    loadObservability(run.id);
    loadRunHistory();
    if (run.status === "complete" || run.status === "failed") {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
  await refresh();
  pollTimer = setInterval(refresh, 750);
}

function renderRun(run) {
  if (Array.isArray(run.timeline)) {
    timelineList.innerHTML = "";
    run.timeline.forEach((item) => {
      const element = document.createElement("li");
      element.className = item.status === "running" ? "active" : "";
      element.innerHTML = `<span>${escapeHtml(labelStep(item.stepId))}</span><strong>${escapeHtml(labelStatus(item.status))}</strong>`;
      timelineList.appendChild(element);
    });
  }
  if (run.detail) {
    stepDetail.textContent = JSON.stringify(run.detail, null, 2);
  }
  if (Array.isArray(run.evidence)) {
    state.evidence = run.evidence;
    renderEvidence();
  }
  if (Array.isArray(run.artifacts)) {
    state.artifacts = run.artifacts;
    renderArtifacts();
  }
}

async function loadObservability(runId) {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/observability`);
    if (!response.ok) return;
    const payload = await response.json();
    if (!isObject(payload)) return;
    state.observability = payload.observability;
    renderObservability();
  } catch {
    // Keep the current observability view if refresh fails.
  }
}

function labelStep(stepId) {
  return stepLabels[stepId] || stepId;
}

function labelStatus(status) {
  return statusLabels[status] || status;
}

function labelPreset(presetId) {
  return {
    quick: "快速",
    standard: "標準",
    deep: "深入"
  }[presetId] || presetId;
}

function labelArtifact(name) {
  return {
    "Markdown Report": "Markdown 報告",
    "Evidence Bundle": "證據資料包",
    "Workflow Summary": "工作流摘要"
  }[name] || name;
}

function labelEvidenceReview(status) {
  return {
    accepted: "採用",
    rejected: "排除",
    watch: "待確認"
  }[status] || status || "待確認";
}

function labelOperationStatus(status) {
  return {
    editable: "可編輯",
    operable: "可操作",
    partial: "部分支援"
  }[status] || status || "待補";
}

function translateError(message) {
  return {
    "Invalid request": "請求格式不正確",
    "Run not found": "找不到執行紀錄",
    "Request failed": "請求失敗"
  }[message] || message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

render();
