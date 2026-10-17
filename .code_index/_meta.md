# _meta

One line per change: what, then the key file / symbol. Details live in `collector.md`, `web.md`, `protocol.md`, `desktop.md`, the `.planning/PLAN-v*.md` plans and `docs/*-integration.md`. Paths are relative to the package (`apps/web/src`, `apps/collector/src`, `apps/desktop/src`) unless they start at the repo root. Cleaned 2026-10-17: entries for removed code (`.bat` launchers, `scripts/launch.mjs`, collector borrowing / takeover, PWA, `SessionView.vue`, `AgentContextMenu.vue`, `AgentNode.vue`, `spikes/`) were dropped; full history is in git.

## 2026-10-07 — MVP + v2

- Phases 1–7: discovery `docs/claude-code-integration.md`; collector `Monitor` / `SessionTracker` / `MonitorStore` / `server.ts`; shared `types.ts` / `status.ts`; web stores, Agent Map, SessionCard, ActivityFeed, i18n en/vi; `scripts/demo-fixture.mjs`.
- Nested subagents: `tracker.ts` `recordLinks` / `buildAgents` (`parentId`); hide-finished filter `settings.hideFinished`.
- v2 Usage tab: collector `usage.ts` `UsageIndex`, shared `pricing.ts`, `stores/usage.ts`, `components/usage/*`; aliases `aliases.ts` + `Monitor.setAlias`; header tabs `AppHeader.vue`.
- Panels: collapsible (`PanelHeader.vue`, `ui.collapsed`), `PanelSplitter.vue` (`ccm.panelSize`), `AppSelect.vue` replaces every native `<select>`.
- Sprint A / G: notifications `useNotifications`, `ContextGauge` + shared `context.ts`, favorites `favorites.ts` + `FavoritesList` (add / rename), `ProjectTable` + `usage/ProjectPickerDialog` (resize, density), `WaitingQueue.vue`, `statusSince`, `repo.ts` `RepoRoots`.
- `lib/sessionSort.ts`, `terminal.dismiss` → `Monitor.dismissEnded`, `ArtImage.vue` / `LottieArt.vue`, model chip `lib/model.ts` `modelLabel`.
- Sprint D hardening: `server.ts` `isAllowedOrigin` + WS heartbeat, `usage.ts` `pruneOldIds` / `renameWithRetry`; test `hardening.test.ts`.

## 2026-10-08 — v5–v11

- Sprint E–G (PLAN-v5): effort chip, cache-cold, stuck, reply time, sound, pins, frozen sort, tool ring, background jobs, plan limits via `scripts/statusline-bridge.mjs` (docs §11e).
- Motion: `style.css` `ccm-tick` / `ccm-pulse`, `composables/useBump.ts`, `useCountUp`.
- Favorites: `favorite.add` → `Monitor.addFavorite` (`favorite.rejected` reasons), `favorite.reorder` → `FavoriteStore.reorder`, folder picker `folder-pick.ts` → `folder.pick` / `folder.picked`.
- Activity paging `settings.activityPageSize`; caps 1000 (web `ACTIVITY_LIMIT`, collector `activityLimit`).
- Sprint H (PLAN-v6): `forecast.ts` `LimitHistory`, `stores/away.ts` + `AwaySummary.vue`, `lib/conflicts.ts`, `lib/attention.ts` `errorLoops`.
- Jump to terminal: `terminal.focusWindow` → `focus.ts` (`ConsoleHost` → WT root window); `CommandPalette.vue` (Ctrl+K, scopes, groups).
- History tab: `history.ts` `SessionHistory`, `timeline.ts` `StatusTimeline`, `history/{HistoryView,TimelineChart}.vue`, `RecapDialog.vue` + `lib/recap.ts`, daily budget tile.
- PlanLimits chip + popover: shows quota left (`view().left`), count-up + `±N%` delta badge (`ccm-quota-*`), "Weekly" label.
- Agent Map: node resize / drag persisted (`ui.nodeSizes` / `nodePos`, `ccm.mapLayout`), first `syncNodes` in `onMounted`, edges only for nodes present, multi-select `picked`, node click → `ui.revealTerminal`.
- Sprint I/J: `opener.ts` + `terminal.open`, `gitstat.ts` → `TerminalSession.diff`, `diagnostics.get` + `DiagnosticsDialog.vue`, per-socket reply `ClientContext.reply`, `stores/snooze.ts`, usage trends.
- Compact view `CompactView.vue` (`?mode=compact`), `OnboardingTour.vue` + `lib/tour.ts`, Settings right sheet + `ToggleSwitch.vue`, breaks `daystart.ts` → `lib/breaks.ts` + `BreakToast.vue`, `FlipClock.vue`.
- Context %: window from status line `context_window_size` → model catalog `parseModelWindows` → guess (`context.ts` `contextWindowOf`, docs §11c).
- Jobs: `job.dismiss` (any state, persisted `dismissed-jobs.json`), `job.stop` via `claude stop` (`job-stop.ts`, `isDaemonRunning` → `notRunning`), docs §11h.
- Windows toast (PLAN-v9/v10/v11): `toast.ts` `Toaster` (waiting / stuck / context, repeat, quiet hours, test + health), `server.ts` `/snooze`, shared `notify.ts`, collector `snooze.ts`, session notes `Monitor.setNote` (docs §11i).
- `SessionTabs.vue` + `ui.sessionTab`; `AgentMap` / `ActivityFeed` prop `terminalId`; Activity filter by session.

