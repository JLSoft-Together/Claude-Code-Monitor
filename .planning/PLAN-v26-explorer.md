# v26 — Explorer (port từ spacevibe-deck)

## Context

spacevibe-deck (`src/spacevibe-deck`, Preact + signals) có panel **Explorer**: cây thư mục lazy của workspace + view **Changes** (git), tạo file/folder, mở file vào preview tab. Agent Monitor đã có gần đủ backend (`ccm:list-files`, `ccm:changes-*`, `RootWatcher` + `ccm:preview-changed`, `FilePane`, `ChangesPane`, `QuickOpen`) nhưng **không có cây thư mục** để duyệt project. Mục tiêu: port *logic* Explorer sang Vue/Pinia, tái dùng tối đa hạ tầng sẵn có.

Quyết định đã chốt với user:
- **Phạm vi**: Tree + Changes + Create file/folder. Không Monaco/editing/save/external-change/dirty-registry (FilePane read-only giữ nguyên). spacevibe cũng không có rename/delete/context menu → không port.
- **Vị trí**: aside trái hiện có (`w-60`) có segmented switch **Projects | Explorer**, dùng chung toggle `PanelLeft`.
- **Root**: project root của pane active (`activeProject` ở `WorkspaceView.vue:191` = git toplevel, worktree gộp về repo, else folder); giữ root cuối khi pane active không có cwd.

Viết kế hoạch vào `.planning/PLAN-v26-explorer.md` khi bắt đầu implement (v25 đang dở trong working tree — làm sau khi Phase A/B/C của v25 được commit để tránh xung đột ở `WorkspaceView.vue`).

## Mapping spacevibe → Agent Monitor

| spacevibe | Agent Monitor | Ghi chú |
|---|---|---|
| `src/files/file-tree.ts` (+ `tree-focus.ts`, `create-target.ts`) | `apps/web/src/lib/explorer/tree.ts` | port gần nguyên văn: `DirEntry`, `EXCLUDED_NAMES`, `sortEntries`, `visibleEntries`, `canExpand`, `flattenTree` (root là row 0, `walked` chống cycle), `toggleExpanded`, `openDirectories`, `resolveFocusIndex`, `createTargetDirectory` |
| `src/files/tree-reveal.ts` | `lib/explorer/reveal.ts` | `nextRevealStep` nguyên văn |
| `src/files/entry-name.ts` | `packages/shared/src/entryName.ts` | dùng ở cả dialog web lẫn handler desktop (desktop đã import `@ccm/shared`, vd `layouts.ts`) |
| `src/files/changes/changes-scheduler.ts` | `lib/explorer/changesScheduler.ts` | debounce 150 / maxWait 1000 / minInterval 1000, clock injectable |
| `changes-model.ts` | gộp với map sẵn có `KIND_LETTER`/`KIND_CLASS` (`ChangesPane.vue:35-43`) → tách ra `lib/changesView.ts`, ChangesPane import lại |
| `file-surface-store.ts` + `file-surface-controller.ts` (phần tree) + `tree-refresh.ts` | `apps/web/src/stores/explorer.ts` (Pinia setup store) | chỉ phần tree/create; bỏ tabs/documents/dirty |
| `changes-controller.ts` | trong `ExplorerChanges.vue` (hoặc composable `useExplorerChanges.ts`) | dùng `changesStatus/changesWatch/onChangesUpdated` sẵn có |
| `electron/fs/read.ts` `listDir` | `apps/desktop/src/preview/listDir.ts` | readdir withFileTypes, symlink realpath pool 32, `outOfRoot` |
| `electron/fs/create-entry.ts` | `apps/desktop/src/preview/createEntry.ts` | `checkEntryName` lại ở main, `mkdir({recursive:false})` / `open(dest,'wx')`, EEXIST → `exists` |
| `fs/watch.ts` (non-recursive per dir, `watch_paths`) | **không port** — dùng `watchRoot(root)` + `onPreviewChanged` (RootWatcher recursive, đã trả path tuyệt đối, ignore `node_modules/.git`) | đơn giản hơn, cùng kết quả |
| `git/changes*.ts` | **không port** — `preview/changes.ts` đã có status/numstat/watch | |
| `preview-slot.ts` | cờ `preview` trên `Pane` file | xem F5 |
| Monaco, markdown-view, external-change, dirty-registry, turn-end, dock-panel | bỏ | FilePane read-only đã đủ |

## Phases

