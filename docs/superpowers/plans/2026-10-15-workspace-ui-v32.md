# Workspace UI v32 (sidebar width · JetBrains split diff · Explorer menu · ←/→ files · Branches toolbar · Attachments removal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six Workspace UI updates requested on 2026-10-15: a draggable sidebar width, an Android Studio (JetBrains) side-by-side diff, a small Explorer context menu, ←/→ to switch files in a diff, the Branches toolbar of the Git Log, and Attachments that follow Backspace and can be removed in any order.

**Architecture:** Each part is a milestone that ships on its own. The split diff is rebuilt as a new `SplitDiff.vue` fed by a pure row/fragment model (`lib/splitDiff.ts`) computed from the git diff the app already loads, so the side-by-side view needs no new IPC. The Explorer menu and the Branches toolbar add small, validated desktop operations (`preview/explorer.ts`, new `preview/branches.ts`) behind the existing `isAppFrame` + repo/root checks. Destructive git operations (branch delete) go through a native confirm in main, like the Extensions tab.

**Tech Stack:** Vue 3 + Pinia + Tailwind v4 + vue-i18n (apps/web), Electron main + preload (apps/desktop), plain `git` via `execGit`, Vitest (happy-dom on web), CDP E2E scripts (`apps/desktop/e2e/*.cjs`).

**Spec:** The user's request of 2026-10-15 (5 items, quoted in **Spec** below) + the JetBrains side-by-side design note pasted with item 2 + the two screenshots (Android Studio Project-view context menu; Git Log Branches toolbar). Prior rulings: `.planning/PLAN-v29-git-diff.md` (diff is read-only, git is the engine), `.planning/PLAN-v30-git-log.md` (Log was read-only), `.planning/COLOR-SYSTEM.md`.

## Spec (from the user, 2026-10-15)

1. Drag to resize the width of the Explorer / Projects sidebar.
2. Git diff side-by-side like Android Studio, not like VS Code. Design note: no filler lines — each side keeps its real lines; correspondence is drawn as curved bands in a middle gutter. Colours: Modified = blue on both sides; Deleted = grey on the left, thin line on the right; Inserted = thin line on the left, green on the right. Layers: (1) line diff → `Fragment[]` (`l1Start/l1End/l2Start/l2End`, half-open), histogram/patience preferred over Myers; (2) word/char diff inside modified fragments, darker tint; (3) SVG/canvas gutter redrawn on scroll (rAF), Bézier connector per fragment, only visible ones, `>>` buttons aligned to the fragment top; (4) non-linear scroll sync via `mapLine` + inverse, centre line, `syncing` flag cleared next frame. Polish: collapse unchanged, F7/Shift+F7, ignore whitespace / blank lines, highlight lines/words/chars, live edit of the right side, apply/revert chunk.
3. Explorer context menu — minimal compared with the Android Studio screenshot.
4. In git diff mode, F7 is used to change file quickly → ← / → should switch file.
5. Git diff/Log: implement the Branches panel toolbar from the screenshot: Show/Hide Branches, New Branch, Update Selected, Delete Branch, Compare with Current, Search, Fetch, Mark/Unmark Favorite, Navigate Log to Selected Branch, More (Group By, show tags), Expand All, Collapse All.
6. Attachments: deleting with Backspace in the terminal does not make the attachment disappear from the tray; clicking the tray's × shows "Not at the end of the prompt: remove it in the terminal" — with 3 attachments only #3 → #2 → #1 can be removed in that order; removing #2 directly must work.

## Rulings (decided while planning — please confirm or overrule before execution)

1. **Diff engine stays git** (v29). Layer 1 uses the existing full-context `git diff` + `changeBlocks`; we add `--histogram` to every `git diff` the app runs. No `diff` npm package.
2. **Diff stays read-only** (v29 owner ruling): no live editing of the right side, no `<<` (copy right → HEAD is impossible), no "ignore chunk ×". The gutter `»` button is the existing per-block revert (`git apply -R` behind `DiscardConfirm`), shown only in the Changes pane.
3. **Grey for deleted only in the split view.** Inline (unified) view keeps red/green; Explorer and file-viewer gutters are unchanged.
4. **Explorer menu items** (the "minimal" subset of the screenshot): New ▸ File… / Folder…, Copy Path/Reference ▸ Absolute Path / Path From Project Root / File Name, Rename… (Shift+F6), Delete… (Delete; ⌘⌫ on macOS — moves to the OS trash, never `rm`), Open in Right Split (Shift+Enter), Open In ▸ Explorer|Finder / Terminal, Git ▸ Show Diff (repo only), Reload from Disk. Out: Cut/Copy/Paste of files, Find Usages, Analyze, Refactor, Bookmarks, Reformat, Optimize Imports, Override File Type, Local History, Compare With, Mark Directory As, Create Gist, Add C++, the "New ▸" Android templates.
5. **←/→ switch files** in the Changes pane (diff area and flat list) and in the Log diff view. In the Changes **tree** list ←/→ keep collapsing/expanding folders. With modifiers they do nothing new (Alt+←/→ stays pane focus). ←/→ no longer scroll a long line horizontally in the diff; Shift+wheel and the scrollbar still do. `[` `]` keep working.
6. **The Log is no longer strictly read-only** (overrides v30 by the user's request): the Branches toolbar may create a branch (optionally switching to it), fast-forward branches (Update Selected), fetch, and delete a branch. Never: force-push, non-fast-forward update, reset, deleting the current branch, deleting tags. Delete (local and remote) only after a **native confirm in main** that shows the exact git command; an unmerged local branch needs a second native confirm for `-D`.
7. **Star = favorite** in the refs tree (JetBrains). The v30 star meant "has upstream"; tracking now shows as the ↑↓ counts and in the row tooltip. Favorites are per repo in `localStorage` (`ccm.workspace.logFavorites`), default `main` / `master` when the repo has none stored.
8. **Compare with Current** = the log filtered to commits reachable from the selected branch and not from HEAD (`git log <ref> --not HEAD`), with Swap and Clear. No 2-branch file diff.
9. **Branches toolbar is a vertical strip** at the left edge of the Log pane (as in the screenshot); it stays visible when the branch tree is hidden, and its first button is Show/Hide Branches (moved from the Log header).
10. **Attachments removal moves the cursor with arrow keys.** The tray's × on any item whose token sits before the cursor **on the cursor's row** types ← to just after it, Backspace(s), then → back (only on the user's click, never Enter — same consent model as today's Backspace erase). Tokens on another row or after the cursor keep the "remove it in the terminal" notice (screen text cannot tell a soft wrap from a typed newline). Rows with wide (CJK / emoji) characters before the cursor are refused (cells ≠ characters). Verified on a real Claude pane by `e2e/v25.cjs` and recorded in `docs/claude-code-integration.md` §11p.
11. **Ghost rows while erasing a mention** (code-reading finding for item 6): each Backspace on `@package.json` leaves `@package.jso`, `@package.js` … which the scan adds as new "terminal" rows, so the tray never empties. A mention that ends exactly at the cursor is being typed or erased and gets no row until a space follows it.

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green). Desktop native dialog strings in `apps/desktop/src/strings.ts` (`en` and `vi`).
- All colours via theme tokens (`.planning/COLOR-SYSTEM.md`); status = icon + text + colour, never colour alone; status colours for lifecycle only. The diff "well" is always dark: split-diff colours are derived from `--ccm-diff-mod-well`, `--ccm-diff-add-well`, `--ccm-well-ink`, `--ccm-well`, `--ccm-well-line`, `--ccm-focus` with `color-mix` — no new theme tokens.
- No horizontal page scroll; long names truncate with a tooltip (`truncate` + `title`). The split panes scroll horizontally inside themselves.
- Translucent material only on chrome (sidebar, popovers, menus). Dialogs/confirms rendered from inside the material sidebar must be teleported to `body` (backdrop-filter makes a containing block for `position: fixed`).
- No new npm dependency.
- Never delete files outright: Explorer delete uses the OS trash (`shell.trashItem`). Every page-supplied path / name / ref is validated in main (`explorerRoot` / `repoOf`, `checkEntryName`, `REF`, `git check-ref-format`).
- git runs only through `execGit` (`GIT_TERMINAL_PROMPT=0`, literal pathspecs). Page-supplied names reach git only after validation and after `--` where git accepts it. Network commands (`fetch`, `pull`, `push --delete`) use `timeoutMs: 120_000`. Error details shown in the UI have credentials stripped from URLs (`sanitizeGitError`).
- Storage keys keep the `ccm.` prefix. New: `ccm.workspace.sideWidth` (number), `ccm.workspace.logFavorites` (`{ [repoKey]: string[] }`), `ccm.workspace.logRefsView` (`{ group: boolean; tags: boolean }`). Changed: `ccm.workspace.diffOpts` gains `highlight` (migrates `words`).
- Commits: gitmoji style (`✨`, `🐛`, `✅`, `📝`, `♻️`, `💄`), message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm test -w @ccm/desktop -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/<name>.cjs`.
- After each task, update `.code_index/` (`web.md` / `desktop.md` / `_meta.md`) with 1–2 lines per change (CLAUDE.md "Code index"); Task 21 does the final pass.
- Monitoring never sends prompts: the Attachments tray only types editing keys (←, →, Backspace, paste of a mention) into the user's own input box on the user's click, never Enter.
- Coordinate with v31 (`docs/superpowers/plans/2026-10-15-multi-project-workspace.md`, not started): v31 replaces `WorkspaceSidebar` by the Agent rail inside the same `<aside>`. The width in Task 1 applies to the `<aside>`, so whichever plan lands second keeps `:style="{ width }"` on it; v31's collapsed avatar column overrides the width while collapsed.

## Review Focus

1. **New / untracked file and deleted file in the split view** (one side has no lines) → one fragment, a thin line at row 0 on the empty side, connectors drawn, scroll sync keeps the empty side still; no crash on an empty row list. Pinned in Task 3 (`splitModel` new-file test) and Task 4 (`mapRow` with an empty side).
2. **Huge file in `partial` mode** (several hunks with gaps) → a gap row at the same index on both sides so rows stay aligned and `mapRow` stays a constant shift between fragments. Pinned in Task 3 (two-hunk test).
3. **Code zoom while the split view is open** (Ctrl/⌘ + wheel changes `--ccm-code-size`) → row height re-measured, connectors still meet the row tops. Pinned in Task 7 (E2E zoom check).
4. **Case-only rename** (`readme.md` → `README.md`) on Windows/macOS → succeeds, not "already exists". Pinned in Task 9 (`renameEntry` test).
5. **Git error text with a credential URL** (`https://user:token@host/repo.git`) from fetch/push → the token never reaches the page. Pinned in Task 14 (`sanitizeGitError` test).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `apps/web/src/lib/sideWidth.ts` (+ `.test.ts`) | new | sidebar width clamp + persistence |
| `apps/web/src/components/workspace/SideResizer.vue` | new | vertical separator handle (drag, keys, reset) |
| `apps/web/src/components/workspace/WorkspaceView.vue` | modify | aside width, resizer, Explorer events (split, terminal, rename) |
| `apps/desktop/src/preview/changes.ts` | modify | `--histogram` |
| `apps/web/src/lib/splitDiff.ts` (+ `.test.ts`) | new | `splitModel`, `mapRow`, `connectorPath`, `visibleFragments`, `midRow`, `scrollTopFor` |
| `apps/web/src/composables/useDiffDecor.ts` | new | syntax tokens + changed-word marks shared by inline/split |
| `apps/web/src/lib/diffBlocks.ts` | modify | `wordDiff(…, mode)` chars |
| `apps/web/src/lib/diffOpts.ts` (+ new `.test.ts`) | modify | `highlight: 'lines' \| 'words' \| 'chars'` |
| `apps/web/src/components/workspace/SplitDiff.vue` | new | JetBrains side-by-side view |
| `apps/web/src/components/workspace/DiffView.vue` | modify | inline only; delegates split to `SplitDiff` |
| `apps/web/src/lib/diff.ts`, `lib/reviewTools.test.ts` | modify | drop `sideBySide` |
| `apps/web/src/components/workspace/ChangesPane.vue`, `log/LogPane.vue` | modify | highlight menu, split host, ←/→ |
| `apps/web/src/lib/changesView.ts` | modify | `fileStepKey` |
| `apps/desktop/src/preview/explorer.ts`, `ipc.ts`, `preload.ts` | modify | `renameEntry`, `trashEntry` + IPC |
| `apps/web/src/lib/preview.ts`, `stores/explorer.ts`, `lib/explorer/tree.ts` | modify | bridge, store `rename`/`trash`, `movedPath` |
| `apps/web/src/lib/menu.ts` (+ `.test.ts`), `components/ui/ContextMenu.vue` | new | generic menu with one submenu level |
| `apps/web/src/lib/explorer/contextMenu.ts` (+ `.test.ts`) | new | Explorer menu model + tree shortcuts |
| `ExplorerTree.vue`, `ExplorerPanel.vue`, `CreateEntryDialog.vue`, `DiscardConfirm.vue` | modify | menu wiring, rename mode, confirm label |
| `packages/shared/src/gitBranch.ts` | new | `checkBranchName`, branch op result types |
| `apps/desktop/src/preview/branches.ts` (+ `test/branches.test.ts`) | new | create / delete / fetch / update, `sanitizeGitError` |
| `apps/desktop/src/preview/log.ts`, `packages/shared/src/gitlog.ts`, `apps/web/src/lib/logQuery.ts` | modify | `notRef` (Compare with Current) |
| `apps/desktop/src/strings.ts`, `main.ts` | modify | native confirm for branch delete |
| `apps/web/src/lib/gitRefs.ts`, `lib/refPrefs.ts` (+ tests) | modify / new | favorites, group by folder, show tags, folder ids |
| `apps/web/src/components/workspace/log/LogRefsToolbar.vue`, `NewBranchDialog.vue` | new | vertical strip, new-branch sheet |
| `apps/web/src/components/workspace/log/LogRefsTree.vue`, `LogTable.vue` | modify | selection vs filter, favorites, expose `scrollToHash` |
| `apps/web/src/composables/useGitLog.ts` | modify | `reveal(hash)` |
| `apps/web/src/i18n/en.ts`, `vi.ts`, `workspace-diff.ts`, `workspace-explorer.ts`, `workspace-log.ts` | modify | strings |
| `apps/web/src/lib/promptAttachments.ts` (+ test) | modify | `eraseKeys` (replaces `eraseCount`), `cursorToken` |
| `apps/web/src/stores/attachments.ts` (+ test), `composables/usePaneAttachments.ts`, `TermPane.vue`, `AttachmentsPanel.vue` | modify | no ghost rows while editing, remove any item on the cursor row |
| `docs/claude-code-integration.md` §11p | modify | verified arrow-key removal |
| `apps/desktop/e2e/v32.cjs`, `e2e/run.cjs`, `e2e/diff.cjs`, `e2e/log.cjs`, `e2e/v25.cjs` | new / modify | E2E |

---

# Milestone 1 — Resizable sidebar

### Task 1: Drag the Projects / Explorer sidebar width

**Files:**
- Create: `apps/web/src/lib/sideWidth.ts`, `apps/web/src/lib/sideWidth.test.ts`, `apps/web/src/components/workspace/SideResizer.vue`, `apps/desktop/e2e/v32.cjs`
- Modify: `apps/web/src/components/workspace/WorkspaceView.vue:53-71,806-837`, `apps/web/src/i18n/en.ts:104-109`, `apps/web/src/i18n/vi.ts:105-110`, `apps/desktop/e2e/run.cjs:8`

**Interfaces:**
- Produces: `SIDE_WIDTH_KEY`, `SIDE_MIN = 200`, `SIDE_MAX = 560`, `SIDE_DEFAULT = 240`, `STAGE_MIN = 480`, `clampSideWidth(px: number, viewport?: number): number`, `readSideWidth(): number`, `writeSideWidth(px: number): void`; component `SideResizer` props `{ width: number; min: number; max: number; label: string }`, `v-model:dragging`, emits `resize(px)`, `commit()`, `reset()`; DOM hook `[data-side-resizer]`. E2E file `apps/desktop/e2e/v32.cjs` with `run(app)` sections later tasks append to.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/sideWidth.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clampSideWidth, readSideWidth, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_WIDTH_KEY, STAGE_MIN, writeSideWidth } from './sideWidth'

describe('sidebar width', () => {
  beforeEach(() => localStorage.clear())

  it('clamps into [SIDE_MIN, SIDE_MAX]', () => {
    expect(clampSideWidth(50)).toBe(SIDE_MIN)
    expect(clampSideWidth(9999)).toBe(SIDE_MAX)
    expect(clampSideWidth(301.6)).toBe(302)
  })

  it('leaves the stage STAGE_MIN of the window', () => {
    expect(clampSideWidth(500, 800)).toBe(800 - STAGE_MIN)
  })

  it('never goes under SIDE_MIN, even in a tiny window', () => {
    expect(clampSideWidth(300, 500)).toBe(SIDE_MIN)
  })

  it('falls back to the default for NaN / garbage / nothing stored', () => {
    expect(clampSideWidth(Number.NaN)).toBe(SIDE_DEFAULT)
    expect(readSideWidth()).toBe(SIDE_DEFAULT)
    localStorage.setItem(SIDE_WIDTH_KEY, 'wide')
    expect(readSideWidth()).toBe(SIDE_DEFAULT)
  })

  it('round-trips and clamps a stored value', () => {
    writeSideWidth(333)
    expect(readSideWidth()).toBe(333)
    localStorage.setItem(SIDE_WIDTH_KEY, '9999')
    expect(readSideWidth()).toBe(SIDE_MAX)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @ccm/web -- src/lib/sideWidth.test.ts`
Expected: FAIL — `Failed to resolve import "./sideWidth"`.

- [ ] **Step 3: Implement** — `apps/web/src/lib/sideWidth.ts`

```ts
/** Workspace sidebar (Projects | Explorer) width, dragged with `SideResizer`. */
export const SIDE_WIDTH_KEY = 'ccm.workspace.sideWidth'
export const SIDE_MIN = 200
export const SIDE_MAX = 560
export const SIDE_DEFAULT = 240
/** Window width kept for the stage (tab strip + panes, page padding and gap included). */
export const STAGE_MIN = 480

/** `px` clamped to [SIDE_MIN, SIDE_MAX] and to what leaves the stage STAGE_MIN of a `viewport`-wide window. */
export function clampSideWidth(px: number, viewport = Infinity): number {
  if (!Number.isFinite(px)) return SIDE_DEFAULT
  const max = Math.max(SIDE_MIN, Math.min(SIDE_MAX, viewport - STAGE_MIN))
  return Math.round(Math.min(max, Math.max(SIDE_MIN, px)))
}

export function readSideWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDE_WIDTH_KEY))
    return raw ? clampSideWidth(raw) : SIDE_DEFAULT
  } catch {
    return SIDE_DEFAULT
  }
}

