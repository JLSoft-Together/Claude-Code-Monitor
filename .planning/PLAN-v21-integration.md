# PLAN v21 — phase 2 integration notes (browser + file viewer tabs)

Phase 1 (2026-10-14) created only new files. Everything below edits existing files.

## Phase 1 inventory

desktop `apps/desktop/src/preview/`
- `paths.ts` — `isWithin` (win32 case-insensitive), `rootKey`, `realOrNull`, `realRoots`, `rootOf` (deepest root).
- `server.ts` — `PreviewServer` (`start()` → port on 127.0.0.1:0, `origin`, `register(root)`, `urlFor(path, roots)` → `{url, root, token}`, `tokensUnder(root)`, `close()`). Host header must be `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding), realpath + prefix check, dir → `index.html` (301 to trailing slash), no listing, HEAD, byte ranges, `no-store` + `nosniff` + `CORP same-origin`. Unknown token + same-origin `Referer` with a known token → 307 `/<refToken><path>` (root-relative assets like `/app.css`).
- `watch.ts` — `RootWatcher` (`add/remove` refcounted per root, `listen(fn)`, `closeAll`), ignores `node_modules` / `.git`, 150 ms debounce, `error` → drop.
- `files.ts` — `readFileForView(path, roots)` → `{kind: text|image|binary|too-large|missing|denied, path, size, mtimeMs, text?, lang?}` (`lang` = lowercase ext or `dockerfile`/`makefile`). Added `denied` kind (outside roots).
- `ipc.ts` — `registerPreviewIpc(deps)` → `{ grant(dir), dispose() }`; `hardenWebviews(contents, {previewSession, openExternal})`; `PREVIEW_PARTITION`, `isWebUrl`, `isLoopbackUrl`, `isExecutablePath`.
- tests `apps/desktop/test/preview.test.ts`.

web
- `lib/preview.ts` (bridge wrappers, `onPreviewChanged` fan-out, `parseAddress`, `dirOf`, `baseName`), `lib/fileLinks.ts` (`findLinks`, `resolveLink`, `joinPath`, `createFileLinkProvider`), `lib/codeView.ts` (`grammarFor`, `findMatches`, `renderLine`, `changedLines`, `escapeHtml`), `lib/highlight.ts` (shiki core + JS regex engine + css-variables theme, 39 lazy grammars, >400 KB plain), `lib/markdown.ts` (escape-first renderer, no raw HTML, links http(s)/#/relative only, images → alt text), `lib/browserDevices.ts`.
- `components/workspace/BrowserPane.vue`, `BrowserToolbar.vue`, `DeviceMenu.vue`, `FilePane.vue`.
- `i18n/workspace-viewer.ts` (`{ en, vi }`, each `{ browser, viewer }`).
- tests `lib/fileLinks.test.ts`, `lib/viewer.test.ts`.
- dep `shiki@^4.5.0` (apps/web/package.json + root package-lock.json).

## Desktop

### `main.ts`
```ts
import { session } from 'electron'  // already imported
import { hardenWebviews, PREVIEW_PARTITION, registerPreviewIpc, type PreviewIpc } from './preview/ipc'
import { PreviewServer } from './preview/server'
import { RootWatcher } from './preview/watch'

