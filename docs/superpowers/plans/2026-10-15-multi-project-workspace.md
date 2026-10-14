# Multi-project Workspace (Agent rail · Spaces · Mission Control · Needs-you) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port SpaceVibe Deck's way of working on many projects at once into Agent Monitor's Workspace: a project › checkout › session rail, tabs fixed to a project with a project-scoped tab strip, a Mission Control overview of every pane in every project, and a needs-you list.

**Architecture:** Every surface is a pure projection over the existing `workspace` store + linked monitor sessions, built once in `lib/rail/railModel.ts` (`buildRail`) the way Deck builds everything from `buildAgentRail`. The strip scope, Mission Control shelf and needs-you list all read the same clusters, so they cannot disagree. The only new host fact is git's common dir (worktrees of one repo fold together); Mission Control snapshots are text read from the already-mounted xterm buffers, never reparented terminals.

**Tech Stack:** Vue 3 + Pinia + Tailwind v4 (apps/web), xterm 6, Electron main (apps/desktop), Vitest (happy-dom), CDP E2E scripts (`apps/desktop/e2e/*.cjs`).

**Spec:** Deck reference: `src/spacevibe-deck/docs/internals/agent-rail.md`, `mission-control.md`, `docs/DESIGN-LANGUAGE.md` §27/§35 and code `src/spacevibe-deck/src/ui/agent-rail-model.ts`, `agent-rail-card-model.ts`, `rail-order.ts`, `spaces/space-model.ts`, `spaces/space-order.ts`, `mission-control/*`, `attention-list-model.ts`, `repositories/repository-model.ts`. User rulings (2026-10-15) in **Rulings**.

## Context

Today the Workspace sidebar (`WorkspaceSidebar.vue`, `lib/sidebarRows.ts`) groups panes by git toplevel with one flat 34px row per pane; worktrees fold only by the `<repo>-wt/<branch>` folder-name regex; a tab has no project of its own (derived from the primary pane's `cwd`); the tab strip shows every tab of every project and Ctrl+Alt+1–9 / Ctrl+Tab count all of them; the "N need you" chip only jumps to the next pane. Running 2–4 Claude terminals on one project gives identical-looking rows. Deck solves the same problem with a rail tree, project-scoped spaces and Mission Control; this plan ports that model.

## Rulings (from the user)

1. Scope: all four parts — Agent rail, Spaces per project, Mission Control, Needs-you list. Each milestone ships on its own.
2. Row text: **session name only** (alias > Claude's own session name via `displayTitle`). No first prompt, no assistant sentence: the collector stores no message text and CLAUDE.md forbids exposing session contents. Line 2 is `Agent · <state word>`.
3. Tabs bind to a project **fixed for the tab's life** (Deck's `workspacePath`): `Tab.project`, set at creation, never re-derived from a `cd`.

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (`stores/workspace.test.ts` parity test); new strings go in a new `apps/web/src/i18n/workspace-rail.ts` exporting `{ en, vi }`, spread into `workspace` in `en.ts`/`vi.ts` like `workspace-log.ts`.
- All colours via theme tokens; status = icon + text + colour, never colour alone; status colours for lifecycle only (`.planning/COLOR-SYSTEM.md`). Badge `asked` = `st-waiting`, `failed` = `st-error`, `working` = `st-working`, `done` = `st-done`.
- No horizontal page scroll; long names truncate with a tooltip (`truncate` + `title`).
- Translucent material only on chrome (sidebar/rail, popovers). Mission Control's spread is a content surface: opaque `bg-page`.
- Reduced motion: zoom/fly animations skipped (`motionMs` / `reducedMotion` from `lib/motion.ts`).
- No new npm dependency (snapshots read the xterm buffer directly; `@xterm/addon-serialize` is not needed).
- New chords added to **both** `lib/workspaceKeys.ts` `workspaceAction` and `lib/shortcuts.ts` `workspaceShortcuts`, and mirrored in desktop `apps/desktop/src/preview/keys.ts` `workspaceChord` so they work inside webviews.
- Storage keys keep the `ccm.` prefix. New: `ccm.workspace.railOrder` (localStorage, ≤200 entries).
- Never display or persist prompts/output: snapshots live in memory only, are rebuilt on open, and are never sent over IPC or written to storage.
- Commits: gitmoji style (`✨`, `🐛`, `✅`, `📝`, `♻️`), ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm test -w @ccm/desktop -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop` first.

## Review Focus

1. **Folder outside any repo / Home pane (no cwd)** → a `plain:` cluster named after the folder / the "Home folder" cluster; never a crash or an empty header. Pinned in Task 3 (`buildRail` home + plain tests).
2. **Two tabs on the same folder, both silent Claude panes** → rows `Claude` and `Claude 2`, strip/Mission labels `app` and `app 2`. Pinned in Task 3 (ordinals) and Task 7 (`spaceIndexes`).
3. **Git lookup not answered yet (pane just spawned) then answering with a worktree** → the tab first sits in a provisional `plain:` cluster, then moves under the repo; a stored manual order written against the plain key still applies. Pinned in Task 4 (`applyOrder` aliases).
4. **Closing the last tab of the current project** → strip scope falls back to the newly active tab's project; Ctrl+Alt+1 never targets a tab that is not drawn. Pinned in Task 7 (`projectTabKeys` fallback).
5. **Mission Control opened while a pane has exited / never printed** → window shows an empty snapshot and the state word, Enter still focuses it; Esc returns focus to the opener. Pinned in Task 9 (`lastRows` empty) and Task 11 E2E.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/desktop/src/preview/changes.ts` | + `commonDir(dir)` (git common dir, absolute, realpath) |
| `apps/desktop/src/preview/ipc.ts` | `ccm:project-root` also returns `common` |
| `apps/web/src/lib/projects.ts` | `ProjectRootInfo.common?` parsed |
| `apps/web/src/lib/rail/repo.ts` (new) | pure: `mainCheckout(common)`, `repoFacts(top, repo, common)` |
| `apps/web/src/composables/useProjectRoots.ts` | keep commons; + `factsOf(dir): RepoFacts \| undefined` |
| `apps/web/src/stores/workspace.ts` | `Tab.project`, `tabProject()`, `cycleTab(step, scope?)` |
| `apps/web/src/lib/rail/railModel.ts` (new) | pure `buildRail`, `paneState`, `STATE_RANK`, types |
| `apps/web/src/lib/rail/railOrder.ts` (new) | pure `applyOrder`, `pinAt`, load/save order |
| `apps/web/src/lib/rail/avatars.ts` (new) | pure `avatarInitials` |
| `apps/web/src/lib/rail/spaces.ts` (new) | pure `railTabOrder`, `projectTabKeys`, `spaceIndexes`, `spaceLabel` |
| `apps/web/src/lib/rail/attentionList.ts` (new) | pure `buildAttentionList` |
| `apps/web/src/lib/rail/mission.ts` (new) | pure `missionShelf`, `flipTransform` |
| `apps/web/src/lib/paneSnapshots.ts` (new) | snapshot registry + pure `lastRows` |
| `apps/web/src/composables/useRail.ts` (new) | builds `RailInput` from stores, returns `clusters` computed |
| `apps/web/src/composables/useClusterDrag.ts` (new) | pointer drag of cluster headers |
| `apps/web/src/components/workspace/rail/RailClusterView.vue`, `RailRow.vue`, `RailColumn.vue` (new) | rail UI |
| `apps/web/src/components/workspace/WorkspaceSidebar.vue` | rewritten to host the rail |
| `apps/web/src/components/workspace/WorkspaceView.vue` | scoped strip, project capsule, mission + popover wiring |
| `apps/web/src/components/workspace/MissionControl.vue` (new) | overlay |
| `apps/web/src/components/workspace/AttentionPopover.vue` (new) | needs-you list |
| `apps/web/src/components/workspace/TermPane.vue` | registers its snapshot reader |
| `apps/web/src/lib/workspaceKeys.ts`, `lib/shortcuts.ts`, `apps/desktop/src/preview/keys.ts` | `mission` chord |
| `apps/web/src/i18n/workspace-rail.ts` (new), `en.ts`, `vi.ts` | strings |
| `apps/desktop/e2e/rail.cjs` (new) | E2E |
| `.code_index/web.md`, `desktop.md`, `_meta.md`, `docs/claude-code-integration.md` | docs |

Milestones: **M1 Rail** = Tasks 1–6 · **M2 Spaces** = Tasks 7–8 · **M3 Mission Control** = Tasks 9–11 · **M4 Needs-you** = Task 12 · **Wrap-up** = Task 13.

---

### Task 1: Git common dir from the host (worktrees fold by repo)

**Files:**
- Modify: `apps/desktop/src/preview/changes.ts` (after `toplevel`, ~line 208)
- Modify: `apps/desktop/src/preview/ipc.ts:439-449`
- Modify: `apps/web/src/lib/projects.ts:62-74`
- Create: `apps/web/src/lib/rail/repo.ts`
- Modify: `apps/web/src/composables/useProjectRoots.ts`
- Test: `apps/desktop/test/commonDir.test.ts` (new), `apps/web/src/lib/rail/rail.test.ts` (new)

**Interfaces:**
- Produces: `commonDir(dir: string): Promise<string | null>` (desktop); `ProjectRootInfo { root: string; repo: boolean; common?: string }`; `interface RepoFacts { key: string; top: string; main: string | null; repo: boolean }`; `mainCheckout(common: string): string | null`; `repoFacts(top: string, repo: boolean, common?: string): RepoFacts`; `useProjectRoots().factsOf(dir: string): RepoFacts | undefined`.

- [ ] **Step 1: Write the failing desktop test**

```ts
// apps/desktop/test/commonDir.test.ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { commonDir } from '../src/preview/changes'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
let hasGit = true
try { execFileSync('git', ['--version'], { stdio: 'pipe' }) } catch { hasGit = false }

describe.skipIf(!hasGit)('commonDir', () => {
  it('answers the same .git for the main checkout and its worktree', async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-common-')))
    const main = path.join(base, 'app')
    fs.mkdirSync(main)
    git(main, 'init', '-q')
    git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git(main, 'worktree', 'add', '-q', path.join(base, 'app-wt', 'feat'), '-b', 'feat')
    const a = await commonDir(main)
    const b = await commonDir(path.join(base, 'app-wt', 'feat'))
    expect(a).toBe(path.join(main, '.git'))
    expect(b).toBe(a)
    expect(await commonDir(base)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL** (`commonDir` is not exported)

Run: `npm test -w @ccm/desktop -- test/commonDir.test.ts`

- [ ] **Step 3: Implement `commonDir` and return it from `ccm:project-root`**

```ts
// apps/desktop/src/preview/changes.ts, after toplevel()
/** Shared `.git` of a checkout: the main checkout and every worktree of one repo answer the same path. */
export async function commonDir(dir: string): Promise<string | null> {
  const opts = { maxBytes: 16_384, timeoutMs: 10_000 }
  // `--path-format` needs git 2.31; older gits print a path relative to `dir`.
  let res = await execGit(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], opts)
  if (res.code !== 0) res = await execGit(dir, ['rev-parse', '--git-common-dir'], opts)
  const out = res.code === 0 ? res.stdout.trim() : ''
  return out ? realOrNull(path.resolve(dir, out)) : null
}
```

```ts
// apps/desktop/src/preview/ipc.ts — replace the repo branch of 'ccm:project-root'
    repos.set(rootKey(top.root), { root: top.root, from: ok.real })
    const common = await commonDir(top.root)
    return { root: top.root, repo: true, ...(common ? { common } : {}) }
