# Explorer Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-click (and keyboard) context menu on Explorer tree rows with a minimal subset of Android Studio's Project view menu: New, Copy Path/Reference, Rename, Delete, Open in Right Split, Open In, Git ▸ Show Diff, Reload from Disk.

**Architecture:** Two small desktop operations (`renameEntry`, `trashEntry` in `preview/explorer.ts`) behind the same `explorerRoot` checks as `createEntry`, exposed through IPC + preload + `lib/preview.ts` and the explorer store. A generic `ui/ContextMenu.vue` (one submenu level, pure placement helpers in `lib/menu.ts`) renders a pure menu model (`lib/explorer/contextMenu.ts`). `ExplorerTree` opens it and emits actions; `ExplorerPanel` handles what lives in the panel (dialogs, clipboard, trash confirm) and forwards pane actions (split, terminal, rename follow-up) to `WorkspaceView`.

**Tech Stack:** Vue 3 + Pinia + Tailwind v4 + vue-i18n + lucide icons (apps/web), Electron main + preload (apps/desktop), Vitest, CDP E2E.

**Spec:** User request 2026-10-15, item 3: "triển khai context menu ở explore, vì đây không phải là android studio nên làm tối thiểu so với ảnh thôi" + the screenshot of Android Studio's Project view menu (New ▸ …, Cut / Copy / Copy Path/Reference… / Paste, Find Usages, Analyze, Rename… Shift+F6, Refactor, Bookmarks, Reformat Code, Optimize Imports, Delete… Delete, Override File Type, Reload '…' Configuration, Open in Right Split Shift+Enter, Open In, Local History, Git, GitToolBox, Repair IDE on File, Reload from Disk, Compare With… Ctrl+D, Mark File As, Create Gist…). Prior: `.planning/PLAN-v26-explorer.md`. Siblings split from the same request: `2026-10-15-sidebar-width.md`, `2026-10-15-jetbrains-split-diff.md`, `2026-10-15-diff-arrow-files.md`, `2026-10-15-log-branches-toolbar.md`, `2026-10-15-attachments-removal.md`.

## Rulings (decided while planning — confirm or overrule before execution)

1. **Menu items:** New ▸ File… / Folder…, Copy Path/Reference ▸ Absolute Path / Path From Project Root / File Name, Rename… (Shift+F6), Delete… (Delete; ⌘⌫ on macOS), Open in Right Split (Shift+Enter), Open In ▸ Explorer|Finder / Terminal, Git ▸ Show Diff (Ctrl+D / ⌘⌥D; repo only), Reload from Disk.
2. **Out:** Cut / Copy / Paste of files, Find Usages, Analyze, Refactor, Bookmarks, Reformat Code, Optimize Imports, Override File Type, Reload Configuration, Local History, GitToolBox, Repair IDE, Compare With, Mark File As, Create Gist, the Android "New ▸" templates.
3. **Delete moves to the OS trash** (`shell.trashItem`) after an in-app confirm; never `rm`. The root row can be neither renamed nor deleted.
4. **Rename never overwrites**; a case-only rename (`readme.md` → `README.md`) is allowed. Open file viewers follow the rename.
5. **Open In ▸ Terminal** opens a new shell tab in the folder (the row itself for a folder, else its parent).

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green). Shortcut labels are display only and not translated.
- All colours via theme tokens (`.planning/COLOR-SYSTEM.md`); menus use the existing `.ccm-menu` material (chrome layer).
- Dialogs / confirms rendered from inside the material sidebar are teleported to `body` (backdrop-filter makes a containing block for `position: fixed`).
- Every page-supplied path / name is validated in main (`explorerRoot`, `checkEntryName`, no `..`, never the root itself, a link at the target is not followed).
- No new npm dependency.
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm test -w @ccm/desktop -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/<name>.cjs`.
- After each task, add 1–2 lines per change to `.code_index/` (`web.md` / `desktop.md` / `_meta.md`); Task 5 does the final pass.

## Review Focus

1. **Case-only rename** (`case.md` → `CASE.md`) on Windows/macOS → succeeds, not "already exists". Pinned in Task 1 (`renameEntry` test).
2. **Rename / delete aimed at the root, outside the root, or through `..`** → `denied`, nothing touched. Pinned in Task 1 (`renameEntry` / `trashEntry` tests).
3. **A sibling that only shares a prefix** (`src2/` when `src/` is renamed) → its open viewer is not moved. Pinned in Task 2 (`movedPath` test).
4. **A file open in a viewer is renamed** → the viewer follows to the new path. Pinned in Task 4 (E2E rename check).
5. **Menu near the window's right / bottom edge** → it flips left / up and stays 8px inside; a submenu opens on the left when the right has no room. Pinned in Task 3 (`menuPosition` / `submenuPosition` tests).

---

### Task 1: Desktop rename and move-to-trash for Explorer entries

**Files:**
- Modify: `apps/desktop/src/preview/explorer.ts` (append), `apps/desktop/src/preview/ipc.ts:76-81,335-346,393-399`, `apps/desktop/src/preload.ts:59-60`
- Test: `apps/desktop/test/explorer.test.ts` (append)

**Interfaces:**
- Produces:

```ts
export type RenameEntryResult = { ok: true; path: string } | { ok: false; error: 'invalid'; reason: EntryNameProblem } | { ok: false; error: 'exists' | 'denied' | 'missing' | 'failed' }
export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'failed' }
export async function renameEntry(root: string, target: unknown, name: unknown): Promise<RenameEntryResult>
export async function trashEntry(root: string, target: unknown, trash: (p: string) => Promise<void>): Promise<TrashEntryResult>
```

IPC `ccm:rename-entry` `{ root, path, name }`, `ccm:trash-entry` `{ root, path }`; preload `renameEntry(root, path, name)`, `trashEntry(root, path)`.

- [ ] **Step 1: Write the failing tests** — append to `apps/desktop/test/explorer.test.ts` (add `readdirSync` to the `node:fs` import and `renameEntry, trashEntry` to the `../src/preview/explorer` import):

```ts
describe('renameEntry', () => {
  it('renames inside the root and never overwrites', async () => {
    writeFileSync(path.join(project, 'src', 'r1.ts'), '1')
    writeFileSync(path.join(project, 'src', 'r2.ts'), '2')
    expect(await renameEntry(project, path.join(project, 'src', 'r1.ts'), 'r3.ts')).toEqual({ ok: true, path: path.join(project, 'src', 'r3.ts') })
    expect(await renameEntry(project, path.join(project, 'src', 'r3.ts'), 'r2.ts')).toEqual({ ok: false, error: 'exists' })
  })

  it('allows a case-only rename of the same file', async () => {
    writeFileSync(path.join(project, 'src', 'case.md'), 'c')
    expect(await renameEntry(project, path.join(project, 'src', 'case.md'), 'CASE.md')).toMatchObject({ ok: true })
    expect(readdirSync(path.join(project, 'src'))).toContain('CASE.md')
    expect(readdirSync(path.join(project, 'src'))).not.toContain('case.md')
  })

  it('refuses the root, outside paths, `..` and bad names', async () => {
    expect(await renameEntry(project, project, 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, path.join(outside, 'secret.txt'), 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, `${path.join(project, 'src')}${path.sep}..`, 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, path.join(project, 'README.md'), 'a/b')).toMatchObject({ ok: false, error: 'invalid' })
    expect(await renameEntry(project, path.join(project, 'nope.txt'), 'x')).toEqual({ ok: false, error: 'missing' })
  })
})