export function writeSideWidth(px: number): void {
  try {
    localStorage.setItem(SIDE_WIDTH_KEY, String(Math.round(px)))
  } catch {
    // preference only
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @ccm/web -- src/lib/sideWidth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the handle** — `apps/web/src/components/workspace/SideResizer.vue`

```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = defineProps<{ width: number; min: number; max: number; label: string }>()
const emit = defineEmits<{ resize: [px: number]; commit: []; reset: [] }>()
const dragging = defineModel<boolean>('dragging', { default: false })

const { t } = useI18n()
const STEP = 16

function start(e: PointerEvent): void {
  if (e.button !== 0) return
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const origin = e.clientX
  const from = props.width
  dragging.value = true
  const move = (ev: PointerEvent): void => emit('resize', from + ev.clientX - origin)
  const end = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    dragging.value = false
    emit('commit')
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function set(px: number): void {
  emit('resize', px)
  emit('commit')
}
</script>

<template>
  <div
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('panel.resize', { panel: label })"
    :title="t('panel.resizeHint')"
    :aria-valuenow="width"
    :aria-valuemin="min"
    :aria-valuemax="max"
    class="group absolute inset-y-0 -right-3 z-20 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none"
    data-side-resizer
    @pointerdown.prevent="start"
    @dblclick="emit('reset')"
    @keydown.left.prevent="set(width - STEP)"
    @keydown.right.prevent="set(width + STEP)"
    @keydown.home.prevent="set(min)"
    @keydown.end.prevent="set(max)"
  >
    <span
      class="h-12 w-1 rounded-full bg-line-strong opacity-0 transition-[opacity,background-color] duration-(--ccm-dur-fast) group-hover:bg-accent group-hover:opacity-100 group-focus-visible:bg-accent group-focus-visible:opacity-100"
      :class="dragging ? 'bg-accent opacity-100' : ''"
    />
  </div>
</template>
```

- [ ] **Step 6: Wire it into `WorkspaceView.vue`**

Imports (top of `<script setup>`):

```ts
import { clampSideWidth, readSideWidth, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, writeSideWidth } from '../../lib/sideWidth'
import SideResizer from './SideResizer.vue'
```

After the `sidebarOpen` watch (line 71):

```ts
/** Stored preference; what is drawn is clamped to the current window so a narrow window never hides the stage. */
const sideWidthPref = ref(readSideWidth())
const viewportW = ref(window.innerWidth)
const sideWidth = computed(() => clampSideWidth(sideWidthPref.value, viewportW.value))
const sideMax = computed(() => clampSideWidth(SIDE_MAX, viewportW.value))
const sideDragging = ref(false)
function onViewportResize(): void {
  viewportW.value = window.innerWidth
}
function resizeSide(px: number): void {
  sideWidthPref.value = clampSideWidth(px, viewportW.value)
}
function resetSide(): void {
  sideWidthPref.value = SIDE_DEFAULT
  writeSideWidth(SIDE_DEFAULT)
}
```

In the existing `onMounted` add `window.addEventListener('resize', onViewportResize)`; in the existing `onBeforeUnmount` (line 795) add `window.removeEventListener('resize', onViewportResize)`.

Template — replace line 808 and add the handle as the aside's last child (before `</aside>` at line 837):

```vue
    <aside
      v-if="workspace.tabs.length && sidebarOpen"
      class="relative hidden shrink-0 flex-col gap-1.5 md:flex"
      :class="sideDragging ? 'select-none' : ''"
      :style="{ width: `${sideWidth}px` }"
      data-tour="ws-sidebar"
    >
      <!-- …existing tablist / ExplorerPanel / WorkspaceSidebar unchanged… -->
      <SideResizer
        v-model:dragging="sideDragging"
        :width="sideWidth"
        :min="SIDE_MIN"
        :max="sideMax"
        :label="t('workspace.side.panel')"
        @resize="resizeSide"
        @commit="writeSideWidth(sideWidthPref)"
        @reset="resetSide"
      />
    </aside>
```

While dragging, webviews and terminals must not eat the pointer: on the stage wrapper (`<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">`, line 838) add `:class="sideDragging ? 'pointer-events-none' : ''"`.

i18n — `apps/web/src/i18n/en.ts` inside `workspace.side` (line 104): add `panel: 'sidebar',`; `apps/web/src/i18n/vi.ts` inside `workspace.side` (line 105): add `panel: 'thanh bên',`.

- [ ] **Step 7: E2E** — create `apps/desktop/e2e/v32.cjs` (later tasks add sections before `}` of `run`)

```js
// v32: sidebar width, JetBrains split diff, Explorer context menu, ←/→ files, Branches toolbar.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v32-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })
const base = Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1}`)

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), base.join('\n') + '\n')
  fs.writeFileSync(path.join(DIR, 'src', 'b.ts'), 'export const b = 1\n')
  fs.writeFileSync(path.join(DIR, 'README.md'), '# v32\n')
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  // long.ts: line 5 modified, 6 lines inserted after 150, lines 300-309 deleted.
  const now = [...base]
  now[4] = 'const line5 = 500'
  now.splice(299, 10)
  now.splice(150, 0, ...Array.from({ length: 6 }, (_, i) => `const added${i} = ${i}`))
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), now.join('\n') + '\n')
  fs.writeFileSync(path.join(DIR, 'src', 'b.ts'), 'export const b = 2\n')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.workspace.sideWidth')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)

  // — Task 1: sidebar width —
  const aside = `document.querySelector('[data-tour="ws-sidebar"]')`
  const w0 = await evaluate(`Math.round(${aside}.getBoundingClientRect().width)`)
  check('sidebar starts at the default 240px', w0 === 240, String(w0))
  const r = await evaluate(`(() => { const b = document.querySelector('[data-side-resizer]').getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] })()`)
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + 100, y: r[1], button: 'left' })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0] + 100, y: r[1], button: 'left', clickCount: 1 })
  await sleep(200)
  const w1 = await evaluate(`Math.round(${aside}.getBoundingClientRect().width)`)
  check('dragging the handle widens the sidebar', Math.abs(w1 - 340) <= 2, String(w1))
  check('width is persisted', (await evaluate(`localStorage.getItem('ccm.workspace.sideWidth')`)) === String(w1))
  await evaluate(`document.querySelector('[data-side-resizer]').focus()`)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`)
  await sleep(100)
  check('← narrows by 16px', Math.round(await evaluate(`${aside}.getBoundingClientRect().width`)) === w1 - 16)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(100)
  check('double-click resets to 240px', Math.round(await evaluate(`${aside}.getBoundingClientRect().width`)) === 240)
  await shot('v32-01-sidebar')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v32-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-v32.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
```

Add `'v32'` to the end of the list in `apps/desktop/e2e/run.cjs:8`.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test -w @ccm/web -- src/lib/sideWidth.test.ts && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/v32.cjs`
Expected: typecheck clean; unit PASS; E2E lines all `PASS` (5 checks).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/sideWidth.ts apps/web/src/lib/sideWidth.test.ts apps/web/src/components/workspace/SideResizer.vue apps/web/src/components/workspace/WorkspaceView.vue apps/web/src/i18n/en.ts apps/web/src/i18n/vi.ts apps/desktop/e2e/v32.cjs apps/desktop/e2e/run.cjs
git commit -m "✨ Drag to resize the Workspace sidebar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Milestone 2 — JetBrains side-by-side diff

### Task 2: Histogram diff everywhere

**Files:**
- Modify: `apps/desktop/src/preview/changes.ts:78-81,247`
- Test: `apps/desktop/test/changes.test.ts:164`

**Interfaces:**
- Produces: `diffArgs(opts)` now starts with `'--histogram'`; consumed unchanged by `diff()` (changes.ts:286) and `commitDiff()` (log.ts:220).

- [ ] **Step 1: Write the failing test** — in `apps/desktop/test/changes.test.ts` replace line 164 with:

```ts
    expect(diffArgs({ whitespace: 'all-blank' })).toEqual(['--histogram', '-w', '--ignore-blank-lines'])
    expect(diffArgs({ context: 'full' })).toEqual(['--histogram', '-U1000000'])
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/changes.test.ts` — Expected: FAIL on the `diffArgs` expectation.

- [ ] **Step 3: Implement** — `changes.ts:78-81`:

```ts
/** `git diff` flags for the options (after `diff <base>`). Histogram, like IntelliJ: fewer `}` / blank-line mismatches than Myers. */
export function diffArgs(opts: DiffOptions = {}): string[] {
  const { context, whitespace } = cleanDiffOptions(opts)
  return ['--histogram', ...(context === 'full' ? [FULL_CONTEXT] : []), ...WHITESPACE_ARGS[whitespace]]
}
```

And the numstat call at line 247 (so `+N −M` counts match the viewer): `execGit(root, ['diff', base, '--histogram', '--numstat', '-z', '-M', '--no-ext-diff', '--no-textconv'], …)`. Grep the file for any other `['diff',` call that does not spread `diffArgs` and add `'--histogram'` after the base the same way.

- [ ] **Step 4: Run** `npm test -w @ccm/desktop` — Expected: PASS (all desktop tests; the revert/rollback tests prove patches still apply).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/changes.ts apps/desktop/test/changes.test.ts
git commit -m "⚡️ Use histogram git diff for the viewer, gutter and counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Split model — rows per side + fragments

**Files:**
- Create: `apps/web/src/lib/splitDiff.ts`, `apps/web/src/lib/splitDiff.test.ts`

**Interfaces:**
- Consumes: `DiffFile`, `DiffLine` (`lib/diff.ts`); `Block`, `BlockType`, `changeBlocks`, `foldRows` (`lib/diffBlocks.ts`).
- Produces:

```ts
export type Side = 'left' | 'right'
export type SplitRow =
  | { kind: 'line'; line: DiffLine; block: number | null }
  | { kind: 'note'; text: string }
  | { kind: 'fold'; key: string; count: number }
  | { kind: 'gap' }
export interface Fragment { block: number; type: BlockType; l1Start: number; l1End: number; l2Start: number; l2End: number }
export interface SplitModel { left: SplitRow[]; right: SplitRow[]; frags: Fragment[] }
export interface SplitOpts { collapse: boolean; context: number; expanded: ReadonlySet<string> }
export function splitModel(file: DiffFile, blocks: readonly Block[], opts: SplitOpts): SplitModel
```

Row indices in `Fragment` are indices into `left` / `right` (after folding), half-open. Unchanged runs, folds and gaps always take the same number of rows on both sides — that is what makes `mapRow` a constant shift between fragments.

- [ ] **Step 1: Write the failing test** — `apps/web/src/lib/splitDiff.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './diff'
import { changeBlocks } from './diffBlocks'
import { splitModel, type SplitRow } from './splitDiff'

const file = (body: string, head = 'diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n') => parseUnifiedDiff(head + body)[0]!
const text = (rows: SplitRow[]) => rows.map((r) => (r.kind === 'line' ? r.line.text : r.kind === 'fold' ? `fold:${r.count}` : r.kind === 'note' ? 'note' : 'gap'))
const flat = { collapse: false, context: 3, expanded: new Set<string>() }

// left: a b X c d D1 D2 e f g — right: a b Y1 Y2 c d e f I1 I2 g
const SAMPLE = '@@ -1,10 +1,11 @@\n a\n b\n-X\n+Y1\n+Y2\n c\n d\n-D1\n-D2\n e\n f\n+I1\n+I2\n g\n'

describe('splitModel', () => {
  it('keeps real lines on each side, no filler rows', () => {
    const f = file(SAMPLE)
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'X', 'c', 'd', 'D1', 'D2', 'e', 'f', 'g'])
    expect(text(m.right)).toEqual(['a', 'b', 'Y1', 'Y2', 'c', 'd', 'e', 'f', 'I1', 'I2', 'g'])
  })

  it('turns blocks into fragments in row coordinates', () => {
    const f = file(SAMPLE)
    expect(splitModel(f, changeBlocks(f), flat).frags).toEqual([
      { block: 0, type: 'modified', l1Start: 2, l1End: 3, l2Start: 2, l2End: 4 },
      { block: 1, type: 'deleted', l1Start: 5, l1End: 7, l2Start: 6, l2End: 6 },
      { block: 2, type: 'added', l1Start: 9, l1End: 9, l2Start: 8, l2End: 10 },
    ])
  })

  it('tags changed rows with their block and unchanged rows with null', () => {
    const f = file(SAMPLE)
    const m = splitModel(f, changeBlocks(f), flat)
    expect(m.left.map((r) => (r.kind === 'line' ? r.block : 'x'))).toEqual([null, null, 0, null, null, 1, 1, null, null, null])
  })

  it('folds unchanged runs on both sides at once and opens an expanded fold', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)
    const body = `@@ -1,20 +1,20 @@\n${lines.map((l, i) => (i === 9 ? `-${l}\n+X` : ` ${l}`)).join('\n')}\n`
    const f = file(body)
    const m = splitModel(f, changeBlocks(f), { collapse: true, context: 2, expanded: new Set() })
    expect(text(m.left)).toEqual(['fold:7', 'L8', 'L9', 'L10', 'L11', 'L12', 'fold:8'])
    expect(text(m.right)).toEqual(['fold:7', 'L8', 'L9', 'X', 'L11', 'L12', 'fold:8'])
    expect(m.left[0]).toMatchObject({ kind: 'fold', key: '0:0' })
    expect(m.frags[0]).toMatchObject({ l1Start: 3, l1End: 4, l2Start: 3, l2End: 4 })
    const open = splitModel(f, changeBlocks(f), { collapse: true, context: 2, expanded: new Set(['0:0']) })
    expect(open.left.length).toBe(13)
    expect(open.frags[0]!.l1Start).toBe(9)
  })

  it('puts a "No newline" note on the side of the line it follows', () => {
    const f = file('@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+b\n')
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'note'])
    expect(text(m.right)).toEqual(['a', 'b'])
    expect(m.frags[0]).toMatchObject({ l1Start: 1, l1End: 3, l2Start: 1, l2End: 2 })
  })

  it('keeps both sides aligned across hunk gaps (partial diff)', () => {
    const f = file('@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -10,2 +10,2 @@\n j\n-k\n+K\n')
    const m = splitModel(f, changeBlocks(f), flat)
    expect(text(m.left)).toEqual(['a', 'b', 'gap', 'j', 'k'])
    expect(text(m.right)).toEqual(['A', 'b', 'gap', 'j', 'K'])
    expect(m.frags.map((x) => [x.l1Start, x.l2Start])).toEqual([[0, 0], [4, 4]])
  })

  it('handles a new file: empty left side, one added fragment', () => {
    const f = parseUnifiedDiff('diff --git a/n.md b/n.md\nnew file mode 100644\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+x\n+y\n')[0]!
    const m = splitModel(f, changeBlocks(f), flat)
    expect(m.left).toEqual([])
    expect(text(m.right)).toEqual(['x', 'y'])
    expect(m.frags).toEqual([{ block: 0, type: 'added', l1Start: 0, l1End: 0, l2Start: 0, l2End: 2 }])
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: FAIL (`Failed to resolve import "./splitDiff"`).

- [ ] **Step 3: Implement** — `apps/web/src/lib/splitDiff.ts`

```ts
import type { DiffFile, DiffLine } from './diff'
import { foldRows, type Block, type BlockType } from './diffBlocks'

export type Side = 'left' | 'right'

export type SplitRow =
  | { kind: 'line'; line: DiffLine; block: number | null }
  | { kind: 'note'; text: string }
  | { kind: 'fold'; key: string; count: number }
  | { kind: 'gap' }

/** One change block as row ranges `[start, end)` on each side (JetBrains `Fragment`); an empty side = Inserted / Deleted. */
export interface Fragment {
  block: number
  type: BlockType
  l1Start: number
  l1End: number
  l2Start: number
  l2End: number
}

export interface SplitModel {
  left: SplitRow[]
  right: SplitRow[]
  frags: Fragment[]
}

export interface SplitOpts {
  collapse: boolean
  context: number
  /** `${hunk}:${unitFrom}` of folds the user opened. */
  expanded: ReadonlySet<string>
}

type Unit = { kind: 'ctx'; line: DiffLine; notes: string[] } | { kind: 'block'; index: number }

/**
 * Side-by-side rows without filler lines: each side holds only its own lines; unchanged runs, folds and hunk gaps
 * take one row per line on both sides, so the two sides differ only inside fragments.
 */
export function splitModel(file: DiffFile, blocks: readonly Block[], opts: SplitOpts): SplitModel {
  const left: SplitRow[] = []
  const right: SplitRow[] = []
  const frags: Fragment[] = []
  const startOf = new Map(blocks.map((b, i) => [`${b.hunk}:${b.from}`, i]))

  file.hunks.forEach((h, hi) => {
    if (hi > 0) {
      left.push({ kind: 'gap' })
      right.push({ kind: 'gap' })
    }
    const units: Unit[] = []
    for (let i = 0; i < h.lines.length; ) {
      const bi = startOf.get(`${hi}:${i}`)
      if (bi !== undefined) {
        units.push({ kind: 'block', index: bi })
        i = blocks[bi]!.to
        continue
      }
      const l = h.lines[i]!
      if (l.type === 'note') {
        const last = units[units.length - 1]
        if (last?.kind === 'ctx') last.notes.push(l.text)
      } else units.push({ kind: 'ctx', line: l, notes: [] })
      i++
    }

    const changed = units.map((u) => u.kind === 'block')
    const open = new Set([...opts.expanded].filter((k) => k.startsWith(`${hi}:`)).map((k) => Number(k.slice(k.indexOf(':') + 1))))
    const segments = opts.collapse ? foldRows(changed, opts.context, open) : [{ kind: 'rows' as const, from: 0, to: units.length }]

    for (const seg of segments) {
      if (seg.kind === 'fold') {
        const row: SplitRow = { kind: 'fold', key: `${hi}:${seg.from}`, count: seg.to - seg.from }
        left.push(row)
        right.push(row)
        continue
      }
      for (let u = seg.from; u < seg.to; u++) {
        const unit = units[u]!
        if (unit.kind === 'ctx') {
          left.push({ kind: 'line', line: unit.line, block: null })
          right.push({ kind: 'line', line: unit.line, block: null })
          for (const text of unit.notes) {
            left.push({ kind: 'note', text })
            right.push({ kind: 'note', text })
          }
          continue
        }
        const b = blocks[unit.index]!
        const l1Start = left.length
        const l2Start = right.length
        let prev: DiffLine | null = null
        for (const l of h.lines.slice(b.from, b.to)) {
          if (l.type === 'del') left.push({ kind: 'line', line: l, block: unit.index })
          else if (l.type === 'add') right.push({ kind: 'line', line: l, block: unit.index })
          else if (l.type === 'note' && prev) (prev.type === 'del' ? left : right).push({ kind: 'note', text: l.text })
          if (l.type !== 'note') prev = l
        }
        frags.push({ block: unit.index, type: b.type, l1Start, l1End: left.length, l2Start, l2End: right.length })
      }
    }
  })
  return { left, right, frags }
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splitDiff.ts apps/web/src/lib/splitDiff.test.ts
git commit -m "✨ Add the JetBrains split diff model (rows per side + fragments)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Split geometry — scroll mapping and connectors

**Files:**
- Modify: `apps/web/src/lib/splitDiff.ts` (append), `apps/web/src/lib/splitDiff.test.ts` (append)

**Interfaces:**
- Produces:

```ts
export function mapRow(row: number, frags: readonly Fragment[], from: Side): number
export function connectorPath(f: Fragment, lh: number, top1: number, top2: number, w: number): string
export function visibleFragments(frags: readonly Fragment[], lh: number, top1: number, top2: number, height: number): Fragment[]
export function midRow(scrollTop: number, clientHeight: number, lh: number): number
export function scrollTopFor(row: number, lh: number, clientHeight: number): number
```

- [ ] **Step 1: Write the failing tests** — append to `splitDiff.test.ts`:

```ts
import { connectorPath, mapRow, midRow, scrollTopFor, visibleFragments, type Fragment } from './splitDiff'

const FR: Fragment[] = [
  { block: 0, type: 'modified', l1Start: 2, l1End: 3, l2Start: 2, l2End: 4 },
  { block: 1, type: 'deleted', l1Start: 5, l1End: 7, l2Start: 6, l2End: 6 },
  { block: 2, type: 'added', l1Start: 9, l1End: 9, l2Start: 8, l2End: 10 },
]

describe('mapRow', () => {
  it('shifts unchanged rows by a constant', () => {
    expect(mapRow(1.5, FR, 'left')).toBe(1.5)
    expect(mapRow(3, FR, 'left')).toBe(4)
    expect(mapRow(7, FR, 'left')).toBe(6)
    expect(mapRow(9, FR, 'left')).toBe(10)
  })
  it('interpolates inside a fragment', () => {
    expect(mapRow(2.5, FR, 'left')).toBe(3)
    expect(mapRow(3, FR, 'right')).toBe(2.5)
  })
  it('holds the other side still across an empty side', () => {
    expect(mapRow(5, FR, 'left')).toBe(6)
    expect(mapRow(6.5, FR, 'left')).toBe(6)
    expect(mapRow(9, FR, 'right')).toBe(9)
  })
  it('is the identity with no fragments', () => {
    expect(mapRow(42, [], 'right')).toBe(42)
  })
})

describe('connector geometry', () => {
  it('draws a closed Bézier band between the two row ranges', () => {
    expect(connectorPath(FR[0]!, 20, 0, 0, 40)).toBe('M0 40 C20 40 20 40 40 40 L40 80 C20 80 20 60 0 60 Z')
  })
  it('collapses to a point on an empty side (deleted)', () => {
    expect(connectorPath(FR[1]!, 10, 0, 0, 40)).toBe('M0 50 C20 50 20 60 40 60 L40 60 C20 60 20 70 0 70 Z')
  })
  it('keeps fragments visible on either side only', () => {
    expect(visibleFragments(FR, 10, 0, 0, 40).map((f) => f.block)).toEqual([0])
    expect(visibleFragments(FR, 10, 50, 0, 35).map((f) => f.block)).toEqual([0, 1])
    expect(visibleFragments(FR, 10, 1000, 1000, 40)).toEqual([])
  })
  it('centres a row in the viewport and reads the centre row back', () => {
    expect(scrollTopFor(10, 20, 100)).toBe(150)
    expect(scrollTopFor(1, 20, 100)).toBe(0)
    expect(midRow(150, 100, 20)).toBe(10)
  })
})
```

(The `import` line goes at the top next to the existing one: `import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type SplitRow } from './splitDiff'`.)

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: FAIL (`mapRow is not a function` etc.).

- [ ] **Step 3: Implement** — append to `splitDiff.ts`:

```ts
/** Row on the other side matching `row` (fractional) on `from`: a constant shift between fragments, linear inside one. */
export function mapRow(row: number, frags: readonly Fragment[], from: Side): number {
  let offset = 0
  for (const f of frags) {
    const [aS, aE, bS, bE] = from === 'left' ? [f.l1Start, f.l1End, f.l2Start, f.l2End] : [f.l2Start, f.l2End, f.l1Start, f.l1End]
    if (row < aS) break
    if (row < aE) return bS + ((row - aS) / (aE - aS)) * (bE - bS)
    offset = bE - aE
  }
  return row + offset
}

/** Gutter band of `f`: left edge at the left rows, right edge at the right rows, Bézier top and bottom. */
export function connectorPath(f: Fragment, lh: number, top1: number, top2: number, w: number): string {
  const y1a = f.l1Start * lh - top1
  const y1b = f.l1End * lh - top1
  const y2a = f.l2Start * lh - top2
  const y2b = f.l2End * lh - top2
  const m = w / 2
  return `M0 ${y1a} C${m} ${y1a} ${m} ${y2a} ${w} ${y2a} L${w} ${y2b} C${m} ${y2b} ${m} ${y1b} 0 ${y1b} Z`
}

/** Fragments touching the viewport (`height` px) of at least one side. */
export function visibleFragments(frags: readonly Fragment[], lh: number, top1: number, top2: number, height: number): Fragment[] {
  const on = (start: number, end: number, top: number): boolean => end * lh - top >= 0 && start * lh - top <= height
  return frags.filter((f) => on(f.l1Start, f.l1End, top1) || on(f.l2Start, f.l2End, top2))
}

/** Fractional row at the vertical centre of a pane. */
export const midRow = (scrollTop: number, clientHeight: number, lh: number): number => (scrollTop + clientHeight / 2) / lh

/** scrollTop that puts `row` at the vertical centre (never negative). */
export const scrollTopFor = (row: number, lh: number, clientHeight: number): number => Math.max(0, row * lh - clientHeight / 2)
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/splitDiff.test.ts` — Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splitDiff.ts apps/web/src/lib/splitDiff.test.ts
git commit -m "✨ Add split diff scroll mapping and gutter connector geometry

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Extract syntax + word marks into `useDiffDecor`

Pure refactor, no behaviour change: the inline view and the coming split view share tokenizing and word marks.

**Files:**
- Create: `apps/web/src/composables/useDiffDecor.ts`
- Modify: `apps/web/src/components/workspace/DiffView.vue:1-93`

**Interfaces:**
- Produces:

```ts
export interface DiffDecorSource { file: () => DiffFile; blocks: () => readonly Block[]; lang: () => string | null; words: () => boolean }
export function useDiffDecor(src: DiffDecorSource): {
  lineInfo: ComputedRef<{ block: Map<DiffLine, number>; marks: Map<DiffLine, WordMark[]> }>
  code: (l: DiffLine | undefined, cls: string) => string
}
```

(Task 6 replaces `words: () => boolean` with `highlight: () => DiffHighlight`.)

- [ ] **Step 1: Create** `apps/web/src/composables/useDiffDecor.ts`

```ts
import { computed, shallowRef, watch } from 'vue'
import { renderLine, type CodeToken } from '../lib/codeView'
import type { DiffFile, DiffLine } from '../lib/diff'
import { wordDiff, type Block, type WordMark } from '../lib/diffBlocks'
import { tokenize } from '../lib/highlight'

export interface DiffDecorSource {
  file: () => DiffFile
  blocks: () => readonly Block[]
  /** shiki grammar id, null = plain. */
  lang: () => string | null
  words: () => boolean
}

/** Syntax tokens and changed-word marks of a diff, shared by the inline and side-by-side viewers. */
export function useDiffDecor(src: DiffDecorSource) {
  const tokens = shallowRef<Map<DiffLine, CodeToken[]>>(new Map())
  let seq = 0

  /** Old and new sides are tokenized as two continuous texts so multi-line constructs keep their colours. */
  async function highlight(): Promise<void> {
    const run = ++seq
    tokens.value = new Map()
    const lang = src.lang()
    if (!lang) return
    const olds: DiffLine[] = []
    const news: DiffLine[] = []
    for (const h of src.file().hunks) {
      for (const l of h.lines) {
        if (l.type === 'del' || l.type === 'ctx') olds.push(l)
        if (l.type === 'add' || l.type === 'ctx') news.push(l)
      }
    }
    const [oldTok, newTok] = await Promise.all([tokenize(olds.map((l) => l.text).join('\n'), lang), tokenize(news.map((l) => l.text).join('\n'), lang)])
    if (run !== seq) return
    const map = new Map<DiffLine, CodeToken[]>()
    olds.forEach((l, i) => oldTok?.[i] && map.set(l, oldTok[i]!))
    news.forEach((l, i) => newTok?.[i] && map.set(l, newTok[i]!))
    tokens.value = map
  }

  watch(() => [src.file(), src.lang()] as const, () => void highlight(), { immediate: true })

  /** Line → its block index, and word marks per line of Modified blocks. */
  const lineInfo = computed(() => {
    const block = new Map<DiffLine, number>()
    const marks = new Map<DiffLine, WordMark[]>()
    src.blocks().forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
      if (!src.words() || b.type !== 'modified') return
      const res = wordDiff(b.dels.map((l) => l.text), b.adds.map((l) => l.text))
      if (!res) return
      b.dels.forEach((l, k) => res.old[k]!.length && marks.set(l, res.old[k]!))
      b.adds.forEach((l, k) => res.new[k]!.length && marks.set(l, res.new[k]!))
    })
    return { block, marks }
  })

  /** Line HTML: syntax tokens plus changed-word marks with class `cls`. */
  function code(l: DiffLine | undefined, cls: string): string {
    if (!l) return ''
    const words = lineInfo.value.marks.get(l)
    return renderLine(tokens.value.get(l) ?? [{ content: l.text }], words?.map((m) => ({ ...m, cls })))
  }

  return { lineInfo, code }
}
```

- [ ] **Step 2: Use it in `DiffView.vue`** — delete lines 28 (`tokens`), 32-81 (`seq`, `highlight`, both watches on file/lang except the `expanded` reset, `lineInfo`) and 88-93 (`code`), keep the `expanded` reset watch, and add:

```ts
import { useDiffDecor } from '../../composables/useDiffDecor'
// …
const { lineInfo, code: decorCode } = useDiffDecor({ file: () => props.file, blocks: () => props.blocks, lang: () => props.lang, words: () => props.words })
const code = (l: DiffLine | undefined): string => decorCode(l, l?.type === 'add' ? 'w-add' : 'w-del')
```

Remove now-unused imports (`shallowRef`, `renderLine`, `CodeToken`, `wordDiff`, `WordMark`, `tokenize`).

- [ ] **Step 3: Verify** — Run: `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs`
Expected: typecheck clean, unit PASS, `diff.cjs` all PASS (same 22 checks as before — word marks, folds, split revert).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useDiffDecor.ts apps/web/src/components/workspace/DiffView.vue
git commit -m "♻️ Share diff syntax tokens and word marks through useDiffDecor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Highlight level — lines / words / characters

**Files:**
- Modify: `apps/web/src/lib/diffBlocks.ts:112-176`, `apps/web/src/lib/diffBlocks.test.ts` (append), `apps/web/src/lib/diffOpts.ts`, `apps/web/src/composables/useDiffDecor.ts`, `apps/web/src/components/workspace/DiffView.vue:9-23`, `ChangesPane.vue:622-636,817`, `log/LogPane.vue:328`, `apps/web/src/i18n/workspace-diff.ts` (`hl`)
- Create: `apps/web/src/lib/diffOpts.test.ts`

**Interfaces:**
- Produces: `wordDiff(oldLines, newLines, mode: 'words' | 'chars' = 'words')`; `export type DiffHighlight = 'lines' | 'words' | 'chars'`; `export const HIGHLIGHTS: DiffHighlight[] = ['words', 'chars', 'lines']`; `DiffOpts.highlight: DiffHighlight` (replaces `words`); `DiffDecorSource.highlight: () => DiffHighlight` (replaces `words`); `DiffView` prop `highlight: DiffHighlight` (replaces `words`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/diffBlocks.test.ts`:

