# collector — apps/collector

Paths relative to `apps/collector/src` (tests in `apps/collector/test`).

Flow: registry dir + projects dir (fs.watch) + reconcile 5 s → `Monitor` → `SessionTracker` → `MonitorStore` (diff / coalesce / batch) → `server.ts` (WS `/ws`, static web dist). Monitoring never sends prompts or calls an LLM; only counters / whitelisted fields leave the collector, never message content, socket paths or secrets.

## Entry & config

- `index.ts`: boot = `store.setLoading(true)` → `startServer` → shutdown handlers → `monitor.start()` → `setLoading(false)` → `codex.start()` → `usage.start()`; exits unless `CCM_APP_KEY` or `--dev`; port clash (`server.ts` `isPortInUse`) → `PORT_IN_USE_EXIT` 3; `process.parentPort` `shutdown`; shutdown flushes Toaster / snooze / usage; `uncaughtException` → log + exit(1).
- `config.ts` `loadConfig(env, platform)`: `CLAUDE_CONFIG_DIR`, `CCM_PORT` 4317, `CCM_STALE_TTL_MIN`, `CCM_PEER_TTL_MIN`, `CCM_WEB_DIST`, `CCM_VERIFY_PROCESSES`, `CCM_DEV_ORIGIN_PORT` (`devOriginPorts`), `CODEX_HOME` / `CCM_CODEX`, `CCM_STATUSLINE_BRIDGE|COMMAND`, `CCM_TOAST_BACKEND` (`toastBackend`), `activityLimit` 1000; `dataDir` = `CCM_DATA_DIR` || `datadir.ts` `defaultDataDir` (copy in `scripts/statusline-bridge.mjs`, parity `datadir.test.ts`).
- `json-file.ts` `JsonFile`: debounced atomic JSON under `<dataDir>` (tmp + rename).

## Data sources

- `registry.ts` `readRegistry`: `<pid>.json` only, whitelisted fields, 256 KB cap, torn record → `'unreadable'` keeps state; `socketKey` → `sockKey` (sha256, path never kept).
- `win-procs.ts` (koffi, win32): `nativeProcessTable` (Toolhelp32 + `GetProcessTimes`), `nativeCommandLine`; off via `CCM_NATIVE_PROCS=0`. Used by `process.ts`, `codex/processes.ts`, `focus.ts`, desktop `pty/owners.ts` / `run/proc.ts`; every caller keeps a PowerShell CIM fallback.
- `process.ts` `isPidAlive`, `queryProcesses` (win `queryProcessesWindows`, mac/linux `ps` lstart), `procStartMatches`, `parsePsOutput` / `parsePsNames`.
- `win-exe.ts` `windowsPowerShell` / `windowsTerminal` / `findOnPath`: every Windows spawn uses an absolute exe (a bare name resolves against the project cwd first).
- `tailer.ts` `JsonlTailer`: byte-offset tail in 1 MB chunks, partial-line buffer, reset on truncate; `readEach(onRecord, LineFilter)` per record.
- `transcript.ts` `extractSignals` + `TranscriptState`: tool_use / result, usage (incl. cache `ttl`), model, effort, turn_end, task notifications, `compact`, `permission_mode`, `branch`, codex calls, v54 `coordinator_msg` / `handback` / `send_main` (docs §11y), `peer_in` / `peer_sent` (docs §11z). Counters and ids only.
- `claude-settings.ts` `readSettingsModel` (only `model`); `model-catalog.ts` `readModelNames` / `readModelCatalog` / `parseModelWindows`.
- `statusline.ts` `StatusLineReader` + `latestLimits`: files written by `scripts/statusline-bridge.mjs` (limits, context %, buffer %).
- `jobs.ts` `JobReader` (`parseJobState` whitelist, `sessionId`); `job-stop.ts` `findClaudeCli` / `claudeCliCandidates`, `stopBackgroundJob` (`claude stop <id>`, no shell), `isDaemonRunning`.
- `repo.ts` `RepoRoots.resolve` (nearest `.git`, cached); `gitstat.ts` `readDiffStat` (`--shortstat` + untracked, `GIT_OPTIONAL_LOCKS=0`, 5 s).
- `daystart.ts` `firstStartToday` → `store.dayStartedAt`.