const preview = new PreviewServer()
const previewWatch = new RootWatcher()
let previewIpc: PreviewIpc | null = null
```
1. `baseWindow` → only the main window gets `webviewTag: true` (pass via `createMainWindow` options: `webPreferences: {...base, webviewTag: true}`; compact window stays without). Right after `harden(win.webContents)` in `createMainWindow`: `hardenWebviews(win.webContents, { previewSession: session.fromPartition(PREVIEW_PARTITION), openExternal })`.
2. Global guard (top level, before `whenReady`):
   ```ts
   app.on('web-contents-created', (_e, contents) => {
     // Only the main window may host <webview>; hardenWebviews re-checks partition/src there.
     contents.on('will-attach-webview', (event) => { if (contents !== mainWindow?.webContents) event.preventDefault() })
   })
   ```
   (Register order: this listener and the one from `hardenWebviews` both run; either `preventDefault` blocks.)
3. In `ready()` after `ptys` is created:
   ```ts
   await preview.start()
   const appFrame = (event: Electron.IpcMainInvokeEvent): boolean => {
     const frame = event.senderFrame
     return !!frame && !frame.parent && isAppUrl(frame.url) && host.ownsPort
   }
   previewIpc = registerPreviewIpc({
     ipcMain, isAppFrame: appFrame, server: preview, watcher: previewWatch, shell, dialog,
     getWindow: () => mainWindow,
     getRoots: async () => ((await ptys?.census()) ?? []).map((s) => s.cwd),
   })
   ```
   Also `previewIpc.grant(folder)` inside `ccm:pick-folder` after a successful pick (folder chosen in LaunchPicker becomes readable before its PTY reports `ready`). Census is cached? It is an IPC round trip to the PTY host per call — fine for user-driven actions; if it shows in profiles, cache 2 s.
4. Quit: in the `stopping = Promise.allSettled([...])` list add `preview.close()`, and before it `previewIpc?.dispose(); previewWatch.closeAll()`. `session-end` handler: same three calls (sync parts).
5. `lockPermissions` untouched (default session only); preview session is locked inside `hardenWebviews` (only `clipboard-sanitized-write`, device permissions denied).
6. Downloads from preview pages: default Electron save dialog. Optional: `session.fromPartition(PREVIEW_PARTITION).on('will-download', …)` to force a save dialog in Downloads.

### `preload.ts` (add to the exposed object)
```ts
previewUrl: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:preview-url', path),
readFile: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:read-file', path),
watch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:watch', root),
unwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:unwatch', root),
pickFile: (kind: 'html' | 'any'): Promise<unknown> => ipcRenderer.invoke('ccm:pick-file', kind),
openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-external', url),
reveal: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:reveal', path),
openPath: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-path', path),
onPreviewChanged: (handler: (change: unknown) => void): (() => void) => {
  const listener = (_e: unknown, change: unknown) => handler(change)
  ipcRenderer.on('ccm:preview-changed', listener)
  return () => ipcRenderer.removeListener('ccm:preview-changed', listener)
},
```
Note: a returned function crosses contextBridge fine (proxied).

### `.code_index/desktop.md`
Add a "Preview (v21)" section from the inventory above.

## Collector — CSP (`apps/collector/src/server.ts` `contentSecurityPolicy` + `test/csp.test.ts`)
- `frame-src http://127.0.0.1:* http://localhost:* https: http:` — `<webview>` is an OOPIF guest and is subject to the embedder's `frame-src` (`default-src 'self'` would block it). Verify in E2E; if the guest loads without it, keep the CSP as is.
- `img-src 'self' data: blob: http://127.0.0.1:*` — FilePane image view and the toolbar favicon of preview pages load from the preview server port. Remote favicons (https sites) are blocked by this CSP → toolbar falls back to the globe (acceptable; do not widen to `https:`).
- No `wasm-unsafe-eval` needed: highlighter uses the JS regex engine.

## Web

### `vite.config.ts`
`vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'webview' } } })` — otherwise Vue warns "Failed to resolve component: webview" (still renders).

### `lib/desktop.ts`
Optional: nothing required (`lib/preview.ts` declares its own `PreviewBridge`). If preferred, move the `PreviewBridge` members into `DesktopBridge` as optional and drop the cast in `preview.ts`.