```ts
describe('wordDiff modes', () => {
  it('marks whole words in words mode', () => {
    expect(wordDiff(['color'], ['colour'])).toEqual({ old: [[{ start: 0, end: 5 }]], new: [[{ start: 0, end: 6 }]] })
  })
  it('marks single characters in chars mode', () => {
    expect(wordDiff(['color'], ['colour'], 'chars')).toEqual({ old: [[]], new: [[{ start: 4, end: 5 }]] })
  })
})
```

(`wordDiff` is already imported in that file; if not, add it to the import from `./diffBlocks`.)

Create `apps/web/src/lib/diffOpts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DIFF_OPTS_KEY, readDiffOpts } from './diffOpts'

describe('readDiffOpts highlight', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to words', () => expect(readDiffOpts().highlight).toBe('words'))
  it('migrates the old words:false to lines', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ words: false }))
    expect(readDiffOpts().highlight).toBe('lines')
  })
  it('keeps a stored level and rejects junk', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'chars' }))
    expect(readDiffOpts().highlight).toBe('chars')
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'bytes' }))
    expect(readDiffOpts().highlight).toBe('words')
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/diffBlocks.test.ts src/lib/diffOpts.test.ts` — Expected: FAIL (chars test marks the whole word; `highlight` undefined).

- [ ] **Step 3: Implement**

`diffBlocks.ts` — replace `const TOKEN = …` and the `wordDiff` signature/tokenizer:

```ts
const TOKEN = /\w+|\s+|[^\w\s]/gu
const CHAR = /[\s\S]/gu

/**
 * Changed words (or characters) of a Modified block: LCS over word / space / symbol tokens of the whole block, so a
 * word moved to the next line still pairs up. Returns per-line column ranges for each side; null past the limit.
 */
export function wordDiff(oldLines: readonly string[], newLines: readonly string[], mode: 'words' | 'chars' = 'words'): { old: WordMark[][]; new: WordMark[][] } | null {
  const re = mode === 'chars' ? CHAR : TOKEN
  const tok = (lines: readonly string[]) => {
    const out: { text: string; line: number; start: number }[] = []
    lines.forEach((text, line) => {
      for (const m of text.matchAll(re)) out.push({ text: m[0], line, start: m.index })
    })
    return out
  }
  // …rest of the function unchanged…
```

`diffOpts.ts` — full new version:

```ts
import type { DiffWhitespace } from './preview'

/** IntelliJ "Highlight": changed lines only, or also the changed words / characters inside Modified blocks. */
export type DiffHighlight = 'lines' | 'words' | 'chars'

export interface DiffOpts {
  layout: 'inline' | 'split'
  collapse: boolean
  context: number
  whitespace: DiffWhitespace
  highlight: DiffHighlight
}

export const DIFF_OPTS_KEY = 'ccm.workspace.diffOpts'
const OLD_LAYOUT_KEY = 'ccm.workspace.diffLayout'
export const CONTEXTS = [3, 5, 10]
export const WHITESPACE: DiffWhitespace[] = ['none', 'eol', 'all', 'all-blank']
export const HIGHLIGHTS: DiffHighlight[] = ['words', 'chars', 'lines']

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Shared by the Changes and Log diff viewers. */
export function readDiffOpts(): DiffOpts {
  const base: DiffOpts = { layout: read(OLD_LAYOUT_KEY) === 'split' ? 'split' : 'inline', collapse: true, context: 3, whitespace: 'none', highlight: 'words' }
  try {
    const raw = JSON.parse(read(DIFF_OPTS_KEY) ?? 'null') as (Partial<DiffOpts> & { words?: unknown }) | null
    if (!raw || typeof raw !== 'object') return base
    return {
      layout: raw.layout === 'split' ? 'split' : raw.layout === 'inline' ? 'inline' : base.layout,
      collapse: typeof raw.collapse === 'boolean' ? raw.collapse : base.collapse,
      context: CONTEXTS.includes(raw.context as number) ? (raw.context as number) : base.context,
      whitespace: WHITESPACE.includes(raw.whitespace as DiffWhitespace) ? (raw.whitespace as DiffWhitespace) : base.whitespace,
      // v32: `words: boolean` became `highlight`.
      highlight: HIGHLIGHTS.includes(raw.highlight as DiffHighlight) ? (raw.highlight as DiffHighlight) : raw.words === false ? 'lines' : base.highlight,
    }
  } catch {
    return base
  }
}

export function writeDiffOpts(o: DiffOpts): void {
  try {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify(o))
  } catch {
    // private mode / quota: options last for this session only
  }
}
```

`useDiffDecor.ts` — `words: () => boolean` → `highlight: () => DiffHighlight` (import type from `../lib/diffOpts`), and in `lineInfo`:

```ts
    const mode = src.highlight()
    src.blocks().forEach((b, i) => {
      for (const l of b.dels) block.set(l, i)
      for (const l of b.adds) block.set(l, i)
      if (mode === 'lines' || b.type !== 'modified') return
      const res = wordDiff(b.dels.map((l) => l.text), b.adds.map((l) => l.text), mode)
```

`DiffView.vue` — prop `words: boolean` → `highlight: DiffHighlight` (doc comment: `/** IntelliJ "Highlight": lines / words / characters inside Modified blocks. */`), decor source `highlight: () => props.highlight`.

`ChangesPane.vue` — import `HIGHLIGHTS` from `../../lib/diffOpts`; replace the highlight group (lines 623-636):

```vue
            <div role="group" :aria-label="t('workspace.diff.highlight')">
              <button v-for="h in HIGHLIGHTS" :key="h" type="button" role="menuitemradio" :aria-checked="opts.highlight === h" :class="MENU_ROW" :data-hl="h" @click="setOpt('highlight', h)">
                <Check :size="13" class="shrink-0" :class="opts.highlight === h ? '' : 'invisible'" aria-hidden="true" />
                {{ t(`workspace.diff.hl.${h}`) }}
              </button>
            </div>
```

and `:words="opts.words"` → `:highlight="opts.highlight"` (line 817). `LogPane.vue:328` the same.

i18n `workspace-diff.ts`: en `hl: { words: 'Words', chars: 'Characters', lines: 'Lines' }`, vi `hl: { words: 'Theo từ', chars: 'Theo ký tự', lines: 'Theo dòng' }`.

- [ ] **Step 4: Run** `npm run typecheck && npm test -w @ccm/web` — Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/diffBlocks.ts apps/web/src/lib/diffBlocks.test.ts apps/web/src/lib/diffOpts.ts apps/web/src/lib/diffOpts.test.ts apps/web/src/composables/useDiffDecor.ts apps/web/src/components/workspace/DiffView.vue apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/i18n/workspace-diff.ts
git commit -m "✨ Diff highlight level: lines, words or characters

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: `SplitDiff.vue` — two panes, curved gutter, scroll sync, revert

**Files:**
- Create: `apps/web/src/components/workspace/SplitDiff.vue`
- Modify: `apps/web/src/components/workspace/DiffView.vue` (template, `scrollToBlock`, drop split code and `.is-split` CSS), `ChangesPane.vue:792,808-823`, `log/LogPane.vue:314,319-332`, `apps/web/src/lib/diff.ts:168-196` (drop `SideRow`/`sideBySide`), `apps/web/src/lib/reviewTools.test.ts:83-93`, `apps/web/src/i18n/workspace-diff.ts`, `apps/desktop/e2e/v32.cjs`

**Interfaces:**
- Consumes: Task 3/4 `splitModel`, `mapRow`, `connectorPath`, `visibleFragments`, `midRow`, `scrollTopFor`, `Side`, `SplitRow`, `Fragment`; Task 5/6 `useDiffDecor`, `DiffHighlight`.
- Produces: `SplitDiff` props `{ file; blocks; lang; collapse; context; highlight; canRevert; revertBlocked?; current; sides: { left: string; right: string } }`, emits `revert(i)`, `focusBlock(i)`, expose `scrollToBlock(i): Promise<void>`. `DiffView` gains prop `sides?: { left: string; right: string }`. DOM hooks: root `.is-split[data-split-diff]`, panes `[data-side=left|right]`, rows `.sd-row[data-block]`, thin marks `.sd-mark`, connectors `path.sd-conn`, revert `.rv[data-revert]`, folds `[data-fold]`.

- [ ] **Step 1: Create** `apps/web/src/components/workspace/SplitDiff.vue`

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronsRight } from 'lucide-vue-next'
import { escapeHtml } from '../../lib/codeView'
import type { DiffFile } from '../../lib/diff'
import type { Block } from '../../lib/diffBlocks'
import type { DiffHighlight } from '../../lib/diffOpts'
import { connectorPath, mapRow, midRow, scrollTopFor, splitModel, visibleFragments, type Fragment, type Side, type SplitRow } from '../../lib/splitDiff'
import { useDiffDecor } from '../../composables/useDiffDecor'

const props = defineProps<{
  file: DiffFile
  blocks: Block[]
  lang: string | null
  collapse: boolean
  context: number
  highlight: DiffHighlight
  canRevert: boolean
  revertBlocked?: string | null
  current: number
  sides: { left: string; right: string }
}>()
const emit = defineEmits<{ revert: [index: number]; focusBlock: [index: number] }>()

const { t } = useI18n()
const GUTTER_W = 44
const BUTTON = 18

const { code } = useDiffDecor({ file: () => props.file, blocks: () => props.blocks, lang: () => props.lang, highlight: () => props.highlight })
const root = ref<HTMLElement | null>(null)
const leftEl = ref<HTMLElement | null>(null)
const rightEl = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
/** Row height in px: rows are 1.5em of the code font, measured so zoom and font changes stay exact. */
const lh = ref(19.5)
const viewH = ref(0)
const top = reactive({ left: 0, right: 0 })
/** `${hunk}:${unit}` of folds the user opened; reset per file. */
const expanded = ref<Set<string>>(new Set())

const model = computed(() => splitModel(props.file, props.blocks, { collapse: props.collapse, context: props.context, expanded: expanded.value }))
const shown = computed(() => visibleFragments(model.value.frags, lh.value, top.left, top.right, viewH.value))
const el = (side: Side): HTMLElement | null => (side === 'left' ? leftEl.value : rightEl.value)
const other = (side: Side): Side => (side === 'left' ? 'right' : 'left')

const num = (n: number | undefined): string => (n === undefined ? '' : String(n))

function rowHtml(r: SplitRow, side: Side): string {
  if (r.kind === 'gap') return `<div class="sd-row gap" aria-hidden="true"><span class="n"></span><span class="c">⋯</span></div>`
  if (r.kind === 'fold') {
    const label = escapeHtml(t('workspace.diff.expand', { n: r.count }, r.count))
    return `<div class="sd-row fold"><span class="n"></span><button type="button" class="c" data-fold="${r.key}">⋯ ${label}</button></div>`
  }
  if (r.kind === 'note') return `<div class="sd-row note"><span class="n"></span><span class="c">${escapeHtml(r.text)}</span></div>`
  const l = r.line
  const n = num(side === 'left' ? l.old : l.new)
  const newAttr = side === 'right' && l.new ? ` data-new="${l.new}"` : ''
  if (r.block === null) return `<div class="sd-row"${newAttr}><span class="n">${n}</span><span class="c">${code(l, 'w-mod')}\n</span></div>`
  const type = props.blocks[r.block]!.type
  const kind = escapeHtml(t(`workspace.gutter.kind.${type}`))
  return `<div class="sd-row ${type}" data-block="${r.block}"${newAttr}><span class="n" title="${kind}">${n}</span><span class="c">${code(l, 'w-mod')}\n</span></div>`
}