```
(add `commonDir` to the existing import from `./changes`)

- [ ] **Step 4: Run it — expect PASS**; also `npm test -w @ccm/desktop -- test/tier2.test.ts` stays green.

- [ ] **Step 5: Write the failing web test for repo facts**

```ts
// apps/web/src/lib/rail/rail.test.ts
import { describe, expect, it } from 'vitest'
import { mainCheckout, repoFacts } from './repo'

describe('repo facts', () => {
  it('folds a worktree under the repo of its common dir', () => {
    expect(mainCheckout('C:\\work\\app\\.git')).toBe('C:\\work\\app')
    expect(mainCheckout('/srv/app.git')).toBeNull() // bare repo: no main checkout
    const main = repoFacts('C:\\work\\app', true, 'C:\\work\\app\\.git')
    const wt = repoFacts('C:\\work\\app-wt\\feat', true, 'C:\\work\\app\\.git')
    expect(wt.key).toBe(main.key)
    expect(wt.main).toBe('C:\\work\\app')
  })
  it('keys a non-repo folder as plain and a repo without common dir by its toplevel', () => {
    expect(repoFacts('D:\\notes', false).key).toBe('plain:d:\\notes')
    expect(repoFacts('D:\\lib', true)).toEqual({ key: 'repo:d:\\lib', top: 'D:\\lib', main: 'D:\\lib', repo: true })
  })
})
```

- [ ] **Step 6: Run — expect FAIL** (`npm test -w @ccm/web -- src/lib/rail/rail.test.ts`)

> Note for every test in this plan that spells a key like `plain:d:\\notes`: the suffix is whatever `dirKey` (`stores/favorites.ts`) returns for that path. Check its output once (`dirKey('D:\\notes')`) and, if it differs (e.g. forward slashes), adjust the expected strings — never change `dirKey`.

- [ ] **Step 7: Implement `lib/rail/repo.ts`, parse `common`, expose `factsOf`**

```ts
// apps/web/src/lib/rail/repo.ts
import { dirKey } from '../../stores/favorites'
import { folderName } from '../sidebarRows'

export interface RepoFacts {
  /** Cluster key: `repo:<common dir>` for git repos (worktrees share it), `plain:<folder>` otherwise. */
  key: string
  /** Checkout toplevel (or the folder itself when not a repo). */
  top: string
  /** Main checkout of the repo; null for a bare repo or a plain folder. */
  main: string | null
  repo: boolean
}

export function mainCheckout(common: string): string | null {
  if (folderName(common) !== '.git') return null
  const i = Math.max(common.lastIndexOf('/'), common.lastIndexOf('\\'))
  return i > 0 ? common.slice(0, i) : null
}

export function repoFacts(top: string, repo: boolean, common?: string): RepoFacts {
  if (!repo) return { key: `plain:${dirKey(top)}`, top, main: null, repo: false }
  if (!common) return { key: `repo:${dirKey(top)}`, top, main: top, repo: true }
  return { key: `repo:${dirKey(common)}`, top, main: mainCheckout(common), repo: true }
}
```

```ts
// apps/web/src/lib/projects.ts
export interface ProjectRootInfo {
  root: string
  /** False when the folder is not in a git repo (root = the folder itself). */
  repo: boolean
  /** Shared `.git` dir: equal for a repo's main checkout and all its worktrees. */
  common?: string
}
// in projectRootInfo():
  const { root, repo, common } = v as Partial<ProjectRootInfo>
  return typeof root === 'string' ? { root, repo: repo === true, common: typeof common === 'string' ? common : undefined } : null
```

```ts
// apps/web/src/composables/useProjectRoots.ts — additions
import { repoFacts, type RepoFacts } from '../lib/rail/repo'
/** dirKey(dir) -> facts, set together with `roots`. */
const facts = reactive(new Map<string, RepoFacts>())
// inside lookup(), where `info` is known:
        facts.set(key, repoFacts(info.root, info.repo, info.common))
// inside useProjectRoots():
  /** Repo facts of a folder once git answered; undefined while the lookup runs. */
  function factsOf(dir: string): RepoFacts | undefined {
    const known = facts.get(dirKey(dir))
    if (!known && !failed.has(dirKey(dir))) void lookup(dir)
    return known
  }
  return { rootOf, resolve, factsOf }
```

- [ ] **Step 8: Run web + desktop tests — expect PASS**; `npm run typecheck`.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/preview/changes.ts apps/desktop/src/preview/ipc.ts apps/desktop/test/commonDir.test.ts apps/web/src/lib/projects.ts apps/web/src/lib/rail/repo.ts apps/web/src/lib/rail/rail.test.ts apps/web/src/composables/useProjectRoots.ts
git commit -m "✨ Report git common dir so worktrees fold under their repo"
```

---

### Task 2: Tabs bind to a fixed project

**Files:**
- Modify: `apps/web/src/stores/workspace.ts` (Tab l.71-76, loadSaved l.222-233, placeNew l.327-334, open l.433-438, openLayout l.476-515, restoreLast l.523-533, cycleTab l.611-616)
- Test: `apps/web/src/stores/workspace.test.ts`

**Interfaces:**
- Produces: `Tab.project?: string`; `tabProject(tab: Tab, paneOf: (k: string) => Pane | undefined): string | undefined`; `openLayout(layout: Pick<SavedLayout, 'panes' | 'tabs'> & { project?: string }): number`; `cycleTab(step: number, scope?: readonly string[]): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/stores/workspace.test.ts — new describe
import { tabProject } from './workspace'

describe('tab project', () => {
  it('is the folder a tab was opened for and never follows a cd', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.update(a.key, { liveCwd: 'C:\\work\\other' })
    const b = ws.split(a.key, 'row')!
    const tab = ws.tabOf(b.key)!
    expect(tab.project).toBe('C:\\work\\app')
    expect(ws.tabs).toHaveLength(1)
  })
  it('new viewer and script tabs take their folder; layouts take the layout project', () => {
    const ws = useWorkspaceStore()
    const s = ws.runScript('C:\\work\\api', 'npm test')
    expect(ws.tabOf(s.key)!.project).toBe('C:\\work\\api')
    ws.openLayout({ project: 'C:\\work\\web', panes: { x: { kind: 'term', preset: 'shell', cwd: 'C:\\work\\web\\src' } }, tabs: [{ root: { pane: 'x' } }] })
    expect(ws.tabs.at(-1)!.project).toBe('C:\\work\\web')
  })
  it('falls back to the primary pane folder for tabs saved before v31', () => {
    const ws = useWorkspaceStore()
    const p = ws.open('shell', 'D:\\notes')
    const tab = { ...ws.tabOf(p.key)!, project: undefined }
    expect(tabProject(tab, (k) => ws.panes.find((x) => x.key === k))).toBe('D:\\notes')
  })
  it('cycles only inside the given scope', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\a')
    ws.open('claude', 'C:\\b')
    const c = ws.open('claude', 'C:\\a')
    const scope = [ws.tabOf(a.key)!.key, ws.tabOf(c.key)!.key]
    ws.cycleTab(1, scope)
    expect(ws.activeKey).toBe(a.key)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm test -w @ccm/web -- src/stores/workspace.test.ts`)

- [ ] **Step 3: Implement**

```ts
export interface Tab {
  key: string
  root: LayoutNode
  /** Pane that gets focus when the tab is selected. */
  focus: string
  /** Folder the tab was opened for (Deck's workspace): fixed for the tab's life, a `cd` never moves it. Missing = home. */
  project?: string
}

/** A tab's project; tabs saved before v31 fall back to their naming pane's starting folder. */
export function tabProject(tab: Tab, paneOf: (key: string) => Pick<Pane, 'kind' | 'cwd'> | undefined): string | undefined {
  return tab.project ?? paneOf(primaryPaneKey(tab.root, paneOf))?.cwd
}
```
- `loadSaved`: `tabs.push({ key: tab.key, root, focus: …, project: typeof tab.project === 'string' ? tab.project : undefined })`.
- `placeNew` (new-tab branch): `tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: pane.cwd })`.
- `open`: same `project: cwd`.
- `openLayout(layout: Pick<SavedLayout, 'panes' | 'tabs'> & { project?: string })`: `tabs.value.push({ key: newKey('t'), root: mapped, focus, project: layout.project ?? panes.value.find((p) => p.key === leaves(mapped)[0])?.cwd })`.
- `restoreLast`: `project: tab.project ?? snap.panes.find((p) => p.key === leaves(tab.root)[0])?.cwd`.
- `cycleTab`:

```ts
  /** Next / previous tab; `scope` (tab keys in display order) limits it to the tabs on screen. */
  function cycleTab(step: number, scope?: readonly string[]): void {
    const keys = scope?.length ? scope : tabs.value.map((t) => t.key)
    const n = keys.length
    if (!n) return
    const at = keys.indexOf(activeTab.value?.key ?? '')
    activateTab(keys[(((at < 0 ? 0 : at) + step) % n + n) % n]!)
  }
```

- [ ] **Step 4: Run — expect PASS**; existing `tier2.test.ts` and `workspace.test.ts` stay green.
- [ ] **Step 5: Update `WorkspaceView.vue` `paneProject` (l.233) to resolve through `tabProject(workspace.tabOf(key), …)` first, then the pane folder** — scripts/layouts/explorer root follow the tab's project. Run `npm run typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "✨ Bind each workspace tab to the project it was opened for"`

