// @ts-nocheck
import { readFileSync } from "node:fs";

const html = readFileSync("apps/web/index.html", "utf8");
const app = readFileSync("apps/web/src/App.tsx", "utf8");
const main = readFileSync("apps/web/src/main.tsx", "utf8");
const i18n = readFileSync("apps/web/src/i18n.ts", "utf8");
const css = readFileSync("apps/web/src/styles.css", "utf8");

const requiredHtml = [
  "root",
  "./src/main.tsx"
];

for (const token of requiredHtml) {
  if (!html.includes(token)) {
    throw new Error(`Missing UI element: ${token}`);
  }
}

const requiredApp = [
  "useTranslation",
  "flow-select",
  "topic-input",
  "preset-select",
  "runtime-status",
  "useQuery",
  "observability.providerCalls",
  "observability.toolInvocations",
  "/artifacts/",
  "/api/health",
  "/api/runs",
  "policy",
  "contextBlocks"
];

for (const token of requiredApp) {
  if (!app.includes(token)) {
    throw new Error(`Missing app behavior token: ${token}`);
  }
}

if (!css.includes("@media")) {
  throw new Error("Expected responsive CSS");
}

if (!main.includes("QueryClientProvider")) {
  throw new Error("Expected React Query provider in web entrypoint");
}

for (const token of ["i18next", "react-i18next", "LanguageDetector", "\"zh-Hant\"", "en"]) {
  if (!i18n.includes(token)) {
    throw new Error(`Missing i18n token: ${token}`);
  }
}

if (!html.includes("./src/main.tsx")) {
  throw new Error("Expected web shell to load React TypeScript entrypoint through Vite");
}

console.log("web check passed");