/** Rows, then a thin line where a fragment has no rows on this side (Inserted on the left, Deleted on the right). */
function sideHtml(side: Side): string {
  const rows = side === 'left' ? model.value.left : model.value.right
  let out = ''
  for (const r of rows) out += rowHtml(r, side)
  for (const f of model.value.frags) {
    const at = side === 'left' ? f.l1Start : f.l2Start
    const empty = side === 'left' ? f.l1Start === f.l1End : f.l2Start === f.l2End
    if (empty) out += `<div class="sd-mark ${f.type}" data-block="${f.block}" style="top: calc(${at} * 1.5em)" aria-hidden="true"></div>`
  }
  return out
}

const leftHtml = computed(() => sideHtml('left'))
const rightHtml = computed(() => sideHtml('right'))

let frame = 0
/** Gutter redraw: one rAF per burst of scroll events. */
function schedule(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    top.left = leftEl.value?.scrollTop ?? 0
    top.right = rightEl.value?.scrollTop ?? 0
  })
}

/** Side whose scroll we set ourselves; its next scroll event is not synced back (cleared the frame after). */
let syncing: Side | null = null

function onScroll(side: Side): void {
  schedule()
  if (syncing === side) return
  const src = el(side)
  const dst = el(other(side))
  if (!src || !dst) return
  const want = scrollTopFor(mapRow(midRow(src.scrollTop, src.clientHeight, lh.value), model.value.frags, side), lh.value, dst.clientHeight)
  if (Math.abs(dst.scrollTop - want) < 0.5 && dst.scrollLeft === src.scrollLeft) return
  const target = other(side)
  syncing = target
  dst.scrollTop = want
  dst.scrollLeft = src.scrollLeft
  requestAnimationFrame(() => {
    if (syncing === target) syncing = null
  })
}

let ro: ResizeObserver | null = null
function measure(): void {
  const h = probe.value?.getBoundingClientRect().height
  if (h) lh.value = h
  viewH.value = leftEl.value?.clientHeight ?? 0
  schedule()
}
onMounted(() => {
  ro = new ResizeObserver(measure)
  if (probe.value) ro.observe(probe.value)
  if (leftEl.value) ro.observe(leftEl.value)
  measure()
})
onBeforeUnmount(() => {
  ro?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

watch(
  () => props.file,
  () => {
    expanded.value = new Set()
    for (const p of [leftEl.value, rightEl.value]) if (p) p.scrollTop = p.scrollLeft = 0
    schedule()
  },
)

function markCurrent(): void {
  const r = root.value
  if (!r) return
  for (const x of r.querySelectorAll('.is-current')) x.classList.remove('is-current')
  for (const x of r.querySelectorAll(`[data-block="${props.current}"]`)) x.classList.add('is-current')
}
watch([leftHtml, rightHtml, () => props.current], () => void nextTick(markCurrent), { flush: 'post' })
watch(model, () => schedule())

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  const fold = target?.closest<HTMLElement>('[data-fold]')
  if (fold) {
    expanded.value = new Set([...expanded.value, fold.dataset.fold!])
    return
  }
  const row = target?.closest<HTMLElement>('[data-block]')
  if (row) emit('focusBlock', Number(row.dataset.block))
}

function revert(i: number): void {
  emit('focusBlock', i)
  if (!props.revertBlocked) emit('revert', i)
}

/** `»` sits at the top of the left rows of its fragment, kept inside the gutter. */
const revertTop = (f: Fragment): number => Math.max(0, Math.min(viewH.value - BUTTON, f.l1Start * lh.value - top.left + (lh.value - BUTTON) / 2))

async function scrollToBlock(i: number): Promise<void> {
  await nextTick()
  markCurrent()
  const f = model.value.frags.find((x) => x.block === i)
  if (!f) return
  const side: Side = f.l2End > f.l2Start ? 'right' : 'left'
  const pane = el(side)
  if (!pane) return
  pane.scrollTop = scrollTopFor(side === 'right' ? f.l2Start : f.l1Start, lh.value, pane.clientHeight)
  onScroll(side)
}

defineExpose({ scrollToBlock })
</script>

<template>
  <div
    ref="root"
    class="is-split flex h-full min-h-0 min-w-0 flex-col"
    data-code-zoom
    data-split-diff
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
  >
    <div class="sd-heads flex shrink-0 border-b border-well-line">
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.left">{{ sides.left }}</span>
      <span class="shrink-0" :style="{ width: `${GUTTER_W}px` }" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate px-2" :title="sides.right">{{ sides.right }}</span>
    </div>
    <div class="relative flex min-h-0 flex-1">
      <div ref="probe" class="sd-row sd-probe" aria-hidden="true"><span class="n">0</span><span class="c">0</span></div>
      <div ref="leftEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="left" :aria-label="sides.left" @scroll.passive="onScroll('left')" @click="onClick">
        <div class="sd-body" v-html="leftHtml" />
      </div>
      <div class="sd-gutter relative shrink-0 overflow-hidden" :style="{ width: `${GUTTER_W}px` }">
        <svg class="absolute inset-0 size-full" aria-hidden="true">
          <path v-for="f in shown" :key="f.block" class="sd-conn" :class="[f.type, f.block === current ? 'is-current' : '']" :d="connectorPath(f, lh, top.left, top.right, GUTTER_W)" />
        </svg>
        <template v-if="canRevert">
          <button
            v-for="f in shown"
            :key="`rv-${f.block}`"
            type="button"
            class="rv absolute left-1"
            :style="{ top: `${revertTop(f)}px` }"
            :data-revert="f.block"
            :aria-disabled="revertBlocked ? 'true' : undefined"
            :title="revertBlocked ?? t('workspace.diff.revert')"
            :aria-label="revertBlocked ?? t('workspace.diff.revert')"
            @click="revert(f.block)"
          >
            <ChevronsRight :size="12" aria-hidden="true" />
          </button>
        </template>
      </div>
      <div ref="rightEl" class="sd-pane ccm-scroll" tabindex="0" role="document" data-side="right" :aria-label="sides.right" @scroll.passive="onScroll('right')" @click="onClick">
        <div class="sd-body" v-html="rightHtml" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Always on the dark well. JetBrains colours: modified blue, inserted green, deleted grey (a neutral well-ink step, not red). */
.is-split {
  --mod-ink: var(--ccm-diff-mod-well);
  --add-ink: var(--ccm-diff-add-well);
  --del-ink: color-mix(in srgb, var(--ccm-well-ink) 72%, var(--ccm-well));
  --mod-bg: color-mix(in srgb, var(--mod-ink) 16%, transparent);
  --add-bg: color-mix(in srgb, var(--add-ink) 14%, transparent);
  --del-bg: color-mix(in srgb, var(--del-ink) 18%, transparent);
  --mod-word: color-mix(in srgb, var(--mod-ink) 40%, transparent);
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: calc(var(--ccm-code-size, 13px) - 0.5px);
  font-variant-ligatures: none;
  tab-size: 4;
}
.sd-heads {
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 22px;
  color: var(--ccm-well-ink);
}
.sd-pane {
  position: relative;
  min-width: 0;
  flex: 1 1 0;
  overflow: auto;
  outline: none;
}
.sd-pane:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ccm-focus);
}
.sd-body {
  position: relative;
  width: max-content;
  min-width: 100%;
}
.sd-probe {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
.is-split :deep(.sd-row) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  height: 1.5em;
  line-height: 1.5em;
  white-space: pre;
}
.is-split :deep(.n) {
  min-width: 3.25em;
  padding-inline: 0.5em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.is-split :deep(.c) {
  padding-right: 1.5em;
}
.is-split :deep(.sd-row.modified) {
  background: var(--mod-bg);
}
.is-split :deep(.sd-row.added) {
  background: var(--add-bg);
}
.is-split :deep(.sd-row.deleted) {
  background: var(--del-bg);
}
.is-split :deep(mark.w-mod) {
  color: inherit;
  border-radius: 2px;
  background: var(--mod-word);
}
.is-split :deep(.sd-mark) {
  position: absolute;
  left: 0;
  right: 0;
  height: 1px;
  margin-top: -0.5px;
  background: var(--del-ink);
}
.is-split :deep(.sd-mark.added) {
  background: var(--add-ink);
}
.is-split :deep(.is-current > .n) {
  box-shadow: inset 2px 0 0 var(--ccm-focus);
}
.is-split :deep(.sd-mark.is-current) {
  height: 2px;
  background: var(--ccm-focus);
}
.is-split :deep(.sd-row.note .c),
.is-split :deep(.sd-row.gap .c) {
  font-style: italic;
  color: var(--ccm-syn-comment, #7f8c98);
  user-select: none;
}
.is-split :deep(.sd-row.fold) {
  background: color-mix(in srgb, var(--ccm-well-ink) 4%, var(--ccm-well));
  box-shadow: inset 0 1px 0 var(--ccm-well-line), inset 0 -1px 0 var(--ccm-well-line);
}
.is-split :deep(.sd-row.fold button) {
  text-align: left;
  color: var(--ccm-syn-comment, #7f8c98);
  cursor: pointer;
}
.is-split :deep(.sd-row.fold button:hover) {
  color: var(--ccm-well-ink);
}
.is-split :deep(.sd-row.fold button:focus-visible) {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -1px;
}
.sd-gutter {
  border-inline: 1px solid var(--ccm-well-line);
}
.sd-conn {
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.sd-conn.modified {
  fill: color-mix(in srgb, var(--mod-ink) 24%, transparent);
  stroke: color-mix(in srgb, var(--mod-ink) 60%, transparent);
}
.sd-conn.added {
  fill: color-mix(in srgb, var(--add-ink) 22%, transparent);
  stroke: color-mix(in srgb, var(--add-ink) 60%, transparent);
}
.sd-conn.deleted {
  fill: color-mix(in srgb, var(--del-ink) 26%, transparent);
  stroke: color-mix(in srgb, var(--del-ink) 60%, transparent);
}
.sd-conn.is-current {
  stroke: var(--ccm-focus);
  stroke-width: 1.5;
}
.rv {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: var(--ccm-well-ink);
  background: var(--ccm-well);
  cursor: pointer;
}
.rv:hover:not([aria-disabled='true']) {
  background: var(--ccm-well-line);
  color: var(--mod-ink);
}
.rv[aria-disabled='true'] {
  cursor: not-allowed;
  color: color-mix(in srgb, var(--ccm-well-ink) 40%, var(--ccm-well));
}
.rv:focus-visible {
  outline: 2px solid var(--ccm-focus);
  outline-offset: -1px;
}
.is-split ::selection,
.is-split :deep(*)::selection {
  background: var(--ccm-well-selection, #3f638b);
}
</style>
```

- [ ] **Step 2: `DiffView.vue` becomes inline + delegate**

- Add prop `sides?: { left: string; right: string }` (doc: `/** Split view column headers (default HEAD / working tree). */`).
- Delete `splitRows`, the `CHEVRONS` constant, the `split` branch in `html` (render always uses `inlineRows`; `foldHtml(…, 'r')`), and every `.is-split …` rule in `<style>`; remove `sideBySide` from the `lib/diff` import.
- Import `SplitDiff` and add `const split = ref<InstanceType<typeof SplitDiff> | null>(null)`.
- `scrollToBlock`:

```ts
async function scrollToBlock(i: number): Promise<void> {
  if (props.layout === 'split') return split.value?.scrollToBlock(i)
  await nextTick()
  markCurrent()
  root.value?.querySelector<HTMLElement>(`[data-block="${i}"]`)?.scrollIntoView({ block: 'center' })
}
```

- Template:

```vue
<template>
  <SplitDiff
    v-if="layout === 'split'"
    ref="split"
    :file="file"
    :blocks="blocks"
    :lang="lang"
    :collapse="collapse"
    :context="context"
    :highlight="highlight"
    :can-revert="canRevert"
    :revert-blocked="revertBlocked"
    :current="current"
    :sides="sides ?? { left: 'HEAD', right: t('workspace.diff.side.working') }"
    @revert="(i) => emit('revert', i)"
    @focus-block="(i) => emit('focusBlock', i)"
  />
  <div
    v-else
    ref="root"
    class="diff ccm-code w-max min-w-full py-1"
    role="document"
    data-code-zoom
    :aria-label="blocks.length ? t('workspace.diff.change', { n: current + 1, total: blocks.length }) : undefined"
    @click="onClick"
    v-html="html"
  />
</template>
```

- The `watch([html, () => props.current], …)` and `markCurrent` stay for inline.

- [ ] **Step 3: Hosts give the split view the full height**

`ChangesPane.vue:792` — `<div class="ccm-scroll min-h-0 flex-1 overflow-auto">` →

```vue
        <div class="ccm-scroll min-h-0 flex-1" :class="opts.layout === 'split' && diffFile && diffState === 'idle' ? 'overflow-hidden' : 'overflow-auto'">
```

`LogPane.vue:314` — same change on `<div class="ccm-scroll min-h-0 flex-1 overflow-auto bg-well">` (keep `bg-well`), and pass headers on the `DiffView` (line 319): `:sides="{ left: `${shortHash}^`, right: shortHash }"`.

- [ ] **Step 4: Drop the GitHub-style pairing** — delete `SideRow` + `sideBySide` from `apps/web/src/lib/diff.ts` (lines 168-196), and in `apps/web/src/lib/reviewTools.test.ts` remove `sideBySide` from the import and replace the test at lines 83-93 by:

```ts
  it('finds the first changed line', () => {
    expect(firstChangedLine(files[0]!)).toBe(2)
    expect(firstChangedLine(files[2]!)).toBe(1)
  })
```

- [ ] **Step 5: i18n** — `workspace-diff.ts` `diff`: en `side: { working: 'Working tree' },`, vi `side: { working: 'Bản đang sửa' },`.

- [ ] **Step 6: E2E** — append to `run()` in `apps/desktop/e2e/v32.cjs` (after the sidebar section):

```js
  // — Task 7: JetBrains split diff —
  await evaluate(`localStorage.setItem('ccm.workspace.diffOpts', JSON.stringify({ layout: 'split', collapse: false, context: 3, whitespace: 'none', highlight: 'words' }))`)
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)}, { select: ${JSON.stringify(path.join(DIR, 'src', 'long.ts'))} })`)
  await waitFor(`!!document.querySelector('[data-kind=changes] [data-split-diff] path.sd-conn')`, 10000, 'split view').catch(() => {})
  await shot('v32-02-split')
  const counts = await evaluate(`[...document.querySelectorAll('[data-kind=changes] [data-side]')].map((p) => p.querySelectorAll('.sd-row').length)`)
  check('no filler rows: left 400 lines, right 396', JSON.stringify(counts) === JSON.stringify([400, 396]), JSON.stringify(counts))
  check('modified rows are tinted on both sides', await evaluate(`document.querySelectorAll('[data-kind=changes] .sd-row.modified').length === 2`))
  check('inserted block: thin line on the left, deleted block: thin line on the right', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=left] .sd-mark.added') && !!document.querySelector('[data-kind=changes] [data-side=right] .sd-mark.deleted')`))
  check('changed character marked inside the modified line', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=right] mark.w-mod')`))
  // Scroll sync: scroll the left pane to row 320 (after the inserted 6 and deleted 10 lines the right pane is 4 rows behind).
  const sync = await evaluate(`(async () => {
    const [l, r] = [...document.querySelectorAll('[data-kind=changes] [data-side]')]
    const lh = l.querySelector('.sd-row').getBoundingClientRect().height
    l.scrollTop = 320 * lh - l.clientHeight / 2
    await new Promise((res) => setTimeout(res, 300))
    return { left: (l.scrollTop + l.clientHeight / 2) / lh, right: (r.scrollTop + r.clientHeight / 2) / lh }
  })()`)
  check('scroll sync maps the centre row across fragments', Math.abs(sync.right - (sync.left - 4)) < 0.6, JSON.stringify(sync))
  // F7 lands on the next change and draws its connector as current.
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').focus()`)
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }))`)
  await sleep(300)
  check('F7 → change 2 of 3 with a current connector', /2\D+3/.test(await evaluate(`document.querySelector('[data-diff-position]').textContent`)) && (await evaluate(`!!document.querySelector('[data-kind=changes] path.sd-conn.is-current')`)))
  // Review focus 3: zoom keeps connectors on the rows.
  await evaluate(`document.documentElement.style.setProperty('--ccm-code-size', '18px')`)
  await sleep(400)
  const aligned = await evaluate(`(() => {
    const row = document.querySelector('[data-kind=changes] [data-side=left] .sd-row.is-current, [data-kind=changes] [data-side=left] .sd-mark.is-current')
    const pane = row.closest('[data-side]')
    const d = document.querySelector('[data-kind=changes] path.sd-conn.is-current').getAttribute('d')
    const y = Number(/^M0 (-?[\\d.]+)/.exec(d)[1])
    return Math.abs(y - (row.getBoundingClientRect().top - pane.getBoundingClientRect().top))
  })()`)
  check('connectors stay on their rows after zoom', aligned < 1.5, String(aligned))
  await evaluate(`document.documentElement.style.removeProperty('--ccm-code-size')`)
  await shot('v32-03-split-current')
```

Also update `apps/desktop/e2e/diff.cjs:2` comment: `split revert` stays — selectors `.is-split .rv` are unchanged.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs && node apps/desktop/e2e/log.cjs && node apps/desktop/e2e/v32.cjs`
Expected: all PASS (diff.cjs "split revert restores line 3" exercises the gutter `»`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/workspace/SplitDiff.vue apps/web/src/components/workspace/DiffView.vue apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/lib/diff.ts apps/web/src/lib/reviewTools.test.ts apps/web/src/i18n/workspace-diff.ts apps/desktop/e2e/v32.cjs apps/desktop/e2e/diff.cjs
git commit -m "✨ Android Studio style side-by-side diff: real lines, curved gutter, synced scroll

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Milestone 3 — ← / → switch files in a diff

### Task 8: Arrow keys step files in the Changes and Log diff views

**Files:**
- Modify: `apps/web/src/lib/changesView.ts` (add `fileStepKey`), `apps/web/src/lib/reviewTools.test.ts` (append), `ChangesPane.vue:233-257,346-390`, `log/LogPane.vue:189-205,309-311`, `apps/web/src/i18n/workspace-diff.ts` (`keysHint`), `apps/web/src/i18n/workspace-log.ts` (`diff.keys`), `apps/desktop/e2e/v32.cjs`

**Interfaces:**
- Produces: `fileStepKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 1 | -1 | 0`; `ChangesPane` `stepFile(dir, land = 'first', focus = true)`.

- [ ] **Step 1: Write the failing test** — append to `apps/web/src/lib/reviewTools.test.ts`:

```ts
import { fileStepKey } from './changesView'

