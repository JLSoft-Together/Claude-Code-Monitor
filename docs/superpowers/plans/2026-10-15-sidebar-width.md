# Resizable Workspace Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag the width of the Workspace sidebar (Projects | Explorer), with keyboard nudges, double-click reset and a persisted width.

**Architecture:** A pure clamp/persistence module (`lib/sideWidth.ts`) and a small separator component (`SideResizer.vue`) placed in the 12px gap at the right edge of the existing `<aside>` in `WorkspaceView.vue`. The stored preference is kept as is; what is drawn is clamped to the current window so a narrow window never hides the stage.

**Tech Stack:** Vue 3 + Tailwind v4 + vue-i18n (apps/web), Vitest (happy-dom), CDP E2E (`apps/desktop/e2e/*.cjs`).

**Spec:** User request 2026-10-15, item 1: "cho kéo thả độ rộng của explorer/projects" (drag to resize the width of the Explorer / Projects sidebar). Siblings split from the same request: `2026-10-15-jetbrains-split-diff.md`, `2026-10-15-diff-arrow-files.md`, `2026-10-15-explorer-context-menu.md`, `2026-10-15-log-branches-toolbar.md`, `2026-10-15-attachments-removal.md`.

## Rulings

1. Width range 200–560px, default 240px (today's `w-60`); the stage keeps at least 480px of the window (padding and gap included).
2. The width applies to the `<aside>` itself, so it covers both views (Projects and Explorer) and survives v31's Agent rail rewrite (`docs/superpowers/plans/2026-10-15-multi-project-workspace.md`), which replaces only the aside's content. Whichever plan lands second keeps `:style="{ width }"` on the aside; v31's collapsed avatar column overrides the width while collapsed.
3. Same interaction as the Monitor `PanelSplitter`: drag, ←/→ by 16px, Home/End to min/max, double-click resets; reuses its i18n strings `panel.resize` / `panel.resizeHint`.

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green).
- All colours via theme tokens (`.planning/COLOR-SYSTEM.md`); the handle uses `line-strong` / `accent`.
- No horizontal page scroll.
- Storage key keeps the `ccm.` prefix: `ccm.workspace.sideWidth` (number, px). localStorage access wrapped in try/catch (preference only).
- No new npm dependency.
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/sidebar.cjs`.
- Version: the last task bumps `apps/desktop/package.json` `version` one minor above what `master` has when this plan merges.

## Review Focus

1. **Tiny window** (narrower than 200 + 480px) → the sidebar stays at 200px, never negative, never wider than the window allows; the stored preference is not overwritten. Pinned in Task 1 (`clampSideWidth` tests).
2. **Garbage in storage** (`'wide'`, `'9999'`, private mode throwing) → default or clamped width, no crash. Pinned in Task 1 (`readSideWidth` tests).
3. **Dragging across a terminal or browser pane** → the drag keeps going (pointer capture + `pointer-events-none` on the stage while dragging). Pinned in Task 1 (E2E drags 100px across the shell pane).

---

### Task 1: Drag the Projects / Explorer sidebar width

**Files:**
- Create: `apps/web/src/lib/sideWidth.ts`, `apps/web/src/lib/sideWidth.test.ts`, `apps/web/src/components/workspace/SideResizer.vue`, `apps/desktop/e2e/sidebar.cjs`
- Modify: `apps/web/src/components/workspace/WorkspaceView.vue:53-71,795-803,806-838`, `apps/web/src/i18n/en.ts:104-109`, `apps/web/src/i18n/vi.ts:105-110`, `apps/desktop/e2e/run.cjs:8`

**Interfaces:**
- Produces: `SIDE_WIDTH_KEY`, `SIDE_MIN = 200`, `SIDE_MAX = 560`, `SIDE_DEFAULT = 240`, `STAGE_MIN = 480`, `clampSideWidth(px: number, viewport?: number): number`, `readSideWidth(): number`, `writeSideWidth(px: number): void`; component `SideResizer` props `{ width: number; min: number; max: number; label: string }`, `v-model:dragging`, emits `resize(px)`, `commit()`, `reset()`; DOM hook `[data-side-resizer]`.

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

Template — replace the `<aside …>` opening tag (line 808) and add the handle as the aside's last child (before `</aside>`, line 837):

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

While dragging, terminals and webviews must not eat the pointer: on the stage wrapper right after the aside (`<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">`, line 838) add `:class="sideDragging ? 'pointer-events-none' : ''"`.

