import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

export const resources = {
  "zh-Hant": {
    translation: {
      nav: {
        run: "執行",
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
        review: "Review"
      },
      artifacts: {
        title: "產物",
        selectRun: "先建立或選取 run 以檢視 artifacts。",
        empty: "目前 run 尚未產生 artifacts。",
        regenerate: "重新產生",
        download: "下載",
        diff: "版本差異"
      },
      manage: {
        title: "管理",
        loading: "管理設定載入中。",
        openSourceRuntime: "Open-source runtime",
        localUsable: "本機可用",
        cloudflareDeployReady: "Cloudflare deploy ready",
        providers: "Providers",
        skillVersions: "技能版本管理",
        enabled: "enabled",
        disabled: "disabled",
        policyAllowed: "policy allowed",
        blocked: "blocked",
        test: "測試",
        testing: "測試中...",
        ready: "可用：{{model}}",
        notReady: "不可用：{{detail}}"
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
        run: "Run",
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
        review: "Review"
      },
      artifacts: {
        title: "Artifacts",
        selectRun: "Create or select a run to inspect artifacts.",
        empty: "This run has not produced artifacts yet.",
        regenerate: "Regenerate",
        download: "Download",
        diff: "Version diff"
      },
      manage: {
        title: "Manage",
        loading: "Loading management settings.",
        openSourceRuntime: "Open-source runtime",
        localUsable: "Local usable",
        cloudflareDeployReady: "Cloudflare deploy ready",
        providers: "Providers",
        skillVersions: "Skill version management",
        enabled: "enabled",
        disabled: "disabled",
        policyAllowed: "policy allowed",
        blocked: "blocked",
        test: "Test",
        testing: "Testing...",
        ready: "Ready: {{model}}",
        notReady: "Not ready: {{detail}}"
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