## 2026-10-09 — v12–v15 desktop, macOS

- v12 Electron shell `apps/desktop` (`main.ts`, `collector-host.ts` utilityProcess, `bridge.ts` → `%LOCALAPPDATA%/ccm/bin`), docs §11j.
- v13 macOS dmg (PLAN-v13): `process.ts` ps verify, `datadir.ts`, `focus-mac.ts` + `osascript.ts`, `launcher.ts` Terminal / iTerm2, `folder-pick.ts` `choose folder`, `toast-electron.ts` + desktop `attention.ts` (dock badge), `mac.ts`, `.github/workflows/desktop.yml` (docs §7b §11k).
- Port clash → exit 3 (`server.ts` `isPortInUse`, `PORT_IN_USE_EXIT`); `JsonlTailer` 1 MB chunks; SessionCard split into `SessionCardHeader` / `SessionCardSignals`.
- Tool timeline: `tool-spans.ts` `ToolSpanLog` (`closeOpen` on end) → `tool.span` / `toolSpans.get`; web `stores/toolSpans.ts`, `ToolTimeline.vue`.
- v14 Monitor layout E: `SessionBar`, `SessionSummary`, `AgentDetails`, `useShortcuts` + `KeyHint` + `ShortcutsDialog`.
- `TokenCount`, `SubagentCounts`; context % from the bridge (`contextPct` / `bufferPct` → `Agent.contextPct`, `contextUsedPct` 16.5 % buffer).
- v15 motion: `lib/motion.ts`, SessionTabs pill, panel transitions, edge draw, `CountNum`.

## 2026-10-11 / 12 — v16–v17 Codex, rename

- v16 Codex CLI: collector `codex/*` (`CodexMonitor`, rollout reader, process chain, link to calling Claude agent), shared `Provider`, web `ProviderBadge`, `lib/provider.ts`; docs `codex-integration.md`.
- v17 rename → Agent Monitor (display only); art `assets/art/10..14-*.svg`; `PlanLimits` compact 2-row Claude / Codex chips; `AppHeader` no-overlap folds (`3xl` breakpoint).

## 2026-10-14 — v18–v27 workspace, desktop only

- v18 Apple tokens + control kit: `style.css` tokens / `@utility ccm-btn|field|sheet|menu…`, `ui/SegmentedControl.vue` (AUDIT-v18).
- v18 embedded terminals P1–P7: desktop `pty/{host,presets,supervisor,owners,git}.ts`, `preload.ts`; shared `pty.ts`; web `lib/ptyClient.ts`, `stores/workspace.ts`, `components/workspace/*` (tabs / split `lib/splitLayout.ts`, worktrees `WorktreeMenu`, restore `restoreLast`, sidebar + attention, close confirm); collector CSP; docs §11o.
- v19 desktop only (v2.0.0): collector needs `CCM_APP_KEY` or `--dev` (`server.ts` `hasAppKey`), desktop `APP_KEY` / `openLink` / `registerLinks`; `sw.js` is a kill switch for old PWA installs.
- v20 audit: collector `win-exe.ts`, toast key persist, shutdown flush; desktop `log-mask.ts`; web motion tokens + `lib/motion.ts` `retireOverlay`.
- v21/v23 preview + pane kinds browser / file / changes: desktop `preview/{ipc,keys,grants,server}.ts` (webview, grants `GrantStore`), web `BrowserPane`, `FilePane`, `ChangesPane`, `AccessPrompt.vue`; live shell cwd `pty/shellInit.ts` + `lib/shellCwd.ts`.
- v22 colors (`.planning/COLOR-SYSTEM.md`): `accent-ink`, `success` / `warning` / `diff-*` / `agent-*` / `ansi-*` tokens, ink ladder.
- v24 tier 2: `lib/{sidebarRows,projects,layouts}.ts`, `useProjectRoots.ts`, `ProjectMenu` / `LayoutsDialog` / `ScriptsDialog`, desktop `layouts.ts`, `preview/scripts.ts`, `lib/startGuard.ts`.
- v25 feedback (PLAN-v25, docs §11p): themes `themes.css` + `lib/themes.ts` + `ThemePicker`, tours `TOURS`, tips `stores/tips.ts`, attachments `stores/attachments.ts` + `usePaneAttachments.ts` + `AttachmentsPanel.vue`.
- v26 Explorer: desktop `preview/explorer.ts` (`ccm:list-dir|create-entry`), web `lib/explorer/*`, `stores/explorer.ts`, `Explorer{Panel,Tree,Changes}.vue`; drag path → terminal `lib/explorer/dragPath.ts`.
- v27 fonts + setup (PLAN-v27, docs §11q): `lib/fonts.ts`, `fonts.css` (`scripts/gen-fonts.mjs`), `FontPicker`, wheel zoom `useWheelZoom.ts`, startup screen `pages.ts`, `QuickSetup.vue` + desktop `statusline.ts`.
- `CodeMinimap.vue` (`settings.minimap`); pickers open near the last project (`pick-start.ts`); dev HMR `npm run desktop:dev` (`devUrlOf`); `npm run dist` → `scripts/dist.mjs`.

