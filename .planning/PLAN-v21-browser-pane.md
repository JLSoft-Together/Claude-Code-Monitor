# PLAN v21 — Browser + file viewer tabs in Workspace (2026-10-14)

Goal: open HTML the agent writes right next to the terminal, no switching to an external browser.

Decisions (owner, 2026-10-14): pane in Workspace; full toolbar + device modes + served over HTTP; open by Ctrl/⌘+click path in terminal, auto reload on file change, pick file / type URL.

## Shape

- Pane gets `kind: 'term' | 'browser'` (+ `url`). Split menu: Claude / Codex / Shell / **Browser**. Launch picker gets Browser too. Persisted in `SavedPane` + `ccm.workspace.last`.
- Render: Electron `<webview>` (main window `webviewTag: true`), partition `persist:ccm-preview` → separate session, so the app-key header (`sendAppKey`, default session) never reaches previewed pages.
- Hardening (`will-attach-webview`): drop preload, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, partition must be `persist:ccm-preview`, src must be http(s). `window.open` → same pane (localhost/preview) or `shell.openExternal` (other https). Permission requests denied except clipboard-write.

## Preview server (desktop main, `src/preview/server.ts`)

- `http.createServer` on `127.0.0.1:0`, path `/<token>/<rel>`; token per root folder (pane cwd or file's folder), random 16 bytes, map token→root.
- Serve only inside root (`realpath` + prefix check), dir → `index.html`, MIME table, `Cache-Control: no-store`, no directory listing → 404.
- Real HTTP so `fetch`, ES modules, relative assets, CORS same-origin work (no `file://` quirks).
- IPC `ccm:preview-url(path)` → `{ url }` (frame check). URLs typed by user (`http://localhost:5173`, https) pass through untouched.

## Live reload

- `fs.watch(root, { recursive: true })` per active root (win/mac native), ignore `node_modules`, `.git`, `dist` noise? (keep dist), debounce 150 ms → IPC `ccm:preview-changed(token)` → pane `reloadIgnoringCache()` keeping scroll best-effort. Toggle in toolbar (default on). Close watcher when no pane uses the root.

## Toolbar (Apple style, 36px, chrome material)

Back · Forward · Reload (spinner while loading) · address field (path or URL; Enter navigates; shows host+path, full in tooltip) · device menu (Responsive / iPhone 390×844 / iPad 820×1180 / Laptop 1280×800 / Desktop 1440×900, rotate) + zoom (50–200%) · live-reload toggle · Open in browser · DevTools · close. Device mode = centered frame with checker-free neutral backdrop, scaled to fit.

## Opening

- xterm link provider in `TermPane`: absolute / relative (`pane.cwd`) paths ending `.html`/`.htm`, `file://…`, `http://localhost|127.0.0.1:…` → Ctrl/⌘+click opens/reuses browser pane in same tab (split right), else new split. Hover underline + tooltip.
- Toolbar "Open file…" uses existing `pickFolder`-style IPC with html filter.

## Files

desktop: `main.ts` (webviewTag, will-attach-webview, IPC), `preview/server.ts`, `preview/watch.ts`, `preload.ts` (`previewUrl`, `onPreviewChanged`, `openExternal`, `pickHtml`).
web: `stores/workspace.ts` (kind/url), `components/workspace/BrowserPane.vue`, `BrowserToolbar.vue`, `DeviceMenu.vue`, `SplitMenu.vue`, `LaunchPicker.vue`, `WorkspaceView.vue` (render by kind), `TermPane.vue` (link provider), `lib/desktop.ts`, i18n en/vi.
Tests: preview server unit (traversal, MIME, token), E2E `e2e/browser.cjs` (split → Browser, open fixture html, edit file → reload, device mode, link click).

## UI reference (owner screenshot, 2026-10-14 — SpaceVibe Deck style)

- Top tab strip mixes kinds: agent tab (agent icon + task title), file tab (doc icon + filename), **browser tab (globe icon + `localhost:5173`)**, `+`. → Browser opens as its own **tab** by default (globe + host/filename label), and can also sit as a split pane next to a terminal (split menu → Browser).
- Toolbar lives inside the browser tab content, slim; tab label = page host or file name, favicon if page has one, else globe.
- `+` menu: Claude / Codex / Shell / Browser.
- **File viewer tab** (doc icon + filename) — in scope (owner, 2026-10-14), see below.

## File viewer tab

- Pane `kind: 'file'` (+ `path`). Opens as tab (default) or split. Read-only.
- Open: Ctrl/⌘+click any file path in terminal (`src/x.ts`, `src/x.ts:42`, `src/x.ts:42:7`, relative to pane cwd or absolute) → file tab scrolled to that line; `.html` paths open Browser instead (modifier+Shift → file view). Also "Open file…" in `+` menu.
- Render: syntax highlight with `shiki` (lazy-loaded per language, Apple-ish light/dark themes mapped to tokens) — fallback plain mono. Line numbers, current-line highlight on jump target, wrap toggle, find (Ctrl/⌘+F), copy path, reveal in Explorer/Finder, open in editor (`code`/system default via `shell.openPath`).
- Markdown: rendered preview ↔ source toggle. Images (png/jpg/svg/webp/gif): image view. Binary / >2 MB: notice + open externally.
- Live: same root watcher as browser → content refreshes on change, keeps scroll; changed lines flash briefly (diff vs previous text, cheap line diff).
- Read via IPC `ccm:read-file(path)` (desktop main): only regular files, size cap, returns text + mtime; path must resolve under a workspace pane cwd or a path user picked (no arbitrary reads from page).

## Order

Start after v20 (audit + motion) lands — same files (`WorkspaceView`, `TermPane`, `SplitMenu`, store).