describe('trashEntry', () => {
  it('hands the entry to the trash and refuses the root', async () => {
    writeFileSync(path.join(project, 'src', 'gone.ts'), 'g')
    const trashed: string[] = []
    const trash = async (p: string) => void trashed.push(p)
    expect(await trashEntry(project, path.join(project, 'src', 'gone.ts'), trash)).toEqual({ ok: true })
    expect(trashed).toEqual([path.join(project, 'src', 'gone.ts')])
    expect(await trashEntry(project, project, trash)).toEqual({ ok: false, error: 'denied' })
    expect(await trashEntry(project, path.join(outside, 'secret.txt'), trash)).toEqual({ ok: false, error: 'denied' })
    expect(await trashEntry(project, path.join(project, 'missing.ts'), trash)).toEqual({ ok: false, error: 'missing' })
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), async () => { throw new Error('busy') })).toEqual({ ok: false, error: 'failed' })
  })
})
```

And inside the existing `describe('ccm:list-dir / ccm:create-entry', …)`, set `trash: async () => undefined` in the `registerPreviewIpc({…})` deps and add:

```ts
  it('renames and trashes only inside readable roots', async () => {
    writeFileSync(path.join(project, 'ipc.txt'), 'i')
    expect(await call('ccm:rename-entry', { root: outside, path: path.join(outside, 'secret.txt'), name: 'x' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:rename-entry', { root: project, path: path.join(project, 'ipc.txt'), name: 'ipc2.txt' })).toMatchObject({ ok: true })
    expect(await call('ccm:trash-entry', { root: project, path: path.join(project, 'ipc2.txt') })).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/explorer.test.ts` — Expected: FAIL (`renameEntry` is not exported).

- [ ] **Step 3: Implement** — append to `apps/desktop/src/preview/explorer.ts`:

```ts
export type RenameEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'missing' | 'failed' }

export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'failed' }

/** `target` as its real parent folder (inside `root`) + its own name: a link at `target` itself is not followed, the root never qualifies. */
async function entryIn(root: string, target: unknown): Promise<string | null> {
  if (typeof target !== 'string' || !path.isAbsolute(target) || target.includes('\0')) return null
  const abs = path.normalize(target)
  const name = path.basename(abs)
  if (!name || name === '.' || name === '..') return null
  const parent = await inside(root, path.dirname(abs))
  return parent ? path.join(parent, name) : null
}

/** Renames `target` to `name` in the same folder. Never overwrites; a case-only rename of the same file is allowed. */
export async function renameEntry(root: string, target: unknown, name: unknown): Promise<RenameEntryResult> {
  const check = checkEntryName(name)
  if (!check.ok) return { ok: false, error: 'invalid', reason: check.reason }
  const from = await entryIn(root, target)
  if (!from) return { ok: false, error: 'denied' }
  const stat = await fs.lstat(from).catch(() => null)
  if (!stat) return { ok: false, error: 'missing' }
  const dest = path.join(path.dirname(from), name as string)
  if (dest === from) return { ok: true, path: dest }
  const existing = await fs.lstat(dest).catch(() => null)
  // Case-insensitive disks (Windows, macOS) answer for `dest` with the same file: that is a case-only rename.
  if (existing && !(existing.ino === stat.ino && existing.dev === stat.dev)) return { ok: false, error: 'exists' }
  try {
    await fs.rename(from, dest)
    return { ok: true, path: dest }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Moves `target` to the OS trash (`trash` = Electron `shell.trashItem`); never deletes outright. */
export async function trashEntry(root: string, target: unknown, trash: (p: string) => Promise<void>): Promise<TrashEntryResult> {
  const from = await entryIn(root, target)
  if (!from) return { ok: false, error: 'denied' }
  if (!(await fs.lstat(from).catch(() => null))) return { ok: false, error: 'missing' }
  try {
    await trash(from)
    return { ok: true }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
```

`ipc.ts`:
- import `renameEntry, trashEntry` with `createEntry, listDir`.
- `CHANNELS` last line: `'ccm:project-root', 'ccm:scripts', 'ccm:list-dir', 'ccm:create-entry', 'ccm:rename-entry', 'ccm:trash-entry',`.
- Extract the trash resolution used by `ccm:changes-discard` (lines 344-346) into a helper defined once near the top of `registerPreviewIpc`:

```ts
  /** OS trash: injected for tests, else Electron's `shell.trashItem`. */
  const trashFn = (): ((p: string) => Promise<void>) | null => {
    const shellTrash = (deps.shell as Partial<Shell>).trashItem
    return deps.trash ?? (shellTrash ? (p: string) => shellTrash.call(deps.shell, p) : null)
  }
```

and use `const trash = trashFn()` in `ccm:changes-discard`.
- After `ccm:create-entry`:

```ts
  ipcMain.handle('ccm:rename-entry', async (event, req: unknown) => {
    const { root, path: target, name } = (req ?? {}) as { root?: unknown; path?: unknown; name?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    if (!real) return { ok: false, error: 'denied' }
    const res = await renameEntry(real, target, name)
    if (res.ok) fileLists.invalidate(real)
    return res
  })

  ipcMain.handle('ccm:trash-entry', async (event, req: unknown) => {
    const { root, path: target } = (req ?? {}) as { root?: unknown; path?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    if (!real) return { ok: false, error: 'denied' }
    const trash = trashFn()
    if (!trash) return { ok: false, error: 'failed' }
    const res = await trashEntry(real, target, trash)
    if (res.ok) fileLists.invalidate(real)
    return res
  })
```

`preload.ts` after `createEntry`:

```ts
  renameEntry: (root: string, path: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:rename-entry', { root, path, name }),
  trashEntry: (root: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:trash-entry', { root, path }),
```

- [ ] **Step 4: Run** `npm test -w @ccm/desktop && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/explorer.ts apps/desktop/src/preview/ipc.ts apps/desktop/src/preload.ts apps/desktop/test/explorer.test.ts
git commit -m "✨ Rename and move-to-trash IPC for Explorer entries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Web bridge + explorer store `rename` / `trash`

**Files:**
- Modify: `apps/web/src/lib/preview.ts:76-80,82-117,162-163`, `apps/web/src/stores/explorer.ts`, `apps/web/src/lib/explorer/tree.ts` (add `movedPath`), `apps/web/src/i18n/workspace-explorer.ts` (`status`)
- Test: `apps/web/src/stores/explorer.test.ts` (append), `apps/web/src/lib/tier2.test.ts` or a new `apps/web/src/lib/explorer/tree.test.ts` if absent (check `ls apps/web/src/lib/explorer`; append to the existing tree test file if there is one)

**Interfaces:**
- Produces: `renameEntry(root, path, name): Promise<RenameEntryResult>`, `trashEntry(root, path): Promise<TrashEntryResult>` (web, with `'unavailable'`); store `rename(path: string, name: string): Promise<string | null>`, `trash(path: string): Promise<boolean>`; `ExplorerStatus.key` adds `'renameFailed' | 'renameInvalid' | 'trashFailed' | 'missing' | 'copied'`; `movedPath(p: string, from: string, to: string): string | null`.

- [ ] **Step 1: Write the failing tests**

`movedPath` (tree test file):

```ts
import { movedPath } from './tree'

describe('movedPath', () => {
  it('follows a renamed file or folder', () => {
    expect(movedPath('C:\\r\\a.ts', 'C:\\r\\a.ts', 'C:\\r\\b.ts')).toBe('C:\\r\\b.ts')
    expect(movedPath('C:\\r\\src\\x\\y.ts', 'C:\\r\\src', 'C:\\r\\lib')).toBe('C:\\r\\lib\\x\\y.ts')
    expect(movedPath('/r/src/y.ts', '/r/src', '/r/lib')).toBe('/r/lib/y.ts')
  })
  it('ignores siblings that only share a prefix', () => {
    expect(movedPath('C:\\r\\src2\\y.ts', 'C:\\r\\src', 'C:\\r\\lib')).toBeNull()
  })
  it('is case-insensitive on Windows paths', () => {
    expect(movedPath('c:\\R\\SRC\\y.ts', 'C:\\r\\src', 'C:\\r\\lib')).toBe('C:\\r\\lib\\y.ts')
  })
})
```

Store (in `stores/explorer.test.ts`: add `renameEntry: vi.fn()`, `trashEntry: vi.fn()` to the hoisted `bridge`, `renameEntry: bridge.renameEntry, trashEntry: bridge.trashEntry` to the `vi.mock('../lib/preview', …)` factory, `bridge.renameEntry.mockReset(); bridge.trashEntry.mockReset()` to `beforeEach`; the mock factory must also export `baseName: (p: string) => p.split(/[\\/]/).pop()`), then append:

```ts
describe('rename / trash', () => {
  it('renames, re-lists the parent and focuses the new row', async () => {
    const s = useExplorerStore()
    s.setRoot(R)
    await flush()
    fs[R] = [e('src', true), e('b.ts')]
    bridge.renameEntry.mockResolvedValue({ ok: true, path: `${R}\\b.ts` })
    expect(await s.rename(`${R}\\a.ts`, 'b.ts')).toBe(`${R}\\b.ts`)
    expect(s.rows.map((r) => r.name)).toEqual(['repo', 'src', 'b.ts'])
    expect(s.pendingFocus).toBe(`${R}\\b.ts`)
  })

  it('reports a failed rename and a failed trash', async () => {
    const s = useExplorerStore()
    s.setRoot(R)
    await flush()
    bridge.renameEntry.mockResolvedValue({ ok: false, error: 'exists' })
    expect(await s.rename(`${R}\\a.ts`, 'b.ts')).toBeNull()
    expect(s.status).toMatchObject({ key: 'exists', name: 'b.ts', failed: true })
    bridge.trashEntry.mockResolvedValue({ ok: false, error: 'failed' })
    expect(await s.trash(`${R}\\a.ts`)).toBe(false)
    expect(s.status).toMatchObject({ key: 'trashFailed', name: 'a.ts', failed: true })
  })

  it('trash re-lists the folder', async () => {
    const s = useExplorerStore()
    s.setRoot(R)
    await flush()
    fs[R] = [e('src', true)]
    bridge.trashEntry.mockResolvedValue({ ok: true })
    expect(await s.trash(`${R}\\a.ts`)).toBe(true)
    expect(s.rows.map((r) => r.name)).toEqual(['repo', 'src'])
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/stores/explorer.test.ts src/lib/explorer` — Expected: FAIL.

- [ ] **Step 3: Implement**

`lib/explorer/tree.ts` (import `samePath` from `../changesView`):

```ts
/** `p` after `from` was renamed to `to`: `to` itself or the same path under it; null when `p` is neither. */
export function movedPath(p: string, from: string, to: string): string | null {
  if (samePath(p, from)) return to
  const sep = from.includes('\\') ? '\\' : '/'
  const prefix = from.replace(/[\\/]+$/, '') + sep
  if (p.length > prefix.length && samePath(p.slice(0, prefix.length - 1), prefix.slice(0, -1)) && /[\\/]/.test(p[prefix.length - 1]!)) {
    return to.replace(/[\\/]+$/, '') + sep + p.slice(prefix.length)
  }
  return null
}
```

`lib/preview.ts`:

```ts
export type RenameEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'missing' | 'failed' | 'unavailable' }
export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'failed' | 'unavailable' }
```

In `PreviewBridge`: `renameEntry?: (root: string, path: string, name: string) => Promise<RenameEntryResult>` and `trashEntry?: (root: string, path: string) => Promise<TrashEntryResult>`. Exports next to `createEntry`:

```ts
export const renameEntry = (root: string, path: string, name: string): Promise<RenameEntryResult> =>
  bridge?.renameEntry?.(root, path, name) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const trashEntry = (root: string, path: string): Promise<TrashEntryResult> => bridge?.trashEntry?.(root, path) ?? Promise.resolve({ ok: false, error: 'unavailable' })
```

`stores/explorer.ts` — import `renameEntry as renameEntryIpc, trashEntry as trashEntryIpc` and `movedPath`, `baseName` (`../lib/preview`); widen `ExplorerStatus.key` to `'createFailed' | 'exists' | 'invalid' | 'denied' | 'shownHidden' | 'renameFailed' | 'renameInvalid' | 'trashFailed' | 'missing' | 'copied'`; add after `create`:

```ts
  /** Renames `path` to `name`; open folders under it follow, the parent is listed again and the row focused. Returns the new path. */
  async function rename(path: string, name: string): Promise<string | null> {
    const at = root.value
    if (!at) return null
    const res = await renameEntryIpc(at, path, name)
    if (root.value !== at) return null
    if (!res.ok) {
      const key = res.error === 'invalid' ? 'renameInvalid' : res.error === 'exists' || res.error === 'denied' || res.error === 'missing' ? res.error : 'renameFailed'
      status.value = { key, name: res.error === 'missing' ? baseName(path) : name, reason: res.error === 'invalid' ? res.reason : undefined, failed: true }
      return null
    }
    status.value = null
    patch({ expanded: new Set([...state.value.expanded].map((p) => movedPath(p, path, res.path) ?? p)) })
    await loadListing(parentDirectory(path))
    pendingFocus.value = res.path
    setFocused(res.path)
    return res.path
  }

  /** Moves `path` to the OS trash and lists its folder again. */
  async function trash(path: string): Promise<boolean> {
    const at = root.value
    if (!at) return false
    const res = await trashEntryIpc(at, path)
    if (root.value !== at) return false
    if (!res.ok) {
      status.value = { key: res.error === 'denied' || res.error === 'missing' ? res.error : 'trashFailed', name: baseName(path), failed: true }
      return false
    }
    status.value = null
    await loadListing(parentDirectory(path))
    return true
  }
```

Return `rename, trash` from the store.

i18n `workspace-explorer.ts` `status` — en:

```ts
      renameFailed: 'Couldn’t rename to “{name}”.',
      renameInvalid: 'Couldn’t rename to “{name}”: {reason}',
      trashFailed: 'Couldn’t move “{name}” to the trash.',
      missing: '“{name}” no longer exists.',
      copied: 'Copied: {name}',
```

vi:

```ts
      renameFailed: 'Không đổi tên thành “{name}” được.',
      renameInvalid: 'Không đổi tên thành “{name}” được: {reason}',
      trashFailed: 'Không chuyển được “{name}” vào thùng rác.',
      missing: '“{name}” không còn tồn tại.',
      copied: 'Đã sao chép: {name}',
```

- [ ] **Step 4: Run** `npm run typecheck && npm test -w @ccm/web` — Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/preview.ts apps/web/src/stores/explorer.ts apps/web/src/stores/explorer.test.ts apps/web/src/lib/explorer apps/web/src/i18n/workspace-explorer.ts
git commit -m "✨ Explorer store rename and move to trash

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Generic context menu with one submenu level

**Files:**
- Create: `apps/web/src/lib/menu.ts`, `apps/web/src/lib/menu.test.ts`, `apps/web/src/components/ui/ContextMenu.vue`

**Interfaces:**
- Produces:

```ts
export interface MenuAction { id: string; label: string; icon?: Component; shortcut?: string; disabled?: boolean; children?: MenuEntry[] }
export type MenuEntry = MenuAction | { separator: true }
export interface Rect { left: number; right: number; top: number; bottom: number }
export const isSeparator: (e: MenuEntry) => e is { separator: true }
export function menuPosition(at: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number; origin: string }
export function submenuPosition(row: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number }
export function findAction(entries: readonly MenuEntry[], id: string): MenuAction | null
```

`ContextMenu.vue` props `{ at: Rect; entries: MenuEntry[]; label: string; trigger?: HTMLElement | null }`, emits `pick(id: string)`, `close()`; DOM `[data-context-menu]`, items `[role=menuitem][data-menu-id]`, submenu panel `[data-context-submenu]`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/menu.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { findAction, menuPosition, submenuPosition, type MenuEntry } from './menu'

const at = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y })

describe('menu placement', () => {
  it('opens right/below the cursor', () => {
    expect(menuPosition(at(100, 100), 200, 300, 1000, 800)).toEqual({ left: 100, top: 100, origin: 'left top' })
  })
  it('flips left/up near the window edges and stays 8px inside', () => {
    expect(menuPosition(at(900, 700), 200, 300, 1000, 800)).toEqual({ left: 700, top: 400, origin: 'right bottom' })
    expect(menuPosition(at(50, 100), 200, 900, 1000, 800).top).toBe(8)
  })
  it('puts a submenu beside its row, on the left when the right has no room', () => {
    const row = { left: 100, right: 300, top: 200, bottom: 228 }
    expect(submenuPosition(row, 220, 100, 1000, 800)).toEqual({ left: 300, top: 196 })
    expect(submenuPosition({ ...row, left: 700, right: 900 }, 220, 100, 1000, 800)).toEqual({ left: 480, top: 196 })
    expect(submenuPosition(row, 220, 700, 1000, 800).top).toBe(92)
  })
})

describe('findAction', () => {
  const entries: MenuEntry[] = [{ id: 'a', label: 'A' }, { separator: true }, { id: 'p', label: 'P', children: [{ id: 'c', label: 'C', disabled: true }] }]
  it('finds nested actions', () => {
    expect(findAction(entries, 'c')).toMatchObject({ id: 'c', disabled: true })
    expect(findAction(entries, 'zz')).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/menu.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `apps/web/src/lib/menu.ts`

```ts
import type { Component } from 'vue'

export interface MenuAction {
  id: string
  label: string
  icon?: Component
  /** Display only (the owner binds the key). */
  shortcut?: string
  disabled?: boolean
  children?: MenuEntry[]
}
export type MenuEntry = MenuAction | { separator: true }

export interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

const M = 8

export const isSeparator = (e: MenuEntry): e is { separator: true } => 'separator' in e

/** Menu `w`×`h` at `at` (cursor or row rect): right/below, flipped left/up to stay `M` px inside the window. */
export function menuPosition(at: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number; origin: string } {
  const flipX = at.left + w > vw - M
  const flipY = at.bottom + h > vh - M
  return {
    left: Math.max(M, flipX ? at.right - w : at.left),
    top: Math.max(M, flipY ? at.top - h : at.bottom),
    origin: `${flipX ? 'right' : 'left'} ${flipY ? 'bottom' : 'top'}`,
  }
}

/** Submenu beside its parent row (right, else left), top aligned with the row (4px for the panel padding), clamped. */
export function submenuPosition(row: Rect, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = row.right + w > vw - M ? Math.max(M, row.left - w) : row.right
  return { left, top: Math.max(M, Math.min(row.top - 4, vh - M - h)) }
}

export function findAction(entries: readonly MenuEntry[], id: string): MenuAction | null {
  for (const e of entries) {
    if (isSeparator(e)) continue
    if (e.id === id) return e
    const hit = e.children ? findAction(e.children, id) : null
    if (hit) return hit
  }
  return null
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/menu.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: Component** — `apps/web/src/components/ui/ContextMenu.vue`

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { isSeparator, menuPosition, submenuPosition, type MenuAction, type MenuEntry, type Rect } from '../../lib/menu'

/** Right-click menu: one level of submenus, keyboard (↑↓ Home End → ← Enter Esc), outside click / blur / resize close it. */
const props = defineProps<{ at: Rect; entries: MenuEntry[]; label: string; trigger?: HTMLElement | null }>()
const emit = defineEmits<{ pick: [id: string]; close: [] }>()

const WIDTH = 252
const SUB_WIDTH = 228
const layer = ref<HTMLElement | null>(null)
const main = ref<HTMLElement | null>(null)
const sub = ref<HTMLElement | null>(null)
const mainH = ref(0)
const subH = ref(0)
const openId = ref<string | null>(null)
const subRow = ref<Rect | null>(null)

const openEntry = computed(() => props.entries.find((e): e is MenuAction => !isSeparator(e) && e.id === openId.value) ?? null)
const mainStyle = computed(() => {
  const p = menuPosition(props.at, WIDTH, mainH.value, window.innerWidth, window.innerHeight)
  return { left: `${p.left}px`, top: `${p.top}px`, width: `${WIDTH}px`, '--ccm-origin': p.origin, visibility: mainH.value ? 'visible' : 'hidden' }
})
const subStyle = computed(() => {
  if (!subRow.value) return {}
  const p = submenuPosition(subRow.value, SUB_WIDTH, subH.value, window.innerWidth, window.innerHeight)
  return { left: `${p.left}px`, top: `${p.top}px`, width: `${SUB_WIDTH}px`, visibility: subH.value ? 'visible' : 'hidden' }
})

const items = (panel: HTMLElement | null): HTMLElement[] => [...(panel?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])]

async function openSub(e: MenuAction, row: HTMLElement, focus: boolean): Promise<void> {
  if (e.disabled || !e.children) return
  openId.value = e.id
  subRow.value = row.getBoundingClientRect()
  subH.value = 0
  await nextTick()
  subH.value = sub.value?.offsetHeight ?? 0
  if (focus) items(sub.value)[0]?.focus()
}

function closeSub(refocus: boolean): void {
  const id = openId.value
  openId.value = null
  subRow.value = null
  if (refocus && id) main.value?.querySelector<HTMLElement>(`[data-menu-id="${CSS.escape(id)}"]`)?.focus()
}

function close(): void {
  emit('close')
  props.trigger?.focus()
}

function activate(e: MenuAction, row: HTMLElement, fromKey: boolean): void {
  if (e.disabled) return
  if (e.children) {
    void openSub(e, row, fromKey)
    return
  }
  emit('pick', e.id)
  close()
}

function hover(e: MenuAction, row: HTMLElement, level: 'main' | 'sub'): void {
  if (level !== 'main') return
  if (e.children) void openSub(e, row, false)
  else if (openId.value) closeSub(false)
}

function find(level: 'main' | 'sub', id: string | undefined): MenuAction | null {
  const list = level === 'main' ? props.entries : (openEntry.value?.children ?? [])
  return list.find((e): e is MenuAction => !isSeparator(e) && e.id === id) ?? null
}

function onKey(ev: KeyboardEvent, level: 'main' | 'sub'): void {
  const list = items(level === 'main' ? main.value : sub.value)
  const at = list.indexOf(document.activeElement as HTMLElement)
  const cur = at >= 0 ? list[at]! : null
  switch (ev.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      list[(at + (ev.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
      break
    case 'Home':
      list[0]?.focus()
      break
    case 'End':
      list[list.length - 1]?.focus()
      break
    case 'ArrowRight': {
      const e = level === 'main' && cur ? find('main', cur.dataset.menuId) : null
      if (e?.children && cur) void openSub(e, cur, true)
      break
    }
    case 'ArrowLeft':
      if (level === 'sub') closeSub(true)
      break
    case 'Enter':
    case ' ': {
      const e = cur ? find(level, cur.dataset.menuId) : null
      if (e && cur) activate(e, cur, true)
      break
    }
    case 'Escape':
      if (level === 'sub') closeSub(true)
      else close()
      ev.stopPropagation()
      break
    case 'Tab':
      close()
      break
    default:
      return
  }
  ev.preventDefault()
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!layer.value?.contains(target) && !props.trigger?.contains(target)) emit('close')
}
const onDismiss = (): void => emit('close')

onMounted(async () => {
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('blur', onDismiss)
  window.addEventListener('resize', onDismiss)
  await nextTick()
  mainH.value = main.value?.offsetHeight ?? 0
  items(main.value)[0]?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('blur', onDismiss)
  window.removeEventListener('resize', onDismiss)
})

const panels = computed(() => [
  { level: 'main' as const, entries: props.entries, style: mainStyle.value },
  ...(openEntry.value?.children ? [{ level: 'sub' as const, entries: openEntry.value.children, style: subStyle.value }] : []),
])
const ITEM =
  'group flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-[13px] text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none aria-disabled:cursor-default aria-disabled:text-ink-faint aria-disabled:hover:bg-transparent aria-expanded:bg-fill'
const ICON = 'shrink-0 text-ink-muted group-focus-visible:text-on-accent'
</script>

<template>
  <Teleport to="body">
    <div ref="layer" class="contents">
      <div
        v-for="p in panels"
        :key="p.level"
        :ref="(el) => (p.level === 'main' ? (main = el as HTMLElement | null) : (sub = el as HTMLElement | null))"
        class="ccm-menu fixed z-50 flex flex-col p-1"
        :style="p.style"
        role="menu"
        :aria-label="p.level === 'main' ? label : openEntry?.label"
        :data-context-menu="p.level === 'main' ? '' : undefined"
        :data-context-submenu="p.level === 'sub' ? '' : undefined"
        @keydown="onKey($event, p.level)"
        @contextmenu.prevent
      >
        <template v-for="(e, i) in p.entries" :key="isSeparator(e) ? `sep-${i}` : e.id">
          <div v-if="isSeparator(e)" class="mx-2 my-1 border-t border-line" role="separator" />
          <button
            v-else
            type="button"
            role="menuitem"
            tabindex="-1"
            :class="ITEM"
            :data-menu-id="e.id"
            :aria-disabled="e.disabled ? 'true' : undefined"
            :aria-haspopup="e.children ? 'menu' : undefined"
            :aria-expanded="e.children ? openId === e.id : undefined"
            @click="activate(e, $event.currentTarget as HTMLElement, false)"
            @pointerenter="hover(e, $event.currentTarget as HTMLElement, p.level)"
          >
            <component :is="e.icon" v-if="e.icon" :size="14" :class="ICON" aria-hidden="true" />
            <span v-else class="w-3.5 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{{ e.label }}</span>
            <kbd v-if="e.shortcut" class="shrink-0 font-sans text-2xs text-ink-faint group-focus-visible:text-on-accent">{{ e.shortcut }}</kbd>
            <ChevronRight v-if="e.children" :size="13" :class="ICON" aria-hidden="true" />
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 6: Run** `npm run typecheck && npm test -w @ccm/web -- src/lib/menu.test.ts` — Expected: clean; PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/menu.ts apps/web/src/lib/menu.test.ts apps/web/src/components/ui/ContextMenu.vue
git commit -m "✨ Generic context menu with a submenu level

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Explorer menu model, shortcuts and wiring

**Files:**
- Create: `apps/web/src/lib/explorer/contextMenu.ts`, `apps/web/src/lib/explorer/contextMenu.test.ts`
- Modify: `ExplorerTree.vue`, `ExplorerPanel.vue`, `CreateEntryDialog.vue`, `DiscardConfirm.vue`, `WorkspaceView.vue:243-247,827`, `apps/web/src/i18n/workspace-explorer.ts`, `apps/desktop/e2e/run.cjs:8`; Create (E2E): `apps/desktop/e2e/explorer-menu.cjs`

**Interfaces:**
- Consumes: Task 2 store `rename`/`trash`, `movedPath`; Task 3 `ContextMenu`, `MenuEntry`, `findAction`.
- Produces:

```ts
export type ExplorerAction = 'new-file' | 'new-folder' | 'copy-abs' | 'copy-rel' | 'copy-name' | 'rename' | 'trash' | 'open-split' | 'reveal' | 'terminal' | 'show-diff' | 'reload'
export interface ExplorerMenuCtx { mac: boolean; repo: boolean; changed: boolean }
export function explorerMenu(row: TreeRow, ctx: ExplorerMenuCtx, t: (key: string) => string): MenuEntry[]
export type ExplorerKey = 'rename' | 'trash' | 'open-split' | 'menu'
export function explorerKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac: boolean): ExplorerKey | null
```

`ExplorerTree` new prop `repo: boolean`, emit `action: [id: ExplorerAction, row: TreeRow]`; `ExplorerPanel` emits `openSplit: [path: string]`, `terminal: [dir: string]`, `renamed: [from: string, to: string]`; `CreateEntryDialog` request gains `mode?: 'create' | 'rename'` and `initial?: string`; `DiscardConfirm` prop `confirmLabel?: string`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/explorer/contextMenu.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuEntry } from '../menu'
import { explorerKey, explorerMenu } from './contextMenu'
import type { TreeRow } from './tree'

const t = (k: string) => k.split('.').pop()!
const row = (p: Partial<TreeRow>): TreeRow => ({ path: 'C:\\r\\a.ts', name: 'a.ts', directory: false, depth: 1, expanded: false, outOfRoot: false, ...p })
const ids = (e: MenuEntry[]) => e.map((x) => (isSeparator(x) ? '-' : x.id))
const ctx = { mac: false, repo: true, changed: true }

describe('explorerMenu', () => {
  it('has the minimal Android Studio set, in order', () => {
    expect(ids(explorerMenu(row({}), ctx, t))).toEqual(['new', '-', 'copy-ref', '-', 'rename', 'trash', '-', 'open-split', 'open-in', '-', 'git', '-', 'reload'])
  })
  it('protects the root row and keeps folders out of the right split', () => {
    const root = explorerMenu(row({ depth: 0, directory: true }), ctx, t)
    expect(findAction(root, 'rename')?.disabled).toBe(true)
    expect(findAction(root, 'trash')?.disabled).toBe(true)
    expect(findAction(explorerMenu(row({ directory: true }), ctx, t), 'open-split')?.disabled).toBe(true)
  })
  it('enables Show Diff only on a changed file and drops Git outside a repo', () => {
    expect(findAction(explorerMenu(row({}), { ...ctx, changed: false }, t), 'show-diff')?.disabled).toBe(true)
    expect(ids(explorerMenu(row({}), { ...ctx, repo: false }, t))).not.toContain('git')
  })
  it('names the file manager and shortcuts per platform', () => {
    expect(findAction(explorerMenu(row({}), { ...ctx, mac: true }, t), 'reveal')?.label).toBe('finder')
    expect(findAction(explorerMenu(row({}), { ...ctx, mac: true }, t), 'trash')?.shortcut).toBe('⌘⌫')
    expect(findAction(explorerMenu(row({}), ctx, t), 'trash')?.shortcut).toBe('Delete')
  })
})

describe('explorerKey', () => {
  const k = (key: string, m: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m })
  it('maps the JetBrains keys', () => {
    expect(explorerKey(k('F6', { shiftKey: true }), false)).toBe('rename')
    expect(explorerKey(k('Delete'), false)).toBe('trash')
    expect(explorerKey(k('Backspace', { metaKey: true }), true)).toBe('trash')
    expect(explorerKey(k('Delete'), true)).toBeNull()
    expect(explorerKey(k('Enter', { shiftKey: true }), false)).toBe('open-split')
    expect(explorerKey(k('ContextMenu'), false)).toBe('menu')
    expect(explorerKey(k('F10', { shiftKey: true }), false)).toBe('menu')
    expect(explorerKey(k('Enter'), false)).toBeNull()
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/explorer/contextMenu.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — `apps/web/src/lib/explorer/contextMenu.ts`

```ts
import type { MenuEntry } from '../menu'
import type { TreeRow } from './tree'

export type ExplorerAction = 'new-file' | 'new-folder' | 'copy-abs' | 'copy-rel' | 'copy-name' | 'rename' | 'trash' | 'open-split' | 'reveal' | 'terminal' | 'show-diff' | 'reload'

export interface ExplorerMenuCtx {
  mac: boolean
  /** The project is a git repo: the Git submenu shows. */
  repo: boolean
  /** The row is a changed file: Show Diff is enabled. */
  changed: boolean
}

const M = 'workspace.explorer.menu.'

/** Row menu: a small subset of Android Studio's Project view menu (see the Explorer context menu plan rulings). */
export function explorerMenu(row: TreeRow, ctx: ExplorerMenuCtx, t: (key: string) => string): MenuEntry[] {
  const isRoot = row.depth === 0
  const entries: MenuEntry[] = [
    { id: 'new', label: t(`${M}new`), children: [{ id: 'new-file', label: t(`${M}newFile`) }, { id: 'new-folder', label: t(`${M}newFolder`) }] },
    { separator: true },
    {
      id: 'copy-ref',
      label: t(`${M}copyRef`),
      children: [{ id: 'copy-abs', label: t(`${M}copyAbs`) }, { id: 'copy-rel', label: t(`${M}copyRel`) }, { id: 'copy-name', label: t(`${M}copyName`) }],
    },
    { separator: true },
    { id: 'rename', label: t(`${M}rename`), shortcut: ctx.mac ? '⇧F6' : 'Shift+F6', disabled: isRoot },
    { id: 'trash', label: t(`${M}trash`), shortcut: ctx.mac ? '⌘⌫' : 'Delete', disabled: isRoot },
    { separator: true },
    { id: 'open-split', label: t(`${M}openSplit`), shortcut: ctx.mac ? '⇧↩' : 'Shift+Enter', disabled: row.directory || row.outOfRoot },
    { id: 'open-in', label: t(`${M}openIn`), children: [{ id: 'reveal', label: t(`${M}${ctx.mac ? 'finder' : 'explorer'}`) }, { id: 'terminal', label: t(`${M}terminal`) }] },
  ]
  if (ctx.repo) {
    entries.push({ separator: true }, { id: 'git', label: t(`${M}git`), children: [{ id: 'show-diff', label: t(`${M}showDiff`), shortcut: ctx.mac ? '⌘⌥D' : 'Ctrl+D', disabled: !ctx.changed }] })
  }
  entries.push({ separator: true }, { id: 'reload', label: t(`${M}reload`) })
  return entries
}

export type ExplorerKey = 'rename' | 'trash' | 'open-split' | 'menu'

/** Tree shortcuts (JetBrains keymap): Shift+F6 rename, Delete (⌘⌫ on macOS) delete, Shift+Enter right split, ContextMenu / Shift+F10 menu. */
export function explorerKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac: boolean): ExplorerKey | null {
  const noMods = !e.ctrlKey && !e.altKey && !e.metaKey
  if (e.key === 'F6' && e.shiftKey && noMods) return 'rename'
  if (mac ? e.key === 'Backspace' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey : e.key === 'Delete' && noMods && !e.shiftKey) return 'trash'
  if (e.key === 'Enter' && e.shiftKey && noMods) return 'open-split'
  if ((e.key === 'ContextMenu' && noMods && !e.shiftKey) || (e.key === 'F10' && e.shiftKey && noMods)) return 'menu'
  return null
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/explorer/contextMenu.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 5: `ExplorerTree.vue`**

Imports: `ContextMenu` from `../ui/ContextMenu.vue`; `explorerKey, explorerMenu, type ExplorerAction` from `../../lib/explorer/contextMenu`; `findAction, isSeparator, type MenuEntry` from `../../lib/menu`; `isMac` from `../../lib/platform`; icons `ClipboardCopy, FolderOpen, GitCompare, Pencil, Plus, RefreshCw, SquareSplitHorizontal, SquareTerminal, Trash2` from `lucide-vue-next`.

Props add `repo?: boolean`; emits add `action: [id: ExplorerAction, row: TreeRow]`.

Script additions:

```ts
const MENU_ICONS: Partial<Record<string, typeof File>> = {
  new: Plus, 'copy-ref': ClipboardCopy, rename: Pencil, trash: Trash2, 'open-split': SquareSplitHorizontal, 'open-in': FolderOpen, terminal: SquareTerminal, git: GitCompare, reload: RefreshCw,
}
const withIcons = (list: MenuEntry[]): MenuEntry[] => list.map((e) => (isSeparator(e) ? e : { ...e, icon: MENU_ICONS[e.id], children: e.children && withIcons(e.children) }))
const menuFor = (row: TreeRow): MenuEntry[] => withIcons(explorerMenu(row, { mac: isMac, repo: !!props.repo, changed: !!gitKind(row) }, (k) => t(k)))

const menu = ref<{ at: DOMRect; row: TreeRow; trigger: HTMLElement | null } | null>(null)

function openMenu(row: TreeRow, index: number, at: DOMRect, trigger: HTMLElement | null): void {
  explorer.setFocused(index === 0 ? null : row.path)
  menu.value = { at, row, trigger }
}

function onContextMenu(e: MouseEvent, row: TreeRow, index: number): void {
  e.preventDefault()
  openMenu(row, index, new DOMRect(e.clientX, e.clientY, 0, 0), e.currentTarget as HTMLElement)
}

function onPick(id: string): void {
  const row = menu.value?.row
  if (row) emit('action', id as ExplorerAction, row)
}
```

In `onKey`, before `if (isShowDiffKey(e))`:

```ts
  const shortcut = explorerKey(e, isMac)
  if (shortcut) {
    const i = focusIndex.value
    const row = rows.value[i]
    if (!row) return
    e.preventDefault()
    if (shortcut === 'menu') {
      const el = scroller.value?.querySelector<HTMLElement>(`[data-row-index="${i}"]`) ?? null
      const r = el?.getBoundingClientRect()
      openMenu(row, i, r ? new DOMRect(r.left + 24, r.bottom, 0, 0) : new DOMRect(0, 0, 0, 0), el)
    } else if (!findAction(menuFor(row), shortcut)?.disabled) emit('action', shortcut, row)
    return
  }
```

Row element: add `@contextmenu="onContextMenu($event, row, index)"`. After the scroller `<div>` (inside the root `<div>`):

```vue
    <ContextMenu
      v-if="menu"
      :at="menu.at"
      :entries="menuFor(menu.row)"
      :label="t('workspace.explorer.menu.label', { name: menu.row.name })"
      :trigger="menu.trigger"
      @pick="onPick"
      @close="menu = null"
    />
```

- [ ] **Step 6: `CreateEntryDialog.vue` rename mode**

- Props: `request: { kind: 'file' | 'directory'; where: string; rootName: string; mode?: 'create' | 'rename'; initial?: string } | null`.
- Import `Pencil` from `lucide-vue-next`; `const renaming = computed(() => props.request?.mode === 'rename')`.
- In the `request` watch: `name.value = req.initial ?? ''`, and after `input.value?.focus()`:

```ts
    if (req.mode === 'rename') {
      const dot = req.kind === 'file' ? name.value.lastIndexOf('.') : -1
      input.value?.setSelectionRange(0, dot > 0 ? dot : name.value.length)
    }
```

- `submit()`: `if (renaming.value && name.value === props.request?.initial) return emit('close')` before the existing body.
- Header icon: `:is="renaming ? Pencil : request.kind === 'file' ? FilePlus : FolderPlus"`; title: `renaming ? t('workspace.explorer.rename.title') : (…existing…)`; submit label: `renaming ? t('workspace.explorer.rename.action') : t('workspace.explorer.create.action')`.

- [ ] **Step 7: `DiscardConfirm.vue`** — props `{ title: string; lines: string[]; preview?: string[]; confirmLabel?: string }`; danger button text `{{ confirmLabel ?? t('workspace.changes.confirm.discard') }}`.

- [ ] **Step 8: `ExplorerPanel.vue` handles actions**

Imports: `Teleport` is built in; `DiscardConfirm` from `./DiscardConfirm.vue`; `parentDirectory, relativeTo` (tree), `revealPath` (`../../lib/preview`), `isMac` (`../../lib/platform`), `type ExplorerAction` (contextMenu), `type TreeRow` (tree).

Emits: add `openSplit: [path: string]; terminal: [dir: string]; renamed: [from: string; to: string]`.

Replace `createRequest` / `dialog` / `askCreate` / `create` with:

```ts
const entryRequest = ref<{ mode: 'create' | 'rename'; kind: 'file' | 'directory'; parent: string; target?: string; initial?: string } | null>(null)
const dialog = computed(() => {
  const r = entryRequest.value
  return r && explorer.root ? { kind: r.kind, where: relativeTo(explorer.root, r.parent), rootName: rootName(explorer.root), mode: r.mode, initial: r.initial } : null
})

function askCreate(kind: 'file' | 'directory'): void {
  if (!explorer.root) return
  entryRequest.value = { mode: 'create', kind, parent: createTargetDirectory(explorer.rows, explorer.state.focused, explorer.root) }
}

async function submitEntry(name: string): Promise<void> {
  const req = entryRequest.value
  entryRequest.value = null
  if (!req) return
  if (req.mode === 'rename' && req.target) {
    const to = await explorer.rename(req.target, name)
    if (to) emit('renamed', req.target, to)
    return
  }
  const path = await explorer.create(req.parent, name, req.kind)
  if (path && req.kind === 'file') emit('open', path, false)
}

const pendingTrash = ref<TreeRow | null>(null)
const trashName = computed(() => t(`workspace.changes.trash.${isMac ? 'mac' : 'win'}`))

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    explorer.status = { key: 'copied', name: text, failed: false }
  } catch {
    // clipboard refused: nothing to report beyond no feedback
  }
}

async function onAction(id: ExplorerAction, row: TreeRow): Promise<void> {
  const root = explorer.root
  if (!root) return
  const dir = row.depth === 0 ? root : row.directory ? row.path : parentDirectory(row.path)
  switch (id) {
    case 'new-file':
    case 'new-folder':
      entryRequest.value = { mode: 'create', kind: id === 'new-file' ? 'file' : 'directory', parent: dir }
      break
    case 'copy-abs':
      return copy(row.path)
    case 'copy-rel':
      return copy(relativeTo(root, row.path) || '.')
    case 'copy-name':
      return copy(row.name)
    case 'rename':
      entryRequest.value = { mode: 'rename', kind: row.directory ? 'directory' : 'file', parent: parentDirectory(row.path), target: row.path, initial: row.name }
      break
    case 'trash':
      pendingTrash.value = row
      break
    case 'reload':
      await explorer.loadListing(dir)
      break
    case 'reveal':
      void revealPath(row.path)
      break
    case 'open-split':
      emit('openSplit', row.path)
      break
    case 'terminal':
      emit('terminal', dir)
      break
    case 'show-diff':
      if (changes.status.value?.ok) emit('openDiff', changes.status.value.root, row.path)
      break
  }
}

async function confirmTrash(): Promise<void> {
  const row = pendingTrash.value
  pendingTrash.value = null
  if (row) await explorer.trash(row.path)
}
```

Template: `ExplorerTree` gets `:repo="changes.isRepo.value"` and `@action="onAction"`; the dialog line becomes `<CreateEntryDialog :request="dialog" @create="submitEntry" @close="entryRequest = null" />`; add after it:

```vue
    <Teleport to="body">
      <DiscardConfirm
        v-if="pendingTrash"
        :title="t('workspace.explorer.trash.title', { name: pendingTrash.name, trash: trashName })"
        :lines="[t(pendingTrash.directory ? 'workspace.explorer.trash.folder' : 'workspace.explorer.trash.file', { trash: trashName }), t('workspace.explorer.trash.restore', { trash: trashName })]"
        :confirm-label="t('workspace.explorer.trash.action', { trash: trashName })"
        @confirm="confirmTrash"
        @cancel="pendingTrash = null"
      />
    </Teleport>
```

- [ ] **Step 9: `WorkspaceView.vue`** — import `movedPath` from `../../lib/explorer/tree`; after `openFromExplorer` (line 247):

```ts
function openSplitFromExplorer(path: string): void {
  const cwd = activeProject.value ?? undefined
  const key = workspace.activeKey
  withViewTransition(() => workspace.openFile(path, undefined, key ? { cwd, split: { key, dir: 'row' }, preview: false } : { cwd, preview: false }))
}

/** File viewers follow a rename made in the Explorer. */
function onExplorerRenamed(from: string, to: string): void {
  for (const p of workspace.panes) {
    if (p.kind !== 'file' || !p.path) continue
    const next = movedPath(p.path, from, to)
    if (next) workspace.update(p.key, { path: next })
  }
}
```

On `<ExplorerPanel …>` (line 827) add `@open-split="openSplitFromExplorer" @terminal="(dir) => withViewTransition(() => workspace.open('shell', dir))" @renamed="onExplorerRenamed"`.

- [ ] **Step 10: i18n** — `workspace-explorer.ts` inside `explorer` (en):

```ts
    menu: {
      label: 'Actions for {name}',
      new: 'New',
      newFile: 'File…',
      newFolder: 'Folder…',
      copyRef: 'Copy Path/Reference',
      copyAbs: 'Absolute Path',
      copyRel: 'Path From Project Root',
      copyName: 'File Name',
      rename: 'Rename…',
      trash: 'Delete…',
      openSplit: 'Open in Right Split',
      openIn: 'Open In',
      explorer: 'Explorer',
      finder: 'Finder',
      terminal: 'Terminal',
      git: 'Git',
      showDiff: 'Show Diff',
      reload: 'Reload from Disk',
    },
    rename: { title: 'Rename', action: 'Rename' },
    trash: {
      title: 'Move “{name}” to the {trash}?',
      file: 'The file moves to the {trash}.',
      folder: 'The folder and everything in it move to the {trash}.',
      restore: 'You can put it back from the {trash}.',
      action: 'Move to {trash}',
    },
```

vi:

```ts
    menu: {
      label: 'Thao tác cho {name}',
      new: 'Mới',
      newFile: 'File…',
      newFolder: 'Thư mục…',
      copyRef: 'Sao chép đường dẫn',
      copyAbs: 'Đường dẫn tuyệt đối',
      copyRel: 'Đường dẫn từ gốc dự án',
      copyName: 'Tên file',
      rename: 'Đổi tên…',
      trash: 'Xoá…',
      openSplit: 'Mở ở khung bên phải',
      openIn: 'Mở bằng',
      explorer: 'Explorer',
      finder: 'Finder',
      terminal: 'Terminal',
      git: 'Git',
      showDiff: 'Xem diff',
      reload: 'Tải lại từ ổ đĩa',
    },
    rename: { title: 'Đổi tên', action: 'Đổi tên' },
    trash: {
      title: 'Chuyển “{name}” vào {trash}?',
      file: 'File sẽ được chuyển vào {trash}.',
      folder: 'Thư mục và mọi thứ bên trong sẽ được chuyển vào {trash}.',
      restore: 'Có thể khôi phục lại từ {trash}.',
      action: 'Chuyển vào {trash}',
    },
```

- [ ] **Step 11: E2E** — create `apps/desktop/e2e/explorer-menu.cjs` and add `'explorer-menu'` to the end of the list in `apps/desktop/e2e/run.cjs:8`:

```js
// Explorer context menu: items, submenu by keyboard, copy path, rename (viewer follows), delete to trash, right split.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-explorer-menu-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'README.md'), '# menu\n')
  fs.writeFileSync(path.join(DIR, 'src', 'b.ts'), 'export const b = 1\n')
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)
  await cmd('Page.bringToFront') // navigator.clipboard needs a focused document
  await evaluate(`document.querySelector('[data-side-view="explorer"]').click()`)
  await waitFor(`!!document.querySelector('[data-explorer-tree] [data-path$="README.md"]')`, 8000, 'explorer rows').catch(() => {})
  const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
  await evaluate(`(() => { const r = ${rowSel('README.md')}.getBoundingClientRect(); ${rowSel('README.md')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'menu').catch(() => {})
  await shot('explorer-menu-01')
  const items = await evaluate(`[...document.querySelectorAll('[data-context-menu] [role=menuitem]')].map((b) => b.dataset.menuId)`)
  check('menu lists the minimal set', JSON.stringify(items) === JSON.stringify(['new', 'copy-ref', 'rename', 'trash', 'open-split', 'open-in', 'git', 'reload']), JSON.stringify(items))
  // Keyboard into a submenu: ↓ to Copy Path/Reference, → opens it, Enter copies the absolute path.
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-context-submenu]')`, 2000, 'submenu').catch(() => {})
  check('→ opens the submenu and focuses its first item', await evaluate(`document.activeElement?.dataset.menuId === 'copy-abs'`))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(300)
  check('Copy Absolute Path reports the path', (await evaluate(`document.querySelector('[data-explorer] [role=status]')?.textContent ?? ''`)).includes('README.md'))
  // Rename with Shift+F6 while README.md is open in a kept viewer: the viewer follows.
  await evaluate(`${W}.openFile(${JSON.stringify(path.join(DIR, 'README.md'))}, undefined, { cwd: ${JSON.stringify(DIR)}, preview: false })`)
  await sleep(500)
  await evaluate(`document.querySelector('[data-side-view="explorer"]').click()`)
  await waitFor(`!!(${rowSel('README.md')})`, 4000, 'row back').catch(() => {})
  await evaluate(`${rowSel('README.md')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: true, bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-create-name]')`, 3000, 'rename dialog').catch(() => {})
  check('rename preselects the name without its extension', await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); return i.value === 'README.md' && i.selectionEnd === 6 })()`))
  await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); i.value = 'NOTES.md'; i.dispatchEvent(new Event('input')); document.querySelector('[data-create-submit]').click() })()`)
  await sleep(600)
  check('rename renames on disk', fs.existsSync(path.join(DIR, 'NOTES.md')) && !fs.existsSync(path.join(DIR, 'README.md')))
  check('the open viewer follows the rename', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('NOTES.md')) && !${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('README.md'))`))
  // Delete moves to the trash after the confirm.
  await waitFor(`!!(${rowSel('NOTES.md')})`, 4000, 'renamed row').catch(() => {})
  await evaluate(`${rowSel('NOTES.md')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(process.platform === 'darwin' ? 'Backspace' : 'Delete')}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`)
  await waitFor(`!!document.querySelector('.ccm-btn-danger')`, 3000, 'trash confirm').catch(() => {})
  await evaluate(`[...document.querySelectorAll('.ccm-btn-danger')].at(-1).click()`)
  await sleep(1200)
  check('Delete moves the file to the trash', !fs.existsSync(path.join(DIR, 'NOTES.md')))
  // Open in Right Split.
  const before = await evaluate(`${W}.panes.length`)
  await evaluate(`[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === 'src')?.click()`)
  await waitFor(`!!(${rowSel('b.ts')})`, 4000, 'src open').catch(() => {})
  await evaluate(`${rowSel('b.ts')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`)
  await sleep(600)
  check('Shift+Enter opens the file beside the active pane', (await evaluate(`${W}.panes.length`)) === before + 1 && (await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('b.ts') && !p.preview)`)))
  await shot('explorer-menu-02')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('explorer-menu-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-explorer-menu.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
```

- [ ] **Step 12: Verify** — `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/explorer.cjs && node apps/desktop/e2e/explorer-menu.cjs` — Expected: all PASS (explorer.cjs proves create still works through the generalised dialog).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/lib/explorer/contextMenu.ts apps/web/src/lib/explorer/contextMenu.test.ts apps/web/src/components/workspace/ExplorerTree.vue apps/web/src/components/workspace/ExplorerPanel.vue apps/web/src/components/workspace/CreateEntryDialog.vue apps/web/src/components/workspace/DiscardConfirm.vue apps/web/src/components/workspace/WorkspaceView.vue apps/web/src/i18n/workspace-explorer.ts apps/desktop/e2e/explorer-menu.cjs apps/desktop/e2e/run.cjs
git commit -m "✨ Explorer context menu: new, copy path, rename, delete, open in split, git diff

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


### Task 5: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v35-explorer-menu.md`
- Modify: `.code_index/web.md`, `.code_index/desktop.md`, `.code_index/_meta.md`, `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v35-explorer-menu.md` — 10–15 lines: Goal, pieces (`renameEntry` / `trashEntry` + IPC, store `rename` / `trash`, `movedPath`, `lib/menu.ts` + `ui/ContextMenu.vue`, `lib/explorer/contextMenu.ts`, dialog rename mode, `DiscardConfirm.confirmLabel`), the 5 Rulings above, tests (`explorer.test.ts` desktop + store, `menu.test.ts`, `contextMenu.test.ts`, `e2e/explorer-menu.cjs`), link to this plan.
- [ ] **Step 2:** `.code_index/web.md` — in the v26 Explorer section add: `- v35 context menu: lib/explorer/contextMenu.ts (explorerMenu model, explorerKey: Shift+F6 / Delete (⌘⌫) / Shift+Enter / ContextMenu|Shift+F10), ui/ContextMenu.vue + lib/menu.ts (menuPosition, submenuPosition, findAction; one submenu level, teleported), ExplorerTree @contextmenu + emit action, ExplorerPanel onAction (create/rename dialog, copy path → status "copied", trash confirm teleported), WorkspaceView openSplitFromExplorer / terminal / onExplorerRenamed (movedPath). Store rename (expanded paths follow) / trash.` `desktop.md`: `preview/explorer.ts renameEntry (never overwrites, case-only rename via ino/dev) / trashEntry (shell.trashItem via trashFn), IPC ccm:rename-entry / ccm:trash-entry.` `_meta.md`: one line with the paths.
- [ ] **Step 3:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 4: Verify** — `npm run typecheck && npm test && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/explorer.cjs && node apps/desktop/e2e/explorer-menu.cjs` — Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add .planning/PLAN-v35-explorer-menu.md .code_index apps/desktop/package.json
git commit -m "📝 Explorer context menu plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