---

### Task 3: Rail model (pure)

**Files:**
- Create: `apps/web/src/lib/rail/railModel.ts`
- Test: `apps/web/src/lib/rail/rail.test.ts`

**Interfaces:**
- Consumes: `Tab`, `Pane`, `tabProject`, `isTerm`, `primaryPaneKey` (Task 2); `RepoFacts` (Task 1); `projectOf`, `folderName` (`lib/sidebarRows.ts`); `dirKey` (`stores/favorites`); `leaves` (`lib/splitLayout`).
- Produces:

```ts
export type RailState = 'failed' | 'asked' | 'ended' | 'working' | 'done' | 'starting' | 'idle'
export const STATE_RANK: Record<RailState, number>
export interface RailSession { status: TerminalStatus; title: string; branch?: string; since?: string }
export interface RailRow { key: string; paneKey: string; tabKey: string; kind: 'agent' | 'other'; preset: PtyPreset; agent: string; task: string | null; ordinal: string; state: RailState; since: number; focused: boolean; tabActive: boolean }
export interface RailCheckout { key: string; path: string | null; branch: string | null; tag: 'worktree' | 'folder' | null; primary: boolean; active: boolean; rows: RailRow[] }
export interface RailCluster { key: string; aliases: string[]; name: string; root: string | null; live: boolean; active: boolean; needs: number; failed: number; checkouts: RailCheckout[]; tabKeys: string[]; history: string[] }
export interface RailInput { tabs: readonly Tab[]; panes: readonly Pane[]; activeKey: string | null; sessionOf: (pane: Pane) => RailSession | undefined; factsOf: (dir: string) => RepoFacts | undefined; labelOf: (pane: Pane) => string; agentLabel: (preset: PtyPreset) => string; history: readonly string[]; order: readonly string[] }
export function paneState(pane: Pane, session: RailSession | undefined): RailState
export function buildRail(input: RailInput): RailCluster[]
export const needsUser: (s: RailState) => boolean
```

- [ ] **Step 1: Write the failing tests** (append to `rail.test.ts`)

```ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach } from 'vitest'
import { useWorkspaceStore, type Pane } from '../../stores/workspace'
import { buildRail, paneState, type RailInput, type RailSession } from './railModel'
import { repoFacts } from './repo'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  setActivePinia(createPinia())
})

const FACTS: Record<string, ReturnType<typeof repoFacts>> = {
  'C:\\work\\app': repoFacts('C:\\work\\app', true, 'C:\\work\\app\\.git'),
  'C:\\work\\app-wt\\feat': repoFacts('C:\\work\\app-wt\\feat', true, 'C:\\work\\app\\.git'),
  'D:\\notes': repoFacts('D:\\notes', false),
}
function input(over: Partial<RailInput> = {}): RailInput {
  const ws = useWorkspaceStore()
  return {
    tabs: ws.tabs, panes: ws.panes, activeKey: ws.activeKey,
    sessionOf: () => undefined, factsOf: (d) => FACTS[d],
    labelOf: (p) => p.command ?? 'Shell', agentLabel: (p) => ({ claude: 'Claude', codex: 'Codex', shell: 'Shell' })[p],
    history: [], order: [], ...over,
  }
}

describe('rail state', () => {
  const pane = (over: Partial<Pane>): Pane => ({ key: 'p', preset: 'claude', state: 'running', ...over })
  const s = (status: RailSession['status']): RailSession => ({ status, title: 'x' })
  it('reads latched attention and failures before live phase', () => {
    expect(paneState(pane({ state: 'error' }), s('working'))).toBe('failed')
    expect(paneState(pane({ attention: 'waiting' }), s('working'))).toBe('asked')
    expect(paneState(pane({}), s('waiting'))).toBe('asked')
    expect(paneState(pane({ state: 'exited' }), undefined)).toBe('ended')
    expect(paneState(pane({}), s('working'))).toBe('working')
    expect(paneState(pane({ attention: 'done' }), s('idle'))).toBe('done')
    expect(paneState(pane({ state: 'starting' }), undefined)).toBe('starting')
    expect(paneState(pane({}), undefined)).toBe('idle')
  })
})

describe('buildRail', () => {
  it('folds worktrees into one repo cluster with a checkout line each', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'C:\\work\\app-wt\\feat')
    ws.open('shell', 'D:\\notes')
    const rail = buildRail(input())
    expect(rail.map((c) => c.name)).toEqual(['app', 'notes'])
    expect(rail[0]!.checkouts.map((c) => [c.path, c.tag, c.primary])).toEqual([
      ['C:\\work\\app', null, true],
      ['C:\\work\\app-wt\\feat', 'worktree', false],
    ])
    expect(rail[1]!.checkouts[0]!.tag).toBe('folder')
  })
  it('gives two silent Claude panes of one checkout distinct ordinals', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.split(a.key, 'row')
    ws.open('claude', 'C:\\work\\app')
    const rows = buildRail(input())[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([[null, 'Claude'], [null, 'Claude 2'], [null, 'Claude 3']])
  })
  it('puts the ordinal behind a shared session name, never on the name', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'C:\\work\\app')
    const rows = buildRail(input({ sessionOf: () => ({ status: 'idle', title: 'Fix login' }) }))[0]!.checkouts[0]!.rows
    expect(rows.map((r) => [r.task, r.ordinal])).toEqual([['Fix login', 'Claude'], ['Fix login', 'Claude 2']])
  })
  it('shows a tab without agents as one row and a home tab under the home cluster', () => {
    const ws = useWorkspaceStore()
    ws.runScript('D:\\notes', 'npm test')
    ws.open('shell')
    const rail = buildRail(input())
    expect(rail.map((c) => [c.key, c.root])).toEqual([['plain:d:\\notes', 'D:\\notes'], ['home', null]])
    expect(rail[0]!.checkouts[0]!.rows[0]!).toMatchObject({ kind: 'other', agent: 'npm test' })
  })
  it('counts who needs you and marks exactly one focused row', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    const b = ws.open('claude', 'C:\\work\\app')
    ws.update(a.key, { attention: 'waiting' })
    const rail = buildRail(input())
    expect(rail[0]!.needs).toBe(1)
    expect(rail.flatMap((c) => c.checkouts.flatMap((k) => k.rows)).filter((r) => r.focused).map((r) => r.paneKey)).toEqual([b.key])
  })
  it('keeps remembered projects as rowless clusters after the live ones', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    const rail = buildRail(input({ history: ['C:\\work\\app-wt\\feat', 'D:\\notes'] }))
    expect(rail.map((c) => [c.name, c.live])).toEqual([['app', true], ['notes', false]])
  })
  it('groups a tab whose git lookup is pending under a provisional plain key', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'E:\\fresh')
    const rail = buildRail(input())
    expect(rail[0]!.key).toBe('plain:e:\\fresh')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `railModel.ts`**

```ts
import type { PtyPreset, TerminalStatus } from '@ccm/shared'
import { dirKey } from '../../stores/favorites'
import { isTerm, primaryPaneKey, tabProject, type Pane, type Tab } from '../../stores/workspace'
import { folderName, projectOf } from '../sidebarRows'
import { leaves } from '../splitLayout'
import type { RepoFacts } from './repo'

export type RailState = 'failed' | 'asked' | 'ended' | 'working' | 'done' | 'starting' | 'idle'
export const STATE_RANK: Record<RailState, number> = { failed: 6, asked: 5, ended: 4, working: 3, done: 2, starting: 1, idle: 0 }
export const needsUser = (s: RailState): boolean => s === 'asked' || s === 'failed'

export interface RailSession {
  status: TerminalStatus
  /** `displayTitle`: alias, else Claude's own session name. Never prompt text. */
  title: string
  branch?: string
  /** ISO time of the last status change. */
  since?: string
}

export interface RailRow {
  /** Pane key for agent rows, `tab:<key>` for a tab without agents. */
  key: string
  paneKey: string
  tabKey: string
  kind: 'agent' | 'other'
  preset: PtyPreset
  /** Agent product name, or the row label for `other` rows. */
  agent: string
  task: string | null
  /** Agent name made unique within the checkout: `Claude`, `Claude 2`. */
  ordinal: string
  state: RailState
  since: number
  focused: boolean
  tabActive: boolean
}

export interface RailCheckout { key: string; path: string | null; branch: string | null; tag: 'worktree' | 'folder' | null; primary: boolean; active: boolean; rows: RailRow[] }

export interface RailCluster {
  /** Order key: `repo:<common dir>`, `plain:<folder>` or `home`. */
  key: string
  /** Other keys this cluster answered to (provisional plain keys): stored order matches them too. */
  aliases: string[]
  name: string
  root: string | null
  live: boolean
  active: boolean
  needs: number
  failed: number
  checkouts: RailCheckout[]
  /** Tab keys in open order. */
  tabKeys: string[]
  /** Remembered folders this cluster covers (✕ forgets them). */
  history: string[]
}

export interface RailInput {
  tabs: readonly Tab[]
  panes: readonly Pane[]
  activeKey: string | null
  sessionOf: (pane: Pane) => RailSession | undefined
  factsOf: (dir: string) => RepoFacts | undefined
  labelOf: (pane: Pane) => string
  agentLabel: (preset: PtyPreset) => string
  history: readonly string[]
  order: readonly string[]
}

export function paneState(pane: Pane, session: RailSession | undefined): RailState {
  if (pane.state === 'starting') return 'starting'
  if (pane.state === 'error' || pane.state === 'gone' || session?.status === 'error') return 'failed'
  if (pane.attention === 'waiting' || session?.status === 'waiting') return 'asked'
  if (pane.state === 'exited') return 'ended'
  if (session?.status === 'working') return 'working'
  if (pane.attention === 'done') return 'done'
  return 'idle'
}

const time = (iso: string | undefined, fallback = 0): number => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : fallback
}

interface Place { clusterKey: string; alias: string | null; name: string; root: string | null; checkout: string | null; facts: RepoFacts | undefined }