### `stores/workspace.ts`
- `Pane` gets `kind: 'term' | 'browser' | 'file'` (missing = `'term'` for old sessionStorage / `ccm.workspace.last`), `url?: string` (browser: http(s) URL **or absolute file path** — BrowserPane emits file paths for preview pages because the port/token change each run), `path?: string`, `line?: number` (file), `title?: string`, `favicon?: string | null` (runtime only, not persisted).
- `preset` stays required for terms; for browser/file make it optional or keep `'shell'` placeholder — cleaner: discriminated union `TermPane | BrowserPaneState | FilePaneState`.
- Persist `kind/url/path/line` in sessionStorage `ccm.workspace.panes` and `LastPane` (`ccm.workspace.last`); `loadLast` validation: accept `kind` browser with string `url`, file with absolute `path`.
- New actions: `openBrowser(url, {split?: key, dir?})`, `openFile(path, line?, {split?})`, `reuseBrowser(tabKey)` (link click: reuse an existing browser pane in the same tab, else split right of the clicked pane), `update(key, {url|title|favicon|line})`.
- `split(key, dir, preset?)` → `split(key, dir, spec: {kind:'term', preset} | {kind:'browser', url} | {kind:'file', path})`.
- `isBusy` / close confirm (`usePaneInfo.describe`): browser/file panes never busy; describe = host or file name.
- `useWorkspaceLinks` / owners / attention: skip non-term panes (`pane.kind !== 'term'`).

### `WorkspaceView.vue`
- Render by kind in the absolute pane boxes: `TermPane` | `BrowserPane :url :active @navigate="(u) => ws.update(key, {url: u})" @title @favicon` | `FilePane :path :line :active @open="(p) => ws.openFile(p)"`.
- Tab label/icon: term = existing; browser = favicon `<img>` (only `http://127.0.0.1:*` or `localhost` sources pass CSP) else `Globe` `text-agent-browser` + label `host[:port]` (URL) or file name (preview path); file = `FileText` `text-agent-file` + `baseName(path)`; tooltip = full url/path.
- Browser/file panes need their own pane header (close ✕, split button) since they have no TermPane header: either wrap them in a small shared `PaneHeader` or add close/split into `BrowserToolbar`/`FilePane` toolbar via a slot (both toolbars are flex rows; append `<slot name="end" />` before closing `</div>` — phase-1 files can take that edit).
- `+` menu (new-tab popover / LaunchPicker): items Claude / Codex / Shell / **Browser** (opens empty browser tab, address focused) / **Open file…** (`pickFile('any')` → `.html/.htm` → browser, else file tab).
- Keyboard: focus inside a `<webview>` goes to the guest process — workspace shortcuts (Ctrl+Tab, Ctrl+Shift+W, Alt+arrows) do not reach the window while the page has focus. Guest handles F5/Ctrl+R (reload) and F12 (DevTools) itself (`ipc.ts` `hardenGuest`). If needed later: forward chords via `before-input-event` on the guest → `mainWindow.webContents.send('ccm:key', …)`.

### `SplitMenu.vue`
Add Browser (Globe `text-agent-browser`) + Open file… (FileText `text-agent-file`) under a separator; emit `pick({kind:'browser'})` / `pick({kind:'file'})`. LaunchPicker preset segmented control: add Browser only if the owner wants it there (plan says yes).

### `TermPane.vue` — link provider
```ts
import { createFileLinkProvider } from '../../lib/fileLinks'
// after term.open(...)
linkDisposable = term.registerLinkProvider(createFileLinkProvider(term, {
  cwd: () => props.pane.cwd,
  isMac,
  onOpen: (target, { line, shift }) => emit('openLink', target, { line, shift }),
  onHover: (target, e) => { /* optional tooltip: path + "Ctrl+click to open" */ },
  onLeave: () => { /* hide tooltip */ },
}))
// onBeforeUnmount: linkDisposable?.dispose()
```
WorkspaceView handles `openLink`: url → browser (reuse browser pane in same tab, else split right); file `.html/.htm` and not `shift` → browser with the path; any other file → file tab (default) / split (if the owner prefers) with `line`. Relative paths resolve against `pane.cwd` (spawn cwd; `cd` inside the shell is not tracked — known limit). Paths outside every live pane cwd → desktop answers `denied` (FilePane shows the notice; BrowserPane shows "outside the open project folders").

### i18n
In `en.ts`: `import viewer from './workspace-viewer'` then inside `workspace: { …, ...viewer.en }`; `vi.ts` same with `viewer.vi` (types line up: `vi` is typed `typeof en`). Keys: `workspace.browser.*`, `workspace.viewer.*`. Unused keys after integration can be trimmed (`browser.loadFailedDetail`, `viewer.updated`).