i18n — `apps/web/src/i18n/en.ts` inside `workspace.side` (line 104): add `panel: 'sidebar',`; `apps/web/src/i18n/vi.ts` inside `workspace.side` (line 105): add `panel: 'thanh bên',`.

- [ ] **Step 7: E2E** — create `apps/desktop/e2e/sidebar.cjs`

```js
// Resizable Workspace sidebar: drag across a shell pane, ← nudge, double-click reset, persisted width.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-sidebar-')))

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

  const aside = `document.querySelector('[data-tour="ws-sidebar"]')`
  const width = () => evaluate(`Math.round(${aside}.getBoundingClientRect().width)`)
  check('sidebar starts at the default 240px', (await width()) === 240, String(await width()))
  const r = await evaluate(`(() => { const b = document.querySelector('[data-side-resizer]').getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] })()`)
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + 100, y: r[1], button: 'left' })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0] + 100, y: r[1], button: 'left', clickCount: 1 })
  await sleep(200)
  const w1 = await width()
  check('dragging the handle across the shell pane widens the sidebar', Math.abs(w1 - 340) <= 2, String(w1))
  check('width is persisted', (await evaluate(`localStorage.getItem('ccm.workspace.sideWidth')`)) === String(w1))
  await evaluate(`document.querySelector('[data-side-resizer]').focus()`)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`)
  await sleep(100)
  check('← narrows by 16px', (await width()) === w1 - 16)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(100)
  check('double-click resets to 240px', (await width()) === 240)
  await shot('sidebar-01')
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('sidebar-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-sidebar.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
```

Add `'sidebar'` to the end of the list in `apps/desktop/e2e/run.cjs:8`.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test -w @ccm/web -- src/lib/sideWidth.test.ts && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/sidebar.cjs`
Expected: typecheck clean; unit PASS; E2E 5 × `PASS`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/sideWidth.ts apps/web/src/lib/sideWidth.test.ts apps/web/src/components/workspace/SideResizer.vue apps/web/src/components/workspace/WorkspaceView.vue apps/web/src/i18n/en.ts apps/web/src/i18n/vi.ts apps/desktop/e2e/sidebar.cjs apps/desktop/e2e/run.cjs
git commit -m "✨ Drag to resize the Workspace sidebar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v32-sidebar-width.md`
- Modify: `.code_index/web.md`, `.code_index/_meta.md`, `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v32-sidebar-width.md` — 8–12 lines in the v29/v30 style: Goal, pieces (`lib/sideWidth.ts`, `SideResizer.vue`, aside width), the 3 Rulings above, test files (`sideWidth.test.ts`, `e2e/sidebar.cjs`), link to this plan.
- [ ] **Step 2:** `.code_index/web.md` — under the Workspace section: `- v32 sidebar width: lib/sideWidth.ts (clamp 200–560, stage ≥ 480, ccm.workspace.sideWidth) + SideResizer.vue (separator in the aside's right gap: drag, ←/→ 16px, Home/End, dbl-click reset); WorkspaceView aside :style width, stage pointer-events-none while dragging.` `_meta.md`: one line with the paths.
- [ ] **Step 3:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 4: Verify** — `npm run typecheck && npm test` — Expected: clean; PASS.
- [ ] **Step 5: Commit**

```bash
git add .planning/PLAN-v32-sidebar-width.md .code_index apps/desktop/package.json
git commit -m "📝 Sidebar width plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