### F1 — Desktop IPC (`apps/desktop`)
- `src/preview/listDir.ts`: `listDir(root, dir): Promise<DirEntry[]>` — port `read.ts:135-179`; containment bằng `isWithin`/`realOrNull` của `preview/paths.ts` (không dùng `startsWith`). Uncapped (UI virtualize).
- `src/preview/createEntry.ts`: `createEntry(root, parent, name, kind)` → `{ ok: true, path } | { ok: false, error: 'invalid' | 'exists' | 'denied' | 'failed' }`. Parent realpath phải nằm trong root; dest không được là symlink trỏ ra ngoài.
- `src/preview/ipc.ts`: thêm handler `ccm:list-dir {root, dir}` và `ccm:create-entry {root, parent, name, kind}`, gate giống `ccm:list-files` (`isAppFrame` → `repoOf(root) ?? allowedPath(root)` → `dir`/`parent` phải `isWithin` root). Sau create: `fileLists.invalidate(root)`. Thêm cả 2 vào `CHANNELS` (L73).
- `src/preload.ts`: `listDir`, `createEntry`.
- Tests: `test/explorer-ipc.test.ts` (port `read.test.ts` listDir cases + `create-entry.test.ts` + path escape: `..`, symlink ra ngoài, dir ngoài root → null/denied).

### F2 — Logic thuần (web + shared)
- `packages/shared/src/entryName.ts` + export từ `index.ts`; test port `entry-name.test.ts`.
- `apps/web/src/lib/explorer/{tree,reveal,changesScheduler}.ts` + tests port từ `file-tree.test.ts`, `tree-focus.test.ts`, `create-target.test.ts`, `tree-reveal.test.ts`, `changes-scheduler.test.ts` (Vitest chạy được nguyên).
- `lib/preview.ts`: thêm type `DirEntry`, wrappers `listDir(root, dir)`, `createEntry(...)`, `hasExplorer`.
- `lib/changesView.ts`: tách `KIND_LETTER`, `KIND_CLASS`, nhóm conflicts/changed/untracked, `absolute(root, rel)` từ `ChangesPane.vue`; ChangesPane import lại (không đổi hành vi).

