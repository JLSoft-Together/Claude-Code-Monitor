# desktop — apps/desktop (Electron, Windows + macOS)

Paths are relative to `apps/desktop` unless they start at the repo root. Change history: `_meta.md`; plans `.planning/PLAN-v*.md`; docs §11j (shell), §11k (macOS).

Flow: `main.ts` `ready()` → `CollectorHost.start()` (fork collector; port already healthy → fatal `port-in-use`) → `boot()` startup page → BrowserWindow loads `http://127.0.0.1:<port>/`.

## Boot & main process

- `src/main.ts`: single-instance lock, AUMID / `appId` `dev.ccm.monitor`; `USER_DATA_DIR` pinned to `appData/Agent Monitor` before the lock (profile survives the GolAIm and Orrery renames); `lockPermissions` (notifications / clipboard / fullscreen, app origin only; `clipboard-read` for image paste); `harden` (window.open → `openAppWindow` or `shell.openExternal` http(s); cross-origin navigation blocked); main window (bounds `userData/window.json`, close = hide + one balloon), compact window (`?mode=compact`); tray (open / compact / start at login `--hidden` / logs / quit); `boot()` intro (`INTRO_MS`, `LEAVE_SCRIPT`) → host.start → load origin.
  - IPC in main: `ccm:pty-endpoint`, `ccm:pick-folder(near?)` (`src/pick-start.ts` `pickStartDir`), `ccm:logs`, `ccm:login-item`, `ccm:window-bg`, `ccm:appearance`, `ccm:zoom`, `ccm:statusline-state|enable`, `ccm:grant-folder`, `ccm:capture-rect`, `ccm:focus` / `ccm:select` / `ccm:pane-open` (page round trips), push `ccm:run-event`.
  - `isAppFrame` (top frame, app origin, `host.ownsPort`) gates every IPC channel here and in the `register*Ipc` modules.
  - Every native confirm (quit, status line, folder access, full access, git delete, Run prompts, extensions, unsaved files) goes through `confirmBox(win, opts)` (first button = action).
  - Quit only via tray (`window-all-closed` no-op). `before-quit` → `confirmUnsaved` → `confirmQuit` (PTY census + live runs, default Cancel; asks even if census times out) → `stopRuns`, `stopPreview`, host / PTY stop, `allSettled` + 8 s `app.exit` deadline. `session-end` skips dialogs.
  - `logReport` (`ccm:logs` copy | save → Downloads `agent-monitor-log-<stamp>.txt`): app / OS / port ownership + page diagnostics + tail of `collector.log` / `pty.log`, masked by `log-mask.ts`.
  - `repairLoginItem` + `LEGACY_EXES` re-point login entries from old exe names; `removeStaleShortcuts` (win32) → `src/shortcuts.ts`.
