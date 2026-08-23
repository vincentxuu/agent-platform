# Project Conventions

## Frontend: prioritize AI Elements

The frontend should prioritize **AI Elements** (`https://elements.ai-sdk.dev/`) — the shadcn/ui-based component library for AI-native UIs (conversation, message, prompt-input, reasoning, sources, suggestion, etc.).

### Layout
- AI Elements components: `apps/web/src/components/ai-elements/`
- Base shadcn/ui primitives: `apps/web/src/components/ui/`
- `cn` util: `apps/web/src/lib/utils.ts`
- `@/` alias → `apps/web/src` (configured in `vite.config.ts` and `tsconfig.json`)
- shadcn `components.json` lives at the **repo root** (deps/`package.json` are there).

### Adding a component
AI Elements ships as a shadcn registry. The CLI writes `ai-elements/*` to repo-root `components/` (registry target path), so move it afterward:

```bash
pnpm dlx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json -y -o -c .
mv components/ai-elements apps/web/src/components/ai-elements
```

`-o` overwrites existing ui primitives (AI Elements expects canonical shadcn versions).

### Known integration quirks
- **Select is split:** `ui/select.tsx` is the Radix Select (required by AI Elements `prompt-input`). `App.tsx` uses a simple native `<select>` exposed as `ui/native-select.tsx` (`import { Select } from "./components/ui/native-select"`). Keep both — do not replace `native-select` with the Radix one in `App.tsx`.
- **`workers-types` clash:** the shared `tsconfig.json` includes Cloudflare `workers-types`, whose global `append` clashes with DOM `ParentNode.append`. In `ai-elements/conversation.tsx` use `document.body.appendChild(link)` (not `append`).
- `tsconfig.json` `lib` includes `DOM.Iterable` (AI Elements iterates `FileList`).