### `style.css` — tokens referenced by the new files (from `.planning/COLOR-SYSTEM.md`)
Add to `:root`/`.dark` + `@theme`:
- utilities: `--color-agent-browser` (`text-agent-browser`: light #0071a4 / dark #64d2ff), `--color-agent-file` (`text-agent-file`: #7f6545 / #b59469), `--color-success` (`text-success`, copy ✓), `--color-ink-disabled` (`disabled:text-ink-disabled` in DeviceMenu), `--color-accent-ink` (not used yet; use for accent text if added).
- CSS vars used with fallbacks in `FilePane.vue`: `--ccm-syn-keyword #ff7ab2`, `--ccm-syn-string #ff8170`, `--ccm-syn-number #d9c97c`, `--ccm-syn-comment #7f8c98`, `--ccm-syn-type #6bdfff`, `--ccm-syn-func #67b7a4`, `--ccm-syn-var` (= well-ink), `--ccm-selection` (#b3d7ff / #3f638b; code view is always on the dark well so it uses the dark value via fallback), `--ccm-diff-add-soft` (changed-line flash).
- shiki css-variables theme has no "type" or "number" slot: `constant` → `syn-number`, `link` → `syn-type`, `string-expression` → `syn-string`, `parameter` → `syn-var`, `punctuation` → well-ink.
- Motion: uses `--ccm-dur-base/slow`, `--ease-out-quint` with fallbacks; existing `ccm-fade`, `ccm-pop`, `ccm-shimmer`.

### `.code_index/web.md`, `_meta.md`
Add a "Browser + file viewer (v21)" block (files above) and one `_meta` line.

## E2E `apps/desktop/e2e/browser.cjs` (outline, CDP driver `cdp.cjs`)
1. Temp project dir with `index.html` (`<link href="/style.css">` root-relative + `./app.js` module), `style.css`, `src/a.ts`, `README.md`, `pic.png`.
2. Open a Shell pane with cwd = temp dir (LaunchPicker). `echo <dir>/index.html src/a.ts:3` in the shell.
3. Ctrl+click the html path (dispatch mouse on the xterm cell via `Input.dispatchMouseEvent` with modifiers 2) → a browser pane appears; poll the guest via `Target.getTargets` type `webview` → URL `http://127.0.0.1:<p>/<token>/index.html`; page `getComputedStyle(body).color` proves `/style.css` loaded via referer redirect.
4. Edit `index.html` on disk → guest reloads within ~1 s (check a `Date.now()` marker in `document.body.dataset`).
5. Device menu → iPhone: frame 390×844 scaled (read `.browser-frame` style transform); rotate → 844×390; zoom 150 → `webContents.getZoomFactor()` 1.5.
6. Ctrl+click `src/a.ts:3` → file pane, `[data-line="3"].is-target` visible; Ctrl+F type `const` → count text; edit file → `.is-flash` rows appear and scrollTop unchanged.
7. README.md → preview shows `<h1>`; toggle → source.
8. Security probes: from the guest, `fetch('http://127.0.0.1:4317/health')` ok but `/ws`/API 403; `window.open('https://example.com')` → no new BrowserWindow; navigating guest to `file:///C:/Windows/win.ini` blocked; `ccm:read-file` of `C:\Windows\win.ini` from the app page → `denied`.
9. Restart app with `ccm.workspace.last` restore → browser pane reopens the file path (new port/token) and file pane reopens at its path.

## Open questions
1. Allowed roots = live PTY cwds + picked folders. Ctrl+click on an absolute path outside every pane cwd (e.g. `%TEMP%\report.html`) is refused. Option: treat a link click as a user grant — main cannot verify the click, so this would let page script read any file; keep refused unless the owner accepts that risk.
2. All roots share the preview origin `127.0.0.1:<port>` (separated only by unguessable tokens). Per-root origin isolation would need `<token>.localhost` hosts (Chromium resolves `*.localhost` to loopback) — deferred.
3. "Open in editor" = `shell.openPath` (default app), with an executable-extension denylist (`.js`, `.py`, `.ps1`, `.bat`… are refused because their default handler runs them). A real "open in VS Code" could reuse the collector `opener.ts` Code.exe path — owner to decide.
4. File tab vs split as the default for terminal links (plan says tab for file, reuse/split for browser).
5. Markdown images are shown as alt text (no fetch from the app page). Could load via preview server URLs if wanted (needs img-src above, already planned).

# v23 integration (review tools, `.planning/PLAN-v23-review-tools.md`)

New modules (2026-10-14). Only new files + phase-1 files (`preview/ipc.ts`, `lib/preview.ts`, `BrowserPane/BrowserToolbar/FilePane.vue`, `i18n/workspace-viewer.ts`) were edited. Everything below edits existing files.

## Inventory

desktop `apps/desktop/src/preview/`
- `gitExec.ts` — `execGit(cwd, args, {input?, maxBytes?, timeoutMs?})` → `{code, stdout, stderr, truncated}`: absolute git (`findGit`), stdin, stdout cap (kills on overflow), `GIT_LITERAL_PATHSPECS=1`, `core.quotePath=false`, forced `a/` `b/` prefixes, no colour.
- `changes.ts` — `toplevel(dir)`, `status(root)` (porcelain v2 + `--numstat` vs HEAD, or the empty tree in a repo without commits; untracked line counts; cap 5000), `diff(root, rel)` (1 MB cap; untracked = synthesized new-file diff), `discardFile(root, rel, {trash})` (modified/deleted → `git restore --source=HEAD --staged --worktree`; untracked → trash; added → `rm --cached` + trash; renamed → both; conflict refused), `discardHunk(root, rel, patch)` (modified only; `hunkPatchFor` keeps exactly one hunk, verifies its counts and re-heads it for `rel`; `git apply -R --whitespace=nowarn --check -` then apply, patch on stdin), `safeRepoPath`, `parseStatusV2`, `parseNumstat`, `newFileDiff`, `GitDirWatcher` (fs.watch on the git dir for `index` / `HEAD` / `MERGE_HEAD`: commits and staging never touch the working tree the RootWatcher sees).
- `listFiles.ts` — `listFiles(root)` (`git ls-files -co --exclude-standard -z`, else walk ignoring node_modules/.git/dist/…), cap 50k, `FileListCache` (TTL 30 s, `invalidate(root)` on watcher events).
- `clipboardImage.ts` — `parsePngDataUrl` (png data URL only, base64, PNG signature, ≤ 20 MB), `writeClipboardImage(dataUrl, deps)` (nativeImage decode → re-encode → clipboard), `electronClipboardImage()`. Electron 44's clipboard is the async W3C-style API (`clipboard.write([new ClipboardItem({'image/png': Blob})])`); `clipboard.writeImage` no longer exists.
- `ipc.ts` additions (same `isAppFrame` gate):
  - `ccm:changes-status(dir)` → `ChangesStatus`. `dir` must be inside an allowed root; its git toplevel is registered (`repos`, usable while the dir it came from stays allowed) and may sit above the pane cwd.
  - `ccm:changes-diff({root, path})`, `ccm:changes-discard({root, path, hunk?})` → `root` must be a registered toplevel; `path` relative and contained (`safeRepoPath`).
  - `ccm:changes-watch(root)` / `ccm:changes-unwatch(root)` → RootWatcher (working tree) + GitDirWatcher, refcounted per webContents (released on navigate/destroy like `ccm:watch`); push `ccm:changes-updated {root}`.
  - `ccm:list-files(root)` → `FileList | null` (`root` = allowed dir or registered toplevel).
  - `ccm:clipboard-image(pngDataUrl)` → boolean.
  - `ccm:capture-guest(webContentsId)` → boolean: `capturePage()` of a `<webview>` guest whose `hostWebContents` is the caller, PNG to clipboard. Preferred over renderer `capturePage()` (its NativeImage is not usable under contextIsolation); BrowserPane falls back to `capturePage().toDataURL()` → `ccm:clipboard-image`.
  - New optional deps: `trash?` (default: `trashItem` of the passed `shell`), `clipboardImage?` (default: Electron's, lazy). `registerPreviewIpc` signature otherwise unchanged.
- tests `apps/desktop/test/changes.test.ts` (real temp repo: status / diff / hunk discard / file discard / trash / ls-files / cache / clipboard validation).

web
- `lib/diff.ts` (`parseUnifiedDiff`, `hunkPatch`, `firstChangedLine`, `sideBySide`), `lib/fuzzy.ts` (`fuzzyScore`, `fuzzyFilter(items, q, {limit, recent})`, `parseQuickOpen`, `highlightRuns`), `lib/devServer.ts` (`DevServerDetector` `feed(chunk) → new URLs` / `forget` / `reset`, `stripAnsi`, `normalizeDevUrl`, `devUrlLabel`, `rememberDevUrl` / `lastDevUrl` → localStorage `ccm.workspace.devUrl`), `lib/agentHandoff.ts` (`sanitize`, `consoleLevel`, `pushConsole` (last 50), `formatConsoleBlock`, `formatElementBlock`, `asElementPick`, `pickerScript(color)`, `PICKER_CANCEL_SCRIPT`, `HandoffAction`).
- `lib/preview.ts` additions: types `ChangeEntry / ChangesStatus / ChangesDiff / ChangesResult / FileList`; `hasChanges`, `changesStatus`, `changesDiff`, `changesDiscard`, `changesWatch`, `changesUnwatch`, `onChangesUpdated` (one IPC listener, fan-out), `listFiles`, `clipboardImage`, `captureGuest`, `hasCaptureGuest`.
- `components/workspace/`: `ChangesPane.vue` (+ `DiffView.vue`, `DiscardConfirm.vue`), `DevServerChip.vue`, `QuickOpen.vue`, `TermFind.vue`, `HandoffMenu.vue`, `ConsolePopover.vue`. `BrowserToolbar` gained the Send-to-agent button + `<slot name="end">`; `BrowserPane` gained console capture, screenshot, element picker, emits `insertText(text)` / `insertImage()`, `<slot name="toolbar-end">`; `FilePane` toolbar `<slot name="end">`.
- i18n `workspace.changes|devServer|handoff|quickOpen|termFind` in `i18n/workspace-viewer.ts` (ride the v21 spread).
- dep `@xterm/addon-search@0.16.0` (exact, xterm 6 family) in `apps/web/package.json` + lockfile.
- tests `src/lib/reviewTools.test.ts`.

## Desktop

### `preload.ts` (add to the exposed object)
```ts
changesStatus: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-status', dir),
changesDiff: (root: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-diff', { root, path }),
changesDiscard: (root: string, path: string, hunk?: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-discard', { root, path, hunk }),
changesWatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-watch', root),
changesUnwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-unwatch', root),
onChangesUpdated: (handler: (change: unknown) => void): (() => void) => {
  const listener = (_e: unknown, change: unknown) => handler(change)
  ipcRenderer.on('ccm:changes-updated', listener)
  return () => ipcRenderer.removeListener('ccm:changes-updated', listener)
},
listFiles: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:list-files', root),
clipboardImage: (pngDataUrl: string): Promise<unknown> => ipcRenderer.invoke('ccm:clipboard-image', pngDataUrl),
captureGuest: (webContentsId: number): Promise<unknown> => ipcRenderer.invoke('ccm:capture-guest', webContentsId),
```
`hunk` must stay `undefined` (not `null`) for a whole-file discard: the handler branches on `hunk !== undefined`.

### `main.ts`
- Nothing required beyond the v21 `registerPreviewIpc({...})` call: Electron's `shell` already has `trashItem`; clipboard deps load lazily. Optional explicit `trash: (p) => shell.trashItem(p)`.
- `ccm:capture-guest` only accepts guests attached to the calling window (main window has `webviewTag`) — nothing to add.
- Existing `clipboard.writeText(text)` in main.ts (logs) — Electron 44 makes it async; harmless unawaited, but `await` it if errors matter.

### `lib/desktop.ts`
Optional: move the new optional members into `DesktopBridge` (as for v21); `lib/preview.ts` already casts.

## Web

### `stores/workspace.ts`
- Pane kind `'changes'` next to v21's `'browser' | 'file'`: `{ kind: 'changes', key, cwd, root?: string, count?: number }`; persist `kind/cwd` (sessionStorage + `ccm.workspace.last`); never busy; describe = "Changes — <repo folder name>".
- Actions: `openChanges(cwd, {split?})` (one Changes pane per repo root: a pane with the same `root` (`dirKey`) is activated instead), `update(key, {root, count})`.
- `insertInto(paneKey: string, text: string)` + `insertImage(paneKey: string)`: a request queue (e.g. `insertRequests` shallowRef of `{id, paneKey, text} | {id, paneKey, image: true}`) consumed by the matching TermPane. Never sends Enter.
- Target resolution for BrowserPane events, `resolveAgentPane(browserKey)`: 1) term pane in the same tab with preset `claude`/`codex` (prefer linked `terminalId`, then most recently focused); 2) else a picker listing agent panes of all tabs (SplitMenu-style, Esc cancels); 3) none → notice "Open a Claude or Codex pane first" (new i18n key when wiring). Focus the target pane after the insert so Enter goes there.