function placeOf(dir: string | undefined, factsOf: RailInput['factsOf']): Place {
  if (!dir) return { clusterKey: 'home', alias: null, name: '', root: null, checkout: null, facts: undefined }
  const facts = factsOf(dir)
  // Until git answers, fold by the `<repo>-wt/<branch>` naming so a new worktree tab does not flash as its own project.
  const provisional = projectOf(dir) ?? dir
  const alias = `plain:${dirKey(provisional)}`
  if (!facts) return { clusterKey: alias, alias: null, name: folderName(provisional), root: provisional, checkout: dir, facts }
  const root = facts.main ?? facts.top
  return { clusterKey: facts.key, alias, name: folderName(root), root, checkout: facts.top, facts }
}

export function buildRail(input: RailInput): RailCluster[] {
  const byKey = new Map(input.panes.map((p) => [p.key, p]))
  const paneOf = (k: string): Pane | undefined => byKey.get(k)
  const activeTab = input.activeKey ? input.tabs.find((t) => leaves(t.root).includes(input.activeKey!)) : undefined
  const clusters = new Map<string, RailCluster>()
  const taken = new Map<string, Set<string>>() // checkout key -> claimed labels

  for (const tab of input.tabs) {
    const place = placeOf(tabProject(tab, paneOf), input.factsOf)
    let cluster = clusters.get(place.clusterKey)
    if (!cluster) {
      cluster = { key: place.clusterKey, aliases: [], name: place.name, root: place.root, live: true, active: false, needs: 0, failed: 0, checkouts: [], tabKeys: [], history: [] }
      clusters.set(place.clusterKey, cluster)
    }
    if (place.alias && !cluster.aliases.includes(place.alias)) cluster.aliases.push(place.alias)
    cluster.tabKeys.push(tab.key)
    const coKey = place.checkout ? dirKey(place.checkout) : 'home'
    let checkout = cluster.checkouts.find((c) => c.key === coKey)
    if (!checkout) {
      const f = place.facts
      const tag = !place.checkout ? null : !f ? null : !f.repo ? 'folder' : f.main && dirKey(f.main) !== dirKey(f.top) ? 'worktree' : null
      checkout = { key: coKey, path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [] }
      cluster.checkouts.push(checkout)
    }
    const tabActive = tab === activeTab
    if (tabActive) cluster.active = checkout.active = true
    const claimed = taken.get(coKey) ?? new Set<string>()
    taken.set(coKey, claimed)
    const claim = (prefix: string, base: string): string => {
      let w = base
      for (let n = 2; claimed.has(prefix + w); n++) w = `${base} ${n}`
      claimed.add(prefix + w)
      return w
    }
    const agents = leaves(tab.root).map(paneOf).filter((p): p is Pane => !!p && isTerm(p) && p.preset !== 'shell')
    for (const pane of agents) {
      const session = input.sessionOf(pane)
      checkout.branch ??= session?.branch ?? pane.branch ?? null
      const agent = input.agentLabel(pane.preset)
      const task = session?.title || null
      checkout.rows.push({
        key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'agent', preset: pane.preset, agent, task,
        ordinal: claim(task ? `${task} · ` : '', agent), state: paneState(pane, session),
        since: time(session?.since, pane.focusedAt ?? 0), focused: tabActive && pane.key === input.activeKey, tabActive,
      })
    }
    if (!agents.length) {
      const primary = paneOf(primaryPaneKey(tab.root, paneOf))!
      checkout.branch ??= primary.branch ?? null
      const label = input.labelOf(primary)
      checkout.rows.push({
        key: `tab:${tab.key}`, paneKey: tab.focus, tabKey: tab.key, kind: 'other', preset: primary.preset, agent: label, task: null,
        ordinal: label, state: isTerm(primary) ? paneState(primary, undefined) : 'idle', since: primary.focusedAt ?? 0, focused: tabActive, tabActive,
      })
    }
  }

  const live = [...clusters.values()]
  for (const c of live) {
    c.checkouts.sort((a, b) => Number(b.primary) - Number(a.primary)) // stable: open order within each tier
    const rows = c.checkouts.flatMap((k) => k.rows)
    c.needs = rows.filter((r) => needsUser(r.state)).length
    c.failed = rows.filter((r) => r.state === 'failed').length
  }

  // Remembered projects: opened before, nothing open now. Folded per repo; dropped when a live cluster already draws them.
  const remembered = new Map<string, RailCluster>()
  for (const dir of input.history) {
    const place = placeOf(dir, input.factsOf)
    const owner = live.find((c) => c.key === place.clusterKey || (place.alias && c.aliases.includes(place.alias)))
    if (owner) {
      owner.history.push(dir)
      continue
    }
    const r = remembered.get(place.clusterKey) ?? { key: place.clusterKey, aliases: place.alias ? [place.alias] : [], name: place.name, root: place.root, live: false, active: false, needs: 0, failed: 0, checkouts: [], tabKeys: [], history: [] }
    r.history.push(dir)
    if (place.checkout && !r.checkouts.some((k) => k.key === dirKey(place.checkout!))) {
      const tag = place.facts && !place.facts.repo ? 'folder' : place.facts?.main && dirKey(place.facts.main) !== dirKey(place.facts.top) ? 'worktree' : null
      r.checkouts.push({ key: dirKey(place.checkout), path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [] })
    }
    remembered.set(place.clusterKey, r)
  }
  return applyOrder([...live, ...remembered.values()], input.order)
}
```
(Import `applyOrder` from `./railOrder` — Task 4. Until Task 4 lands, write `applyOrder` in Task 4's file first; the two tasks commit together if executed in order — see Task 4 Step 1.)

- [ ] **Step 4: Run — expect PASS** (after Task 4 Step 3 exists; do Task 4 Steps 1–3 before running if `railOrder.ts` is missing)
- [ ] **Step 5: Commit** — `git commit -m "✨ Add the project › checkout › session rail model"`

---

### Task 4: Manual cluster order

**Files:**
- Create: `apps/web/src/lib/rail/railOrder.ts`
- Test: `apps/web/src/lib/rail/rail.test.ts`

**Interfaces:**
- Produces: `MAX_RAIL_ORDER = 200`; `applyOrder<T extends { key: string; aliases: readonly string[] }>(clusters: readonly T[], order: readonly string[]): T[]`; `pinAt(clusters: readonly { key: string }[], from: number, to: number, order: readonly string[]): string[] | null`; `loadRailOrder(): string[]`; `saveRailOrder(order: readonly string[]): void` (localStorage `ccm.workspace.railOrder`).

- [ ] **Step 1: Write the failing tests**

```ts
import { applyOrder, MAX_RAIL_ORDER, pinAt } from './railOrder'

