# v25 — Attachments tray, workspace tutorial + tips, colour themes, browser-style "+", map context menu

## Context
User feedback on 2.2.0 (5 items): (1) a focused session needs image paste + a visible list of what is attached to the prompt (files/docs/images with names, matching the terminal's `[Image #N]`), editable from the list; (2) new users do not know how to use the Workspace or its shortcuts → short tour + "use shortcut X" tips (can be turned off); (3) more colour themes; (4) the New-tab button is pinned far right → put it right after the last tab like a browser; (5) right-click a main agent on the Monitor map → jump to its pane in Workspace.

Decisions taken with the user:
- #1 model = **staging tray + reflection**: the panel is a tray (add via paste / drop / pick, remove freely); added items are inserted into the prompt (auto by default); after insertion the panel reads the screen to show the `[Image #N]` / `@path` Claude assigned, mapped to the original file name. Removing an already-inserted item is best-effort only.
- #3 themes (whole app + terminal + code highlight): Xcode Light/Dark, Monokai, Dracula, Solarized Light/Dark, GitHub Light/Dark, Material, One Dark. Apple Light/Dark stay the defaults (ids `light`/`dark` unchanged). "Material icon theme" = the Material colour theme only, no file-icon set.

Before any UI work: load skills `frontend-design:frontend-design` + `ui-ux-pro-max:ui-ux-pro-max` (CLAUDE.md). Follow `.planning/COLOR-SYSTEM.md`, i18n en+vi for every string, status = icon+text+colour. Copy this plan to `.planning/PLAN-v25-feedback.md`; update `.code_index/{web,desktop,_meta}.md` per phase. Target version 2.3.0.

Phases in order of risk (each shippable alone): A → B → C → D → E.

---

## Phase A — Browser-style "+" (#4)
`apps/web/src/components/workspace/WorkspaceView.vue` (toolbar ~l.662–776).
- Move the `+` wrapper **inside** the tab strip, right after the tab `TransitionGroup`; icon-only `ccm-btn-plain` (Plus), keep `aria-label=workspace.newLabel`, `title` = `workspace.newHint` + shortcut. `sticky right-0` (strip bg) so it stays visible when tabs overflow and scroll.
- The strip is `overflow-x-auto`, so the popover can no longer be `absolute` inside it: teleport the existing LaunchPicker popover to `body`, `fixed`, anchored to the button `DOMRect` (same pattern as `SplitMenu`/`ProjectMenu`: clamp to viewport, `--ccm-origin: top left`, `ccm-menu` Transition + `retireOverlay`). Keep `openMenu/closeMenu/onFocusOut`/outside-pointerdown logic; outside check must include the teleported node.
- Double-click on empty strip area → `openMenu()` (browser habit).
- Keep `data-menu=scripts|save-layout` rows and the "`.at(-1)` = Home" E2E invariant. Update E2E selectors only if they relied on position (they use aria-label).

## Phase B — Map context menu → workspace (#5)
- New shared helper `apps/web/src/composables/useRevealInWorkspace.ts`: `paneOf(terminalId)` (via `workspace.paneByTerminal`), `show(terminalId)` (= `workspace.activate(pane.key)` + `ui.setView('workspace')`), `canReopen(terminal)` / `reopen(terminal)` (moved from `SessionCardHeader.vue:48–69`, incl. the live-session two-writer confirm state). Refactor `SessionCardHeader.vue`, `App.vue:38–45` (`desktop.onFocus`) and `composables/useNotifications.ts:109–112` to use it.
- New `apps/web/src/components/AgentContextMenu.vue` — copy of the `ProjectMenu.vue` menu pattern (role=menu, ↑↓ Home End, Esc/Tab close, focusout + capture outside pointerdown, first item focused), anchor = `new DOMRect(e.clientX, e.clientY, 0, 0)`, left-aligned to the cursor and **flips up/left** near viewport edges. Teleported + `ccm-menu` Transition.
- Items (main agent's terminal): **Show in Workspace** (pane linked) · else **Open in Agent Monitor** (resume; live session → inline warning item "Will open a second writer — Open anyway / Cancel") · **Focus session** (`ui.revealTerminal`) · **Show details** (`ui.selectAgent`). Workspace items only when `hasTerminals`; disabled + reason text when the session has no cwd/UUID.
- `AgentMap.vue`: `onNodeContextMenu` from `useVueFlow(FLOW_ID)` (l.30) → `preventDefault`, select the node, open menu for `agent.terminalId` when `agent.role === 'main'` (subagent nodes: same menu for their terminal, titled with the main session). Shift+F10 / ContextMenu key on a focused node opens it at the node rect.
- Same menu on `SessionCard` root `@contextmenu` (whole card is clickable already) — cheap reuse.

## Phase C — Colour themes (#3)
Theme model: `settings.theme: ThemeId`; each theme has `mode: 'light'|'dark'`.
- `apps/web/src/lib/themes.ts`: `THEMES` = `{ id, mode, labelKey, pair?, swatch: [canvas, surface, accent, well] , windowBg }` for `light, dark, xcode-light, xcode-dark, monokai, dracula, solarized-light, solarized-dark, github-light, github-dark, material, one-dark`; `isThemeId`, `modeOf`, `toggleTarget(id)` (pairs: xcode/solarized/github light↔dark, Apple light↔dark; unpaired dark themes → `light`).
- `apps/web/src/themes.css` (imported after `style.css`): one `:root[data-theme="<id>"]` block per theme overriding the **colour** tokens (surfaces, ink ladder, line, fill, accent/accent-ink/accent-soft/on-accent, focus, selection, status + soft, warning, favorite, diff-*, agent-*, cat-1..8, well/well-ink/well-line/well-selection, ansi-0..15, syn-*). Aliases (`link`, `success`, `model-*`, `agent-shell`, `syn-var`) resolve automatically because all selectors sit on `<html>`. Light themes use their own editor background for `well` (ANSI set chosen for it; xterm `minimumContrastRatio: 4.5` stays). Values taken from each theme's official palette; status colours must stay distinct and meet COLOR-SYSTEM contrast rules. Tokens parsed as hex at runtime (`agent-claude`, `ink`, `success`, `well-selection`, `ansi-3` — LottieArt/TermFind) must be `#RRGGBB`.
- `stores/settings.ts`: `Theme` → `ThemeId`; watch sets `classList.toggle('dark', mode==='dark')` + `dataset.theme = id` (Apple ids remove the attribute) + `theme-color` meta; unknown stored value → `light`/`dark` by OS. `setTheme(id)`; `toggleTheme()` → `toggleTarget`.
- `index.html` pre-paint script: same logic with an inline list of dark ids; sets `data-theme` before paint.
- `SettingsMenu.vue` Appearance: replace the 2-segment control with a theme grid (radiogroup, roving tabindex, swatch preview + name + check, grouped Light / Dark) wrapped in `withViewTransition`. `AppHeader` sun/moon toggle keeps flipping mode via `toggleTarget`. `CommandPalette.vue:122`: keep "Dark theme" toggle + add one prefs command per theme ("Theme: Dracula", `on` tag on current).
- Shiki: move the duplicated `--shiki-*` → `--ccm-syn-*` map (`FilePane.vue:365–376`, `DiffView.vue:129–140`) into one `.ccm-code` class in `style.css`; drop the hardcoded fallback hexes.
- Desktop window background: preload `setWindowBackground(hex)` → IPC `ccm:window-bg` (isAppFrame, `#RRGGBB` only) → `win.setBackgroundColor` + saved in `userData/window.json`; `main.ts:172` uses the saved value before the OS fallback. Loading pages (`pages.ts`) stay OS-based.
- Test `apps/web/src/lib/themes.test.ts`: read `themes.css`/`style.css` via `?raw`; every theme block defines every colour token of `:root` that is not an alias; hex-only tokens are `#RRGGBB`; `toggleTarget` round-trips pairs; ids in `index.html` dark list == `THEMES` dark ids.

## Phase D — Workspace tutorial + shortcut tips (#2)
Tour (reuse `OnboardingTour.vue` + `lib/tour.ts`):
- `ui.tourOpen: false | 'monitor' | 'workspace'`; OnboardingTour takes steps / view / done-key from a `TOURS` map (`monitor` = `TOUR_STEPS`, `ccm.tourDone`; `workspace` = new `WORKSPACE_TOUR_STEPS`, `ccm.tourWorkspaceDone`); `setView(tour.view)` instead of hard-coded monitor. Existing openers pass `'monitor'`.
- `WORKSPACE_TOUR_STEPS` (7, essentials only): welcome → `+` new tab (preset + folder, shortcut) → split button / split shortcuts → pane header (branch & worktrees, scripts ▶, find) → sidebar projects (+ layouts) → attachments button (after Phase E; `absent` hint before) → shortcuts list + finish. Shortcut text interpolated from `workspaceShortcuts(isMac)` so it is correct per OS. `data-tour` attributes added in `WorkspaceView`, `TermPane`, `WorkspaceSidebar`.
- Auto-open once, 600 ms after the Workspace view is first shown (desktop only). Re-open: Settings → Help, Ctrl+K `c:tourWorkspace`, and a new toolbar Help button (`CircleHelp`, menu: Workspace tour / Keyboard shortcuts) — today ShortcutsDialog cannot be opened from inside the workspace.

Tips:
- `apps/web/src/stores/tips.ts`: persisted `ccm.tips` `{ off, learned: string[], shown: Record<action, n> }`; `mouse(action)` (rolling 10 min window per action), `key(action)` (→ learned, never tipped again). Show when an action reaches 3 mouse uses in the window, not learned, `shown[action] < 2`, workspace visible, ≥ 3 min since the last tip. Pure decision fn `shouldTip(...)` in `lib/tips.ts` (unit-tested).
- Actions: `newTab` (`+`), `split` (SplitMenu choice / ViewPaneControls), `closePane` (pane ✕ / tab ✕), `tab` (tab click → Ctrl+Alt+N / Ctrl+Tab), `attention` (chip), `focus` (pointerdown on another pane when > 1 pane → Alt+Arrows). Count at the mouse handlers in `WorkspaceView.vue` / `TermPane.vue` / `ViewPaneControls.vue`; `onGlobalKey` calls `tips.key(action)`.
- `components/workspace/ShortcutTip.vue` modelled on `BreakToast.vue` (`role=status`, aria-live, slide/fade, reduced-motion safe): "Tip: press <kbd>Ctrl Shift T</kbd> to open a tab faster" + **Got it** + **Don't show tips**; auto-hide 10 s (paused on hover/focus). Settings → Appearance toggle "Shortcut tips" (= `!off`), Ctrl+K pref command.

## Phase E — Attachments tray (#1)
**E0 discovery (before code, record in `docs/claude-code-integration.md` new §):** on Claude Code 2.1.289 and Codex 0.162.0 verify: `[Image #N]` numbering (per prompt or per session, after removal); deleting the placeholder text drops the image; how the input box renders (borders / `>` prefix, wrapping) so it can be located in the xterm buffer; `@path` insertion incl. paths with spaces (quoting) and relative vs absolute; Codex ^V image support and `@` mention. Plan details below adjust to the findings; anything unsupported for Codex is hidden for Codex panes.

Desktop (`apps/desktop/src/preload.ts`, `preview/ipc.ts`, `preview/clipboardImage.ts`):
- preload `pathForFile(file)` = `webUtils.getPathForFile` (drop gives no `File.path` on Electron ≥ 32).
- IPC `ccm:clipboard-image-file(path)` (isAppFrame): absolute existing file, image extension (png/jpg/jpeg/gif/webp), ≤ 20 MB, `nativeImage.createFromPath` non-empty → clipboard. Existing `ccm:clipboard-image` (PNG data URL) reused for tray images held in memory. No temp files written.
- `pickFile` gains a multi-select variant for "Add files…".

Web:
- `stores/workspace.ts`: runtime-only `attachments: Record<paneKey, Attachment[]>` — `{ id, kind: 'image'|'file', name, source: 'paste'|'drop'|'pick'|'terminal', path?, thumb? (≤ 96 px data URL, memory only), token? ('[Image #3]' | '@src/a.ts'), state: 'staged'|'inserted'|'sent' }`. Never written to sessionStorage / `ccm.workspace.last` / logs. Actions `addAttachments`, `insertAttachment(s)`, `removeAttachment`, `markSent`. Setting `ccm.workspace.autoInsert` (default on).
- Insert path: file → `term.paste('@<path relative to workCwd, else absolute, quoted per E0> ')`; image → put on clipboard (`clipboardImageFile` / `clipboardImage`) then `\x16` (existing insert queue `insertRequest` extended with an attachment id). Inserts are serialised (one at a time, wait for the token to appear or 1.5 s). Note in UI: inserting an image replaces the system clipboard.
- Reflection: `lib/promptAttachments.ts` pure `scanPrompt(rows: string[]) → { images: number[], files: string[] }` limited to the input-box rows found per E0. `TermPane` runs it on `onWriteParsed` (debounced 150 ms, visible Claude/Codex panes only) over the bottom rows of `buffer.active`. Matching: a new `[Image #N]` appearing after an app insert is bound to that item (→ "screenshot.png · [Image #3]"); one appearing after a plain Ctrl/⌘+V in the pane (TermPane `paste()` already knows) becomes "Clipboard image" with a thumbnail from `navigator.clipboard.read()`; any other token shows as found (`source: 'terminal'`). Enter in the pane + tokens gone from the prompt → items `sent` (shown under "Last sent", cleared on next send).
- Remove: staged → removed. Inserted → only if its token is the text right before the cursor (typical right after insert): send backspaces for the token length (+ space), then confirm via rescan; otherwise the button is disabled with tooltip "Remove it in the terminal". Never edits other prompt text.
- macOS: make ⌘V go through `paste()` (image-aware) like Ctrl+V on Windows.
- UI `components/workspace/AttachmentsPanel.vue`: pane-header toggle (Paperclip + count badge, `data-tour=attachments`) between status chip and restart; panel = right column inside the TermPane body (flex row; existing ResizeObserver refits xterm), `w-64`, opaque surface. Content: drop hint / **Add files…** / **Paste image**, list rows (thumb or file-type lucide icon, name, token chip, state = icon+text: Staged / In prompt / Sent, remove), footer **Insert all** when staged items exist + auto-insert toggle. Drag-over anywhere on the pane shows a drop overlay; drop opens the panel and adds. Keyboard: list arrows, Delete removes.

---

## Critical files
- web: `components/workspace/{WorkspaceView,TermPane,WorkspaceSidebar,ViewPaneControls,ShortcutTip*,AttachmentsPanel*}.vue`, `components/{AgentMap,AgentContextMenu*,SessionCard,SessionCardHeader,OnboardingTour,SettingsMenu,CommandPalette,AppHeader,FilePane}.vue`, `components/workspace/DiffView.vue`, `stores/{settings,ui,workspace,tips*}.ts`, `lib/{themes*,tour,tips*,promptAttachments*,shortcuts,desktop,preview}.ts`, `composables/{useRevealInWorkspace*,useNotifications}.ts`, `App.vue`, `index.html`, `style.css`, `themes.css*`, `i18n/{en,vi}.ts` (+ new `i18n/workspace-v25.ts` spread into `workspace`). (* = new)
- desktop: `src/{main,preload}.ts`, `src/preview/{ipc,clipboardImage}.ts`.
- docs: `docs/claude-code-integration.md` (E0 findings + screen-reading of the input box, local only), `.code_index/*`, `.planning/PLAN-v25-feedback.md`.

## Reuse
`ProjectMenu.vue`/`SplitMenu.vue` menu pattern · `retireOverlay`/`withViewTransition` (`lib/motion.ts`) · `BreakToast.vue` toast pattern · `OnboardingTour.vue` · `workspaceShortcuts` (`lib/shortcuts.ts`) · `workspace.paneByTerminal/activate/resumeSession` · `insertRequest` queue + `clipboardImage` IPC · `KeyHint.vue` kbd styling · `ToggleSwitch`, `SegmentedControl`, `ccm-btn*`, `ccm-menu`, `ccm-sheet`.

## Verification
- `npm run typecheck`, `npm test` (new: `themes.test.ts`, `tips.test.ts`, `promptAttachments.test.ts` with captured Claude input-box fixtures from E0, `stores/workspace.test.ts` attachments + en/vi parity, desktop `test/preview-ipc.test.ts` for `clipboard-image-file` validation).
- `npm run desktop:dev` manual pass: A `+` follows last tab, stays visible with 15 tabs, popover not clipped; B right-click main node → menu → lands on its pane / resume flow; C every theme in Settings grid: header, map, cards, terminal ANSI, FilePane + Changes diff, Lottie art, window bg on restart, reduced motion; D fresh profile (`ccm.tourWorkspaceDone` cleared) tour auto-opens, click `+` 3× → tip, "Don't show tips" persists, shortcut use suppresses tip; E paste image (Ctrl+V and from panel), drop png + .ts + .md onto a Claude pane → tokens appear and panel shows names ↔ `[Image #N]`, remove right after insert, submit → "Last sent".
- E2E: extend `apps/desktop/e2e/` with `v25.cjs` (tab `+` position, theme switch sets `data-theme`, context menu → workspace, attachments drop via CDP `Input.dispatchDragEvent`) and add to `run.cjs`; existing scripts set `ccm.theme='dark'` and must stay green.
- `npm run dist` on Windows once at the end; smoke the packaged exe.