### `TermPane.vue`
- **Insert text**: request for this pane → `term.paste(text)` (xterm wraps it in bracketed paste when the app enabled mode 2004 — Claude Code / Codex do); no `\r`; then `term.focus()`.
- **Insert image**: the PNG is already on the clipboard (BrowserPane did it) → existing image paste path `conn?.write('\x16')` (Claude Code reads clipboard images on ^V; Codex too). Shell preset → skip.
- **Dev server**: `const dev = new DevServerDetector()`; in the PTY output path (next to `term.write`) feed decoded text (`TextDecoder('utf-8', { stream: true })` for binary frames; skip chunks > 64 KB): `for (const url of dev.feed(text)) { devUrls.value = [...devUrls.value, url]; rememberDevUrl(pane.cwd ?? '', url) }`. `dev.reset()` + clear on exit / respawn.
- Header: `<DevServerChip v-if="devUrls.length" :urls="devUrls" @open="(u) => emit('openLink', u, {})" />` before the branch chip (header row is `min-w-0`; chip truncates). WorkspaceView `openLink` with a URL already reuses / splits a browser pane. No auto-open.
- **Find**: `import { SearchAddon } from '@xterm/addon-search'`; `const search = new SearchAddon({ highlightLimit: 1000 })`; `term.loadAddon(search)` after fit. Terminal options need `allowProposedApi: true` (search decorations use the decoration API; without them `onDidChangeResults` never fires and the count stays empty). `findOpen` ref; `<TermFind v-if="findOpen" :addon="search" class="absolute right-2 top-1 z-10" @close="findOpen = false; term?.focus()" />` as an overlay in the terminal box (bar is 32 px, taller than the 28 px header).
- Keys in `attachCustomKeyEventHandler`: Windows/Linux `Ctrl+Shift+F`, mac `⌘F` → open / refocus the bar, `return false`. Plain `Ctrl+F` stays with the shell (readline forward-char). Add to `lib/shortcuts.ts` `workspaceShortcuts(mac)`.