## 2026-10-15 — v28–v48

- v28 Extensions (PLAN-v28, docs §11r): shared `extensions.ts` `CATALOG`; desktop `extensions/{commands,status,ipc}.ts`; web `stores/extensions.ts` (`mcpByDir` 5 min cache, login via workspace shell), `components/extensions/*`, `brandIcons.ts`; catalog / guide entries `godot`, `godot-editor`, `godot-funplay`.
- v29 git diff (PLAN-v29): desktop `preview/changes.ts` `fileDiff`; web `lib/diffBlocks.ts`, `lib/changesTree.ts`, `DiffView.vue`, FilePane gutter + `HunkPopup` + `ChangeRuler`.
- v30 Git Log (PLAN-v30, docs §11s): shared `gitlog.ts`; desktop `preview/log.ts`; web `lib/commitGraph.ts`, `composables/useGitLog.ts`, `workspace/log/*`.
- v31 Run: shared `run.ts`; desktop `run/*` (`RunManager`, detectors, runners, `trust.ts`, `watch.ts`, `toolchain.ts`, `android/jdkPick.ts` `chooseJdk`); web `stores/run.ts`, `Run{Pane,Bar,Log,ConfigsDialog,Badge}.vue`, `lib/runUi.ts`; E2E `run-pane.cjs` + `fixtures/run-fakes`.
- v32 / v44 / v46 XML layout preview: `apps/layout-daemon` (Paparazzi / layoutlib, warm project LRU, loose kit `LooseKitGen`, drawables, `scale`); desktop `layout/*` (`LayoutDaemon`, `LayoutModelService`, `pickModule` borrows an app model, `cds.ts`); web `LayoutPreview.vue`, `LayoutBoxes.vue`, `DrawablePreview.vue`, `lib/layoutPreview.ts`.
- v33 / v34 split diff: `lib/splitDiff.ts`, `SplitDiff.vue`, `useDiffDecor.ts`, `--histogram`, ←/→ step files (`fileStepKey`), `lib/diffImports.ts`.
- v35 Explorer context menu: `renameEntry` / `trashEntry`, `ui/ContextMenu.vue`, `lib/menu.ts`, `lib/explorer/contextMenu.ts`.
- v36 Log Branches toolbar: shared `gitBranch.ts`; desktop `preview/branches.ts` + `main.ts` `confirmGit`; web `LogRefsToolbar.vue`, `NewBranchDialog.vue`, `lib/refPrefs.ts`.
- v37 attachment removal: `promptAttachments.ts` `eraseKeys`, `attachments.reconcile`.
- v38 multi-project rail (PLAN-v38, docs §11t): `lib/rail/*`, `composables/{useRail,useClusterDrag,useOpenProject}.ts`, `workspace/rail/*`, `MissionControl.vue`, `AttentionPopover.vue`; desktop `ccm:project-root` `common` / `remembered`.
- v39 sidebar width `lib/sideWidth.ts` + `SideResizer.vue`.
- v40 Flutter widget preview: shared `flutterPreview.ts`; desktop `flutterPreview/*`, `run/flutter/machine.ts`; web `FlutterPreviewPanel.vue`.
- v42 file editor (docs §11u): `CodeEditor.vue` (CodeMirror 6), `lib/editor/*`, `lib/fileEditor.ts`, `Pane.dirty` / `saveFiles`; desktop `preview/fileWrite.ts`, `confirmUnsaved`.
- v43 rail context menu `lib/rail/railMenu.ts`.
- v45 performance (PLAN-v45, docs §11v): koffi `win-procs.ts` + `ps-host.ts`; `store.ts` `coalesce`; listen before `monitor.start()` (`sessions.loading`); `tailer.ts` `readEach` + `signalLineFilter` / `liteFilter` / `SyncScope`; web highlight worker `lib/highlight.ts`, `lib/rowWindow.ts`, `useWindowCopy.ts`.
- v47 Agent Map keyboard / find / menus: `lib/mapNav.ts`, `lib/mapText.ts`, `lib/mapMenu.ts`, `composables/useAgentActions.ts`; per-platform key labels `lib/shortcuts.ts` `formatKeys` / `keyCombo`.
- v48 pane drag: `splitLayout.ts` `dockTree` / `movePane` / `dockSpot`, `composables/usePaneDrag.ts`, new terminals join their project tab.
- Rename Agent Monitor → GolAIm (display only, `main.ts` `USER_DATA_DIR` pin); golem icon via `scripts/make-icon.mjs`; startup intro + login item (`ccm:login-item`).
- Full access switch: `preview/grants.ts` `FullAccess`, `ccm:full-access`, asked once on first Workspace mount.
- Popups opaque: `--ccm-material-pop` solid, no backdrop blur on menus.
- Fixes: `AppSelect` `inheritAttrs:false`; drawable i18n `{'@'}` + `i18n/messages.test.ts` compiles every message; `build.mjs` `buildDaemon` on dev start when artifacts are missing.