## Tracking

- `tracker.ts` `SessionTracker` (per terminal, `terminalIdOf` = pid:procStart): finds transcript, discovers `subagents/*.meta.json`, `recordLinks` (nested via `parentId`), subagent status (notification > tool_result > end_turn), `buildTerminal` / `buildAgents`, `contextOf` (shared `contextWindowOf` + `ContextHints`; `Agent.contextPct` prefers the bridge value), `recordMessages` (`msgIn` / `msgOut`), `recordPeers` → `drainPeers`, `drainSpans`. Partial reads: `signalLineFilter`, `SyncScope` / `SyncPlan`, lite catch-up (`isLiteCatchUp`, `liteFilter`, `linkedOutcome`). Snapshot test `__snapshots__/tracker.test.ts.snap`.
- `monitor.ts` `Monitor`: reconcile (new → verify procStart → catch-up; dead → stale; TTL → `forget`), `verifyLive` 60 s, watchers → `routeProjectChange` → `syncFiles`, `reconcileScope`; `refreshHints` / `pollExtras` (jobs, limits, cost, day roll); actions `setAlias` / `setNote`, favorites, `dismissEnded`, `dismissJobs` (persisted `dismissed-jobs.json`; stopped jobs auto-dismissed since `claude stop` never rewrites `state.json`), `stopJob`, `focusWindow`, `scheduleDiff`, `diagnostics`, `sendToolSpans`; `retireWatcher` on errored watchers.
- `tool-spans.ts` `ToolSpanLog`: pairs tool_use → result, `closeOpen` as `interrupted`, `prune()`, cap 2000 / 2 h → `tool.span`, `toolSpans.get` / `toolSpans.data`.
- `peers.ts` `PeerLinkStore`: session ↔ session links (msg_id dedupe, 2 s hold for sender, TTL) → store `link.*`, activity `peer.message`.
- `response.ts` `ResponseTracker` (today's waiting → busy durations).
- `aliases.ts` `AliasStore` + `sanitizeAlias` (`aliases.json`, notes `notes.json` with `MAX_NOTE_LENGTH`); dropped with the session.
- `favorites.ts` `FavoriteStore` (≤ 50, `favoriteKey`, `order`, `reorder`). `Monitor.addFavorite` rejects relative / UNC / non-dir / control-char paths; dirs to open come only from the store or tracker cwd, never from the client.
- `snooze.ts` `SnoozeStore` (`snooze.json`, pruned per episode).

## Store & server

- `store.ts` `MonitorStore`: terminals / agents / links maps, activity + `toolActivity` rings, diff → patch, `coalesce` per id, batch flush, seq; setters for usage, jobs, limits (incl. `setCodexLimits`), response, favorites, notify, snoozes, `peerLinks`, `setLoading`, `contextPct`, `setProjectRoots`.
- `server.ts` `startServer`: 127.0.0.1 only, `hasAppKey` (header `x-ccm-app`, constant-time) on every route but `/health`, `isAllowedOrigin`, WS heartbeat 30 s + `maxPayload` 128 KB, one stringify per batch, client messages validated by shape, `ClientContext {reply, clients, clientId}` for direct replies; POST `/focus` + GET `/snooze` (toast links, called by the desktop main); `serveStatic` with `contentSecurityPolicy` (inline-script hashes, test `csp.test.ts`).

## Office (v60) — `office/`

- `model.ts` `OfficeModel`: Orrery terminals / agents / ToolSpans -> `OfficeSnapshot` (room per project via `roomKey`, character per agent; grace 20 s offline / 25 s done; tool name / kind / icon only, never `detail`; `meta.version` is `''`, the collector has no app version).
- `hub.ts` `OfficeHub`: store listener -> model, commit <= 200 ms, tick 1 s, `TimelineRecorder.ingest` per changed commit (`<dataDir>/timeline/*.jsonl`), names in `<dataDir>/office-names.json`; sends `office.snapshot` only to clients that sent `office.subscribe` (zero cost without a subscriber).
- `server.ts` `timelineDir` -> `createTimelineHandler` (vendored `@ccm/habblaud` `server/http/timeline.ts`): `GET /api/timeline/days`, `/api/timeline/:day`, behind the app key. `@ccm/habblaud` bundles into `stage/collector.cjs` like `@ccm/shared` (no `build.mjs` change). No env vars added. Tests `office-model`, `office-hub`.

## Codex CLI — `codex/` (docs `docs/codex-integration.md`)

- `rollout.ts` `classifyLine` (content lines never parsed), `extractCodexSignals`, `CodexThreadState`, `modeOf`.
- `reader.ts` `readSessionMeta`, `RolloutTailer` (8 MB tail start).
- `processes.ts` `listCodexProcesses` / `windowsCodexProcesses`, `modeOfCommandLine`, orphan detection.
- `link.ts` `matchProcesses`, `claudeTargetFor`, `callerOf`: links a Codex run to the Claude agent that launched it.
- `monitor.ts` `CodexMonitor`: watches `sessions/` + `session_index.jsonl`, publishes `codex:<id>` agents under the Claude terminal (or own terminal), limits via `LimitHistory` (`codex-limit-history.json`). Glue: `Monitor.codex` / `claudeTargets`.

## Usage, history, limits

- `usage.ts` `UsageIndex`: all `projects/**/*.jsonl` → buckets day × model × cwd × speed (counters only), dedupe by message.id, persisted `usage-index.json`, background first scan → `usage.scan` / `usage.reset`, then `notify(file)` + 10 min sweep → `usage.updated`; `scanInfo`.
- `forecast.ts` `LimitHistory` (least-squares forecast, `limit-history.json`); `history.ts` `SessionHistory` (ended sessions ≤ 1000 → `history.added`); `timeline.ts` `StatusTimeline` (today's status segments).

## OS integration

- `focus.ts` `focusTerminalWindow` → win32 `focusProcessWindow` (`ConsoleHost` / `ancestorChain`) / darwin `focus-mac.ts` `focusMacWindow` (Terminal / iTerm by tty, else `appOnly`, -1743 → `denied`); `osascript.ts` `runCommand` / `parseOsaError`.
- `opener.ts` `openFolder` (Explorer / Finder / xdg-open, VS Code lookup; tracker cwd only).
- `launcher.ts` `launchClaude`: wt.exe tab or detached PowerShell; macOS Terminal / iTerm via `launchArgs` (dir + cmd as osascript argv, `quoted form of`); `hasControlChars` guard because the new shell's line editor acts on control bytes before quoting applies; `LaunchError(denied|notInstalled|failed)`; strips `ELECTRON_RUN_AS_NODE`.
- `folder-pick.ts` `pickFolder`: win32 PowerShell -STA IFileOpenDialog (path back as base64, no client input in the script), darwin `choose folder`.
- `toast.ts` `Toaster`: waiting / reminder / done / job / limit / stuck / context toasts, quiet hours, test + `refreshHealth`, key persisted in `notify.json` (`accepts` timing-safe), links via `CCM_TOAST_LINK` (`agent-monitor://`); Windows backend `ps-host.ts` `PsHost` (one long-lived PowerShell, JSON lines on stdin); `toast-electron.ts` `electronToastDeps` posts `toast.show|hide` to the desktop parent.

## Tests

`units`, `tracker` (+ snapshot), `monitor`, `tailer`, `usage`, `extras`, `context`, `codex`, `peers`, `tool-spans`, `job-actions`, `favorites`, `daystart`, `datadir`, `toast`, `toast-electron`, `focus-mac`, `win-procs`, `hardening` (origin, bad URI, port clash), `csp` — all `*.test.ts` in `test/`.
