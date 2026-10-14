# ← / → Switch Files in a Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In git diff mode (Changes pane and the Log's per-file diff), plain ← / → move to the previous / next file, instead of pressing F7 at the last change twice.

**Architecture:** One pure key helper (`fileStepKey` in `lib/changesView.ts`, next to `isShowDiffKey`) used by the two existing keydown handlers: `ChangesPane.onKey` and `LogPane.onKey`. Both already have a `stepFile`; the Changes one gains a `focus` flag so stepping from the diff does not pull focus into the file list.

**Tech Stack:** Vue 3 + vue-i18n (apps/web), Vitest (happy-dom), CDP E2E.

**Spec:** User request 2026-10-15, item 4: "khi ở mode git diff thì đang click F7 để đổi file nhanh => nhấn mũi tên sang trái sang phải để đổi file" (in git diff mode F7 is used to change file quickly → use ← / → to change file). Prior: `.planning/PLAN-v29-git-diff.md` (F7 / Shift+F7, `[ ]`, J/K), `.planning/PLAN-v30-git-log.md`. Siblings split from the same request: `2026-10-15-sidebar-width.md`, `2026-10-15-jetbrains-split-diff.md`, `2026-10-15-explorer-context-menu.md`, `2026-10-15-log-branches-toolbar.md`, `2026-10-15-attachments-removal.md`.

## Rulings (decided while planning — confirm or overrule before execution)

1. ← / → without modifiers step files in the Changes pane (diff area and the flat file list) and in the Log diff view.
2. In the Changes **tree** list ← / → keep collapsing / expanding folders (and ← to the parent), as in v29; the Log refs tree keeps its own ← / →.
3. With any modifier nothing new happens: Alt+← / → stays pane focus, Shift+← / → stays text selection.
4. ← / → no longer scroll a long line horizontally in the diff; Shift+wheel and the scrollbar still do. `[` `]`, F7 / Shift+F7 and J / K keep working.

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green).
- Keys are ignored while typing in inputs (existing guards in both handlers stay first).
- No new npm dependency.
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/diff.cjs`.
- Version: the last task bumps `apps/desktop/package.json` `version` one minor above what `master` has when this plan merges.

## Review Focus

1. **← / → on a folder row in the Changes tree list** → collapses / expands the folder; the selected file does not change. Pinned in Task 1 (E2E tree check).
2. **Alt+← / Alt+→** → pane focus as before, no file step. Pinned in Task 1 (`fileStepKey` modifier test).
3. **Focus after stepping from the diff** → the diff unmounts while the next file loads; focus stays in the Changes pane (not the list, not `body`), so the next ← / → still works. Pinned in Task 1 (E2E: → then ← from the diff).

---

### Task 1: Arrow keys step files in the Changes and Log diff views

**Files:**
- Modify: `apps/web/src/lib/changesView.ts` (add `fileStepKey`), `apps/web/src/components/workspace/ChangesPane.vue:247-257,346-390`, `apps/web/src/components/workspace/log/LogPane.vue:189-205,310-311`, `apps/web/src/i18n/workspace-diff.ts` (`keysHint`), `apps/web/src/i18n/workspace-log.ts` (`diff.keys`), `apps/desktop/e2e/diff.cjs`
- Test: `apps/web/src/lib/reviewTools.test.ts` (append)

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
    expect(fileStepKey(k('ArrowRight', { metaKey: true }))).toBe(0)
    expect(fileStepKey(k('ArrowDown'))).toBe(0)
  })
})
```

(Put the `import` at the top of the file with the others; if `describe` is not yet imported there, add it to the `vitest` import.)

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/reviewTools.test.ts` — Expected: FAIL (`fileStepKey` is not exported).

- [ ] **Step 3: Implement**

`apps/web/src/lib/changesView.ts`, next to `isShowDiffKey`:

```ts
/** ← / → without modifiers in a diff: previous / next file (Alt+← / → stays pane focus). */
export function fileStepKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 1 | -1 | 0 {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return 0
  return e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
}
```

`ChangesPane.vue` (import `fileStepKey` with the other `../../lib/changesView` imports):
- `stepFile` gains a focus flag:

```ts
function stepFile(dir: 1 | -1, land: 'first' | 'last' = 'first', focus = true): boolean {
  const list = ordered.value
  if (!list.length) return false
  const at = list.findIndex((e) => e.path === selected.value)
  const next = list[at + dir]
  if (!next) return false
  landAt = land
  revealInTree(next.path)
  select(next.path, focus)
  return true
}
```

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

`LogPane.vue` (import `fileStepKey` from `../../../lib/changesView`) — in `onKey`, before `else return`:

```ts
  else if (fileStepKey(e) && !(e.target as HTMLElement | null)?.closest('[role=tree]')) stepFile(fileStepKey(e) as 1 | -1)