## 2026-10-16 — v49–v54

- XML preview without a Gradle model: `layout/sourceModel.ts`, `gradleGraph.ts`, `gradleCache.ts`, `autoCompile`; daemon `SampleData.kt`.
- `FilePane` Ctrl/⌘+A scoped to the code (`isSelectAllKey`).
- v49 agents open panes (PLAN-v49, docs §11w): PTY host `pty/mcp.ts` tool `open_session` (20 / pane / min, `OPEN_RATE_MAX`), `GOLAIM_*` env; deeplink `agent-monitor://open` (`openLink.ts`).
- v50 workspace groups (PLAN-v50): `RailGroup`, `Tab.name`, `lib/subagents.ts`, `lib/tabMenu.ts` / `tabStrip.ts`, Mission grid `MissionCard`, dust `lib/dust.ts` (opt-in `settings.dustEffect`) + desktop `capture.ts`.
- v51 Compact handoff (PLAN-v51, docs §11x): `lib/compactHandoff.ts`, `composables/useCompact.ts`, `Pane.compact`.
- v52 workspace polish (PLAN-v52): `usePaneInfo` state vocabulary, `PaneMore.vue`, `Tab.zoom`, undo close `closedStack` + `UndoToast.vue`, `DimToggle.vue`, `missionLayout.ts`, `lib/inputModality.ts`.
- Start view: Workspace on every launch (`ui.initialView`, `ccm.view` in sessionStorage).
- v53 Monitor + Usage redesign (PLAN-v53): `MainNode` / `SubPill` / `DoneTray`, `lib/layout.ts` `pickLayout`, `TreeEdge`, `ContextRing`, `UsageHero` / `UsageRankList`; map key `ccm.mapLayout.v53`.
- v54 messaging (PLAN-v54, docs §11y §11z): `tracker.ts` `recordMessages` → `Agent.msgIn/msgOut`; `peers.ts` `PeerLinkStore` (`CCM_PEER_TTL_MIN`) → `link.*` + snapshot `peerLinks`; web `stores/peers.ts`, `PeerEdge.vue`, `usePaneInfo.peerOf`.
- CI: `package-lock.json` tracked; tests use `realpathSync.native`; `job-stop.ts` / `codex/monitor.ts` path per platform.

## 2026-10-17

- Taskbar icon blank: dead Start Menu `.lnk` removed by `shortcuts.ts` `removeDeadShortcuts` (`main.ts` `removeStaleShortcuts`).
- v53 Explorer in its own right panel: `WorkspaceView.vue` `explorerOpen` / `explorerWidth`, `SideResizer` `edge`, `sideWidth.ts` key params, `explorer.retryFailed`; `preview/ipc.ts` re-asks a fresh pane census before refusing.