describe('fileStepKey', () => {
  const k = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
  it('maps plain ← / → to previous / next file', () => {
    expect(fileStepKey(k('ArrowRight'))).toBe(1)
    expect(fileStepKey(k('ArrowLeft'))).toBe(-1)
  })
  it('ignores modified arrows (Alt+← is pane focus) and other keys', () => {
    expect(fileStepKey(k('ArrowRight', { altKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowLeft', { shiftKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowLeft', { ctrlKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowDown'))).toBe(0)
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/reviewTools.test.ts` — Expected: FAIL (`fileStepKey` not exported).

- [ ] **Step 3: Implement** — `changesView.ts`, next to `isShowDiffKey`:

```ts
/** ← / → without modifiers in a diff: previous / next file (Alt+← / → stays pane focus). */
export function fileStepKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 1 | -1 | 0 {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return 0
  return e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
}
```

`ChangesPane.vue`:
- `stepFile(dir: 1 | -1, land: 'first' | 'last' = 'first', focus = true)` and inside `select(next.path, focus)`.
- In `onKey`, right after the tree block (`if (treeMode.value && inList && onTreeKey(e)) { … }`), add:

```ts
  const step = fileStepKey(e)
  if (step) {
    // The folder tree keeps ← / → for collapse / expand.
    if (treeMode.value && inList) return
    e.preventDefault()
    armed = 0
    notice.value = null
    stepFile(step, 'first', inList)
    // The diff unmounts while the next file loads: keep keyboard focus in this pane so ← / → keep working.
    if (!inList) rootEl.value?.focus()
    return
  }
```

(import `fileStepKey` from `../../lib/changesView`).

`LogPane.vue` `onKey` — before `else return`:

```ts
  else if (fileStepKey(e) && !(e.target as HTMLElement | null)?.closest('[role=tree]')) stepFile(fileStepKey(e) as 1 | -1)
```

and the prev/next button titles (lines 310-311): `([)` → `(←)`, `(])` → `(→)`.

i18n: `workspace-diff.ts` en `keysHint: 'F7 changes · ← → files · F4 open'`, vi `keysHint: 'F7 thay đổi · ← → file · F4 mở'`; `workspace-log.ts` en `keys: 'F7 changes · ← → files · Esc back'`, vi `keys: 'F7 thay đổi · ← → tệp · Esc quay lại'`.

- [ ] **Step 4: E2E** — append to `v32.cjs` `run()`:

```js
  // — Task 8: ← / → switch files —
  const sel = `[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].map((r) => r.textContent).join()`
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').focus()`)
  const before = await evaluate(sel)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  await sleep(400)
  const after = await evaluate(sel)
  check('→ in the diff opens the next file', before.includes('long.ts') && after.includes('b.ts'), `${before} → ${after}`)
  check('focus stays in the Changes pane (not the file list)', await evaluate(`!!document.activeElement?.closest('[data-kind=changes]') && !document.activeElement.closest('[role=listbox], [role=tree]')`))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`)
  await sleep(400)
  check('← goes back', (await evaluate(sel)).includes('long.ts'))
```

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs && node apps/desktop/e2e/log.cjs && node apps/desktop/e2e/v32.cjs` — Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/changesView.ts apps/web/src/lib/reviewTools.test.ts apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/i18n/workspace-diff.ts apps/web/src/i18n/workspace-log.ts apps/desktop/e2e/v32.cjs
git commit -m "✨ Switch diff files with ← and →

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Milestone 4 — Explorer context menu

### Task 9: Desktop rename and move-to-trash for Explorer entries

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

### Task 10: Web bridge + explorer store `rename` / `trash`

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

### Task 11: Generic context menu with one submenu level

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

### Task 12: Explorer menu model, shortcuts and wiring

**Files:**
- Create: `apps/web/src/lib/explorer/contextMenu.ts`, `apps/web/src/lib/explorer/contextMenu.test.ts`
- Modify: `ExplorerTree.vue`, `ExplorerPanel.vue`, `CreateEntryDialog.vue`, `DiscardConfirm.vue`, `WorkspaceView.vue:243-247,827`, `apps/web/src/i18n/workspace-explorer.ts`, `apps/desktop/e2e/v32.cjs`

**Interfaces:**
- Consumes: Task 10 store `rename`/`trash`, `movedPath`; Task 11 `ContextMenu`, `MenuEntry`, `findAction`.
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

/** Row menu: a small subset of Android Studio's Project view menu (see the v32 plan rulings). */
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

- [ ] **Step 11: E2E** — append to `v32.cjs` `run()`:

```js
  // — Task 12: Explorer context menu —
  await cmd('Page.bringToFront') // navigator.clipboard needs a focused document
  await evaluate(`document.querySelector('[data-side-view="explorer"]').click()`)
  await waitFor(`!!document.querySelector('[data-explorer-tree] [data-path$="README.md"]')`, 8000, 'explorer rows').catch(() => {})
  const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
  await evaluate(`(() => { const r = ${rowSel('README.md')}.getBoundingClientRect(); ${rowSel('README.md')}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'menu').catch(() => {})
  await shot('v32-04-explorer-menu')
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
  // Rename with Shift+F6.
  await evaluate(`${rowSel('README.md')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: true, bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-create-name]')`, 3000, 'rename dialog').catch(() => {})
  check('rename preselects the name without its extension', await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); return i.value === 'README.md' && i.selectionEnd === 6 })()`))
  await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); i.value = 'NOTES.md'; i.dispatchEvent(new Event('input')); document.querySelector('[data-create-submit]').click() })()`)
  await sleep(600)
  check('rename renames on disk', fs.existsSync(path.join(DIR, 'NOTES.md')) && !fs.existsSync(path.join(DIR, 'README.md')))
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
```

- [ ] **Step 12: Verify** — `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/explorer.cjs && node apps/desktop/e2e/v32.cjs` — Expected: all PASS (explorer.cjs proves create still works through the generalised dialog).

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/lib/explorer/contextMenu.ts apps/web/src/lib/explorer/contextMenu.test.ts apps/web/src/components/workspace/ExplorerTree.vue apps/web/src/components/workspace/ExplorerPanel.vue apps/web/src/components/workspace/CreateEntryDialog.vue apps/web/src/components/workspace/DiscardConfirm.vue apps/web/src/components/workspace/WorkspaceView.vue apps/web/src/i18n/workspace-explorer.ts apps/desktop/e2e/v32.cjs
git commit -m "✨ Explorer context menu: new, copy path, rename, delete, open in split, git diff

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Milestone 5 — Branches toolbar in the Git Log

### Task 13: Shared branch types and name check

**Files:**
- Create: `packages/shared/src/gitBranch.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem }
export type BranchOpError = 'denied' | 'invalid' | 'exists' | 'not-merged' | 'current' | 'conflict' | 'no-upstream' | 'non-ff' | 'auth' | 'timeout' | 'cancelled' | 'failed'
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }
```

(Tested through the desktop tests in Task 14 — `packages/shared` has no test runner.)

- [ ] **Step 1: Implement** — `packages/shared/src/gitBranch.ts`

```ts
export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'

/** Quick check mirroring `git check-ref-format --branch` (main runs git's own check too). */
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem } {
  if (typeof name !== 'string' || !name) return { ok: false, reason: 'empty' }
  if (name.length > 200) return { ok: false, reason: 'long' }
  if (/\s/.test(name)) return { ok: false, reason: 'space' }
  if (name.startsWith('-')) return { ok: false, reason: 'dash' }
  if (name.includes('..') || name.includes('@{') || name === '@') return { ok: false, reason: 'dots' }
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return { ok: false, reason: 'char' }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.endsWith('.') || /(^|\/)\./.test(name)) return { ok: false, reason: 'slash' }
  if (/\.lock(\/|$)/.test(name)) return { ok: false, reason: 'lock' }
  return { ok: true }
}

export type BranchOpError = 'denied' | 'invalid' | 'exists' | 'not-merged' | 'current' | 'conflict' | 'no-upstream' | 'non-ff' | 'auth' | 'timeout' | 'cancelled' | 'failed'

/** `detail`: one sanitized line of git's stderr (no credentials). */
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }
```

`packages/shared/src/index.ts`: add `export * from './gitBranch'`.

- [ ] **Step 2: Run** `npm run typecheck` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/gitBranch.ts packages/shared/src/index.ts
git commit -m "✨ Shared branch name check and branch operation results

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 14: Desktop branch operations

**Files:**
- Create: `apps/desktop/src/preview/branches.ts`, `apps/desktop/test/branches.test.ts`
- Modify: `apps/desktop/src/preview/log.ts:9` (export `REF`)

**Interfaces:**
- Consumes: `execGit` (`preview/gitExec.ts`), `REF` (`preview/log.ts`), Task 13 types.
- Produces:

```ts
export function sanitizeGitError(stderr: string): string
export async function createBranch(root: string, name: unknown, base: unknown, checkout: unknown): Promise<BranchOpResult>
export async function deletePlan(root: string, ref: unknown, force: boolean): Promise<{ ok: true; args: string[]; remote: boolean; label: string } | { ok: false; error: BranchOpError }>
export async function runDelete(root: string, args: string[]): Promise<BranchOpResult>
export async function fetchAll(root: string): Promise<BranchOpResult>
export async function updateBranch(root: string, ref: unknown): Promise<BranchOpResult>
```

`deletePlan` validates and returns the exact argv (shown in the native confirm, Task 15) — `runDelete` executes it.

- [ ] **Step 1: Write the failing tests** — `apps/desktop/test/branches.test.ts`

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkBranchName } from '@ccm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBranch, deletePlan, fetchAll, runDelete, sanitizeGitError, updateBranch } from '../src/preview/branches'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-branches-')))
const origin = path.join(tmp, 'origin.git')
const repo = path.join(tmp, 'repo')
const other = path.join(tmp, 'other')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

beforeAll(() => {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '-q', origin, repo])
  git(repo, 'checkout', '-q', '-b', 'main')
  writeFileSync(path.join(repo, 'a.txt'), '1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'one')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'branch', 'side')
  git(repo, 'push', '-q', '-u', 'origin', 'side')
  execFileSync('git', ['clone', '-q', origin, other])
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('checkBranchName', () => {
  it('accepts normal names and rejects git-invalid ones', () => {
    expect(checkBranchName('feature/x-1')).toEqual({ ok: true })
    for (const bad of ['', 'a b', '-x', 'a..b', 'a~1', 'x.lock', 'a/', '.hidden', 'a//b', 'a:b']) expect(checkBranchName(bad).ok).toBe(false)
  })
})

describe('sanitizeGitError', () => {
  it('strips credentials from URLs and keeps one line', () => {
    expect(sanitizeGitError("fatal: unable to access 'https://bob:ghp_SECRET@github.com/o/r.git/': 403\nmore")).toBe("fatal: unable to access 'https://github.com/o/r.git/': 403")
  })
})

describe('createBranch', () => {
  it('creates from a ref, optionally switching to it', async () => {
    expect(await createBranch(repo, 'feat/a', 'refs/heads/main', false)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('main')
    expect(await createBranch(repo, 'feat/b', 'HEAD', true)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('feat/b')
    git(repo, 'checkout', '-q', 'main')
  })
  it('refuses bad names, unknown bases and existing branches', async () => {
    expect(await createBranch(repo, '-x', 'HEAD', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', 'refs/heads/nope', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', '--orphan', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'feat/a', 'HEAD', false)).toMatchObject({ ok: false, error: 'exists' })
  })
})

describe('delete', () => {
  it('plans exact commands, refuses the current branch and tags', async () => {
    expect(await deletePlan(repo, 'refs/heads/feat/a', false)).toEqual({ ok: true, args: ['branch', '-d', '--', 'feat/a'], remote: false, label: 'feat/a' })
    expect(await deletePlan(repo, 'refs/heads/feat/a', true)).toMatchObject({ args: ['branch', '-D', '--', 'feat/a'] })
    expect(await deletePlan(repo, 'refs/remotes/origin/side', false)).toEqual({ ok: true, args: ['push', 'origin', '--delete', 'side'], remote: true, label: 'origin/side' })
    expect(await deletePlan(repo, 'refs/heads/main', false)).toEqual({ ok: false, error: 'current' })
    expect(await deletePlan(repo, 'refs/tags/v1', false)).toEqual({ ok: false, error: 'denied' })
    expect(await deletePlan(repo, 'refs/heads/../x', false)).toEqual({ ok: false, error: 'denied' })
  })
  it('reports an unmerged branch so the user can force it', async () => {
    git(repo, 'checkout', '-q', 'feat/a')
    writeFileSync(path.join(repo, 'b.txt'), 'b\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'two')
    git(repo, 'checkout', '-q', 'main')
    const soft = await deletePlan(repo, 'refs/heads/feat/a', false)
    expect(soft.ok && (await runDelete(repo, soft.args))).toMatchObject({ ok: false, error: 'not-merged' })
    const hard = await deletePlan(repo, 'refs/heads/feat/a', true)
    expect(hard.ok && (await runDelete(repo, hard.args))).toEqual({ ok: true })
  })
})

describe('fetch / update', () => {
  it('fetches and fast-forwards the current and a non-current branch', async () => {
    writeFileSync(path.join(other, 'a.txt'), '2\n')
    git(other, 'commit', '-q', '-am', 'remote main')
    git(other, 'push', '-q', 'origin', 'main')
    git(other, 'checkout', '-q', 'side')
    writeFileSync(path.join(other, 's.txt'), 's\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'remote side')
    git(other, 'push', '-q', 'origin', 'side')
    expect(await fetchAll(repo)).toEqual({ ok: true })
    expect(await updateBranch(repo, 'refs/heads/main')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'main')).toBe(git(other, 'rev-parse', 'main'))
    expect(await updateBranch(repo, 'refs/heads/side')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'side')).toBe(git(other, 'rev-parse', 'side'))
  })
  it('refuses branches without upstream and non-fast-forward updates', async () => {
    expect(await updateBranch(repo, 'refs/heads/feat/b')).toEqual({ ok: false, error: 'no-upstream' })
    git(repo, 'checkout', '-q', 'side')
    writeFileSync(path.join(repo, 'local.txt'), 'l\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'local side')
    git(repo, 'checkout', '-q', 'main')
    git(other, 'checkout', '-q', 'side')
    writeFileSync(path.join(other, 's2.txt'), 's2\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'remote side 2')
    git(other, 'push', '-q', 'origin', 'side')
    expect(await updateBranch(repo, 'refs/heads/side')).toMatchObject({ ok: false, error: 'non-ff' })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: FAIL (`Cannot find module '../src/preview/branches'`).

- [ ] **Step 3: Implement**

`log.ts:9`: `export const REF = …` (add `export`).

`apps/desktop/src/preview/branches.ts`:

```ts
import { checkBranchName, type BranchOpError, type BranchOpResult } from '@ccm/shared'
import { execGit, type GitExecResult } from './gitExec'
import { REF } from './log'

const LOCAL = 20_000
const NET = { timeoutMs: 120_000 }

/** First stderr line, with `user:token@` removed from URLs: git prints remote URLs it failed on. */
export function sanitizeGitError(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1').slice(0, 300)
}

function failed(res: GitExecResult, fallback: BranchOpError = 'failed'): BranchOpResult {
  if (res.code === null && res.stderr !== 'git not found') return { ok: false, error: 'timeout' }
  const s = res.stderr
  const error: BranchOpError = /not fully merged/i.test(s)
    ? 'not-merged'
    : /already exists/i.test(s)
      ? 'exists'
      : /Authentication failed|could not read Username|Permission denied|403/i.test(s)
        ? 'auth'
        : /non-fast-forward|Not possible to fast-forward|rejected/i.test(s)
          ? 'non-ff'
          : /would be overwritten|conflict/i.test(s)
            ? 'conflict'
            : fallback
  return { ok: false, error, detail: sanitizeGitError(s) }
}

const validRef = (ref: unknown): ref is string => typeof ref === 'string' && (ref === 'HEAD' || (REF.test(ref) && !ref.includes('..') && !ref.endsWith('.lock')))

async function currentBranch(root: string): Promise<string | null> {
  const res = await execGit(root, ['symbolic-ref', '-q', '--short', 'HEAD'], { timeoutMs: LOCAL })
  return res.code === 0 ? res.stdout.trim() || null : null
}

/** New branch `name` at `base` (a listed ref, `HEAD` or a commit hash); `checkout` switches to it (`git switch -c`). */
export async function createBranch(root: string, name: unknown, base: unknown, checkout: unknown): Promise<BranchOpResult> {
  if (!checkBranchName(name).ok) return { ok: false, error: 'invalid' }
  const fmt = await execGit(root, ['check-ref-format', '--branch', name as string], { timeoutMs: LOCAL })
  if (fmt.code !== 0) return { ok: false, error: 'invalid' }
  const baseOk = validRef(base) || (typeof base === 'string' && /^[0-9a-f]{4,40}$/.test(base))
  if (!baseOk) return { ok: false, error: 'invalid' }
  const verify = await execGit(root, ['rev-parse', '--verify', '-q', `${base as string}^{commit}`], { timeoutMs: LOCAL })
  if (verify.code !== 0) return { ok: false, error: 'invalid' }
  const start = verify.stdout.trim()
  const res =
    checkout === true
      ? await execGit(root, ['switch', '-c', name as string, start], { timeoutMs: LOCAL })
      : await execGit(root, ['branch', '--', name as string, start], { timeoutMs: LOCAL })
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Exact git argv for deleting `ref`: local `branch -d|-D -- <name>`, remote `push <remote> --delete <branch>`.
 * Never the current branch, never tags. The caller shows `args` in a native confirm before `runDelete`.
 */
export async function deletePlan(root: string, ref: unknown, force: boolean): Promise<{ ok: true; args: string[]; remote: boolean; label: string } | { ok: false; error: BranchOpError }> {
  if (!validRef(ref) || ref === 'HEAD' || ref.startsWith('refs/tags/')) return { ok: false, error: 'denied' }
  if (ref.startsWith('refs/heads/')) {
    const name = ref.slice('refs/heads/'.length)
    if ((await currentBranch(root)) === name) return { ok: false, error: 'current' }
    return { ok: true, args: ['branch', force ? '-D' : '-d', '--', name], remote: false, label: name }
  }
  const short = ref.slice('refs/remotes/'.length)
  const remotes = (await execGit(root, ['remote'], { timeoutMs: LOCAL })).stdout.split(/\r?\n/).filter(Boolean)
  const remote = remotes.filter((r) => short.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  const branch = remote ? short.slice(remote.length + 1) : ''
  if (!remote || !branch || branch === 'HEAD' || !checkBranchName(branch).ok) return { ok: false, error: 'denied' }
  return { ok: true, args: ['push', remote, '--delete', branch], remote: true, label: short }
}

export async function runDelete(root: string, args: string[]): Promise<BranchOpResult> {
  const res = await execGit(root, args, args[0] === 'push' ? NET : { timeoutMs: LOCAL })
  return res.code === 0 ? { ok: true } : failed(res)
}

/** `git fetch --all` (no prune): new branches and commits from every remote. */
export async function fetchAll(root: string): Promise<BranchOpResult> {
  const res = await execGit(root, ['fetch', '--all', '--no-write-fetch-head'], NET)
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Update Selected (fast-forward only): the current branch via `pull --ff-only`; another tracked local branch via
 * `fetch <remote> <branch>:refs/heads/<local>`, which git refuses when it is not a fast-forward.
 */
export async function updateBranch(root: string, ref: unknown): Promise<BranchOpResult> {
  if (!validRef(ref) || !ref.startsWith('refs/heads/')) return { ok: false, error: 'denied' }
  const local = ref.slice('refs/heads/'.length)
  const up = await execGit(root, ['for-each-ref', '--format=%(upstream:remotename)%1f%(upstream:remoteref)', ref], { timeoutMs: LOCAL })
  const [remote, remoteRef] = up.stdout.trim().split('\x1f')
  if (!remote || !remoteRef?.startsWith('refs/heads/')) return { ok: false, error: 'no-upstream' }
  const res =
    (await currentBranch(root)) === local
      ? await execGit(root, ['pull', '--ff-only', '--no-rebase'], NET)
      : await execGit(root, ['fetch', remote, `${remoteRef}:${ref}`], NET)
  return res.code === 0 ? { ok: true } : failed(res, 'non-ff')
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: PASS (9 tests). If git prints `Not possible to fast-forward` only in newer versions, the `failed(res, 'non-ff')` fallback still returns `non-ff`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/branches.ts apps/desktop/src/preview/log.ts apps/desktop/test/branches.test.ts
git commit -m "✨ Desktop branch operations: create, delete plan, fetch, fast-forward update

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 15: Branch IPC with a native confirm for delete

**Files:**
- Modify: `apps/desktop/src/preview/ipc.ts` (deps, CHANNELS, handlers), `apps/desktop/src/main.ts:597-620`, `apps/desktop/src/strings.ts`, `apps/desktop/src/preload.ts`, `apps/web/src/lib/preview.ts`
- Test: `apps/desktop/test/branches.test.ts` (append IPC block)

**Interfaces:**
- Consumes: Task 14.
- Produces: deps field `confirmGit?: (req: { title: string; commands: string[]; force?: boolean }) => Promise<boolean>` on `PreviewIpcDeps`; IPC `ccm:git-branch-create {root,name,base,checkout}`, `ccm:git-branch-delete {root,ref}`, `ccm:git-fetch root`, `ccm:git-branch-update {root,ref}` → `BranchOpResult`; preload/web `gitBranchCreate(root, name, base, checkout)`, `gitBranchDelete(root, ref)`, `gitFetch(root)`, `gitBranchUpdate(root, ref)`, `hasBranchOps`.

Delete flow in main: plan (`-d`) → native confirm with the command → run; on `not-merged`, a second native confirm with the `-D` command (`force: true` wording) → run. Cancel at any step returns `{ ok: false, error: 'cancelled' }`.

- [ ] **Step 1: Write the failing test** — append to `apps/desktop/test/branches.test.ts`:

```ts
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

describe('branch IPC', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const asked: string[][] = []
  let answer = true
  registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined, add: () => true, remove: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [repo],
    confirmAccess: async () => false,
    confirmGit: async (req) => {
      asked.push(req.commands)
      return answer
    },
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  it('asks before deleting and runs nothing when cancelled', async () => {
    git(repo, 'branch', 'tmp-del')
    answer = false
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: false, error: 'cancelled' })
    expect(asked.at(-1)).toEqual(['git branch -d -- tmp-del'])
    expect(git(repo, 'branch', '--list', 'tmp-del')).toContain('tmp-del')
    answer = true
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: true })
  })

  it('creates without a confirm and refuses unknown roots', async () => {
    expect(await call('ccm:git-branch-create', { root: repo, name: 'ipc-new', base: 'HEAD', checkout: false })).toEqual({ ok: true })
    expect(await call('ccm:git-branch-create', { root: tmp, name: 'x', base: 'HEAD', checkout: false })).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: FAIL (no handler for `ccm:git-branch-delete`).

- [ ] **Step 3: Implement**

`ipc.ts`:
- Deps interface: `/** Native yes/no showing the exact git commands; the page cannot delete a branch without it. */ confirmGit?: (req: { title: string; commands: string[]; force?: boolean }) => Promise<boolean>`.
- CHANNELS: add `'ccm:git-branch-create', 'ccm:git-branch-delete', 'ccm:git-fetch', 'ccm:git-branch-update',`.
- Import `createBranch, deletePlan, fetchAll, runDelete, updateBranch` from `./branches`.
- Handlers (after the log handlers; `logRepo`/`denied` are already in scope):

```ts
  ipcMain.handle('ccm:git-branch-create', async (event, req: unknown) => {
    const { root, name, base, checkout } = (req ?? {}) as { root?: unknown; name?: unknown; base?: unknown; checkout?: unknown }
    const repo = await logRepo(event, root)
    return repo ? createBranch(repo, name, base, checkout) : denied
  })

  ipcMain.handle('ccm:git-branch-delete', async (event, req: unknown) => {
    const { root, ref } = (req ?? {}) as { root?: unknown; ref?: unknown }
    const repo = await logRepo(event, root)
    if (!repo || !deps.confirmGit) return denied
    const plan = await deletePlan(repo, ref, false)
    if (!plan.ok) return plan
    if (!(await deps.confirmGit({ title: plan.label, commands: [`git ${plan.args.join(' ')}`] }))) return { ok: false, error: 'cancelled' }
    const res = await runDelete(repo, plan.args)
    if (res.ok || res.error !== 'not-merged' || plan.remote) return res
    const force = await deletePlan(repo, ref, true)
    if (!force.ok) return force
    if (!(await deps.confirmGit({ title: force.label, commands: [`git ${force.args.join(' ')}`], force: true }))) return { ok: false, error: 'cancelled' }
    return runDelete(repo, force.args)
  })

  ipcMain.handle('ccm:git-fetch', async (event, root: unknown) => {
    const repo = await logRepo(event, root)
    return repo ? fetchAll(repo) : denied
  })

  ipcMain.handle('ccm:git-branch-update', async (event, req: unknown) => {
    const { root, ref } = (req ?? {}) as { root?: unknown; ref?: unknown }
    const repo = await logRepo(event, root)
    return repo ? updateBranch(repo, ref) : denied
  })
```

`strings.ts` (en, then the same keys in vi):

```ts
  gitDeleteTitle: (name: string) => `Delete branch ${name}?`,
  gitForceTitle: (name: string) => `${name} is not fully merged. Delete it anyway?`,
  gitDeleteDetail: (commands: string[]) => `Agent Monitor will run:\n\n${commands.join('\n')}\n\nCommits only on this branch can be lost.`,
  gitDeleteConfirm: 'Delete',
  gitDeleteCancel: 'Cancel',
```

```ts
  gitDeleteTitle: (name) => `Xoá nhánh ${name}?`,
  gitForceTitle: (name) => `${name} chưa được merge hết. Vẫn xoá?`,
  gitDeleteDetail: (commands) => `Agent Monitor sẽ chạy:\n\n${commands.join('\n')}\n\nCác commit chỉ có trên nhánh này có thể bị mất.`,
  gitDeleteConfirm: 'Xoá',
  gitDeleteCancel: 'Huỷ',
```

`main.ts` in `registerPreviewIpc({ … })` after `confirmAccess`:

```ts
    confirmGit: async (req) => {
      const opts: Electron.MessageBoxOptions = {
        type: 'warning',
        message: req.force ? t.gitForceTitle(req.title) : t.gitDeleteTitle(req.title),
        detail: t.gitDeleteDetail(req.commands),
        buttons: [t.gitDeleteConfirm, t.gitDeleteCancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
```

`preload.ts` (after `logDiff`):

```ts
  gitBranchCreate: (root: string, name: string, base: string, checkout: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-create', { root, name, base, checkout }),
  gitBranchDelete: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-delete', { root, ref }),
  gitFetch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-fetch', root),
  gitBranchUpdate: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-update', { root, ref }),
```

`apps/web/src/lib/preview.ts` — `PreviewBridge` gains the four optional methods typed `Promise<BranchOpResult>` (import `type BranchOpResult` from `@ccm/shared`), and:

```ts
const noBranchOps: BranchOpResult = { ok: false, error: 'denied' }
export const hasBranchOps = typeof bridge?.gitFetch === 'function'
export const gitBranchCreate = (root: string, name: string, base: string, checkout: boolean): Promise<BranchOpResult> => bridge?.gitBranchCreate?.(root, name, base, checkout) ?? Promise.resolve(noBranchOps)
export const gitBranchDelete = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchDelete?.(root, ref) ?? Promise.resolve(noBranchOps)
export const gitFetch = (root: string): Promise<BranchOpResult> => bridge?.gitFetch?.(root) ?? Promise.resolve(noBranchOps)
export const gitBranchUpdate = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchUpdate?.(root, ref) ?? Promise.resolve(noBranchOps)
```

- [ ] **Step 4: Run** `npm test -w @ccm/desktop && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/ipc.ts apps/desktop/src/main.ts apps/desktop/src/strings.ts apps/desktop/src/preload.ts apps/web/src/lib/preview.ts apps/desktop/test/branches.test.ts
git commit -m "✨ Branch IPC; deleting a branch needs a native confirm with the git command

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 16: Compare with Current — `notRef` in the log query

**Files:**
- Modify: `packages/shared/src/gitlog.ts:42-54`, `apps/desktop/src/preview/log.ts:77-104`, `apps/web/src/lib/logQuery.ts:6-49`
- Test: `apps/desktop/test/log.test.ts` (append), `apps/web/src/lib/logQuery.test.ts` (append)

**Interfaces:**
- Produces: `LogQuery.notRef: string | null` (desktop + shared); `LogFilters.notRef: string | null` (web), `emptyFilters().notRef === null`; `graphMode` → `'flat'` and `hasFilters` → true when `notRef` is set.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/log.test.ts`:

```ts
describe('notRef (Compare with Current)', () => {
  it('excludes commits reachable from notRef', () => {
    const q = cleanLogQuery({ branch: 'refs/heads/feature', notRef: 'HEAD' }, '/r')
    expect(q.notRef).toBe('HEAD')
    expect(logArgs(q).slice(-4)).toEqual(['refs/heads/feature', '--not', 'HEAD', '--'])
  })
  it('drops notRef without a branch or when invalid', () => {
    expect(cleanLogQuery({ notRef: 'HEAD' }, '/r').notRef).toBeNull()
    expect(cleanLogQuery({ branch: 'HEAD', notRef: '--all' }, '/r').notRef).toBeNull()
  })
})
```

Existing exact expectations gain the new field: every `toEqual` on a whole `cleanLogQuery(…)` result in `apps/desktop/test/log.test.ts` adds `notRef: null`.

`apps/web/src/lib/logQuery.test.ts`:

```ts
describe('notRef', () => {
  it('passes through and forces the flat list', () => {
    const f = { ...emptyFilters(), branch: 'refs/heads/feature', notRef: 'HEAD' }
    expect(toQuery(f, NOW).notRef).toBe('HEAD')
    expect(toQuery({ ...f, branch: null }, NOW).notRef).toBeNull()
    expect(graphMode(f)).toBe('flat')
    expect(hasFilters({ ...emptyFilters(), notRef: 'HEAD' })).toBe(true)
  })
})
```

The first test (`'maps empty filters to the full history'`, line 8) gains `notRef: null` in its expected object.

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/log.test.ts && npm test -w @ccm/web -- src/lib/logQuery.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`gitlog.ts` `LogQuery`: add `/** With \`branch\`: hide commits reachable from this ref (\`git log <branch> --not <notRef>\`). */ notRef: string | null`.

`log.ts` `cleanLogQuery`: factor the branch validation into `const refOk = (v: unknown): v is string => typeof v === 'string' && (v === 'HEAD' || (REF.test(v) && !v.includes('..') && !v.endsWith('.lock')))`; `const branch = refOk(o.branch) ? o.branch : null`; `const notRef = branch && refOk(o.notRef) && o.notRef !== branch ? o.notRef : null`; include `notRef` in the returned object. `logArgs`: replace the push of refs with

```ts
  args.push(...(q.branch ? [q.branch, ...(q.notRef ? ['--not', q.notRef] : [])] : ['--branches', '--remotes', '--tags', 'HEAD']), '--', ...q.paths)
```

`logQuery.ts`: `LogFilters.notRef: string | null` (doc: `/** Compare with Current: commits in \`branch\` not in this ref. */`); `emptyFilters` adds `notRef: null`; `toQuery` returns `notRef: f.branch ? f.notRef : null`; `graphMode` condition adds `|| f.notRef`; `hasFilters` adds `|| f.notRef`.

- [ ] **Step 4: Run** `npm test -w @ccm/desktop && npm test -w @ccm/web && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/gitlog.ts apps/desktop/src/preview/log.ts apps/desktop/test/log.test.ts apps/web/src/lib/logQuery.ts apps/web/src/lib/logQuery.test.ts
git commit -m "✨ Log query: commits in a branch but not in another (Compare with Current)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 17: Refs tree model — favorites, group by folder, show tags, folder ids

**Files:**
- Create: `apps/web/src/lib/refPrefs.ts`, `apps/web/src/lib/refPrefs.test.ts`
- Modify: `apps/web/src/lib/gitRefs.ts:63-126`, `apps/web/src/lib/gitRefs.test.ts` (append)

**Interfaces:**
- Produces:

```ts
// gitRefs.ts
export interface RefTreeOpts { favorites: ReadonlySet<string>; group: boolean; tags: boolean }
export function refTree(refs: RefsOk, filter: string, collapsed: ReadonlySet<string>, opts?: RefTreeOpts): RefRow[]   // RefRow 'ref' gains `favorite: boolean`
export function expandableIds(refs: RefsOk, opts?: RefTreeOpts): string[]
// refPrefs.ts
export const FAVORITES_KEY = 'ccm.workspace.logFavorites'
export const REFS_VIEW_KEY = 'ccm.workspace.logRefsView'
export function readFavorites(repo: string, refs: RefsOk): Set<string>
export function writeFavorites(repo: string, favs: ReadonlySet<string>): void
export function readRefsView(): { group: boolean; tags: boolean }
export function writeRefsView(v: { group: boolean; tags: boolean }): void
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/gitRefs.test.ts` (reuse the file's existing `RefsOk` fixture builder; the sample below builds its own):

```ts
import { expandableIds, refTree } from './gitRefs'

const R = {
  ok: true as const,
  root: '/r',
  head: { branch: 'main', hash: 'a'.repeat(40) },
  local: [
    { ref: 'refs/heads/main', name: 'main', hash: 'a', upstream: 'origin/main', ahead: 0, behind: 0, gone: false },
    { ref: 'refs/heads/feature/x', name: 'feature/x', hash: 'b', upstream: null, ahead: 0, behind: 0, gone: false },
    { ref: 'refs/heads/zeta', name: 'zeta', hash: 'c', upstream: null, ahead: 0, behind: 0, gone: false },
  ],
  remotes: [{ name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: 'a' }] }],
  tags: [{ ref: 'refs/tags/v1', name: 'v1', hash: 'a' }],
  me: null,
}
const names = (rows: ReturnType<typeof refTree>) => rows.map((r) => (r.kind === 'ref' ? r.name : r.kind === 'folder' ? `[${r.name}]` : `#${r.section}`))

describe('refTree options', () => {
  it('floats favorites to the top of their section and flags them', () => {
    const rows = refTree(R as never, '', new Set(), { favorites: new Set(['refs/heads/zeta']), group: true, tags: true })
    expect(names(rows).slice(0, 5)).toEqual(['#head', '#local', 'zeta', 'main', '[feature]'])
    expect(rows.find((r) => r.kind === 'ref' && r.name === 'zeta')).toMatchObject({ favorite: true })
  })
  it('lists full names without folders when grouping is off', () => {
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: false, tags: true }))).toContain('feature/x')
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: false, tags: true }))).not.toContain('[feature]')
  })
  it('hides the Tags section when tags are off', () => {
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: true, tags: false }))).not.toContain('#tags')
  })
  it('lists every expandable id for Collapse All', () => {
    expect(expandableIds(R as never).sort()).toEqual(['local', 'local/feature', 'remote', 'remote/origin', 'tags'].sort())
  })
})
```

`apps/web/src/lib/refPrefs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { FAVORITES_KEY, readFavorites, readRefsView, writeFavorites, writeRefsView } from './refPrefs'

