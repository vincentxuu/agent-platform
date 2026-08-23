# Project Conventions

## Frontend: prioritize AI Elements

The frontend should prioritize **AI Elements** (`https://elements.ai-sdk.dev/`) — the shadcn/ui-based component library for AI-native UIs (conversation, message, prompt-input, reasoning, sources, suggestion, etc.).

### Prefer registry over custom UI

When a UI need appears (sidebar, card with icon, empty state, settings panel, etc.), **search the shadcn registry first and install existing items** instead of hand-rolling CSS or wrapping divs:

```bash
pnpm dlx shadcn@latest search -q "<keyword>" @shadcn        # find a primitive or block
pnpm dlx shadcn@latest view @shadcn/<name>                   # inspect before installing
pnpm dlx shadcn@latest add @shadcn/<name> -o -c . -y         # install (overwrites ui/ primitives if needed)
```

Official `@shadcn` registry has ui primitives (sidebar, card, dialog, ...) plus 16 `sidebar-XX` blocks and many chart/dashboard blocks. If `@shadcn` lacks a fit, search third-party registries (e.g., community shadcn-compatible registries) before considering custom code.

Custom CSS classes in `apps/web/src/styles.css` should **not** duplicate registry behavior. The previous hand-rolled `.sidebar*` / `.nav-*` / `.brand-block` / `.runtime-pill` / `.language-switcher` classes were removed in favor of `@shadcn/sidebar` (block `sidebar-02`).

### Layout
- AI Elements components: `apps/web/src/components/ai-elements/`
- Base shadcn/ui primitives: `apps/web/src/components/ui/`
- Project sidebar: `apps/web/src/components/app-sidebar.tsx` (composes `@shadcn/sidebar`)
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

For shadcn block additions (e.g. `sidebar-02`), the CLI writes `components/<block-name>/components/*.tsx` directly into `apps/web/src/components/` — no manual move needed.

### Known integration quirks
- **Select is split:** `ui/select.tsx` is the Radix Select (required by AI Elements `prompt-input`). `App.tsx` uses a simple native `<select>` exposed as `ui/native-select.tsx` (`import { Select } from "./components/ui/native-select"`). Keep both — do not replace `native-select` with the Radix one in `App.tsx`.
- **`workers-types` clash:** the shared `tsconfig.json` includes Cloudflare `workers-types`, whose global `append` clashes with DOM `ParentNode.append`. In `ai-elements/conversation.tsx` use `document.body.appendChild(link)` (not `append`).
- `tsconfig.json` `lib` includes `DOM.Iterable` (AI Elements iterates `FileList`).
- **Mobile sidebar UX changed:** the previous hand-rolled sidebar had a horizontal scrolling mobile nav. `@shadcn/sidebar` uses a Sheet-based mobile drawer (triggered by `SidebarTrigger` shown `<md`). If you need horizontal mobile nav back, customize via Tailwind overrides on the installed components — don't re-introduce the old custom CSS.