### `WorkspaceView.vue`
- Render by kind: `ChangesPane :cwd :active @open="(p, line) => ws.openFile(p, line)" @count="(n) => ws.update(key, { count: n })" @root="(r) => ws.update(key, { root: r })"`, close/split controls via `<template #end>`.
- Tab label / icon: `GitCompare` `text-ink-muted` + `t('workspace.changes.titleCount', { n })` (`workspace.changes.title` when 0 / unknown); tooltip = repo root.
- `+` menu / `SplitMenu` / LaunchPicker: entry **Changes** (GitCompare) under Browser / Open file… → `openChanges(active pane cwd ?? picked folder)`. **Browser** entry: when `lastDevUrl(cwd)` exists, offer it first ("localhost:5173").
- **Quick open**: `<QuickOpen :open="quickOpen" :root="activeRoot" @close="quickOpen = false" @open="({ path, line, split }) => ws.openFile(path, line, split ? { split: activeKey } : undefined)" />`; `activeRoot` = Changes `root` of that cwd when known, else the active pane's `cwd` (ls-files from a sub-folder lists only that sub-folder). Keys: mac `⌘P`; Windows/Linux `Ctrl+P` only when focus is not inside `.xterm` (there it is shell history / previous command) — owner to confirm, alternative `Ctrl+Shift+P` everywhere. Add to `lib/workspaceKeys.ts` + shortcuts list, and to `preview/keys.ts` `workspaceChord` so a focused `<webview>` forwards it (`ccm:forward-key`).
- BrowserPane: `@insert-text="(text) => insertFromBrowser(key, text)"`, `@insert-image="insertFromBrowser(key, null)"` → `resolveAgentPane(key)` → `ws.insertInto` / `ws.insertImage`. Close / split controls via `<template #toolbar-end>`.