const refs = { local: [{ ref: 'refs/heads/main' }, { ref: 'refs/heads/dev' }] } as never

describe('refPrefs', () => {
  beforeEach(() => localStorage.clear())
  it('defaults favorites to main / master that exist', () => {
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/main'])
  })
  it('stores favorites per repo, an empty set included', () => {
    writeFavorites('/r', new Set())
    expect([...readFavorites('/r', refs)]).toEqual([])
    writeFavorites('/r', new Set(['refs/heads/dev']))
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/dev'])
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toHaveProperty(['/r'])
  })
  it('remembers the view options', () => {
    expect(readRefsView()).toEqual({ group: true, tags: true })
    writeRefsView({ group: false, tags: false })
    expect(readRefsView()).toEqual({ group: false, tags: false })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/gitRefs.test.ts src/lib/refPrefs.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`gitRefs.ts`:
- `RefRow` `'ref'` variant and `Leaf` gain `favorite: boolean`; every place that builds a `Leaf` sets `favorite: opts.favorites.has(<ref>)`.
- `export interface RefTreeOpts { favorites: ReadonlySet<string>; group: boolean; tags: boolean }` and `const DEFAULT_OPTS: RefTreeOpts = { favorites: new Set(), group: true, tags: true }`.
- `nest(…)` gains a `group: boolean` parameter: when `!group`, every leaf is "direct" with `leaf = l.name.slice(strip.length)`. Sort direct leaves favorites first, keeping their order otherwise:

```ts
  const direct: Leaf[] = []
  // …existing split; when !group push every leaf to direct…
  direct.sort((a, b) => Number(b.favorite) - Number(a.favorite))
```

- `refTree(refs, filter, collapsed, opts = DEFAULT_OPTS)` passes `opts.group` to `nest`, sets `favorite` on leaves, and wraps the tags section in `if (opts.tags) section('tags', …)`.
- Add:

```ts
/** Ids of every section and folder (Collapse All collapses them, Expand All clears the set). */
export function expandableIds(refs: RefsOk, opts: RefTreeOpts = DEFAULT_OPTS): string[] {
  const all = refTree(refs, '', new Set(), opts)
  return all.filter((r) => r.kind === 'folder' || (r.kind === 'section' && r.section !== 'head')).map((r) => r.id)
}
```

`refPrefs.ts`:

```ts
import type { RefsOk } from './gitRefs'
import { pathKey } from './changesView'

export const FAVORITES_KEY = 'ccm.workspace.logFavorites'
export const REFS_VIEW_KEY = 'ccm.workspace.logRefsView'

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // preference only
  }
}

/** Favorite refs of a repo; never set yet → `main` / `master` when they exist (IntelliJ default). */
export function readFavorites(repo: string, refs: RefsOk): Set<string> {
  const all = readJson<Record<string, string[]>>(FAVORITES_KEY)
  const mine = all && typeof all === 'object' ? all[pathKey(repo)] : undefined
  if (Array.isArray(mine)) return new Set(mine.filter((r) => typeof r === 'string'))
  return new Set(refs.local.map((l) => l.ref).filter((r) => r === 'refs/heads/main' || r === 'refs/heads/master'))
}

export function writeFavorites(repo: string, favs: ReadonlySet<string>): void {
  const all = readJson<Record<string, string[]>>(FAVORITES_KEY) ?? {}
  all[pathKey(repo)] = [...favs].slice(0, 200)
  writeJson(FAVORITES_KEY, all)
}

export function readRefsView(): { group: boolean; tags: boolean } {
  const v = readJson<{ group?: unknown; tags?: unknown }>(REFS_VIEW_KEY)
  return { group: v?.group !== false, tags: v?.tags !== false }
}

export function writeRefsView(v: { group: boolean; tags: boolean }): void {
  writeJson(REFS_VIEW_KEY, v)
}
```

(The `refPrefs` test uses `'/r'`; `pathKey('/r')` is `'/r'` on Windows CI as it has no drive letter, so `toHaveProperty(['/r'])` holds.)

- [ ] **Step 4: Run** `npm test -w @ccm/web && npm run typecheck` — Expected: PASS; clean (existing `refTree` tests keep passing with the default options).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/gitRefs.ts apps/web/src/lib/gitRefs.test.ts apps/web/src/lib/refPrefs.ts apps/web/src/lib/refPrefs.test.ts
git commit -m "✨ Refs tree: favorites first, group by folder, hide tags, expandable ids

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 18: Branches toolbar strip, new-branch sheet and Log wiring

**Files:**
- Create: `apps/web/src/components/workspace/log/LogRefsToolbar.vue`, `apps/web/src/components/workspace/log/NewBranchDialog.vue`
- Modify: `log/LogRefsTree.vue`, `log/LogPane.vue:276-302`, `log/LogTable.vue:82,131`, `apps/web/src/composables/useGitLog.ts`, `apps/web/src/i18n/workspace-log.ts`, `apps/desktop/e2e/log.cjs`

**Interfaces:**
- Consumes: Tasks 13–17 (`BranchOpResult`, `checkBranchName`, `gitBranchCreate/Delete/Update`, `gitFetch`, `hasBranchOps`, `LogFilters.notRef`, `refTree` opts, `expandableIds`, `readFavorites/writeFavorites/readRefsView/writeRefsView`).
- Produces:
  - `LogRefsToolbar` props `{ open: boolean; selected: RefRow | null; busy: 'fetch' | 'update' | null; view: { group: boolean; tags: boolean }; canWrite: boolean }`, emits `toggle`, `newBranch`, `update`, `remove`, `compare`, `search`, `fetch`, `favorite`, `navigate`, `view: [{ group: boolean; tags: boolean }]`, `expandAll`, `collapseAll`. DOM `[data-refs-toolbar]`, buttons `[data-refs-action=<emit name>]`.
  - `LogRefsTree` new props `{ repo: string; favorites: ReadonlySet<string>; view: { group: boolean; tags: boolean } }`, `v-model:collapsed` (`Set<string>`), emits `select: [row: RefRow | null]` (focused row = toolbar target) in addition to `pick`; expose `focusSearch()`.
  - `LogTable` expose `scrollToHash(hash: string): boolean`.
  - `useGitLog` `reveal(hash: string, maxPages = 10): Promise<boolean>` (loads pages until the commit is listed, then selects it).
  - `NewBranchDialog` props `{ request: { base: string; baseLabel: string } | null }`, emits `create: [name: string, checkout: boolean]`, `close`.

- [ ] **Step 1: `useGitLog.reveal`** — add before `return` and include in the returned object:

```ts
  /** Navigate Log to a commit: load pages until it is listed (at most `maxPages`), then select it. */
  async function reveal(hash: string, maxPages = 10): Promise<boolean> {
    for (let i = 0; i <= maxPages; i++) {
      if (commits.value.some((c) => c.hash === hash)) {
        select(hash)
        return true
      }
      if (!more.value) return false
      await loadMore()
    }
    return false
  }
```

- [ ] **Step 2: `LogTable.scrollToHash`** — next to `scrollToIndex` (line 82):

```ts
function scrollToHash(hash: string): boolean {
  const i = props.commits.findIndex((c) => c.hash === hash)
  if (i < 0) return false
  scrollToIndex(i)
  return true
}
```

(If rows are indexed through `rows`/`flatRows` rather than `commits`, use the same array `scrollToIndex` indexes.) `defineExpose({ focus: () => scroller.value?.focus(), scrollToHash })`.

- [ ] **Step 3: `LogRefsToolbar.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ChevronsDownUp, ChevronsUpDown, Columns2, Crosshair, EllipsisVertical, LoaderCircle, PanelLeft, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import type { RefRow } from '../../../lib/gitRefs'
import ContextMenu from '../../ui/ContextMenu.vue'

const props = defineProps<{ open: boolean; selected: RefRow | null; busy: 'fetch' | 'update' | null; view: { group: boolean; tags: boolean }; canWrite: boolean }>()
const emit = defineEmits<{
  toggle: []
  newBranch: []
  update: []
  remove: []
  compare: []
  search: []
  fetch: []
  favorite: []
  navigate: []
  view: [v: { group: boolean; tags: boolean }]
  expandAll: []
  collapseAll: []
}>()
const { t } = useI18n()

const target = computed(() => (props.selected?.kind === 'ref' ? props.selected : null))
const isLocal = computed(() => target.value?.refKind === 'local')
const isBranch = computed(() => target.value?.refKind === 'local' || target.value?.refKind === 'remote')
const more = ref<{ at: DOMRect; trigger: HTMLElement } | null>(null)

const B = 'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted hover:bg-fill hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:text-accent-ink'
const L = (k: string): string => t(`workspace.log.branches.${k}`)

function openMore(e: MouseEvent): void {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  more.value = { at: new DOMRect(r.right, r.top, 0, 0), trigger: el }
}
function onMore(id: string): void {
  if (id === 'group') emit('view', { ...props.view, group: !props.view.group })
  if (id === 'tags') emit('view', { ...props.view, tags: !props.view.tags })
}
</script>

<template>
  <div class="flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-line py-1" role="toolbar" aria-orientation="vertical" :aria-label="L('toolbar')" data-refs-toolbar>
    <button type="button" :class="B" :aria-pressed="open" :title="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" :aria-label="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" data-refs-action="toggle" @click="emit('toggle')">
      <PanelLeft :size="15" aria-hidden="true" />
    </button>
    <template v-if="open">
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :disabled="!canWrite" :title="L('new')" :aria-label="L('new')" data-refs-action="newBranch" @click="emit('newBranch')"><Plus :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !isLocal || !!busy" :title="L('update')" :aria-label="L('update')" data-refs-action="update" @click="emit('update')">
        <LoaderCircle v-if="busy === 'update'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <ArrowDownToLine v-else :size="15" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!canWrite || !isBranch || !!target?.current" :title="L('delete')" :aria-label="L('delete')" data-refs-action="remove" @click="emit('remove')"><Trash2 :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!isBranch || !!target?.current" :title="L('compare')" :aria-label="L('compare')" data-refs-action="compare" @click="emit('compare')"><Columns2 :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('search')" :aria-label="L('search')" data-refs-action="search" @click="emit('search')"><Search :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !!busy" :title="L('fetch')" :aria-label="L('fetch')" data-refs-action="fetch" @click="emit('fetch')">
        <LoaderCircle v-if="busy === 'fetch'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <RefreshCw v-else :size="15" class="text-accent-ink" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!isBranch" :aria-pressed="!!target?.favorite" :title="L(target?.favorite ? 'unfavorite' : 'favorite')" :aria-label="L(target?.favorite ? 'unfavorite' : 'favorite')" data-refs-action="favorite" @click="emit('favorite')">
        <Star :size="15" :class="target?.favorite ? 'fill-current text-favorite' : ''" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!target" :title="L('navigate')" :aria-label="L('navigate')" data-refs-action="navigate" @click="emit('navigate')"><Crosshair :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('more')" :aria-label="L('more')" aria-haspopup="menu" data-refs-action="more" @click="openMore"><EllipsisVertical :size="15" aria-hidden="true" /></button>
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :title="L('expandAll')" :aria-label="L('expandAll')" data-refs-action="expandAll" @click="emit('expandAll')"><ChevronsUpDown :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('collapseAll')" :aria-label="L('collapseAll')" data-refs-action="collapseAll" @click="emit('collapseAll')"><ChevronsDownUp :size="15" aria-hidden="true" /></button>
    </template>
    <ContextMenu
      v-if="more"
      :at="more.at"
      :entries="[
        { id: 'group', label: `${view.group ? '✓ ' : ''}${L('groupByFolder')}` },
        { id: 'tags', label: `${view.tags ? '✓ ' : ''}${L('showTags')}` },
      ]"
      :label="L('more')"
      :trigger="more.trigger"
      @pick="onMore"
      @close="more = null"
    />
  </div>
</template>
```

- [ ] **Step 4: `NewBranchDialog.vue`** — a teleported sheet in the `CreateEntryDialog` style:

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranchPlus, X } from 'lucide-vue-next'
import { checkBranchName } from '@ccm/shared'
import { retireOverlay } from '../../../lib/motion'

const props = defineProps<{ request: { base: string; baseLabel: string } | null }>()
const emit = defineEmits<{ create: [name: string, checkout: boolean]; close: [] }>()
const { t } = useI18n()
const name = ref('')
const checkout = ref(true)
const touched = ref(false)
const input = ref<HTMLInputElement | null>(null)
const check = computed(() => checkBranchName(name.value))
const problem = computed(() => (touched.value && !check.value.ok ? t(`workspace.log.branches.name.${check.value.reason}`) : null))

watch(
  () => props.request,
  async (req) => {
    if (!req) return
    name.value = ''
    checkout.value = true
    touched.value = false
    await nextTick()
    input.value?.focus()
  },
)

function submit(): void {
  touched.value = true
  if (check.value.ok) emit('create', name.value, checkout.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="request" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]" @mousedown.self="emit('close')">
        <div role="dialog" aria-modal="true" aria-labelledby="log-new-branch" class="ccm-sheet flex w-full max-w-[420px] flex-col overflow-hidden" data-new-branch @keydown.esc.stop="emit('close')">
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <GitBranchPlus :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 id="log-new-branch" class="truncate text-sm font-semibold text-ink">{{ t('workspace.log.branches.newTitle') }}</h2>
              <p class="truncate text-xs text-ink-faint" :title="request.baseLabel">{{ t('workspace.log.branches.from', { base: request.baseLabel }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.explorer.create.cancel')" @click="emit('close')"><X :size="14" aria-hidden="true" /></button>
          </header>
          <form class="flex flex-col gap-2 px-4 py-3" novalidate @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              {{ t('workspace.explorer.create.name') }}
              <input ref="input" v-model="name" type="text" spellcheck="false" autocomplete="off" class="ccm-field h-8 font-mono text-sm" :aria-invalid="!!problem" aria-describedby="log-new-branch-problem" data-new-branch-name @input="touched = true" />
            </label>
            <p id="log-new-branch-problem" class="min-h-4 text-xs text-st-error" role="status">{{ problem ?? '' }}</p>
            <label class="flex items-center gap-2 text-xs text-ink"><input v-model="checkout" type="checkbox" data-new-branch-checkout />{{ t('workspace.log.branches.checkout') }}</label>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('close')">{{ t('workspace.explorer.create.cancel') }}</button>
              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!check.ok" data-new-branch-submit>{{ t('workspace.log.branches.create') }}</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

- [ ] **Step 5: `LogRefsTree.vue`**

- Props: `{ refs: RefsOk | null; branch: string | null; favorites: ReadonlySet<string>; view: { group: boolean; tags: boolean } }`; `const collapsed = defineModel<Set<string>>('collapsed', { required: true })` replaces the local `collapsed` ref; emits add `select: [row: RefRow | null]`.
- `rows` → `refTree(props.refs, filter.value, collapsed.value, { favorites: props.favorites, group: props.view.group, tags: props.view.tags })`.
- `watch(focusId, () => emit('select', rows.value.find((r) => r.id === focusId.value) ?? null))` and also emit when `rows` changes (favorite toggled): `watch(rows, () => emit('select', rows.value.find((r) => r.id === focusId.value) ?? null))`.
- `const searchEl = ref<HTMLInputElement | null>(null)` on the `<input>`; `defineExpose({ focusSearch: () => { searchEl.value?.focus(); searchEl.value?.select() } })`.
- Icons: `Star v-else-if="r.tracked"` → `Star v-else-if="r.favorite" … class="shrink-0 fill-current text-favorite" :aria-label="t('workspace.log.branches.favorite')"`; the row `title` becomes `r.kind === 'ref' ? [r.name, r.tracked ? t('workspace.log.refs.tracked') : ''].filter(Boolean).join(' · ') : undefined`.

- [ ] **Step 6: `LogPane.vue` wiring**

Imports: `LogRefsToolbar`, `NewBranchDialog`, `expandableIds`, `type RefRow` from `../../../lib/gitRefs`, `readFavorites, writeFavorites, readRefsView, writeRefsView` from `../../../lib/refPrefs`, `gitBranchCreate, gitBranchDelete, gitBranchUpdate, gitFetch, hasBranchOps` from `../../../lib/preview`, `type BranchOpResult` from `@ccm/shared`.

State:

```ts
const refsTree = ref<InstanceType<typeof LogRefsTree> | null>(null)
const selectedRef = ref<RefRow | null>(null)
const refsCollapsed = ref<Set<string>>(new Set())
const refsView = ref(readRefsView())
watch(refsView, writeRefsView, { deep: true })
const favorites = ref<Set<string>>(new Set())
watch(log.refs, (r) => {
  if (r && log.root.value) favorites.value = readFavorites(log.root.value, r)
}, { immediate: true })
const branchBusy = ref<'fetch' | 'update' | null>(null)
const branchNotice = ref<{ text: string; failed: boolean } | null>(null)
const newBranch = ref<{ base: string; baseLabel: string } | null>(null)

function report(res: BranchOpResult, okKey: string, name = ''): void {
  if (res.ok) branchNotice.value = { text: t(`workspace.log.branches.done.${okKey}`, { name }), failed: false }
  else if (res.error !== 'cancelled') branchNotice.value = { text: [t(`workspace.log.branches.error.${res.error}`, { name }), res.detail].filter(Boolean).join(' — '), failed: true }
  void log.reload()
}

function selRef(): Extract<RefRow, { kind: 'ref' }> | null {
  return selectedRef.value?.kind === 'ref' ? selectedRef.value : null
}

function askNewBranch(): void {
  const r = selRef()
  const commit = log.selected.value
  newBranch.value = r ? { base: r.ref, baseLabel: r.name } : commit ? { base: commit, baseLabel: commit.slice(0, 8) } : { base: 'HEAD', baseLabel: 'HEAD' }
}
async function createBranch(name: string, checkout: boolean): Promise<void> {
  const req = newBranch.value
  newBranch.value = null
  if (req && log.root.value) report(await gitBranchCreate(log.root.value, name, req.base, checkout), checkout ? 'createdSwitched' : 'created', name)
}
async function updateSelected(): Promise<void> {
  const r = selRef()
  if (!r || !log.root.value) return
  branchBusy.value = 'update'
  report(await gitBranchUpdate(log.root.value, r.ref), 'updated', r.name)
  branchBusy.value = null
}
async function deleteSelected(): Promise<void> {
  const r = selRef()
  if (r && log.root.value) report(await gitBranchDelete(log.root.value, r.ref), 'deleted', r.name)
}
async function fetchAll(): Promise<void> {
  if (!log.root.value) return
  branchBusy.value = 'fetch'
  report(await gitFetch(log.root.value), 'fetched')
  branchBusy.value = null
}
function compareSelected(): void {
  const r = selRef()
  if (r) log.setFilters({ branch: r.ref, notRef: 'HEAD' })
}
function toggleFavorite(): void {
  const r = selRef()
  if (!r || !log.root.value) return
  const next = new Set(favorites.value)
  if (next.has(r.ref)) next.delete(r.ref)
  else next.add(r.ref)
  favorites.value = next
  writeFavorites(log.root.value, next)
}
async function navigateTo(): Promise<void> {
  const r = selRef()
  const refs = log.refs.value
  if (!r || !refs) return
  const hash = [...refs.local, ...refs.remotes.flatMap((g) => g.refs), ...refs.tags].find((x) => x.ref === r.ref)?.hash
  if (hash && (await log.reveal(hash)) && table.value?.scrollToHash(hash)) return
  branchNotice.value = { text: t('workspace.log.branches.notLoaded', { name: r.name }), failed: true }
}
```

(Check the shared `LogRef` field name for the tip hash — `hash` in `RefsResult` refs; use whatever `parseRefLines` sets.)

Template — remove the `PanelLeft` toggle button from the header (lines 282-284). Replace the refs block (lines 299-302):

```vue
      <LogRefsToolbar
        :open="cols.refsOpen"
        :selected="selectedRef"
        :busy="branchBusy"
        :view="refsView"
        :can-write="hasBranchOps && !!log.root.value"
        @toggle="cols.refsOpen = !cols.refsOpen"
        @new-branch="askNewBranch"
        @update="updateSelected"
        @remove="deleteSelected"
        @compare="compareSelected"
        @search="refsTree?.focusSearch()"
        @fetch="fetchAll"
        @favorite="toggleFavorite"
        @navigate="navigateTo"
        @view="(v) => (refsView = v)"
        @expand-all="refsCollapsed = new Set()"
        @collapse-all="log.refs.value && (refsCollapsed = new Set(expandableIds(log.refs.value, { favorites, ...refsView })))"
      />
      <template v-if="cols.refsOpen">
        <LogRefsTree
          ref="refsTree"
          v-model:collapsed="refsCollapsed"
          class="shrink-0"
          :style="{ width: `${refsW}px` }"
          :refs="log.refs.value"
          :branch="log.filters.value.branch"
          :favorites="favorites"
          :view="refsView"
          @pick="(name) => log.setFilters({ branch: name, notRef: null })"
          @select="(row) => (selectedRef = row)"
        />
        <!-- existing refs resizer div stays here -->
      </template>
```

Above the table area (inside the `v-else` table column, before `LogFilterBar`), the compare + notice strips:

```vue
          <p v-if="log.filters.value.notRef && log.filters.value.branch" class="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1 text-xs text-ink" role="status" data-log-compare>
            <span class="min-w-0 flex-1 truncate">{{ t('workspace.log.branches.comparing', { a: log.filters.value.branch.replace(/^refs\/(heads|remotes)\//, ''), b: log.filters.value.notRef }) }}</span>
            <button type="button" class="ccm-btn-plain h-6 px-2 text-xs" data-log-compare-swap @click="log.setFilters({ branch: log.filters.value.notRef, notRef: log.filters.value.branch })">{{ t('workspace.log.branches.swap') }}</button>
            <button type="button" class="ccm-btn-plain h-6 px-2 text-xs" @click="log.setFilters({ notRef: null })">{{ t('workspace.log.branches.clear') }}</button>
          </p>
          <p v-if="branchNotice" class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1 text-xs text-ink" :class="branchNotice.failed ? 'bg-st-error-soft' : 'bg-fill'" role="status" data-log-branch-notice>
            <span class="min-w-0 flex-1 truncate" :title="branchNotice.text">{{ branchNotice.text }}</span>
            <button type="button" class="shrink-0 cursor-pointer text-ink-faint hover:text-ink" :aria-label="t('workspace.explorer.status.dismiss')" @click="branchNotice = null"><X :size="12" aria-hidden="true" /></button>
          </p>
```

(`swap` puts HEAD as `branch` and the branch as `notRef` — `cleanLogQuery` accepts `HEAD` as branch.) Add `<NewBranchDialog :request="newBranch" @create="createBranch" @close="newBranch = null" />` at the end of the section; import `X` from `lucide-vue-next` if not already.

- [ ] **Step 7: i18n** — `workspace-log.ts` inside `log` (en):

```ts
    branches: {
      toolbar: 'Branches',
      new: 'New Branch…',
      update: 'Update Selected (fast-forward)',
      delete: 'Delete Branch…',
      compare: 'Compare with Current',
      search: 'Search branches',
      fetch: 'Fetch',
      favorite: 'Mark as Favorite',
      unfavorite: 'Unmark as Favorite',
      navigate: 'Navigate Log to Selected Branch',
      more: 'More',
      groupByFolder: 'Group by Folder',
      showTags: 'Show Tags',
      expandAll: 'Expand All',
      collapseAll: 'Collapse All',
      newTitle: 'New branch',
      from: 'From {base}',
      checkout: 'Switch to the new branch',
      create: 'Create',
      comparing: 'Commits in {a} that are not in {b}',
      swap: 'Swap',
      clear: 'Show all',
      notLoaded: 'The tip of {name} is not in the loaded history.',
      done: { created: 'Created {name}.', createdSwitched: 'Created {name} and switched to it.', updated: 'Updated {name}.', deleted: 'Deleted {name}.', fetched: 'Fetched all remotes.' },
      error: {
        denied: 'Not allowed here.',
        invalid: 'Not a valid branch name or start point.',
        exists: '{name} already exists.',
        'not-merged': '{name} is not fully merged.',
        current: 'The current branch can’t be deleted.',
        conflict: 'Local changes would be overwritten.',
        'no-upstream': '{name} has no upstream branch.',
        'non-ff': '{name} can’t be fast-forwarded.',
        auth: 'The remote refused the credentials.',
        timeout: 'git took too long.',
        cancelled: 'Cancelled.',
        failed: 'git failed.',
      },
      name: { empty: 'Type a name.', space: 'No spaces.', dash: 'Can’t start with “-”.', dots: 'No “..” or “@{”.', char: 'No ~ ^ : ? * [ \\ or control characters.', slash: 'Bad “/” or “.” placement.', lock: 'Can’t end with “.lock”.', long: 'Too long.' },
    },
```

vi:

```ts
    branches: {
      toolbar: 'Nhánh',
      new: 'Tạo nhánh…',
      update: 'Cập nhật nhánh chọn (fast-forward)',
      delete: 'Xoá nhánh…',
      compare: 'So với nhánh hiện tại',
      search: 'Tìm nhánh',
      fetch: 'Fetch',
      favorite: 'Đánh dấu yêu thích',
      unfavorite: 'Bỏ yêu thích',
      navigate: 'Nhảy log tới nhánh đang chọn',
      more: 'Thêm',
      groupByFolder: 'Nhóm theo thư mục',
      showTags: 'Hiện tag',
      expandAll: 'Mở rộng tất cả',
      collapseAll: 'Thu gọn tất cả',
      newTitle: 'Nhánh mới',
      from: 'Từ {base}',
      checkout: 'Chuyển sang nhánh mới',
      create: 'Tạo',
      comparing: 'Commit có trong {a} nhưng không có trong {b}',
      swap: 'Đảo chiều',
      clear: 'Hiện tất cả',
      notLoaded: 'Commit đầu của {name} chưa nằm trong lịch sử đã tải.',
      done: { created: 'Đã tạo {name}.', createdSwitched: 'Đã tạo và chuyển sang {name}.', updated: 'Đã cập nhật {name}.', deleted: 'Đã xoá {name}.', fetched: 'Đã fetch mọi remote.' },
      error: {
        denied: 'Không được phép ở đây.',
        invalid: 'Tên nhánh hoặc điểm bắt đầu không hợp lệ.',
        exists: '{name} đã tồn tại.',
        'not-merged': '{name} chưa được merge hết.',
        current: 'Không thể xoá nhánh hiện tại.',
        conflict: 'Thay đổi chưa commit sẽ bị ghi đè.',
        'no-upstream': '{name} không có nhánh upstream.',
        'non-ff': '{name} không fast-forward được.',
        auth: 'Remote từ chối thông tin đăng nhập.',
        timeout: 'git chạy quá lâu.',
        cancelled: 'Đã huỷ.',
        failed: 'git lỗi.',
      },
      name: { empty: 'Nhập tên.', space: 'Không có dấu cách.', dash: 'Không bắt đầu bằng “-”.', dots: 'Không có “..” hoặc “@{”.', char: 'Không có ~ ^ : ? * [ \\ hay ký tự điều khiển.', slash: 'Sai vị trí “/” hoặc “.”.', lock: 'Không kết thúc bằng “.lock”.', long: 'Quá dài.' },
    },
```

- [ ] **Step 8: E2E** — append to `apps/desktop/e2e/log.cjs` `run()` before its final checks (the fixture already has `feature/x`; use its `DIR`/`W` helpers):

```js
  // v32 Branches toolbar.
  check('vertical branches toolbar is shown', await evaluate(`!!document.querySelector('[data-refs-toolbar] [data-refs-action=newBranch]')`))
  await evaluate(`document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]').focus()`)
  await evaluate(`document.querySelector('[data-refs-action=favorite]').click()`)
  await sleep(200)
  check('star marks the branch favorite and floats it up', await evaluate(`(() => { const rows = [...document.querySelectorAll('[data-log-refs] [role=treeitem]')]; const fav = rows.findIndex((r) => r.dataset.ref === 'refs/heads/feature/x'); return fav >= 0 && fav <= 3 && JSON.stringify(Object.values(JSON.parse(localStorage.getItem('ccm.workspace.logFavorites')))).includes('feature/x') })()`))
  await evaluate(`document.querySelector('[data-refs-action=compare]').click()`)
  await waitFor(`!!document.querySelector('[data-log-compare]')`, 4000, 'compare').catch(() => {})
  check('Compare with Current filters to commits not in HEAD', await evaluate(`!!document.querySelector('[data-log-compare]')`))
  await evaluate(`document.querySelector('[data-log-compare] button:last-child').click()`)
  await evaluate(`document.querySelector('[data-refs-action=newBranch]').click()`)
  await waitFor(`!!document.querySelector('[data-new-branch-name]')`, 3000, 'new branch').catch(() => {})
  await evaluate(`(() => { const i = document.querySelector('[data-new-branch-name]'); i.value = 'v32-e2e'; i.dispatchEvent(new Event('input')); document.querySelector('[data-new-branch-checkout]').click(); document.querySelector('[data-new-branch-submit]').click() })()`)
  await waitFor(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/v32-e2e"]')`, 6000, 'branch listed').catch(() => {})
  check('New Branch creates a branch without switching', await evaluate(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/v32-e2e"]')`) && execFileSync('git', ['branch', '--show-current'], { cwd: DIR, encoding: 'utf8' }).trim() !== 'v32-e2e')
  await evaluate(`document.querySelector('[data-refs-action=collapseAll]').click()`)
  await sleep(150)
  check('Collapse All leaves only section rows', await evaluate(`[...document.querySelectorAll('[data-log-refs] [role=treeitem]')].every((r) => r.getAttribute('aria-level') === '1')`))
  await evaluate(`document.querySelector('[data-refs-action=expandAll]').click()`)
```

(Delete is not driven in E2E: the native confirm cannot be clicked through CDP; Task 15's unit test covers it. If `log.cjs` does not import `execFileSync`, add it to its `require('node:child_process')`.)

- [ ] **Step 9: Verify** — `npm run typecheck && npm test -w @ccm/web && npm test -w @ccm/desktop && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/log.cjs` — Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/workspace/log apps/web/src/composables/useGitLog.ts apps/web/src/i18n/workspace-log.ts apps/desktop/e2e/log.cjs
git commit -m "✨ Git Log Branches toolbar: new, update, delete, compare, fetch, favorites, navigate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Milestone 6 — Attachments: follow Backspace, remove in any order

### Task 19: `eraseKeys` and `cursorToken` (pure)

**Files:**
- Modify: `apps/web/src/lib/promptAttachments.ts` (add after `eraseCount`, line 54), `apps/web/src/lib/promptAttachments.test.ts:2` + append

**Interfaces:**
- Produces:

```ts
export interface EraseKeys { left: number; back: number; right: number }
export function eraseKeys(rows: string[], cursor: { x: number; y: number }, token: string): EraseKeys | null
export function cursorToken(rows: string[], cursor: { x: number; y: number }): string | null
```

`eraseCount` stays until Task 20 moves its only caller (`usePaneAttachments.eraseFor`) to `eraseKeys` and deletes it with its test. `{ left: 0, right: 0 }` is exactly the old "last in the prompt" case.

- [ ] **Step 1: Write the failing tests** — in `promptAttachments.test.ts` add `cursorToken, eraseKeys` to the import from `./promptAttachments` and append inside `describe('prompt attachments', …)`:

```ts
  it('erases the last token in place, like before', () => {
    const rows = screen(['❯ [Image #1] [Image #2]'])
    const y = 5
    // Observed: one backspace drops a whole [Image #N].
    expect(eraseKeys(rows, { x: 23, y }, '[Image #2]')).toEqual({ left: 0, back: 1, right: 0 })
    // Cursor one past the space typed after a mention (translateToString trims it; the cursor cell says it is there).
    expect(eraseKeys(screen(['❯ @package.json']), { x: 16, y }, '@package.json')).toEqual({ left: 0, back: '@package.json'.length + 1, right: 0 })
  })

  it('erases an earlier token on the cursor row by moving the cursor (item 2 of 3)', () => {
    const rows = screen(['❯ [Image #1] [Image #2] [Image #3]'])
    // "[Image #2] " ends at 24; the cursor is at 35 (after "[Image #3] ").
    expect(eraseKeys(rows, { x: 35, y: 5 }, '[Image #2]')).toEqual({ left: 11, back: 2, right: 11 })
    expect(eraseKeys(screen(['❯ @a.ts @b.ts look']), { x: 18, y: 5 }, '@a.ts')).toEqual({ left: 10, back: 6, right: 10 })
  })

  it('refuses tokens off the cursor row, after the cursor, partial matches and wide characters', () => {
    const two = screen(['❯ [Image #1] first line', '  second line'])
    expect(eraseKeys(two, { x: 13, y: 6 }, '[Image #1]')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #1] [Image #2]']), { x: 10, y: 5 }, '[Image #2]')).toBeNull()
    expect(eraseKeys(screen(['❯ @src/a.tsx ']), { x: 14, y: 5 }, '@src/a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ 画像 @a.ts ']), { x: 14, y: 5 }, '@a.ts')).toBeNull()
    expect(eraseKeys(screen(['❯ [Image #2]']), { x: 13, y: 4 }, '[Image #2]')).toBeNull()
  })

  it('names the mention being typed or erased at the cursor', () => {
    expect(cursorToken(screen(['❯ look @package.js']), { x: 18, y: 5 })).toBe('@package.js')
    expect(cursorToken(screen(['❯ look @package.js']), { x: 19, y: 5 })).toBeNull()
    expect(cursorToken(screen(['❯ [Image #1]']), { x: 12, y: 5 })).toBeNull()
  })
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/promptAttachments.test.ts` — Expected: FAIL (`eraseKeys` is not exported).

- [ ] **Step 3: Implement** — add after `eraseCount` (line 54):

```ts
/** East Asian wide characters and emoji take two cells: cursor cells stop matching string indices. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u

export interface EraseKeys {
  /** ← presses from the cursor to just after the token (and the space typed after it). */
  left: number
  /** Backspaces: one per character of a mention, one for a whole `[Image #N]`, plus that space. */
  back: number
  /** → presses back to where the cursor was. */
  right: number
}

/**
 * Keys that erase `token` when it sits before the cursor on the cursor's row of the prompt. Claude Code drops a
 * whole `[Image #N]` on one Backspace (§11p). null = not safe: another row (soft wrap and typed newline look the
 * same on screen), after the cursor, only a partial match, or wide characters before the cursor.
 */
export function eraseKeys(rows: string[], cursor: { x: number; y: number }, token: string): EraseKeys | null {
  const range = findPromptRange(rows)
  if (!range || cursor.y < range[0] || cursor.y >= range[1]) return null
  // translateToString(true) trims trailing spaces; the cursor cell says how many were typed.
  const head = (rows[cursor.y] ?? '').padEnd(cursor.x).slice(0, cursor.x)
  if (WIDE.test(head)) return null
  const image = token.startsWith('[Image #')
  let at = head.lastIndexOf(token)
  while (at >= 0) {
    const before = head[at - 1]
    const after = head[at + token.length]
    // An image placeholder may touch text (the agent types it without a space); a mention starts a word.
    if ((image || at === 0 || /\s/.test(before!)) && (after === undefined || /\s/.test(after))) break
    at = at > 0 ? head.lastIndexOf(token, at - 1) : -1
  }
  if (at < 0) return null
  const end = at + token.length + (head[at + token.length] === ' ' ? 1 : 0)
  const left = cursor.x - end
  return { left, back: end - at - token.length + (image ? 1 : token.length), right: left }
}

/** The `@mention` ending exactly at the cursor (still being typed, or being erased), else null. */
export function cursorToken(rows: string[], cursor: { x: number; y: number }): string | null {
  const head = (rows[cursor.y] ?? '').padEnd(cursor.x).slice(0, cursor.x)
  return /(?:^|\s)(@(?:"[^"\n]+"|[^\s"@]+))$/.exec(head)?.[1] ?? null
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/web -- src/lib/promptAttachments.test.ts && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/promptAttachments.ts apps/web/src/lib/promptAttachments.test.ts
git commit -m "✨ Erase any prompt token on the cursor row; name the mention at the cursor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 20: Tray follows Backspace and removes any item

**Files:**
- Modify: `apps/web/src/stores/attachments.ts:121-157` (`reconcile`), `apps/web/src/stores/attachments.test.ts` (append), `apps/web/src/composables/usePaneAttachments.ts:1-25,52-72,151-171`, `apps/web/src/components/workspace/TermPane.vue:268-280`, `apps/web/src/components/workspace/AttachmentsPanel.vue:12-17`, `apps/web/src/i18n/workspace-v25.ts:63,143`, `docs/claude-code-integration.md` §11p item 4, `apps/desktop/e2e/v25.cjs:148-160`

**Interfaces:**
- Consumes: Task 19 `eraseKeys`, `cursorToken`, `EraseKeys`.
- Produces: `reconcile(pane, scan, submitted, pendingPaste, editing: string | null = null)`; `usePaneAttachments` option `appCursorKeys: () => boolean`; `eraseFor(a): EraseKeys | null`; `remove(a): boolean` (true = erase queued / staged item dropped).

- [ ] **Step 1: Write the failing store test** — append to `apps/web/src/stores/attachments.test.ts` inside the `describe`:

```ts
  it('a mention being erased at the cursor leaves no ghost rows', () => {
    const s = useAttachmentsStore()
    s.reconcile(P, scan([], ['@package.json']), false, null)
    expect(s.list(P)).toHaveLength(1)
    s.reconcile(P, scan([], ['@package.jso']), false, null, '@package.jso')
    s.reconcile(P, scan([], ['@package.js']), false, null, '@package.js')
    expect(s.list(P)).toEqual([])
    // Finished (a space typed after it): the mention gets its row.
    s.reconcile(P, scan([], ['@src/b.ts']), false, null, null)
    expect(s.list(P).map((a) => a.token)).toEqual(['@src/b.ts'])
  })
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/stores/attachments.test.ts` — Expected: FAIL (ghost rows `@package.jso`, `@package.js` remain).

- [ ] **Step 3: Implement**

`stores/attachments.ts` — signature and the file loop:

```ts
  /**
   * Fold one screen read into the tray. `submitted` = Enter was pressed since the previous read: tokens that left
   * the prompt were sent, not removed. Tokens nobody put there (typed / pasted in the terminal) get a row too,
   * except `editing`: the mention ending at the cursor, still being typed or erased one Backspace at a time.
   */
  function reconcile(pane: string, scan: PromptScan, submitted: boolean, pendingPaste: NewAttachment | null, editing: string | null = null): { boundPaste: boolean } {
```

```ts
    for (const f of scan.files) {
      if (!tokens.has(f) && f !== editing) items.push({ id: `att-${++seq}`, kind: 'file', name: baseName(f.slice(1).replace(/^"|"$/g, '')), source: 'terminal', token: f, state: 'inserted', seen: true, at: Date.now() })
    }
```

`promptAttachments.ts` — delete `eraseCount` and its doc comment; in `promptAttachments.test.ts` delete the test `'erase only when the token ends the prompt at the cursor'` and `eraseCount` from the import (Task 19's `'erases the last token in place, like before'` covers it).

`usePaneAttachments.ts`:
- Import `cursorToken, eraseKeys, type EraseKeys` (drop `eraseCount`).
- `Options` add: `/** xterm DECCKM: the app asked for application cursor keys (ESC O D) instead of ESC [ D. */ appCursorKeys: () => boolean`.
- In `scan()`: `const { boundPaste } = store.reconcile(o.paneKey(), result, submitted, pendingPaste?.item ?? null, cursorToken(s.rows, s.cursor))`.
- Replace `eraseFor` and `remove`:

```ts
  /** Keys that erase an inserted item right now (it sits before the cursor on the cursor's row), or null. */
  function eraseFor(a: Attachment): EraseKeys | null {
    const s = lastScreen.value
    if (!s || a.state !== 'inserted' || !a.token) return null
    return eraseKeys(s.rows, s.cursor, a.token)
  }

  const KEY_GAP_MS = 12
  const REDRAW_MS = 80
  const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))
  /** Erases run one after another, each from a fresh screen read, so two quick clicks never use stale positions. */
  let erasing: Promise<void> = Promise.resolve()

  function remove(a: Attachment): boolean {
    if (a.state !== 'inserted') {
      store.remove(o.paneKey(), a.id)
      return true
    }
    if (!eraseFor(a)) return false
    erasing = erasing.then(async () => {
      const s = o.screen()
      const k = s && a.token ? eraseKeys(s.rows, s.cursor, a.token) : null
      // Moved since the click (or already gone): type nothing; the next scan keeps the tray honest.
      if (!k) return
      const [left, right] = o.appCursorKeys() ? ['\x1bOD', '\x1bOC'] : ['\x1b[D', '\x1b[C']
      // One key per write: the agent's input parser sees separate presses.
      for (const key of [...Array<string>(k.left).fill(left), ...Array<string>(k.back).fill('\x7f'), ...Array<string>(k.right).fill(right)]) {
        o.write(key)
        await sleep(KEY_GAP_MS)
      }
      await sleep(REDRAW_MS)
      schedule()
    })
    return true
  }
```

`TermPane.vue` — in the `usePaneAttachments({ … })` options add `appCursorKeys: () => !!term?.modes.applicationCursorKeysMode,`.

`AttachmentsPanel.vue` — import `type EraseKeys` from `../../lib/promptAttachments`; prop doc + type: `/** Keys that erase an inserted item, null = not before the cursor on its row (usePaneAttachments). */ eraseFor: (a: Attachment) => EraseKeys | null`. (`removable` already compares with `null`.)

i18n `workspace-v25.ts`: en `removeInTerminal: 'Not on the cursor’s line in the prompt: remove it in the terminal'`, vi `removeInTerminal: 'Không nằm trên dòng có con trỏ trong prompt: hãy xoá trong terminal'`.

`docs/claude-code-integration.md` §11p item 4 → replace its last sentence with: `The tray erases an item that sits before the cursor on the cursor's row: ← to just after it (ESC [ D, or ESC O D in application-cursor mode), Backspace (one for a placeholder, one per character for a mention, plus the space after it), then → back; one key per write. Items on other rows (a soft wrap and a typed newline look the same on screen) or after the cursor are left to the user ("remove it in the terminal"). While a mention is erased one Backspace at a time, the shortened mention at the cursor gets no tray row. Verified on Claude Code <version from \`claude --version\` when you run e2e/v25.cjs> by e2e/v25.cjs.` — write the actual version printed by `claude --version` on the machine that runs the E2E.

- [ ] **Step 4: E2E on a real Claude pane** — in `apps/desktop/e2e/v25.cjs` replace the removal block (lines 148-159) with:

```js
    // Backspace in the terminal (cursor after the last "[Image #N] "): the row leaves the tray.
    const before = await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length`)
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    await key('Backspace', 'Backspace', 8, 0)
    await key('Backspace', 'Backspace', 8, 0)
    const afterBs = await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).length === ${before - 1}`, 5000, 'backspace removed').catch(() => false)
    check('Backspace in the terminal removes the tray row', afterBs, String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))

    // Remove from the panel in any order: always the FIRST row (not at the end of the prompt).
    let removed = 0
    for (let i = 0; i < 6; i++) {
      const first = await evaluate(`${A}.list(${JSON.stringify(claudeKey)}).find(a => a.state === 'inserted')?.id ?? null`)
      if (!first) break
      await evaluate(`document.querySelector('${pane} [data-attachments] li[data-attachment=inserted] button').click()`)
      const gone = await waitFor(`!${A}.list(${JSON.stringify(claudeKey)}).some(a => a.id === ${JSON.stringify(first)})`, 6000, 'removed').catch(() => false)
      if (!gone) break
      removed++
    }
    check('remove from panel works in any order (first row each time)', removed >= 3 && (await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`)), `removed ${removed}`)
    await shot('v25-10-attach-removed')

    // Erasing a mention one Backspace at a time leaves no ghost rows.
    await evaluate(`${A}.add(${JSON.stringify(claudeKey)}, [{ kind: 'file', name: 'CLAUDE.md', source: 'pick', path: ${JSON.stringify(path.join(REPO, 'CLAUDE.md'))} }], true)`)
    await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).some(a => a.token === '@CLAUDE.md' && a.seen)`, 10000, 'mention in').catch(() => {})
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    for (let i = 0; i < '@CLAUDE.md '.length; i++) {
      await key('Backspace', 'Backspace', 8, 0)
      await sleep(60)
    }
    await sleep(600)
    check('no ghost rows while a mention is erased', await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`), String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))