describe('rail order', () => {
  const c = (key: string, aliases: string[] = []) => ({ key, aliases })
  it('puts pinned clusters first, matching provisional plain keys too', () => {
    const list = [c('repo:a'), c('repo:b', ['plain:b']), c('plain:c')]
    expect(applyOrder(list, ['plain:b']).map((x) => x.key)).toEqual(['repo:b', 'repo:a', 'plain:c'])
    expect(applyOrder(list, [])).toEqual(list)
  })
  it('pins every cluster above the drop slot', () => {
    expect(pinAt([c('a'), c('b'), c('c')], 2, 0, [])).toEqual(['c'])
    expect(pinAt([c('a'), c('b'), c('c')], 0, 2, ['x'])).toEqual(['b', 'c', 'a', 'x'])
    expect(pinAt([c('a'), c('b')], 1, 1, [])).toBeNull()
    expect(pinAt([c('a'), c('a')], 0, 1, [])).toBeNull()
  })
  it('caps the stored order, dropping keys no longer on screen first', () => {
    const old = Array.from({ length: MAX_RAIL_ORDER }, (_, i) => `gone${i}`)
    const next = pinAt([c('a'), c('b')], 1, 0, old)!
    expect(next).toHaveLength(MAX_RAIL_ORDER)
    expect(next[0]).toBe('b')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/rail/railOrder.ts
export const MAX_RAIL_ORDER = 200
const KEY = 'ccm.workspace.railOrder'

/** Stored keys first in stored order (first match wins), everything else keeps today's order. */
export function applyOrder<T extends { key: string; aliases: readonly string[] }>(clusters: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return clusters as T[]
  const used = new Set<T>()
  const pinned: T[] = []
  for (const entry of order) {
    const hit = clusters.find((x) => !used.has(x) && (x.key === entry || x.aliases.includes(entry)))
    if (hit) {
      used.add(hit)
      pinned.push(hit)
    }
  }
  return [...pinned, ...clusters.filter((x) => !used.has(x))]
}

/** Drop of `from` at `to`: pins every cluster above and at the slot, so the next one opening cannot push it. */
export function pinAt(clusters: readonly { key: string }[], from: number, to: number, order: readonly string[]): string[] | null {
  const n = clusters.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null
  const keys = clusters.map((x) => x.key)
  if (new Set(keys).size !== n) return null
  const moved = [...keys]
  moved.splice(to, 0, moved.splice(from, 1)[0]!)
  const prefix = moved.slice(0, to + 1)
  const next = [...prefix, ...order.filter((o) => !prefix.includes(o))]
  if (next.length <= MAX_RAIL_ORDER) return next
  const shown = new Set(keys)
  for (let i = next.length - 1; i >= 0 && next.length > MAX_RAIL_ORDER; i--) if (!shown.has(next[i]!)) next.splice(i, 1)
  return next.slice(0, MAX_RAIL_ORDER)
}

export function loadRailOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string').slice(0, MAX_RAIL_ORDER) : []
  } catch {
    return []
  }
}

export function saveRailOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order))
  } catch {
    // storage blocked: the order is not remembered
  }
}
```

- [ ] **Step 4: Run all `rail.test.ts` — expect PASS** (Task 3 + 4 together)
- [ ] **Step 5: Commit** — `git commit -m "✨ Keep a manual project order for the rail"`

---

### Task 5: Rail UI replaces the Projects sidebar

**Files:**
- Create: `apps/web/src/composables/useRail.ts`, `apps/web/src/components/workspace/rail/RailClusterView.vue`, `RailRow.vue`, `apps/web/src/composables/useClusterDrag.ts`, `apps/web/src/i18n/workspace-rail.ts`
- Modify: `apps/web/src/components/workspace/WorkspaceSidebar.vue` (rewrite body; keep emits `scripts`/`saveLayout`/`manageLayouts`/`openLayout`, add `close(keys: string[])`), `apps/web/src/components/workspace/WorkspaceView.vue` (handle `close` via the existing `closePanes`), `apps/web/src/i18n/en.ts`, `vi.ts`
- Test: `apps/web/src/lib/rail/rail.test.ts` (row text), `apps/web/src/stores/workspace.test.ts` (i18n parity runs automatically)

**Interfaces:**
- Consumes: `buildRail`, `RailCluster`, `RailRow`, `needsUser` (Task 3); `applyOrder`, `pinAt`, `loadRailOrder`, `saveRailOrder` (Task 4); `useProjectRoots().factsOf` (Task 1); `usePaneInfo().sessionOf/labelOf/isBusy`; `displayTitle` (`lib/title.ts`); `waitDisplay` (`lib/wait.ts`).
- Produces: `useRail(): { clusters: ComputedRef<RailCluster[]>; order: Ref<string[]>; move(from: number, to: number): void }` (module-level singleton state so sidebar, strip, Mission Control and popover share one projection); `rowLines(row: RailRow, word: string): { first: string; second: string }`.

- [ ] **Step 1: Failing test for row text**

```ts
import { rowLines } from './railModel'
describe('row lines', () => {
  const base = { kind: 'agent' as const, agent: 'Claude' }
  it('silent unnamed rows carry the ordinal on line 1, named rows on line 2', () => {
    expect(rowLines({ ...base, task: null, ordinal: 'Claude 2' }, 'Ready')).toEqual({ first: 'Claude 2', second: 'Claude · Ready' })
    expect(rowLines({ ...base, task: 'Fix login', ordinal: 'Claude 2' }, 'Working')).toEqual({ first: 'Fix login', second: 'Claude 2 · Working' })
    expect(rowLines({ ...base, kind: 'other', agent: 'npm test', task: null, ordinal: 'npm test' }, 'Running')).toEqual({ first: 'npm test', second: 'Running' })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Add to `railModel.ts`**

```ts
/** Visible lines of a row; `word` is the translated state word (or wait label). */
export function rowLines(row: Pick<RailRow, 'kind' | 'agent' | 'task' | 'ordinal'>, word: string): { first: string; second: string } {
  if (row.kind === 'other') return { first: row.agent, second: word }
  return row.task === null ? { first: row.ordinal, second: `${row.agent} · ${word}` } : { first: row.task, second: `${row.ordinal} · ${word}` }
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: i18n** — `apps/web/src/i18n/workspace-rail.ts`:

```ts
export const en = {
  rail: {
    title: 'Projects',
    state: { failed: 'Failed', asked: 'Needs you', ended: 'Ended', working: 'Working', done: 'Finished', starting: 'Starting…', idle: 'Ready' },
    needs: '{n} needs you | {n} need you',
    worktree: 'worktree',
    folder: 'folder',
    closeRow: 'Close {name}',
    closeProject: 'Close every tab of {name}',
    forget: 'Remove {name} from the list',
    moveHint: 'Drag to reorder, or Alt+↑ / Alt+↓',
    moved: '{name} moved to position {n}',
    newIn: 'New tab in {name}',
    column: 'Projects (collapsed)',
    rowLabel: '{first}, {second}',
  },
}
export const vi: typeof en = {
  rail: {
    title: 'Dự án',
    state: { failed: 'Lỗi', asked: 'Cần bạn', ended: 'Đã kết thúc', working: 'Đang chạy', done: 'Đã xong', starting: 'Đang khởi động…', idle: 'Sẵn sàng' },
    needs: '{n} cần bạn | {n} cần bạn',
    worktree: 'worktree',
    folder: 'thư mục',
    closeRow: 'Đóng {name}',
    closeProject: 'Đóng mọi tab của {name}',
    forget: 'Bỏ {name} khỏi danh sách',
    moveHint: 'Kéo để sắp xếp, hoặc Alt+↑ / Alt+↓',
    moved: 'Đã chuyển {name} tới vị trí {n}',
    newIn: 'Tab mới trong {name}',
    column: 'Dự án (thu gọn)',
    rowLabel: '{first}, {second}',
  },
}
```
Spread `...rail.en` / `...rail.vi` into `workspace` in `en.ts` / `vi.ts` next to `workspace-log`.

- [ ] **Step 6: `useRail.ts`**

```ts
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildRail, type RailSession } from '../lib/rail/railModel'
import { loadRailOrder, pinAt, saveRailOrder } from '../lib/rail/railOrder'
import { displayTitle } from '../lib/title'
import { useWorkspaceStore, type Pane } from '../stores/workspace'
import { usePaneInfo } from './usePaneInfo'
import { useProjectRoots } from './useProjectRoots'

const order = ref<string[]>(loadRailOrder())

/** One projection for the rail, the strip scope, Mission Control and the needs-you list. */
export function useRail() {
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const info = usePaneInfo()
  const { factsOf } = useProjectRoots()

  const sessionOf = (pane: Pane): RailSession | undefined => {
    const s = info.sessionOf(pane)
    return s ? { status: s.status, title: displayTitle(s), branch: s.gitBranch ?? undefined, since: s.statusSince ?? undefined } : undefined
  }
  const clusters = computed(() =>
    buildRail({
      tabs: workspace.tabs, panes: workspace.panes, activeKey: workspace.activeKey,
      sessionOf, factsOf, labelOf: info.labelOf,
      agentLabel: (p) => (p === 'shell' ? t('workspace.preset.shell') : t(`provider.${p}`)),
      history: workspace.recentDirs, order: order.value,
    }),
  )
  function move(from: number, to: number): void {
    const next = pinAt(clusters.value, from, to, order.value)
    if (!next) return
    order.value = next
    saveRailOrder(next)
  }
  return { clusters, order, move }
}
```
(Confirm `usePaneInfo().labelOf` signature takes a `Pane` and `provider.claude|codex` keys exist in `en.ts` l.272; if `labelOf` needs `t`, keep it injected the same way.)

- [ ] **Step 7: `RailRow.vue`** — two-line row, 40px min, grid `16px | 1fr | 16px`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { rowLines, type RailRow } from '../../../lib/rail/railModel'
import PresetIcon from '../PresetIcon.vue'
import StatusIcon from '../../StatusIcon.vue'

const props = defineProps<{ row: RailRow; waitLabel?: string }>()
const emit = defineEmits<{ focus: [paneKey: string]; close: [row: RailRow] }>()
const { t } = useI18n()
const word = computed(() => props.waitLabel ?? t(`workspace.rail.state.${props.row.state}`))
const lines = computed(() => rowLines(props.row, word.value))
// StatusIcon statuses: failed→error, asked→waiting, working→working, done/ended→completed; idle/starting draw no badge.
const BADGE: Partial<Record<RailRow['state'], string>> = { failed: 'error', asked: 'waiting', working: 'working', done: 'completed', ended: 'completed' }
</script>

<template>
  <div class="group relative grid min-h-10 grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-x-2.5 rounded-control py-1 ps-6 pe-1.5 hover:bg-fill"
       :class="row.focused ? 'bg-accent-soft text-accent-ink' : ''">
    <button type="button" data-side-item data-side-row :data-side-pane="row.paneKey" class="absolute inset-0 rounded-control"
            :aria-current="row.focused || undefined" :aria-label="t('workspace.rail.rowLabel', lines)" :title="`${lines.first}\n${lines.second}`"
            @click="emit('focus', row.paneKey)" />
    <span class="pointer-events-none relative size-4">
      <PresetIcon :preset="row.preset" :size="16" />
      <StatusIcon v-if="BADGE[row.state]" :status="BADGE[row.state]!" :size="9" class="absolute -bottom-1 -left-1 rounded-full bg-material ring-2 ring-material" />
    </span>
    <span class="pointer-events-none min-w-0">
      <span class="block truncate text-sm" :class="row.focused ? 'font-medium' : ''">{{ lines.first }}</span>
      <span class="block truncate text-xs text-ink-muted">{{ lines.second }}</span>
    </span>
    <button type="button" class="relative z-10 grid size-4 place-items-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('workspace.rail.closeRow', { name: lines.first })" @click.stop="emit('close', row)">
      <X :size="12" aria-hidden="true" />
    </button>
  </div>
</template>
```
(Check real prop names of `PresetIcon`/`StatusIcon` and the material/ring tokens in `style.css` before writing; reuse the existing row tokens from the current `WorkspaceSidebar.vue` rows.)

- [ ] **Step 8: `RailClusterView.vue`** — header `h3 > button[data-side-item][data-side-head][data-order-key]` (chevron, Folder/FolderOpen, name, needs count `t('workspace.rail.needs', { n }, n)` coloured `text-st-error` when `failed > 0` else `text-st-waiting` with `BellRing` icon), hover `+` (`SplitMenu` → `pickNew(choice, root)` — move today's `pickNew` from `WorkspaceSidebar.vue`), `…` (`ProjectMenu`, add item "Close project" → emit `close(all pane keys of cluster tabs)` then `workspace.forget` each `cluster.history`), ✕ on remembered clusters → `workspace.forget(dir)` for each `cluster.history` entry. Body (when expanded): per checkout a label line `button[data-side-item][data-side-checkout]` (GitBranch + branch, or Folder + folder name; tag chip `worktree`/`folder` in `text-ink-faint text-2xs`); click focuses the checkout's focused row, else its first row, else `workspace.open(workspace.preset, checkout.path)`; then `RailRow` per row. Agent row ✕ → emit `close([row.paneKey])`; `other` row ✕ → emit `close(leaves of tab)`. `waitLabel` for `asked` rows = `waitDisplay(session)` (existing `lib/wait.ts`).
- [ ] **Step 9: `useClusterDrag.ts`** — delegated pointer controller on the list element:

```ts
import { onBeforeUnmount, type Ref } from 'vue'

const THRESHOLD = 5

/** Drag a cluster by its header; `onDrop(from, to)` gets indexes in the rendered order. Esc cancels. */
export function useClusterDrag(list: Ref<HTMLElement | null>, onDrop: (from: number, to: number) => void) {
  let start: { x: number; y: number; from: number; id: number } | null = null
  let dragging = false
  let line: HTMLDivElement | null = null
  let slot = -1
  const heads = (): HTMLElement[] => [...(list.value?.querySelectorAll<HTMLElement>('[data-side-head]') ?? [])]

  function onDown(e: PointerEvent): void {
    const head = (e.target as HTMLElement).closest<HTMLElement>('[data-side-head]')
    if (!head || e.button !== 0 || (e.target as HTMLElement).closest('[data-no-drag]')) return
    start = { x: e.clientX, y: e.clientY, from: heads().indexOf(head), id: e.pointerId }
  }
  function onMove(e: PointerEvent): void {
    if (!start || e.pointerId !== start.id) return
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return
    if (!dragging) {
      dragging = true
      line = document.createElement('div')
      line.className = 'pointer-events-none fixed z-50 h-0.5 rounded bg-line-strong'
      document.body.append(line)
    }
    const sections = heads().map((h) => h.closest('section')!.getBoundingClientRect())
    slot = sections.findIndex((r) => e.clientY < r.top + r.height / 2)
    if (slot < 0) slot = sections.length
    const edge = slot < sections.length ? sections[slot]!.top - 6 : sections.at(-1)!.bottom + 6
    const box = list.value!.getBoundingClientRect()
    Object.assign(line!.style, { top: `${edge}px`, left: `${box.left + 8}px`, width: `${box.width - 16}px` })
  }
  function finish(commit: boolean): void {
    if (dragging && commit && start) {
      const to = slot > start.from ? slot - 1 : slot
      if (to !== start.from) onDrop(start.from, to)
      // The pointerup becomes a click on the header: swallow that one.
      window.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true })
    }
    line?.remove()
    line = null
    start = null
    dragging = false
  }
  const onUp = (): void => finish(true)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dragging) finish(false)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey, true)
  onBeforeUnmount(() => {
    finish(false)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey, true)
  })
  return { onDown }
}
```
Keyboard equivalent in the sidebar's existing `onKey`: Alt+↑ / Alt+↓ on a focused `[data-side-head]` calls `move(i, i ∓ 1)`, refocuses the header after `nextTick`, and announces `t('workspace.rail.moved', { name, n })` in an sr-only `aria-live="polite"` span.

- [ ] **Step 10: Rewrite `WorkspaceSidebar.vue`** — keep its tablist/aside shell, collapse persistence (`ccm.workspace.sideCollapsed`, now keyed by `cluster.key`), keyboard nav over `[data-side-item]` (now headers, checkout lines, rows), and `ProjectMenu`/`SplitMenu`; replace `sideGroups(...)` with `useRail().clusters` and render `RailClusterView` in a `TransitionGroup ccm-list` with `@pointerdown="drag.onDown"`. Keep `data-tour="ws-sidebar"` on the aside. `sideGroups` stays in `lib/sidebarRows.ts` until Task 13 (unused code removed there).
- [ ] **Step 11: Wire `close` in `WorkspaceView.vue`** — `@close="(keys) => closePanes(keys)"` (the existing busy-confirm path).
- [ ] **Step 12: Verify** — `npm test -w @ccm/web`, `npm run typecheck`, then `npm run desktop:dev`: open 3 Claude tabs on one repo + 1 worktree tab + 1 plain folder; check rows `Claude`/`Claude 2`/`Claude 3`, the worktree line, a waiting session's header count, drag + Alt+↑ reorder survives a reload, ✕ on a remembered project forgets it.
- [ ] **Step 13: Commit** — `git commit -m "✨ Replace the Projects sidebar with the project › checkout › session rail"`

---

### Task 6: Collapsed rail column

**Files:**
- Create: `apps/web/src/lib/rail/avatars.ts`, `apps/web/src/components/workspace/rail/RailColumn.vue`
- Modify: `WorkspaceView.vue` (sidebar toggle l.~840: closed state renders `RailColumn` instead of nothing), `WorkspaceSidebar.vue`
- Test: `rail.test.ts`

**Interfaces:**
- Produces: `avatarInitials(name: string): string`.

- [ ] **Step 1: Failing test**

```ts
import { avatarInitials } from './avatars'
it('takes two letters of the last word of a project name', () => {
  expect(avatarInitials('spacevibe-deck')).toBe('De')
  expect(avatarInitials('Claude-Code-Monitor')).toBe('Mo')
  expect(avatarInitials('app2')).toBe('Ap')
  expect(avatarInitials('---')).toBe('?')
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
export function avatarInitials(name: string): string {
  const word = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop()
  if (!word) return '?'
  return word[0]!.toUpperCase() + (word[1] ?? '').toLowerCase()
}
```
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: `RailColumn.vue`** — `nav[aria-label=t('workspace.rail.column')]`, 52px wide `ccm-material`, one `button` per live cluster (initials 28px rounded tile, `ring-focus` when `active`, needs badge with count + `BellRing`, `aria-label` = name + needs text); click opens a teleported `ccm-menu` flyout rendering that cluster's `RailClusterView` (closes on choose/Esc/outside click, like `ProjectMenu`). Sidebar toggle now flips between full rail and column (`ccm.workspace.sidebar` `'0'` = column).
- [ ] **Step 6: Verify in `npm run desktop:dev`**; `npm run typecheck`.
- [ ] **Step 7: Commit** — `git commit -m "✨ Collapse the rail to a column of project avatars"`

---

### Task 7: Spaces — project-scoped strip and keys (pure)

**Files:**
- Create: `apps/web/src/lib/rail/spaces.ts`
- Test: `rail.test.ts`

**Interfaces:**
- Consumes: `RailCluster` (Task 3), `Tab`, `tabProject` (Task 2).
- Produces: `railTabOrder(clusters: readonly RailCluster[]): string[]`; `projectTabKeys(clusters: readonly RailCluster[], activeTabKey: string | null): string[]`; `spaceIndexes(tabs: readonly Tab[], projectOf: (t: Tab) => string | undefined): Map<string, number | null>`; `spaceLabel(folder: string, index: number | null): string`.

- [ ] **Step 1: Failing tests**

```ts
import { projectTabKeys, railTabOrder, spaceIndexes, spaceLabel } from './spaces'
describe('spaces', () => {
  it('scopes the strip to the active tab project, in rail order', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    const c = ws.open('claude', 'C:\\work\\app-wt\\feat')
    const rail = buildRail(input())
    const keyOf = (k: string) => ws.tabOf(k)!.key
    expect(projectTabKeys(rail, keyOf(c.key))).toEqual([keyOf(a.key), keyOf(c.key)])
    expect(railTabOrder(rail)).toHaveLength(3)
  })
  it('falls back to every tab when the active tab is unknown', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    expect(projectTabKeys(buildRail(input()), null)).toHaveLength(2)
  })
  it('numbers tabs sharing one folder and leaves single tabs bare', () => {
    const ws = useWorkspaceStore()
    ws.open('claude', 'C:\\work\\app')
    ws.open('claude', 'c:/work/app/')
    ws.open('shell', 'D:\\notes')
    const idx = spaceIndexes(ws.tabs, (t) => t.project)
    expect([...idx.values()]).toEqual([1, 2, null])
    expect(spaceLabel('app', 2)).toBe('app 2')
    expect(spaceLabel('app', null)).toBe('app')
  })
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
import { dirKey } from '../../stores/favorites'
import type { Tab } from '../../stores/workspace'
import type { RailCluster } from './railModel'

export function railTabOrder(clusters: readonly RailCluster[]): string[] {
  const out: string[] = []
  for (const c of clusters) for (const k of c.checkouts) for (const r of k.rows) if (!out.includes(r.tabKey)) out.push(r.tabKey)
  return out
}

/** Tabs drawn on the strip and counted by Ctrl+Alt+1–9 / cycling: the active tab's project only. */
export function projectTabKeys(clusters: readonly RailCluster[], activeTabKey: string | null): string[] {
  const all = railTabOrder(clusters)
  const owner = activeTabKey ? clusters.find((c) => c.tabKeys.includes(activeTabKey)) : undefined
  return owner ? all.filter((k) => owner.tabKeys.includes(k)) : all
}

/** 1-based index among tabs opened on the same folder; null when a folder has one tab. */
export function spaceIndexes(tabs: readonly Tab[], projectOf: (t: Tab) => string | undefined): Map<string, number | null> {
  const groups = new Map<string, string[]>()
  for (const t of tabs) {
    const p = projectOf(t)
    const k = p ? dirKey(p).replace(/[\\/]+$/, '') : '~'
    groups.set(k, [...(groups.get(k) ?? []), t.key])
  }
  const out = new Map<string, number | null>()
  for (const keys of groups.values()) keys.forEach((k, i) => out.set(k, keys.length > 1 ? i + 1 : null))
  return out
}

export const spaceLabel = (folder: string, index: number | null): string => (index === null ? folder : `${folder} ${index}`)
```
(Check `dirKey` already normalises `/` vs `\` and case; keep the trailing-separator strip only if it does not.)
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "✨ Add project-scoped space order and folder numbering"`

---

### Task 8: Spaces — strip and keys in the Workspace view

**Files:**
- Modify: `apps/web/src/components/workspace/WorkspaceView.vue` (tab strip l.850–909, `onGlobalKey` l.689, `onTabKey` l.731, `tabTitle` l.778)
- Modify: `apps/desktop/e2e/rail.cjs` (created here, extended later)

**Interfaces:**
- Consumes: `useRail().clusters`, `projectTabKeys`, `spaceIndexes`, `spaceLabel`, `cycleTab(step, scope)`.

- [ ] **Step 1: Strip scope** — `const visibleTabKeys = computed(() => projectTabKeys(rail.clusters.value, workspace.activeTab?.key ?? null))`; `const visibleTabs = computed(() => visibleTabKeys.value.map((k) => workspace.tabs.find((t) => t.key === k)!).filter(Boolean))`; the `v-for` over tabs uses `visibleTabs`. Leading capsule before the tablist: `button[data-strip-project]` (`ccm-btn-plain`, Folder icon + active cluster name, `title` = root) and, when other clusters need you, a `BellRing` + count of `sum(needs)` of the other clusters; click opens Mission Control (Task 10; until then focuses the rail header of that project).
- [ ] **Step 2: Keys** — `cycleTab` action → `workspace.cycleTab(step, visibleTabKeys.value)`; `tab` action → `visibleTabs.value[index]` (no-op beyond the end); `onTabKey` ←/→ walks `visibleTabs`.
- [ ] **Step 3: Tooltip** — `tabTitle` prepends `spaceLabel(folderName(project), index)` from `spaceIndexes(workspace.tabs, (t) => tabProject(t, paneOf))`.
- [ ] **Step 4: E2E `apps/desktop/e2e/rail.cjs`** (pattern of `e2e/p6.cjs`: set `ccm.tourDone`, `ccm.setupDone`, `ccm.tourWorkspaceDone`, reload, drive Pinia via `__vue_app__…$pinia._s.get('workspace')`): open 2 shell tabs in repo A and 1 in folder B; assert `[role=tab]` count is 2 while A is active, `Ctrl+Alt+2` activates A's second tab, activating B's pane leaves 1 tab drawn; print `PASS`/`FAIL`.

Run: `npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/rail.cjs` — expect all `PASS`.
- [ ] **Step 5: Update `lib/shortcuts.ts` descriptions** for `wsTab`/`wsCycle` (en/vi `keys.item.wsTab` → "Tab 1–9 of this project" / "Tab 1–9 của dự án này").
- [ ] **Step 6: Commit** — `git commit -m "✨ Scope the tab strip and tab keys to the current project"`

---

### Task 9: Pane text snapshots

**Files:**
- Create: `apps/web/src/lib/paneSnapshots.ts`
- Modify: `apps/web/src/components/workspace/TermPane.vue` (register next to `readScreen` l.260; unregister on unmount)
- Test: `apps/web/src/lib/rail/rail.test.ts`

**Interfaces:**
- Produces: `lastRows(lines: readonly string[], n: number): string`; `registerSnapshot(key: string, read: (rows: number) => string[]): () => void`; `snapshotOf(key: string, rows: number): string`.

- [ ] **Step 1: Failing test**

```ts
import { lastRows, registerSnapshot, snapshotOf } from '../paneSnapshots'
describe('pane snapshots', () => {
  it('keeps the last n rows after trimming trailing blank lines', () => {
    expect(lastRows(['a', 'b', 'c', '', '  '], 2)).toBe('b\nc')
    expect(lastRows(['', ''], 14)).toBe('')
  })
  it('reads through the registry and forgets on unregister', () => {
    const off = registerSnapshot('p1', (n) => Array.from({ length: n + 2 }, (_, i) => `l${i}`))
    expect(snapshotOf('p1', 2)).toBe('l2\nl3')
    off()
    expect(snapshotOf('p1', 2)).toBe('')
  })
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/paneSnapshots.ts — memory only: never stored, never sent over IPC.
const readers = new Map<string, (rows: number) => string[]>()

export function lastRows(lines: readonly string[], n: number): string {
  let end = lines.length
  while (end > 0 && !lines[end - 1]!.trim()) end--
  return lines.slice(Math.max(0, end - n), end).join('\n')
}

export function registerSnapshot(key: string, read: (rows: number) => string[]): () => void {
  readers.set(key, read)
  return () => {
    if (readers.get(key) === read) readers.delete(key)
  }
}

export function snapshotOf(key: string, rows: number): string {
  const read = readers.get(key)
  return read ? lastRows(read(rows), rows) : ''
}
```
In `TermPane.vue` after the terminal opens:

```ts
const offSnapshot = registerSnapshot(props.pane.key, (rows) => {
  const buf = term?.buffer.active
  if (!buf) return []
  // Read a margin above the cursor row so trailing blank screen rows can be trimmed.
  const end = buf.baseY + buf.cursorY + 1
  const out: string[] = []
  for (let y = Math.max(0, end - rows - 8); y < end; y++) out.push(buf.getLine(y)?.translateToString(true) ?? '')
  return out
})
onBeforeUnmount(offSnapshot)
```
- [ ] **Step 4: Run — PASS**; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "✨ Read pane text snapshots from the xterm buffer"`

---

### Task 10: Mission Control model (pure)

**Files:**
- Create: `apps/web/src/lib/rail/mission.ts`
- Test: `rail.test.ts`

**Interfaces:**
- Consumes: `RailCluster`, `RailState`, `needsUser` (Task 3); `spaceIndexes`, `spaceLabel` (Task 7); `boxes`, `Box` (`lib/splitLayout.ts`); `Tab`, `tabProject`.
- Produces:

```ts
export interface MissionWindow { paneKey: string; box: Box; state: RailState | null; title: string }
export interface MissionSpace { tabKey: string; label: string; current: boolean; needs: number; failed: number; windows: MissionWindow[] }
export interface MissionGroup { key: string; name: string; spaces: MissionSpace[] }
export function missionShelf(clusters: readonly RailCluster[], tabs: readonly Tab[], activeTabKey: string | null, folderOf: (t: Tab) => string, titleOf: (paneKey: string) => string): MissionGroup[]
export function flipTransform(from: { left: number; top: number; width: number; height: number }, to: { left: number; top: number; width: number; height: number }): string
```

- [ ] **Step 1: Failing tests**

```ts
import { flipTransform, missionShelf } from './mission'
describe('mission control', () => {
  it('shelves every project with its spaces and windows, unscoped', () => {
    const ws = useWorkspaceStore()
    const a = ws.open('claude', 'C:\\work\\app')
    ws.split(a.key, 'row')
    ws.open('claude', 'C:\\work\\app')
    ws.open('shell', 'D:\\notes')
    const shelf = missionShelf(buildRail(input()), ws.tabs, ws.activeTab!.key, () => 'app', (k) => k)
    expect(shelf.map((g) => [g.name, g.spaces.length])).toEqual([['app', 2], ['notes', 1]])
    expect(shelf[0]!.spaces[0]!.windows).toHaveLength(2)
    expect(shelf[0]!.spaces.map((s) => s.label)).toEqual(['app 1', 'app 2'])
    expect(shelf[1]!.spaces[0]!.current).toBe(true)
  })
  it('maps a window rect onto a pane rect with translate + scale', () => {
    expect(flipTransform({ left: 0, top: 0, width: 100, height: 50 }, { left: 10, top: 20, width: 200, height: 100 })).toBe('translate(10px, 20px) scale(2, 2)')
  })
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
import type { Tab } from '../../stores/workspace'
import { boxes, type Box } from '../splitLayout'
import type { RailCluster, RailState } from './railModel'
import { needsUser } from './railModel'
import { spaceIndexes, spaceLabel } from './spaces'

export interface MissionWindow { paneKey: string; box: Box; state: RailState | null; title: string }
export interface MissionSpace { tabKey: string; label: string; current: boolean; needs: number; failed: number; windows: MissionWindow[] }
export interface MissionGroup { key: string; name: string; spaces: MissionSpace[] }

export function missionShelf(
  clusters: readonly RailCluster[], tabs: readonly Tab[], activeTabKey: string | null,
  folderOf: (t: Tab) => string, titleOf: (paneKey: string) => string,
): MissionGroup[] {
  const idx = spaceIndexes(tabs, (t) => t.project)
  return clusters.filter((c) => c.live).map((c) => {
    const rows = c.checkouts.flatMap((k) => k.rows)
    const spaces = c.tabKeys.map((key): MissionSpace => {
      const tab = tabs.find((t) => t.key === key)!
      const mine = rows.filter((r) => r.tabKey === key)
      const stateOf = (paneKey: string): RailState | null => mine.find((r) => r.paneKey === paneKey && r.kind === 'agent')?.state ?? (mine[0]?.kind === 'other' && mine[0].paneKey === paneKey ? mine[0].state : null)
      return {
        tabKey: key, label: spaceLabel(folderOf(tab), idx.get(key) ?? null), current: key === activeTabKey,
        needs: mine.filter((r) => needsUser(r.state)).length, failed: mine.filter((r) => r.state === 'failed').length,
        windows: [...boxes(tab.root)].map(([paneKey, box]) => ({ paneKey, box, state: stateOf(paneKey), title: titleOf(paneKey) })),
      }
    })
    return { key: c.key, name: c.name, spaces }
  })
}

/** FLIP: the transform that puts an element laid out at `from` exactly over `to` (transform-origin 0 0). */
export function flipTransform(from: { left: number; top: number; width: number; height: number }, to: { left: number; top: number; width: number; height: number }): string {
  const sx = to.width / from.width
  const sy = to.height / from.height
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`
}
```
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** — `git commit -m "✨ Add the Mission Control shelf model"`

---

### Task 11: Mission Control overlay, chord and E2E

**Files:**
- Create: `apps/web/src/components/workspace/MissionControl.vue`
- Modify: `WorkspaceView.vue` (mount inside `canvas`, `missionOpen` ref, capsule click, `mission` action), `apps/web/src/lib/workspaceKeys.ts` (+ test), `apps/web/src/lib/shortcuts.ts` (`wsMission`), `apps/desktop/src/preview/keys.ts` (`workspaceChord`), `apps/web/src/i18n/workspace-rail.ts` (`mission` block), `apps/web/src/lib/tour.ts` (optional `mission` step targeting `[data-strip-project]`, `absent: true`), `apps/desktop/e2e/rail.cjs`

**Interfaces:**
- Consumes: `missionShelf`, `flipTransform` (Task 10); `snapshotOf` (Task 9); `useRail` (Task 5); `motionMs`, `reducedMotion` (`lib/motion.ts`); `workspace.activate`, `workspace.activateTab`.
- Produces: action `{ kind: 'mission' }` from `workspaceAction` on Ctrl+Shift+O (mac ⌘⇧O); `MissionControl` props `{ open: boolean; paneRect: (key: string) => DOMRect | null }`, emits `close(focusOpener: boolean)`.

- [ ] **Step 1: Failing key test** (`lib/workspaceKeys.test.ts`)

```ts
it('maps Ctrl+Shift+O / Cmd+Shift+O to mission control', () => {
  expect(workspaceAction(key({ code: 'KeyO', ctrlKey: true, shiftKey: true }), false, false)).toEqual({ kind: 'mission' })
  expect(workspaceAction(key({ code: 'KeyO', metaKey: true, shiftKey: true }), true, false)).toEqual({ kind: 'mission' })
})
```
(use the file's existing `key()` helper.)
- [ ] **Step 2: Run — FAIL**; **Step 3:** add the branch to `workspaceAction` + `WorkspaceAction` union, `wsMission` to `workspaceShortcuts(mac)` (`['Ctrl', 'Shift', 'O']` / `['⌘', '⇧', 'O']`), the chord in `preview/keys.ts`; **Step 4:** run — PASS.
- [ ] **Step 5: `MissionControl.vue`** behaviour (port of Deck `mission-control.tsx`):
  - Root `div[role=dialog][aria-modal=true][aria-label=t('workspace.rail.mission.title')]`, `absolute inset-0 z-30 grid grid-rows-[auto_minmax(0,1fr)] bg-page`, mounted with `v-if="open"` inside the canvas so it covers only the stage (sidebar stays usable? no — Deck covers the stage only; keep the rail visible).
  - **Shelf** (top, `ccm-material`, horizontal wrap, no horizontal scroll): per `MissionGroup` a labelled group (`h3` project name) of space buttons `button[data-mission-space]` 96px wide: mini map (absolutely positioned boxes from `window.box`, each tinted by state badge colour token), label (`space.label`), needs count text when > 0; hover/focus previews that space; Enter/click enters it (`workspace.activateTab(tabKey)` then close).
  - **Spread** (below): windows of the previewed space (default current), `grid-template-columns: repeat(auto-fit, minmax(200px, 300px))`, each `button[data-mission-window]` with head (PresetIcon + `title` + state word with StatusIcon; `asked`/`failed` heads get a 2px top border in `st-waiting`/`st-error`) and `<pre class="font-mono text-2xs">` = `snapshotOf(paneKey, 14)` taken once per previewed space when it is shown (memoised by tabKey), never live.
  - **Keys:** Esc → close, focus back to opener; Tab trapped (reuse the focus-trap helper used by `ccm-sheet` dialogs); ←/→/↑/↓ move between windows (grid order), Home/End; ↑ from the first row of the spread moves to the shelf; Enter/Space on a window → `workspace.activate(paneKey)` (switches tab under the overlay first) then fly-to + close.
  - **Motion:** on open, for each window of the current space, `el.animate([{ transform: flipTransform(winRect, paneRect(key)) }, { transform: 'none' }], { duration: motionMs(300), easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })` with `transform-origin: 0 0`; on choose, activate first, then animate to `paneRect(key)` of the new active tab and fade the rest; `motionMs` returns 0 under reduced motion so it closes immediately.
  - Closes without animation when the active tab changes from outside, when `workspace.tabs` becomes empty, or another overlay (`pendingClose`, QuickOpen, Settings) opens.
- [ ] **Step 6: Wire in `WorkspaceView.vue`** — `missionOpen` ref; `mission` action toggles it (only when `workspace.tabs.length`); capsule click opens it; `paneRect(key)` returns the `[data-pane]`/TermPane element rect of the current tab; while open, TermPane `visible` stays as is (no WebGL churn — the overlay is opaque over it).
- [ ] **Step 7: i18n** — add to `workspace-rail.ts` (en/vi): `mission: { title: 'Mission Control' / 'Mission Control', shelf: 'Projects and tabs' / 'Dự án và tab', windows: 'Panes of {name}' / 'Các pane của {name}', open: 'Open {name}' / 'Mở {name}', empty: 'No output yet' / 'Chưa có output' }` and `keys.item.wsMission` = 'Mission Control: every tab of every project' / 'Mission Control: mọi tab của mọi dự án'.
- [ ] **Step 8: E2E (extend `rail.cjs`)** — with 2 projects × 2 tabs: press Ctrl+Shift+O → `[role=dialog]` with 3 shelf spaces visible across 2 groups; `[data-mission-window]` count equals panes of the current tab; press ArrowRight + Enter → dialog gone and `workspace.activeKey` is that pane; reopen, Esc → dialog gone and focus is back on the opener; exited pane window shows `t('…mission.empty')`.

Run: `npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/rail.cjs` — expect all `PASS`.
- [ ] **Step 9: Commit** — `git commit -m "✨ Add Mission Control: every project's tabs as pane snapshots"`

---

### Task 12: Needs-you list

**Files:**
- Create: `apps/web/src/lib/rail/attentionList.ts`, `apps/web/src/components/workspace/AttentionPopover.vue`
- Modify: `WorkspaceView.vue` (chip l.946: click toggles the popover instead of `nextAttention()`; Ctrl+Shift+A unchanged), `workspace-rail.ts` (`needsList` strings), `apps/desktop/e2e/rail.cjs`
- Test: `rail.test.ts`

**Interfaces:**
- Consumes: `RailCluster`, `RailRow`, `needsUser` (Task 3).
- Produces: `interface AttentionEntry { paneKey: string; tabKey: string; state: 'failed' | 'asked'; first: string; agent: string; place: string; branch: string | null; since: number }`; `buildAttentionList(clusters: readonly RailCluster[]): { entries: AttentionEntry[]; footer: Record<'working' | 'done' | 'idle' | 'ended', number> }`.

- [ ] **Step 1: Failing test**

```ts
import { buildAttentionList } from './attentionList'
it('lists failed before asked, oldest first, with a footer of the rest', () => {
  const ws = useWorkspaceStore()
  const a = ws.open('claude', 'C:\\work\\app')
  const b = ws.open('claude', 'C:\\work\\app')
  const c = ws.open('claude', 'D:\\notes')
  ws.update(a.key, { attention: 'waiting' })
  ws.update(b.key, { state: 'error' })
  const sessions: Record<string, RailSession> = { [a.key]: { status: 'waiting', title: 'A', since: '2026-10-15T10:00:00Z' }, [c.key]: { status: 'working', title: 'C' } }
  const list = buildAttentionList(buildRail(input({ sessionOf: (p) => sessions[p.key] })))
  expect(list.entries.map((e) => [e.paneKey, e.state])).toEqual([[b.key, 'failed'], [a.key, 'asked']])
  expect(list.footer.working).toBe(1)
})
```
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
import { needsUser, type RailCluster } from './railModel'

export interface AttentionEntry { paneKey: string; tabKey: string; state: 'failed' | 'asked'; first: string; agent: string; place: string; branch: string | null; since: number }

export function buildAttentionList(clusters: readonly RailCluster[]) {
  const entries: AttentionEntry[] = []
  const footer = { working: 0, done: 0, idle: 0, ended: 0 }
  for (const c of clusters) for (const k of c.checkouts) for (const r of k.rows) {
    if (needsUser(r.state)) {
      entries.push({ paneKey: r.paneKey, tabKey: r.tabKey, state: r.state as 'failed' | 'asked', first: r.task ?? r.ordinal, agent: r.agent, place: c.name, branch: k.branch, since: r.since })
    } else if (r.state === 'working' || r.state === 'done' || r.state === 'ended') footer[r.state]++
    else footer.idle++
  }
  const loud = (e: AttentionEntry): number => (e.state === 'failed' ? 0 : 1)
  entries.sort((a, b) => loud(a) - loud(b) || (a.since || Infinity) - (b.since || Infinity))
  return { entries, footer }
}
```
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: `AttentionPopover.vue`** — teleported `ccm-menu`, 288px, right-aligned under the chip (flip inside the window edge 8px); `role=listbox` with `role=option` rows: StatusIcon (`error`/`waiting`) + `first` + `agent · place · branch` + short age (`shortAge`); ↑↓ Home End wrap, Enter → `workspace.activate(paneKey)` + close; Esc → close and refocus the chip; footer text "2 working · 1 done" (`workspace.rail.needsList.footer`). Chip gets `aria-haspopup="listbox"` + `aria-expanded`.
- [ ] **Step 6: E2E** — fake 2 waiting sessions via `terminals.upsert`, click chip → 2 options, ArrowDown + Enter focuses the second pane.
- [ ] **Step 7: Commit** — `git commit -m "✨ Open a needs-you list from the attention chip"`

---

### Task 13: Cleanup, docs, version

**Files:**
- Modify: `apps/web/src/lib/sidebarRows.ts` (delete `sideGroups`/`SideGroup` if unused; keep `projectOf`, `folderName`, `containingRoot`, `rowStatus`, `shellTitle`, `rowActivity`, `shortAge` still referenced) and `lib/tier2.test.ts` (drop `sideGroups` tests, they moved to `rail.test.ts`)
- Modify: `.code_index/web.md` (new `## v31 multi-project` section: rail model/order/avatars/spaces/mission/attention, `useRail`, components, storage key, chord), `.code_index/desktop.md` (`ccm:project-root` → `common`), `.code_index/_meta.md` (1–2 lines), `docs/claude-code-integration.md` (new §11t: git common dir, snapshots stay in memory, no session text shown — ruling 2)
- Modify: `apps/desktop/package.json` version `2.5.0` → `2.6.0`
- Modify: `.planning/PLAN-v31-multi-project.md` status (done, commits, follow-ups)

- [ ] **Step 1:** `rg "sideGroups" apps/web/src` → remove the dead export + its tests; `npm test -w @ccm/web`, `npm test -w @ccm/desktop`, `npm run typecheck` — all green.
- [ ] **Step 2:** Full E2E: `npm run build -w @ccm/web && npm run build -w @ccm/desktop && npm run e2e -w @ccm/desktop` — `tier2.cjs`, `p6.cjs`, `split.cjs` (sidebar selectors `[data-side-row]`, `[data-side-head]` must still match) and `rail.cjs` all PASS; fix selectors in old scripts if the rail changed them.
- [ ] **Step 3:** Docs + version edits above.
- [ ] **Step 4: Commit** — `git commit -m "📝 Document the multi-project rail, spaces and Mission Control; bump to 2.6.0"`
- [ ] **Step 5:** Hand off to superpowers:finishing-a-development-branch (merge `feat/multi-project` into `master` the way v30 was merged).

---

## Deliberately not ported (record in `.planning/PLAN-v31-multi-project.md`)

- Session sentence / first prompt (ruling 2) — rows read the session name and state only.
- Deck's slide animation between spaces (text ghost): our panes already own per-pane view-transition names; a stage slide would fight them. Revisit after M2 ships.
- Deck's launch page (`resolveAgentLaunchTarget`): the existing `+` / LaunchPicker / SplitMenu already cover new tab vs split; the checkout line's click opens a new tab in that checkout.
- Model pill on rows (Deck withholds it too).

## Verification (end to end)

1. `npm test` (all workspaces) and `npm run typecheck` green.
2. `npm run e2e -w @ccm/desktop` green, including the new `rail.cjs`.
3. Manual in `npm run desktop:dev` with `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` or real Claude: 3 Claude tabs on one repo + a worktree tab + a plain folder → rail shows one repo cluster with two checkout lines, rows `Claude`/`Claude 2`/`Claude 3`, a plain cluster tagged `folder`; strip shows only the active project's tabs, Ctrl+Alt+1–9 counts them; Ctrl+Shift+O shows both projects with pane snapshots, Enter on a window jumps there; the needs chip lists waiting panes oldest first; reduced motion (OS setting) removes the zoom; light/dark + one extra theme look right; Vietnamese locale has no missing keys.
