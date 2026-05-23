// @ts-nocheck
import { readFileSync } from "node:fs";

const html = readFileSync("apps/web/index.html", "utf8");
const app = readFileSync("apps/web/src/app.ts", "utf8");
const css = readFileSync("apps/web/src/styles.css", "utf8");

const requiredHtml = [
  "flow-select",
  "topic-input",
  "preset-select",
  "runtime-status",
  "timeline-list",
  "step-detail",
  "context-view",
  "evidence-view",
  "artifact-view",
  "observability-view",
  "management-view"
];

for (const token of requiredHtml) {
  if (!html.includes(token)) {
    throw new Error(`Missing UI element: ${token}`);
  }
}

const requiredApp = [
  "操作流程檢查",
  "可編輯設定",
  "技能版本管理",
  "儲存技能版本",
  "新增草稿 Skill",
  "儲存標註",
  "重新產生",
  "編輯產物",
  "儲存版本",
  "版本差異",
  "loadObservability",
  "Provider Calls",
  "/api/config",
  "/api/skills",
  "/artifacts/",
  "/api/health",
  "/api/runs",
  "Cloudflare",
  "policy",
  "providerCalls",
  "toolInvocations",
  "guardResults",
  "contextBlocks",
  "evidence",
  "artifacts",
  "management"
];

for (const token of requiredApp) {
  if (!app.includes(token)) {
    throw new Error(`Missing app behavior token: ${token}`);
  }
}

if (!css.includes("@media")) {
  throw new Error("Expected responsive CSS");
}

if (!html.includes("./src/app.ts")) {
  throw new Error("Expected web shell to load TypeScript source through Vite");
}

console.log("web check passed");