```

(Check the helper names at the top of `run()` in `v25.cjs` — it destructures `key` and `sleep` from `app` like `explorer.cjs`; add them to the destructuring if missing, and `const path = require('node:path')` if absent. No Enter is pressed anywhere.)

- [ ] **Step 5: Verify** — `npm run typecheck && npm test -w @ccm/web && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/v25.cjs` — Expected: clean; PASS; the three new v25 checks PASS. If "any order" fails because Claude Code mis-reads the arrow keys, look at `v25-10-attach-removed.png` and the pane buffer, raise `KEY_GAP_MS` to 30 and re-run before changing anything else.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/promptAttachments.ts apps/web/src/lib/promptAttachments.test.ts apps/web/src/stores/attachments.ts apps/web/src/stores/attachments.test.ts apps/web/src/composables/usePaneAttachments.ts apps/web/src/components/workspace/TermPane.vue apps/web/src/components/workspace/AttachmentsPanel.vue apps/web/src/i18n/workspace-v25.ts docs/claude-code-integration.md apps/desktop/e2e/v25.cjs
git commit -m "🐛 Attachments follow Backspace and can be removed in any order

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

# Wrap-up

### Task 21: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v32-workspace-ui.md`
- Modify: `.code_index/web.md`, `.code_index/desktop.md`, `.code_index/_meta.md`, `.planning/PLAN-v30-git-log.md` (one line), `apps/desktop/package.json` (`version`)