### `style.css`
- Optional tokens (used with fallbacks in `DiffView.vue` / `ChangesPane.vue`): `--ccm-diff-add-well` #30d158, `--ccm-diff-del-well` #ff6961 — diff ink on the always-dark well (light-theme `--ccm-diff-*` are too dark there). Same value in both themes; add to `COLOR-SYSTEM.md`.
- `TermFind` reads `--ccm-well-selection` and `--ccm-ansi-3` with `getComputedStyle` (xterm decorations accept `#RRGGBB` only) — keep both as 6-digit hex.

### `.code_index`
- `desktop.md` Preview section: v23 desktop inventory (`gitExec`, `changes`, `listFiles`, `clipboardImage`, channels).
- `web.md`: "Review tools (v23)" block (libs, components, store kind `changes`, insert queue, TermPane dev server / find). `_meta.md`: one line.

## E2E outline (`apps/desktop/e2e/review.cjs`)
1. Temp git repo (commit a 30-line file); Shell pane there; edit two distant lines + add an untracked file → open Changes → rows `M +2 −2`, `U +n`; tab `Changes (2)`.
2. "Discard hunk…" on hunk 2 → alertdialog (Cancel focused, Esc closes) → Discard → only hunk 1 remains; refresh within ~1 s. Untracked "Discard file…" → file in Recycle Bin / Trash, not unlinked.
3. `echo "  ➜  Local:   http://localhost:5173/"` → header chip `localhost:5173` → click → browser pane at that URL.
4. Page with `console.error('boom')` → Send to agent → Console errors → Insert → target Claude pane input holds the block, no `\r` written after it. Pick element → click a button → block with `selector:`. Screenshot → clipboard has `image/png` and `\x16` reached the target PTY.
5. Ctrl/⌘+P → `a.ts:3` → Enter opens a file tab at line 3; Ctrl/⌘+Enter splits.
6. Terminal: `seq 1 200` → Ctrl+Shift+F / ⌘F → `1` → count `n of N`, Enter / Shift+Enter move, regex toggle, Esc closes and refocuses the terminal.
7. Security: `ccm:changes-diff` with an unregistered `root` or `path` `../x` → `denied`; `ccm:capture-guest` with a non-guest id → false; `ccm:clipboard-image('data:text/html,…')` → false.

## Open questions (v23)
1. Hunk discard reverse-applies to the working tree only; a staged hunk stays staged (file then shows staged + unstaged). Option: `git apply -R --index` when index == worktree for that file.
2. Quick open root: pane cwd vs git toplevel (see WorkspaceView note).
3. Ctrl+P vs shell history inside terminals on Windows/Linux.

## Phase 2b done (2026-10-14)
Wired as above with these choices: viewer panes keep `preset: 'shell'` as a placeholder (no discriminated union); split menu = Claude / Codex / Shell / Browser (Open file… and Changes only in the `+` menu); terminal links open a new tab by default (reuse a tab already showing that file / URL), never a split; quick open = Ctrl+Shift+P everywhere on Windows/Linux, ⌘P on mac, root = git toplevel (`changesStatus`); staged-hunk discard left as is; extra token `--ccm-page` (#fff) for the web page canvas; BrowserPane retries `previewUrl` once after 1.5 s for restored panes. E2E `e2e/browser.cjs` (replaces the separate review.cjs outline; hunk discard / handoff / terminal find not covered by E2E yet).