### F3 — Store `stores/explorer.ts`
State per root (Map keyed `pathKey(root)` — chuẩn hoá `\`→`/`, lowercase trên win32), in-memory per window như spacevibe:
`{ expanded: Set, rootExpanded: true, showHidden: false, listings: Map<dirKey, DirEntry[]>, errors: Map<dirKey, string>, focused: string|null }` + `root` hiện tại, `view: 'files'|'changes'` (localStorage `ccm.workspace.explorerView`), `status` (1 dòng thông báo).
Actions (port từ `file-surface-controller.ts`):
- `setRoot(root|null)` — null giữ root cũ; đổi root → `unwatchRoot(old)` / `watchRoot(new)` (ref-counted ở main).
- `ensureListing(dir)` / `loadListing(dir)` với generation counter per dir (bỏ reply cũ); lỗi → `errors` + giữ listing cũ.
- `toggle(dir)`, `toggleRoot()`, `collapseAll()`, `refresh()` (re-list mọi `openDirectories`), `setShowHidden()`.
- Watch: `onPreviewChanged` → nếu `change.root` khớp root → với mỗi path, re-list parent (và chính nó nếu là dir đang mở) khi nằm trong `openDirectories`; coalesce 100 ms (port `tree-refresh.ts`).
- `createEntry(parent, name, kind)`: gọi IPC → lỗi vào `status`; tên hidden mà `showHidden` off → bật + status; expand parent, re-list, `pendingFocus = path`; file → mở preview (F5).
- `rows` computed = `flattenTree(...)`.
- Test `stores/explorer.test.ts` (mock bridge, port các case controller liên quan: stale reply, error recovery, create flow, watch coalesce).

### F4 — UI (Vue, theo COLOR-SYSTEM + i18n)
- `components/workspace/ExplorerPanel.vue`: header = switch **Files | Changes** (tablist, ←/→; Changes disabled + tooltip khi `changesStatus` trả `not-repo`/`no-git`; chip `+N −M`), status line, body.
- `ExplorerTree.vue`: virtualize thủ công (`ROW = 22px`, overscan 8, spacer = rows×22), indent `8 + depth*14`; roving tabindex theo path (`resolveFocusIndex`); ↑↓ → ← Enter (+ Home/End); click file = preview, dblclick = keep; root row có 5 action (New file, New folder, Show hidden `aria-pressed`, Refresh, Collapse all — `stopPropagation`); Loading / “No files” / lỗi + Retry. Icon lucide (`Folder/FolderOpen`, `ChevronRight`, `FileCode/FileJson/FileImage/FileText/File` theo map extension port từ `file-icons.ts`). Row active = `bg-accent-soft text-accent-ink`; glyph file `text-agent-file`; outOfRoot = `text-ink-faint`.
- Reveal active document: khi pane active là `file` và path nằm trong root → vòng `nextRevealStep` (expand ancestors, chờ listing, scroll row vào view, không cướp focus); re-arm khi bật show-hidden.
- `ExplorerChanges.vue`: branch row + refresh, list rows (letter, basename, dir `text-ink-faint`, `+a −r` `diff-add/diff-del`), ↑↓ Home End Enter/Space; click → mở file preview (deleted không mở); nút “Open diff” → `workspace.openChanges(root)`. Scheduler: watch chỉ khi view Changes hiển thị **và** workspace visible; trigger `focus`/`shown`/`refresh` ngay, `watch` debounce.
- `CreateEntryDialog.vue` (teleport, giống pattern `LayoutsDialog`): “in `<rel>`”, validate realtime bằng `checkEntryName`, Create disabled khi invalid.
- `WorkspaceView.vue` aside (L662-669): segmented **Projects | Explorer** ở đầu aside (localStorage `ccm.workspace.sideView`), render `WorkspaceSidebar` hoặc `ExplorerPanel :root="activeProject"`. Phím tắt `Ctrl/⌘+Shift+E` mở aside + chọn Explorer (đăng ký cùng chỗ với QuickOpen shortcut).
- i18n: `i18n/workspace-explorer.ts` `{en, vi}`, spread vào `workspace` trong `en.ts`/`vi.ts` (test parity sẵn có ở `stores/workspace.test.ts`).

### F5 — Preview slot cho file pane (`stores/workspace.ts`)
- `Pane.preview?: boolean` (runtime, không persist — bỏ trong `cleanPane`).
- `openFile(path, line, { cwd, split, preview })`: file đã mở → activate (không đổi cờ); `preview: true` → nếu có pane file `preview` khác thì **thay path tại chỗ** (`line` reset) + activate, else tạo mới với `preview: true`; `preview: false` (dblclick) → mở/tìm rồi xoá cờ `preview` (promote). Tab label preview in nghiêng (`TermPane`/tab strip đọc `pane.preview`).
- Test bổ sung trong `stores/workspace.test.ts`.

### F6 — Hoàn tất
- `.code_index/{web,desktop,protocol?,_meta}.md`, `.planning/PLAN-v26-explorer.md`.
- E2E `apps/desktop/e2e/explorer.cjs` (thêm vào `run.cjs` L8): mở workspace trên repo fixture → switch Explorer → expand folder → click file → FilePane hiển thị → tạo file mới → row xuất hiện + được focus → sửa file ngoài app → Changes view cập nhật.

## Verification
1. `npm test` (all workspaces) — các test port + test mới; `npm run typecheck`.
2. `npm run desktop:dev`: mở terminal ở repo này → aside → Explorer: duyệt cây, show hidden, collapse all, refresh; tạo file/folder (tên invalid `con`, `a/b`, trùng tên → lỗi đúng); `touch` file từ terminal → cây tự cập nhật ≤ ~300 ms; Changes view cập nhật sau khi sửa file; single vs double click (preview thay tại chỗ vs giữ tab); đổi pane sang project khác → root đổi; mở file qua QuickOpen → cây reveal.
3. `npm run build -w @ccm/web && npm run e2e -w @ccm/desktop` (gồm `explorer.cjs`).

## Status (2026-10-14)
F1–F6 done. Deviations from the plan above:
- Watcher: no per-folder `watch_paths` port; the store reuses `RootWatcher` (`ccm:watch` + `ccm:preview-changed`) and re-lists only on-screen folders.
- Root-row actions are always visible (as in spacevibe); the root name truncates in the 240 px sidebar.
- ← on a file / collapsed folder moves to the parent row and → on an open folder moves to its first child (VS Code); spacevibe only collapses/expands.
- Not ported (out of scope): Monaco editing/save, external-change bar, dirty registry, turn-end trigger, rename/delete (spacevibe has none either).
Verification: `npm run typecheck`, `npm test` (all workspaces), `node apps/desktop/e2e/explorer.cjs` 21/21 PASS.