- [ ] **Step 1: `.planning/PLAN-v32-workspace-ui.md`** — 15–25 lines in the v29/v30 style: Goal, the 6 pieces, the 11 Rulings from this plan (verbatim one-liners), Out of scope (live edit / `<<` / ignore chunk; cut/copy/paste files and the rest of the Android Studio menu; force push, tag delete, checkout of existing branches; tray removal of tokens on other prompt rows), Tests (unit files + `e2e/v32.cjs`, `diff.cjs`, `log.cjs`, `v25.cjs`), link to this task plan.
- [ ] **Step 2: `.planning/PLAN-v30-git-log.md`** — under Rulings add: `- v32 (2026-10-15): the Branches toolbar adds create / fast-forward update / fetch / delete (native confirm); see PLAN-v32-workspace-ui.md.`
- [ ] **Step 3: `.code_index/`** — `web.md`: a `## v32 workspace UI` section, 1–2 lines each for `lib/sideWidth.ts` + `SideResizer`, `lib/splitDiff.ts` + `SplitDiff.vue` + `useDiffDecor` + `DiffOpts.highlight`, `fileStepKey`, `lib/menu.ts` + `ui/ContextMenu.vue` + `lib/explorer/contextMenu.ts` + store `rename`/`trash`, `LogRefsToolbar` / `NewBranchDialog` / `refPrefs` / `refTree` opts / `useGitLog.reveal` / `LogFilters.notRef`, `promptAttachments.eraseKeys` / `cursorToken` + `reconcile(…, editing)` + queued arrow-key erase in `usePaneAttachments`. Mark the v29 line about the split `»` middle column and `sideBySide` as superseded. `desktop.md`: `preview/explorer.ts` `renameEntry`/`trashEntry`, `preview/branches.ts`, IPC channels, `confirmGit` + strings, `--histogram`. `_meta.md`: one line per milestone with paths.
- [ ] **Step 4: Version** — bump `apps/desktop/package.json` `version` one minor above what `master` has at merge time (2.5.0 → 2.6.0; if v31 already shipped 2.6.0, → 2.7.0).
- [ ] **Step 5: Full verification** — `npm run typecheck && npm test && npm run build -w @ccm/web && npm run build -w @ccm/desktop && npm run e2e -w @ccm/desktop` — Expected: typecheck clean, all unit tests PASS, E2E summary `all passed`.
- [ ] **Step 6: Commit**

```bash
git add .planning/PLAN-v32-workspace-ui.md .planning/PLAN-v30-git-log.md .code_index apps/desktop/package.json
git commit -m "📝 v32 plan note, code index and version
```