- Dev HMR (`npm run desktop:dev`): `--dev-url` → `DEV_URL` (loopback http, ignored when packaged) → `PAGE_ORIGIN`; `boot()` waits for Vite 30 s; `sendAppKey` / pty origins / collector `CCM_DEV_ORIGIN_PORT` include it. Vite `strictPort`.
- `src/pages.ts`: startup / error `data:` pages, golem intro (CSS only, `still()` for reduced motion + error page, sizes via `--mark` / `--word`), retry link `ccm-desktop://retry` → `boot()`.
- `src/strings.ts`: native strings en/vi by `app.getLocale()`.
- `src/appearance.ts`: `userData/appearance.json` {background, look, zoom} (`readAppearance` / `writeAppearance`, `parseLook` #RRGGBB, `nextZoom` −3…3); first-frame `backgroundColor`, zoom applied on `did-finish-load`, Ctrl +/-/0.
- `src/mac.ts`: `adoptLoginShellPath` (`$SHELL -ilc` PATH), `setMacMenu` (Close has `registerAccelerator:false`, page owns Cmd+W), `offerMoveToApplications`. `IS_MAC`: tray template icon, no AUMID / balloon, `activate` → `showMain`.
- `src/attention.ts` `createAttention(dock)` (macOS, `CCM_TOAST_BACKEND=electron`): collector `toast.show|hide` via `CollectorHost.onMessage` → dock bounce + badge (`badgeCount`); window focus → `settle()`; collector exit / quit → `clear()`.
- `src/shortcuts.ts` `removeDeadShortcuts(dir, appId, deps)`: deletes Start Menu `.lnk` with our AUMID whose target exe is gone (else the taskbar icon is blank). Test `test/shortcuts.test.ts`.
- `src/capture.ts` `dustSize` (≤ `DUST_MAX_PIXELS`): `ccm:capture-rect` (rect × zoom, ≤ 4 MP) → `capturePage` → scaled PNG for the dust effect. Test `capture.test.ts`.
- `src/log-mask.ts` `maskLog` / `createLogMasker` (tokens sk- / gh*_ / AKIA / xox*, opaque runs ≥ 32, home → ~). Used by logs, Run, layout, extensions, Flutter preview. Test `log-mask.test.ts`.

## Collector host

- `src/collector-host.ts` `CollectorHost`: `isHealthy` (`GET /health`); healthy port before fork = another collector → `FatalError('port-in-use')`, never borrowed (it would get the app key); `utilityProcess.fork(collector.cjs)`, output → `logs/collector.log` + 40-line `tail`; `stop()` posts `shutdown`, kill after 4 s; `ownsPort`; `onMessage`, `onExit`.
- Restart: exit 3 (`PORT_IN_USE_EXIT`, mirrors collector `server.ts`) → fatal, no restart; other exits → restart ≤ 3 times, then error page with log tail + retry (`boot()` resets the count). Boot waits `/health` 30 s.
- `collectorEnv`: `CCM_APP_KEY` (random per run), `CCM_TOAST_LINK` (win), `CCM_TOAST_BACKEND` (mac), `CCM_PORT`, `CCM_DATA_DIR`, `CCM_WEB_DIST`, `CCM_STATUSLINE_BRIDGE|COMMAND`, `CCM_KOFFI` (win), + inherited env. The CJS bundle needs `CCM_WEB_DIST` / `CCM_STATUSLINE_BRIDGE` always set (`import.meta` fallbacks do not work).
- Desktop only (v2.0.0, PLAN-v19): `sendAppKey` adds `X-CCM-App` to `ORIGIN/*` + the collector WS; the collector 403s everything else. The window must load the http origin, never `file://` (collector origin check, WS URL from `location.host`).

## Links & deeplinks

- `main.ts` `registerLinks` (packaged, win + mac `open-url`, `pendingLink` until `linksReady`), `linkIn(argv)` on first launch + `second-instance` → `openLink`:
  - toast links: snooze → `collectorFetch(/snooze)`; focus (needs non-empty `k`) → `paneHandles` (`ccm:focus` → `ccm:focus-reply` 1.5 s) → else POST `/focus` → else show app + `ccm:select`.
  - `agent-monitor://open` → `openFromLink` → `linkQueue` → `openLinkPane` → `pageOpen` (no confirm, owner decision; docs §11w).
- `src/openLink.ts`: `parseOpenLink` (agent default claude, absolute cwd, no UNC / control chars, `resume=<uuid>`), `takeLinkSlot` (10 / min), `realDir`, `paneOpenResult`. Test `open-link.test.ts`.
- `pageOpen(req)`: `ccm:pane-open` → `ccm:pane-open-reply` (id-matched, 5 s, `unavailable` without a page); also the PTY host's `onOpen`.

## Status line bridge

- `src/bridge.ts` `installBridge`: copies `statusline-bridge.mjs` → `<dataDir>/bin` (write if changed); command `node "<script>"`, else `.cmd` / `.sh` shim running the exe with `ELECTRON_RUN_AS_NODE=1`.
- `src/statusline.ts`: `readStatusLine` (ours / other / none / unreadable), `writeStatusLine` (backup `settings.json.ccm-backup`, tmp + rename, chains the old command via `--chain-b64`). `ccm:statusline-enable` shows the JSON in a native confirm. Docs §11q. Test `appearance.test.ts`.

## Preload

- `src/preload.ts` → `stage/preload.cjs` (sandboxed): `window.ccmDesktop` = every bridge method (pty, pickers, logs, preview, changes, log / git, explorer, layouts, scripts, run, layout preview, Flutter preview, extensions, file write / editors, appearance, open-pane, capture…); `on*` subscribers return an unsubscribe; `pathForFile` = `webUtils.getPathForFile`. Web types: `apps/web/src/lib/desktop.ts` `DesktopBridge`.

## PTY host & MCP (v18, v49)

- `src/pty/host.ts` → `stage/pty-host.cjs` (utilityProcess): node-pty from `CCM_NODE_PTY`; WS `127.0.0.1:<random>/pty` (Host 127.0.0.1, Origin in `CCM_PTY_ORIGINS`, token in `Sec-WebSocket-Protocol` `ccm.pty.<hex>`, `timingSafeEqual`); text frames = shared `pty.ts`, binary = I/O; `MAX_LIVE` 16; 256 KB ring replayed on attach; backpressure pause > 512 KB; kill = `taskkill /T /F` + `proc.kill()`; `trackBranch` (HEAD watch → `branch`), `cwd` reports (`resolveCwd`, `liveCwd`, `branchGen`), `wt.list|add|remove` (remove refuses main / dirty / live cwd, never `--force`), `owners`; parentPort `census` / `shutdown` (sync `taskkill`); watchdog exits when Electron dies.
  - MCP: per-pane `token` + env `ORRERY_API|TOKEN|MCP_CONFIG`, `onRequest` (401 before body, 64 KB cap), `openFrom` (preset, cwd, `resume`, rate `OPEN_RATE_MAX` 20 / min per pane, live + tickets < 16) → ticket 60 s → parentPort `open` → `takeTicket` on spawn.
- `src/pty/mcp.ts` (pure): `mcpGate` (path `/mcp`, Host, no Origin, POST, Bearer), `handleMcp` (JSON-only streamable HTTP), `OPEN_SESSION_TOOL`, `toOpenResult`. Test `mcp.test.ts`.
- `src/pty/presets.ts`: fixed presets only (win absolute `powershell.exe -NoLogo -NoExit -EncodedCommand <PS_CWD_HOOK[; agent]>`, posix validated `$SHELL -l -i -c`); `presetCommand(…, AgentOptions)` (claude `--session-id`, `-n`, `--mcp-config`), `isPaneName`, `MCP_CONFIG_JSON`; `childEnv` strips `CCM_*`, `ELECTRON_*`, `NODE_OPTIONS`, `ORRERY_*` (+ legacy `GOLAIM_*`), `AGENT_SESSION_VARS` (else pane agents become child sessions and leak the parent's messaging token); sets `TERM`, `COLORTERM`, `FORCE_HYPERLINK=1` (OSC 8 links; `run/proc.ts` drops it).
- `src/pty/shellInit.ts`: zsh `ZDOTDIR` wrappers + bash `PROMPT_COMMAND` (OSC 7) so the live cwd is reported; written by the host into `CCM_PTY_INIT_DIR`.
- `src/pty/supervisor.ts` `PtySupervisor`: lazy fork, fresh token per fork, `logs/pty.log`, `census()`, `stop()` (`endpoint()` rejects after), options `onOpen` / `mcpConfig` (`<dataDir>/orrery-mcp.json`) / `shellInitDir`, `relayOpen`.
- `src/pty/owners.ts` `readPidTable` (koffi table, else CIM / `ps`), `ownersOf` (ppid walk ≤ 32 to a session shell).
- `src/pty/git.ts`: `findGit` (own PATH walk), `runGit` (`-C`, no prompts / locks, `LC_ALL=C`), `parseWorktrees`, `isBranchName`, `worktreeDest`.
- Tests `pty.test.ts`; E2E `p2`–`p6.cjs`, `tabs-cwd.cjs`, `v49-open.cjs`.

## Preview server & IPC (files, git, explorer)

- `src/preview/ipc.ts` `registerPreviewIpc(deps)` → `{grant, dispose, resolveDir…}`; all channels behind `isAppFrame`: `ccm:preview-url|read-file|watch|unwatch|pick-file|pick-files|open-external|reveal|open-path|request-access|full-access|forget-grants|project-root|scripts|list-files|list-dir|create-entry|rename-entry|trash-entry|file-write|clipboard-image[-file]|capture-guest|changes-*|log-*|git-*`; push `ccm:preview-changed`, `ccm:changes-updated`, `ccm:forward-key`.
  - Roots = `main.ts` `paneRoots()` (PTY census cwds + `liveCwd`, cached 2 s; `fresh` bypasses) + grants. `explorerRoot` / `registerRepo` re-ask a fresh census before refusing a just-spawned pane.
  - `ccm:project-root` → `{root, repo, common?}` (git toplevel registered in `repos`; `remembered` → read-only `rootFacts`, docs §11t). `ccm:open-path` refuses executables. `trashFn` shared by trash + discard. `writeRoots` = allowed roots + registered repos.
  - `hardenWebviews`: `will-attach-webview` forces sandbox / no preload / partition `persist:ccm-preview` / http(s); guest keys matching `keys.ts` `workspaceChord` → `ccm:forward-key`. Only the main window has `webviewTag`.
- `src/preview/server.ts` `PreviewServer`: 127.0.0.1:0, `/<token>/<path>` per root, Host check, realpath prefix check, ranges, `no-store` / `nosniff`; CORP `same-origin`, `cross-origin` for `image/*` (the app page is another loopback port).
- `src/preview/paths.ts` (`isWithin`, `rootKey`, `rootOf`), `watch.ts` `RootWatcher` (`IGNORED` node_modules / .git / build dirs, 150 ms), `files.ts` `readFileForView` (text + `bom` / `eol` / `invalidUtf8`, image, binary, too-large…), `keys.ts` `workspaceChord` (mirror of web `lib/workspaceKeys.ts`).
- `src/preview/grants.ts`: `GrantStore` (`<dataDir>/preview-grants.json`, ≤ 100 absolute dirs, never roots / UNC), `FullAccess` (`preview-full-access.json`, off by default, `confirmFullAccess` warning; `first` asks once) + `filesystemRoots()`.
- `src/preview/fileWrite.ts` `writeTextFile`: ≤ 4 MB, realpath inside roots, existing file only, `expectedMtime` → `conflict`, keeps EOL + BOM, temp + rename with retry → `busy`. Never logs text. Docs §11u. Test `file-write.test.ts`.
- `src/editors.ts` `createEditorTracker`: `ccm:editor-dirty` (files + v62 auto save flag → `autoSave()`), `saveAll` → `ccm:editor-save-all` / `-reply`; used by `main.ts` `confirmUnsaved`.
- `src/preview/explorer.ts`: `listDir`, `createEntry`, `renameEntry` (same folder, case-only rename), `trashEntry` (OS trash); `fsFailure` → `busy|denied|missing|exists`. Test `explorer.test.ts`; E2E `explorer.cjs`, `explorer-menu.cjs`.
- `src/preview/gitExec.ts` `execGit` (`killTree`, `timedOut`); `changes.ts` status / `diff` (`diffArgs` `--histogram`, whitespace opts, 3 MB full-diff cap) / `fileDiff` / `discardFile` / `discardHunk`, `GitDirWatcher` (HEAD, index, refs, packed-refs, FETCH_HEAD), `commonDir`; `listFiles.ts` `FileListCache`; `clipboardImage.ts`. Tests `changes.test.ts`, `commonDir.test.ts`.
- `src/preview/log.ts`: `listRefs`, `logPage` (`cleanLogQuery`, `notRef`), `commitDetail`, `branchesContaining`, `commitDiff`, parsers. Docs §11s. Test `log.test.ts`.
- `src/preview/branches.ts`: `createBranch`, `deletePlan` / `runDelete` (never current branch / tags; `main.ts` `confirmGit`, unmerged → second confirm with `-D`), `fetchAll`, `updateBranch` (ff only), `sanitizeGitError`; v54 `pushPreview` (defaults + outgoing commits) / `pushBranch` (argv = shared `pushArgs`, never forced) / `pushRejection` (`--porcelain` `!` lines); IPC `ccm:git-push-preview|git-push`; network git 120 s. Tests `branches*.test.ts` (`branches-push.test.ts`), E2E `e2e/push.cjs`.
- `src/preview/scripts.ts` `detectScripts` (package.json / Makefile / justfile / Cargo / pyproject, names must match `SAFE_NAME`).
- `src/layouts.ts` `LayoutStore` (`<dataDir>/layouts.json`, `cleanLayout` validates every field, ≤ 20 per project, one `openOnStart`) + `registerLayoutsIpc` `ccm:layouts-list|save|delete|start`. Test `tier2.test.ts`.
- Tests `preview.test.ts`, `preview-ipc.test.ts`; E2E `browser.cjs`, `diff.cjs`, `split-diff.cjs`, `log.cjs`, `file-editor.cjs`, `csp.cjs`.

## Run (Android / Flutter, v31)

- `src/run/` (no shell spawns): `flutter/{detect,env,runner,devices,machine}.ts` (`flutter run --machine` JSON-RPC via `createMachineClient`, `flutter daemon` devices, `normalizeSetting`, pub get step), `android/{detect,env,runner,devices,jdkPick}.ts` (gradlew → `adb install` → launch → logcat; `chooseJdk` picks the Gradle-compatible JDK, `jdkNote`, `jdk-incompatible`), `configs.ts` `RunConfigStore` (personal `<dataDir>/run-configs`, shared `<repo>/.agent-monitor/run`, templates, auto-import), `command.ts`, `importers.ts` (`.run/*.xml`, `.vscode/launch.json`), `args.ts`, `parse.ts`, `proc.ts` (`defaultSpawner`, `killTree`, `killTreeSparing` keeps `GradleDaemon`, `nativeProcRows`), `resolve.ts` (`quoteCmdArg`, `BadArgError`), `before.ts`, `custom.ts`, `toolchain.ts`, `watch.ts` `ProjectWatchers`, `trust.ts`.
- `src/run/sessions.ts` `RunManager`: detect cache + `projects` push, merged devices, one session per (config, device), batched logs, `run-settings.json` (`layoutAutoCompile`, per-project Flutter SDK), `hold` / `releaseOwner`, `onSessionState`, `stopAll` / `killAll`.
- `src/run/ipc.ts` `registerRunIpc` → `ccm:run-*` (table in `.planning/PLAN-v31-v32-tasks.md`), dirs via `PreviewIpc.resolveDir`.
- Trust: passive env never execs an SDK / JDK inside the project (`*-local-unverified`); shared / imported configs drop blocked env keys (PATH, NODE_OPTIONS, JAVA_TOOL_OPTIONS, LD_PRELOAD…) and need a native `trust-config` confirm (sha256 in `run-trust.json`); env values masked in logs; cmd.exe lines refuse CR/LF/NUL.
- Tests `run-*.test.ts`, `jdk-pick.test.ts`, `proc-table.test.ts`; E2E `run-pane.cjs` with fake tools in `e2e/fixtures/run-fakes/`.

## Layout preview (v32, v41, v44, v46) + `apps/layout-daemon`

- `src/layout/download.ts` `LayoutlibBundle` (`<dataDir>/layoutlib/16.2.3`, https `dl.google.com` only, pinned size + sha256); `zip.ts` `extractZip` (zip-slip + size cap, `filter`); `jdk.ts` `findJdk` (≥ 17).
- `src/layout/daemon.ts` `LayoutDaemon`: `java … MainKt` with `rpc.ts` Content-Length framing; lazy `ensure()`; `render` / `renderDrawable` per `slot` (older request cancelled); watchdog 15 s, crash loop > 3 in 5 min → `failed`; idle 10 min shutdown; `requestRestart`; `progress` → `stage`; `apiLevel`.
- `src/layout/cds.ts`: static AppCDS (`planCds`, `snapshotClassList`, `finishDump`) used by `LayoutDaemon`. Test `layout-cds.test.ts`.
- `src/layout/ipc.ts` `registerLayoutIpc`: `ccm:layout-status|download|render|warmup|model-status|model-refresh|model-pick`, `ccm:drawable-render`; `isLayoutTarget` (res/layout* or loose view-root XML), `cleanText` (unsaved buffer ≤ 1 MB), `cleanScale`, `drawableDevice`, `cleanSwatches`, `RenderCache` LRU 32 (`cache/snap`), auto compile on missing classes; push `ccm:layout-event` (sent by `wire.ts`).
- `src/layout/model.ts` `LayoutModelService`: `resolve` / `pickModule` (library borrows an app model, `preferred-apps.json`), `refresh` (Gradle init script `apps/layout-daemon/init/ccm-project-model.gradle`, cached `<dataDir>/layoutlib/models/<hash>.json`, 5 / 15 min timeouts), `prepare` (disk cache only, never Gradle on open), `ensureLoaded` order: Gradle model → source model (prebuilt, then res-only) → loose kit → framework; res / code watchers, `afterBuild` / `afterRunTarget`, `autoCompile`.
- `src/layout/projectModel.ts` (`parseProjectModel`, `parseLooseKit`, `projectModelArgs`), `sourceModel.ts` `buildSourceModel` (res + cached AARs + kit, `appRJar`, `moduleClasses`), `gradleGraph.ts`, `gradleCache.ts` (`resolveCached`, `extractAar`), `wire.ts` `wireLayout` / `looseKitLoader` (masked `logs/layout.log`), `types.ts`.
- `apps/layout-daemon` (Kotlin, protocol in its `README.md`): `LayoutRenderer` (project LRU 3, `renderDrawable`, `imageScale`), `Project.kt` (`ProjectCallback.getParser`, `AarPrefetch`), `LayoutParser`, `SampleData.kt`, `Drawables.kt`, `PngWriter`, loose kit `LooseKitGen` (`stageLooseKit` → `build/loose-kit`). Tests `ProjectCacheTest`, `LooseKitTest`, `SampleDataTest`, `GoldenTest`, `DaemonTest`, `PngWriterTest`.
- Tests `layout*.test.ts`, `drawable.test.ts` (`make-zip.ts` helper), `layout-daemon.int.test.ts` (real jar, skips without build / JDK); E2E `loose-kit.cjs`, `layout-speed.cjs`, `drawable-preview.cjs`.

## Flutter widget preview (v40)

- `src/flutterPreview/scan.ts` (`scanDartSource`, `scanProject`; v55 widget classes: `scanDartClasses`, `widgetNames` by-name `extends` chain to `WIDGET_BASES`, `classHit`, `isWebOnly`, per-file `fileCache` by mtime + size), `host.ts` (`writeHost` → `.dart_tool/ccm_preview/main.dart`, error marker + `_ErrorCard`; v57 `hostContext` → `HostContext` riverpod / gen-l10n, per-preview `ProviderScope` keyed by id + `MaterialApp` delegates), `service.ts` `FlutterPreviewService` (`live.host` read at start; own `flutter run --machine` outside `RunManager`, lib watch → rescan + restart, `pubspec.yaml` → pub get, `gen` cancels stale starts), `ipc.ts` `ccm:fwp-scan|start|show|stop|get` + push `ccm:fwp-state`, `wire.ts`. Tests `fwp-*.test.ts`; E2E `flutter-preview.cjs`.

## Extensions (v28, docs §11r)

- `src/extensions/commands.ts` (pure): `mcpConfig`, `buildInstall` / `buildRemove` / `buildSource`, `showCommand` (secrets → ••••), list parsers. No page string may start with `-`.
- `src/extensions/status.ts`: `claudeJsonFile`, `readConfigured` (names only), `listSkills`, `probePrereqs`.
- `src/extensions/ipc.ts` `registerExtensionsIpc`: `ccm:ext-status|mcp|install|remove|source|login`; one mutation at a time, native confirm, `execFile` without shell, results `{ok}` / `{ok:false, code, detail}` with masked detail. Test `extensions.test.ts`; E2E `extensions.cjs`.
- `src/github/accounts.ts` (v58) `GitHubAccounts`: token accounts sealed by `safeStorage` in `github-accounts.json`, `add` (`GET /user`), `remove` / `setDefault`, per-repo `choiceOf` / `setChoice`, `accessOf` (`GET /repos`, 10 min cache), `resolve` / `envFor`; `gitAuthEnv` (env config extraHeader + empty github.com helper). `src/github/ipc.ts` `registerGitHubIpc` → `ccm:gh-accounts|gh-account-add|gh-account-remove|gh-account-default` (remove after native confirm). Preview IPC: `ccm:gh-repo-account(-set)`, `authOf` → `GitAuth` for `pushBranch` / `fetchAll` / `updateBranch` / `runDelete`; `gitExec` `opts.env`. Plan `.planning/PLAN-v58-github-accounts.md`.

## Build & packaging

- v60: `build.mjs` unchanged; `@ccm/habblaud` (collector `office/`, `server/http/timeline.ts`) resolves like `@ccm/shared` and lands in `stage/collector.cjs`. Headless check: `CCM_PORT=4319 CCM_DATA_DIR=<tmp> CCM_WEB_DIST CCM_STATUSLINE_BRIDGE node stage/collector.cjs --dev`, then `GET /api/timeline/days` answers JSON.
- `build.mjs`: esbuild → `stage/main.cjs`, `stage/collector.cjs` (from `apps/collector/src/index.ts`), `stage/pty-host.cjs`, `stage/preload.cjs`, `stage/package.json`; `external` electron + koffi. `buildDaemon` runs `apps/layout-daemon` gradlew with `gradleJavaHome` (JDK 17–24; Gradle 8.14 refuses 25): `--dist` → `shadowJar stageLooseKit` (must succeed); dev → `assemble` only when artifacts are missing; `CCM_SKIP_DAEMON_BUILD=1` skips.
- `electron-builder.yml`: app dir `stage`, output `release`; win nsis + portable x64 unsigned; mac dmg arm64 + x64 ad-hoc, `mac.protocols`; `--publish never`.
- Packaged layout: `resources/app.asar` (main), `app.asar.unpacked/collector.cjs` + `pty-host.cjs`, `resources/web`, `resources/bridge/statusline-bridge.mjs`, `resources/pty/node_modules/@lydell/node-pty` (host prebuilt; node-pty is a devDependency on purpose), `resources/koffi` (win only, loader + host prebuilt), `resources/layout-daemon/{layout-daemon.jar, ccm-project-model.gradle, loose-kit/}`, icons. Dev: `resource()` falls back to repo paths.
- Root `npm run dist` → `scripts/dist.mjs` (`dist:win` / `dist:mac` by host; no cross builds).
- CI: `.github/workflows/desktop.yml` (manual / tag `v*` → mac dmg with both node-pty prebuilts + win), `release.yml` (publish a desktop run's artifacts), `test.yml` (win + mac: daemon tests, typecheck, `npm test`, setup-java 21).
- Icons: source `scripts/assets/logo.svg` (= `apps/web/public/favicon.svg`, `apps/web/src/assets/art/01-logo.svg`); `scripts/make-icon.mjs` `FULL` mirrors its geometry (`SMALL`: one orbit + one planet, bolder, for ≤ 32 px and the tray glyph) → `ccm.ico`, `ccm-256.png`, `ccm-mac.png`, `ccmTrayTemplate{,@2x}.png`. Edit the SVG → update `FULL` / `SMALL` → rerun.

## E2E harness

- `npm run e2e -w @ccm/desktop [packaged exe]` → `e2e/run.cjs`; driver `e2e/cdp.cjs` (port 4399, temp profile + data dir, `launch({env})`, retrying temp cleanup); output in `%TEMP%/ccm-e2e`. Scripts are named per feature / version (`desktop-only.cjs`, `rail.cjs`, `pane-drag.cjs`, `v50-groups.cjs`, `v52-polish.cjs`, …); they pre-set `ccm.tourDone` / `ccm.tourWorkspaceDone` / `ccm.setupDone` in localStorage.

## Devices (v61, docs §11aa)

- `src/devices/parse.ts` (pure): `parseAdbDeviceRows`, `parseConnect` / `parsePair` / `parseDisconnect` (decided from output, `adb connect` exits 0 on failure), `parseMdnsServices`, `parseWlanIp`, `parseAddress` (rejects `-…`), `addressKey`, `isWifiId`, `transportOf`. `adb.ts` `createAdbCommands` (connect 15 s / pair 20 s / rest 10 s; `list` = `devices -l`). `history.ts` `DeviceHistory` (`DEVICES_FILE` `adb-devices.json`, tmp + rename, 200 max, no `unauthorized` / `emulator-*`, writes only on ready-set / alias change; null-prototype map, `get` uses `Object.hasOwn`, `__proto__` dropped on load). adb clients are killed with `run/proc.ts` `killAdbClient` (pid only, passed as `kill` to `collect` / `createAdbWatch` here and in `run/android/devices.ts`): the first client is the parent of `adb fork-server`, a tree kill drops every Wi-Fi connection.
- `manager.ts` `DeviceManager` (`mergeDevices` live rows + history, batches of 5, `toWifi`, `discover`, `qrStart` / `qrCancel`, `autoConnectOnce`, tracker via `run/android/adbWatch.ts` only while a window holds the view); `qr.ts` `newQrSecret`, `qrPayload`, `runQrPairing`. `main.ts` wires `DeviceManager` + `registerDevicesIpc`, `confirmRemove` native confirm, `strings.ts` en / vi.
- IPC `devices/ipc.ts` `registerDevicesIpc` (page values validated: id regex, ≤ 50 ids, 6-digit code (`invalid` for an app frame, `denied` otherwise), alias ≤ 64, `parseAddress`; `ownerOf` release on window destroy / navigation):

| Channel | Does |
|---|---|
| `ccm:dev-snapshot` / `ccm:dev-hold` | `{adb, devices, autoConnect}` / hold or release the tracker |
| `ccm:dev-connect` / `ccm:dev-pair` / `ccm:dev-to-wifi` | one address / address + code / USB → Wi-Fi |
| `ccm:dev-disconnect` / `ccm:dev-connect-many` | batch (`DevBatchResult[]`) |
| `ccm:dev-remove` | forget history rows after native confirm |
| `ccm:dev-alias` / `ccm:dev-auto-connect` | rename / auto-connect on launch |
| `ccm:dev-discover` / `ccm:dev-qr-start` / `ccm:dev-qr-cancel` | mDNS connect services / QR pairing |
| `ccm:dev-event` (main → page) | `DevEvent` `devices` / `qr` |

- Preload `devSnapshot` … `onDevEvent`. Tests `test/devices-*.test.ts`; E2E `e2e/devices.cjs` (ANDROID_HOME → fake adb, screenshots `devices-01..04` in the e2e output dir; Forget not driven, no native-confirm auto-answer).
- Frameless windows (2026-10-27): `main.ts` `baseWindow` — Windows `titleBarStyle: 'hidden'` + `titleBarOverlay()` (height `TITLE_BAR_H` 40, colour `look.bar` ?? canvas, symbols `look.ink`; `ccm:appearance` re-applies it to every window), macOS `hiddenInset` with traffic lights at {14, 14}. The page draws the bar (`AppHeader.vue`, preload `titleBar` = `overlay` | `mac`); startup / error pages get a 40 px drag strip (`pages.ts` `body::before`).

## v67 IDE + hook bridge (2026-10-29)

| IPC | Module | Notes |
|---|---|---|
| `ccm:search` | `preview/search.ts` | `git grep -z --untracked`, 2000 matches, one per webContents (old aborted via `execGit` `signal`) |
| `ccm:git-stage` / `-unstage` / `-can-amend` / `-commit` / `-commit-cancel` | `preview/commit.ts` | `apply --cached --check` first for hunks; message on stdin (`-F -`); amend only when `headUnpushed` + `confirmRun({kind:'amend'})` |
| `ccm:check-run` / `-cancel` | `preview/checks.ts` `CheckRunner` | only `detectScripts` scripts or `flutter analyze --no-pub`; 1 per dir, 2 per app, 15 min, output tail; `parseCheckOutput` |
| `ccm:wt-compare` / `-merge` | `preview/worktrees.ts` | ff-only / squash into `mainCheckout`, `confirmRun` lists the commands |
| `ccm:cp-state` / `-set` / `-take` / `-diff` / `-restore` | `preview/checkpoints.ts` `CheckpointStore` | own `GIT_DIR` `<dataDir>/checkpoints/<hash>.git`, `GIT_INDEX_FILE` separate, refs `refs/cp/*`, keep 30, restore → confirm, new files to trash |
| `ccm:hooks-state` / `-set` (main.ts) | `hooks.ts` | `readHooks` / `plannedHooks` / `writeHooks`, entries marked `hook-bridge`, `async: true`; native confirm shows the JSON |

- `pty/wtCopy.ts` `copySetupFiles` runs inside `wt.add` (never overwrites, 1 MB / file, 5 MB total, skips `node_modules` etc.), reply `wt.added.copied`.
- `strings.ts` `RunKind` (`amend` / `ff` / `squash` / `restore`) → `runTitle` / `runDetail` / `runConfirm`; `hooksOnTitle` / `hooksOffTitle` / `hooksDetail`. `main.ts` passes `confirmRun` + `dataDir` into `registerPreviewIpc`.
- `bridge.ts` `installBridge(..., name)` also installs `bridge/hook-bridge.mjs` (`electron-builder.yml` resource).
- Tests `search`, `commit`, `checks`, `worktrees`, `checkpoints`, `hooks`.
