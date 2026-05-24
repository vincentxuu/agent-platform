import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

export const resources = {
  "zh-Hant": {
    translation: {
      nav: {
        skipToContent: "跳到主要內容",
        console: "工作流控制台",
        primary: "主要導覽",
        startRun: "開始新的 Run",
        runtime: "Runtime",
        groups: {
          workspace: "工作區",
          operations: "執行監控",
          review: "驗證與管理"
        },
        descriptions: {
          run: "建立與啟動工作流",
          define: "編輯 Flow 草稿與版本",
          timeline: "追蹤步驟與控制 run",
          observability: "查看成本、工具與 trace",
          context: "檢查上下文與記憶",
          evidence: "核准、拒絕與註記證據",
          artifacts: "再生、審核與匯出產物",
          manage: "設定 provider、policy、skill"
        },
        run: "執行",
        define: "定義",
        timeline: "時間線",
        observability: "觀測",
        context: "上下文",
        evidence: "證據",
        artifacts: "產物",
        manage: "管理"
      },
      run: {
        title: "執行研究流程",
        subtitle: "Local-first demo run 使用同一組 API contract；部署後由 Cloudflare Worker 提供後端。",
        flow: "流程",
        flowDeepResearch: "深度研究",
        topic: "主題",
        audience: "讀者",
        freshnessDays: "資料新鮮度（天）",
        preset: "策略",
        quick: "快速",
        standard: "標準",
        deep: "深入",
        start: "開始執行",
        starting: "啟動中",
        recentRuns: "最近執行",
        clear: "清空",
        noRuns: "尚無執行紀錄。",
        startFailed: "無法開始執行"
      },
      define: {
        title: "定義 Flow",
        subtitle: "建立、複製、編輯、驗證並發布可執行的 flow version。",
        create: "建立 Flow",
        clone: "複製目前 Flow",
        save: "儲存草稿",
        publish: "發布版本",
        archive: "封存",
        draft: "草稿",
        version: "版本",
        empty: "尚無 flow。",
        created: "Flow 已建立。",
        cloned: "Flow 已複製成草稿。",
        saved: "草稿已儲存，驗證通過。",
        savedWithErrors: "草稿已儲存，但驗證未通過：",
        published: "已發布 v{{version}}。",
        archived: "Flow 已刪除或封存。",
        failed: "Flow command failed"
      },
      timeline: {
        title: "執行時間線",
        retry: "重試步驟",
        cancel: "取消執行",
        waitingForRun: "等待建立 run",
        attempt: "attempt"
      },
      context: {
        title: "上下文",
        runtimeContext: "runtime context"
      },
      observability: {
        title: "觀測",
        providerCalls: "Provider Calls",
        toolInvocations: "Tool Invocations",
        tokens: "Tokens",
        cost: "Cost",
        latency: "Latency",
        retries: "Retries",
        step: "Step"
      },
      evidence: {
        title: "證據",
        selectRun: "先建立或選取 run 以檢視 evidence。",
        empty: "目前 run 尚未產生 evidence。",
        reviewedNote: "Reviewed in React UI",
        approvedNote: "Approved in Verify surface",
        rejectedNote: "Rejected in Verify surface",
        annotatedNote: "Annotated for follow-up",
        approve: "核准",
        reject: "拒絕",
        annotate: "註記",
        review: "Review"
      },
      artifacts: {
        title: "產物",
        selectRun: "先建立或選取 run 以檢視 artifacts。",
        empty: "目前 run 尚未產生 artifacts。",
        regenerate: "重新產生",
        approve: "核准",
        reject: "拒絕",
        download: "下載",
        diff: "版本差異"
      },
      manage: {
        title: "管理",
        loading: "管理設定載入中。",
        openSourceRuntime: "Open-source runtime",
        localUsable: "本機可用",
        cloudflareDeployReady: "Cloudflare deploy ready",
        policies: "Policies",
        publishPolicy: "發布 Policy",
        applyPolicy: "套用到 Flow",
        policyPublished: "Policy 已發布 v{{version}}",
        policyApplied: "Policy 已套用到 Flow",
        improvements: "改進提案",
        createImprovement: "建立改進提案",
        noImprovements: "尚無 reviewable improvement proposal。",
        providers: "Providers",
        createProvider: "新增 Provider",
        skillVersions: "技能版本管理",
        enabled: "enabled",
        disabled: "disabled",
        enable: "啟用",
        disable: "停用",
        policyAllowed: "policy allowed",
        blocked: "blocked",
        test: "測試",
        testing: "測試中...",
        ready: "可用：{{model}}",
        notReady: "不可用：{{detail}}",
        runEval: "執行 Eval",
        evalPassed: "Eval 通過",
        evalBlocked: "Eval blocked"
      },
      runtime: {
        cloudflare: "Cloudflare",
        local: "本機",
        offline: "離線"
      },
      steps: {
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
      },
      statuses: {
        idle: "待命",
        queued: "排隊中",
        running: "執行中",
        pending: "等待中",
        waiting: "等待中",
        succeeded: "完成",
        complete: "完成",
        failed: "失敗",
        canceled: "已取消",
        ready: "就緒",
        partial: "部分就緒"
      },
      language: {
        label: "語言",
        zhHant: "繁中",
        en: "English"
      }
    }
  },
  en: {
    translation: {
      nav: {
        skipToContent: "Skip to main content",
        console: "Workflow Console",
        primary: "Primary navigation",
        startRun: "Start New Run",
        runtime: "Runtime",
        groups: {
          workspace: "Workspace",
          operations: "Operations",
          review: "Review And Admin"
        },
        descriptions: {
          run: "Create and start workflows",
          define: "Edit flow drafts and versions",
          timeline: "Track steps and control runs",
          observability: "Inspect cost, tools, and traces",
          context: "Review context and memory",
          evidence: "Approve, reject, and annotate evidence",
          artifacts: "Regenerate, review, and export outputs",
          manage: "Configure providers, policies, and skills"
        },
        run: "Run",
        define: "Define",
        timeline: "Timeline",
        observability: "Observability",
        context: "Context",
        evidence: "Evidence",
        artifacts: "Artifacts",
        manage: "Manage"
      },
      run: {
        title: "Run research workflow",
        subtitle: "The local-first demo uses the same API contract; Cloudflare Worker serves the backend after deployment.",
        flow: "Flow",
        flowDeepResearch: "Deep Research",
        topic: "Topic",
        audience: "Audience",
        freshnessDays: "Freshness window (days)",
        preset: "Preset",
        quick: "Quick",
        standard: "Standard",
        deep: "Deep",
        start: "Start run",
        starting: "Starting",
        recentRuns: "Recent runs",
        clear: "Clear",
        noRuns: "No runs yet.",
        startFailed: "Unable to start run"
      },
      define: {
        title: "Define Flow",
        subtitle: "Create, clone, edit, validate, and publish runnable flow versions.",
        create: "Create Flow",
        clone: "Clone Current Flow",
        save: "Save Draft",
        publish: "Publish Version",
        archive: "Archive",
        draft: "Draft",
        version: "Version",
        empty: "No flows yet.",
        created: "Flow created.",
        cloned: "Flow cloned as a draft.",
        saved: "Draft saved and validation passed.",
        savedWithErrors: "Draft saved with validation errors:",
        published: "Published v{{version}}.",
        archived: "Flow deleted or archived.",
        failed: "Flow command failed"
      },
      timeline: {
        title: "Run timeline",
        retry: "Retry step",
        cancel: "Cancel run",
        waitingForRun: "Waiting for a run",
        attempt: "attempt"
      },
      context: {
        title: "Context",
        runtimeContext: "runtime context"
      },
      observability: {
        title: "Observability",
        providerCalls: "Provider Calls",
        toolInvocations: "Tool Invocations",
        tokens: "Tokens",
        cost: "Cost",
        latency: "Latency",
        retries: "Retries",
        step: "Step"
      },
      evidence: {
        title: "Evidence",
        selectRun: "Create or select a run to inspect evidence.",
        empty: "This run has not produced evidence yet.",
        reviewedNote: "Reviewed in React UI",
        approvedNote: "Approved in Verify surface",
        rejectedNote: "Rejected in Verify surface",
        annotatedNote: "Annotated for follow-up",
        approve: "Approve",
        reject: "Reject",
        annotate: "Annotate",
        review: "Review"
      },
      artifacts: {
        title: "Artifacts",
        selectRun: "Create or select a run to inspect artifacts.",
        empty: "This run has not produced artifacts yet.",
        regenerate: "Regenerate",
        approve: "Approve",
        reject: "Reject",
        download: "Download",
        diff: "Version diff"
      },
      manage: {
        title: "Manage",
        loading: "Loading management settings.",
        openSourceRuntime: "Open-source runtime",
        localUsable: "Local usable",
        cloudflareDeployReady: "Cloudflare deploy ready",
        policies: "Policies",
        publishPolicy: "Publish Policy",
        applyPolicy: "Apply to Flow",
        policyPublished: "Policy published v{{version}}",
        policyApplied: "Policy applied to flow",
        improvements: "Improvement Proposals",
        createImprovement: "Create Improvement",
        noImprovements: "No reviewable improvement proposals yet.",
        providers: "Providers",
        createProvider: "Create Provider",
        skillVersions: "Skill version management",
        enabled: "enabled",
        disabled: "disabled",
        enable: "Enable",
        disable: "Disable",
        policyAllowed: "policy allowed",
        blocked: "blocked",
        test: "Test",
        testing: "Testing...",
        ready: "Ready: {{model}}",
        notReady: "Not ready: {{detail}}",
        runEval: "Run Eval",
        evalPassed: "Eval passed",
        evalBlocked: "Eval blocked"
      },
      runtime: {
        cloudflare: "Cloudflare",
        local: "Local",
        offline: "Offline"
      },
      steps: {
        clarify: "Clarify requirements",
        build_brief: "Build research brief",
        plan: "Plan research path",
        search: "Search sources",
        rank_sources: "Rank sources",
        read_sources: "Read sources",
        extract_evidence: "Extract evidence",
        synthesize: "Synthesize findings",
        verify: "Verify output",
        export: "Export artifacts"
      },
      statuses: {
        idle: "Idle",
        queued: "Queued",
        running: "Running",
        pending: "Pending",
        waiting: "Waiting",
        succeeded: "Complete",
        complete: "Complete",
        failed: "Failed",
        canceled: "Canceled",
        ready: "Ready",
        partial: "Partial"
      },
      language: {
        label: "Language",
        zhHant: "繁中",
        en: "English"
      }
    }
  }
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "zh-Hant",
    supportedLngs: ["zh-Hant", "en"],
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"]
    }
  });

export default i18n;