```

and in the diff header (lines 310-311) the prev / next button titles: `([)` → `(←)`, `(])` → `(→)`.

i18n: `apps/web/src/i18n/workspace-diff.ts` en `keysHint: 'F7 changes · ← → files · F4 open'`, vi `keysHint: 'F7 thay đổi · ← → file · F4 mở'`; `apps/web/src/i18n/workspace-log.ts` en `keys: 'F7 changes · ← → files · Esc back'`, vi `keys: 'F7 thay đổi · ← → tệp · Esc quay lại'`.

- [ ] **Step 4: Run** `npm run typecheck && npm test -w @ccm/web` — Expected: clean; PASS.

- [ ] **Step 5: E2E** — in `apps/desktop/e2e/diff.cjs`, right after the check `'[ goes back a file'` (line 119), insert:

```js
  // ← / → step files from the diff; focus stays in the pane (not the list) so the next arrow works too.
  const selected = `[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].map((r) => r.textContent).join()`
  await evaluate(`document.querySelector('[data-kind=changes] .diff').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  await sleep(500)
  check('→ in the diff opens the next file', (await evaluate(selected)).includes('new.md'), await evaluate(selected))
  check('focus stays in the Changes pane, not the file list', await evaluate(`!!document.activeElement?.closest('[data-kind=changes]') && !document.activeElement.closest('[role=listbox], [role=tree]')`))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`)
  await sleep(500)
  check('← goes back to the previous file', (await evaluate(selected)).includes('a.ts'))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }))`)
  await sleep(300)
  check('Alt+→ does not step files', (await evaluate(selected)).includes('a.ts'))
```

and right after the check `'tree mode groups files by folder'` (line 137), insert:

```js
  // In the folder tree ← / → still fold folders and leave the selection alone.
  const before = await evaluate(selected)
  await evaluate(`document.querySelector('[data-kind=changes] [role=tree] [aria-expanded=true]').focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`)
  await sleep(200)
  check('← on a folder row collapses it, selection unchanged', (await evaluate(`document.activeElement?.getAttribute('aria-expanded') === 'false'`)) && (await evaluate(selected)) === before)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
```

(`selected` is declared in the first block; both blocks are inside `run()`. If `.diff` is not present at that point because the layout was switched earlier, use `[data-kind=changes] [role=document]`.)

- [ ] **Step 6: Verify** — `npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/diff.cjs && node apps/desktop/e2e/log.cjs` — Expected: all PASS (5 new checks in `diff.cjs`).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/changesView.ts apps/web/src/lib/reviewTools.test.ts apps/web/src/components/workspace/ChangesPane.vue apps/web/src/components/workspace/log/LogPane.vue apps/web/src/i18n/workspace-diff.ts apps/web/src/i18n/workspace-log.ts apps/desktop/e2e/diff.cjs
git commit -m "✨ Switch diff files with ← and →

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v34-diff-arrow-files.md`
- Modify: `.code_index/web.md`, `.code_index/_meta.md`, `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v34-diff-arrow-files.md` — 6–10 lines: Goal, `fileStepKey`, the 4 Rulings above, tests (`reviewTools.test.ts`, `e2e/diff.cjs`), link to this plan.
- [ ] **Step 2:** `.code_index/web.md` — in the v29 Changes pane line add: `←/→ = previous/next file (fileStepKey in lib/changesView.ts; tree list keeps ←/→ for folders; stepFile(dir, land, focus) keeps focus in the pane when stepping from the diff); LogPane diff mode too.` `_meta.md`: one line with the paths.
- [ ] **Step 3:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 4: Verify** — `npm run typecheck && npm test` — Expected: clean; PASS.
- [ ] **Step 5: Commit**

```bash
git add .planning/PLAN-v34-diff-arrow-files.md .code_index apps/desktop/package.json
git commit -m "📝 Diff arrow keys plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
