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
- `hub.ts` `OfficeHub`: store listener -> model, commit <= 200 ms, tick 1 s, `TimelineRecorder.ingest` per changed commit (`<dataDir>/timeline/*.jsonl`), names in `<dataDir>/office-names.json`; sends `office.snapshot` only to clients that sent `office.subscribe` (no WS traffic without a subscriber; the recorder always writes). `npm run dev` needs its own `CCM_DATA_DIR`, or a dev collector and the packaged app both append to `timeline/<today>.jsonl` (and demo-fixture sessions land in the real timeline). `model.ts` keeps `toolStart` per agent so the activity id / `at` stay put while `currentTool` is unchanged (otherwise each `updatedAt` / token change re-ran the sim delegate walk and cost a recorder delta). `office/locale.ts` `useEnglishOffice()` (first line of `main()`) sets Habblaud `setLocale('en')`: recorder / NameStore logs and timeline error bodies in English.
- `server.ts` `cacheControlFor(root, file)`: `immutable` only for direct `assets/<name>-<8-char hash>.<ext>` children (Vite output); public files copied under `assets/` (Habblaud `art/`, `brand/`, `illustrations/`, `manifest.json`, `og-image.png`) get `no-cache` (test `csp.test.ts`).
- `server.ts` `timelineDir` -> `createTimelineHandler` (vendored `@ccm/habblaud` `server/http/timeline.ts`): `GET /api/timeline/days`, `/api/timeline/:day`, behind the app key. `@ccm/habblaud` bundles into `stage/collector.cjs` like `@ccm/shared` (no `build.mjs` change). No env vars added. Tests `office-model`, `office-hub`.

## Codex CLI — `codex/` (docs `docs/codex-integration.md`)

- `rollout.ts` `classifyLine` (content lines never parsed), `extractCodexSignals`, `CodexThreadState`, `modeOf`.
- `reader.ts` `readSessionMeta`, `RolloutTailer` (8 MB tail start).
- `processes.ts` `listCodexProcesses` / `windowsCodexProcesses`, `modeOfCommandLine`, orphan detection.
- `link.ts` `matchProcesses`, `claudeTargetFor`, `callerOf`: links a Codex run to the Claude agent that launched it.
- `processes.ts` also holds the shared walker: `CliProcess`, `listProcessesNamed`, `windowsProcessesNamed`, `unixProcessesNamed`, `parseWindowsRows`, `topLevel` (used by `deepseek/`).
- `monitor.ts` `CodexMonitor`: watches `sessions/` + `session_index.jsonl`, publishes `codex:<id>` agents under the Claude terminal (or own terminal), limits via `LimitHistory` (`codex-limit-history.json`). Glue: `Monitor.codex` / `claudeTargets`.

## DeepSeek CLI (Codewhale) — `deepseek/` (docs `docs/deepseek-integration.md` Status)

- `outbox.ts` `codewhaleHome`, `outboxPathFrom` (only `[lifecycle_outbox] path`), `parseOutboxLine` (ids / fixed kinds only), `DeepseekThreadState` (turn / stalled / subagents / ended).
- `processes.ts` `parseCodewhaleArgs` (`-C` / `-r` only), `toDeepseekProcesses`, `listDeepseekProcesses`, `matchDeepseekProcesses` (resume id → workspace → start time → lone process).
- `monitor.ts` `DeepseekMonitor`: `JsonlTailer` (`fromEnd` 256 KB, `maxLine`) on the outbox, watches its folder + home `config.toml`, publishes `deepseek:<thread_id>` terminals (+ `:main`, `:sub:<id>`), activity `turn.*`; scan on new session + every `processVerifyMs`. Glue: `Monitor.deepseek` (`pidOf` / `cwdOf` / `dismissEnded` / diagnostics), `config.ts` `codewhaleHome` / `deepseek` (`CCM_DEEPSEEK`). `tailer.ts` `TailOptions`. Test `deepseek.test.ts`.

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

`units`, `tracker` (+ snapshot), `monitor`, `tailer`, `usage`, `extras`, `context`, `codex`, `deepseek`, `peers`, `tool-spans`, `job-actions`, `favorites`, `daystart`, `datadir`, `toast`, `toast-electron`, `focus-mac`, `win-procs`, `hardening` (origin, bad URI, port clash), `csp` — all `*.test.ts` in `test/`.

## Hook bridge + heatmap (2026-10-29)

- `hooks.ts` `HookReader` reads `<dataDir>/hooks/<uuid>.json` (written by `scripts/hook-bridge.mjs`) on the existing extras poll (`monitor.pollHooks` in `pollExtras`, no watcher); `parseHookRecord` keeps only known keys, `COMPACT_STALE_MS` 15 min drops a lost PostCompact; `monitor.hookFields(sessionId)` spreads `compactingSince` / `compactTrigger` / `deniedCount` / `deniedTools` into `publish` (docs §11y). Test `hooks.test.ts` runs the real script.
- `usage.ts`: per-file `hours` (`day|hour` counts), `hourTotals`, `heatmap(days, today)`; `CACHE_VERSION` 3 (one full rescan after update). `index.ts` `heatmap.get` → `heatmap.data` (28 days).

## v73 (2026-10-29)

- Tool stats (docs §11ab): `usage.ts` `toolCallsOf(block)` (name; `Skill` → `input.skill`, `Agent`/`Task` → `input.subagent_type` or `general-purpose`; `mcp__<server>__*` → server via `mcpServerOf`), per-file `tools` `day|kind|name|cwd` (kinds t / m / s / a, errors e / f) + `toolTotals`; split lines of one `message.id` count when the owner is the same file; `is_error` user lines matched through in-memory `openTools` (≤ 500 ids per transcript); `toolStats(days, project, today)` (lists ≤ 50, `projects` busiest first, `used30`). `CACHE_VERSION` 4. `index.ts` `toolstats.get` → `toolstats.data`; `server.ts` accepts days 7 | 30 and project null | 1..1024 chars. Tests `usage.test.ts` (tool stats), `hardening.test.ts`.
- Usage limit (docs §11ac): `transcript.ts` `limitHitOf` (`isApiErrorMessage` + `apiError: usage_limit_reached`, `quotaLimits.resetsAt` epoch s → ISO, `rateLimitType`) and `RESUME_NOTICES` prefixes (system `informational`: armed / cancelled / reset) → `TranscriptState.limitHit` (cleared by a `model` signal or the reset notice) → `tracker.ts` `buildTerminal` spreads `limitHit` only when set (keeps the tracker snapshot). Tests `units.test.ts`.

## v75 (2026-10-29)

- Prompt search (docs §11af, owner-approved read of old prompts): `prompt-search.ts` `promptTextOf(rec)` (user record, not sidechain / meta / compact summary / tool result / `promptSource: system` / non-human `origin`, no `<command-*>` / `<local-command-*>` / `<bash-*>` / `<task-notification>` prefix), `matchesAll`, `snippetOf` (≤ 200 around the first match), `scanTranscript` (Buffer line split, prefilter `"type":"user"` minus `"tool_result"` / `"isMeta":true`, titles `custom-title` > `ai-title`, lines > `MAX_LINE_BYTES` 2 MB skipped), `listTranscripts` (top-level `<slug>/<uuid>.jsonl` only, mtime ≥ since, newest first, `projectDirName` slug prefix), `PromptSearcher` (one run per client, `cancel` / `dropClient`, cap 200 → `capped`, progress ≤ every 250 ms, `setImmediate` between files, per-client `found` cwd map for `open`). `index.ts` routes `promptSearch.*`, `onClientClose` drops; `server.ts` validates (`isSearchId`, query 1..200, days 7|30|90|0, project absolute ≤ 1024 or null, `isAgentSessionId`). Tests `prompt-search.test.ts`.

## v76 (2026-11-01)

- Resource sampler R1 / R1b / R1c (docs §11ag): `resources/procs.ts` `ProcRow` {pid, ppid, name, start (FILETIME / lstart text), startMs, ramBytes, cpuMs, cmd?}, `procKey`, `ProcReader` {read, enrich(rows, usagePids, cmdPids)}: `nativeReader(WinProcApi)` (table, then `usage` / `commandLine` only for wanted pids, cmd cache per key, CIM fallback when `list` throws), `cimReader` (`parseCimTable`), `psReader` (`parsePsTable`, `parseCpuTime`), `defaultProcReader`. `resources/tree.ts` pure `buildTree({rows, sessions, lineage, ports?})` → session trees (daemons cut out), `ServerEntry` (tool shells under claude: `isToolShell`, cmd.exe only when it hosts a shell; leftovers of a session → orphan once the session is gone; machine-wide daemons / emulators via `daemonOf`), `seen` lineage; `cpuPercent`, `sumOf`, `mayBeDaemon`. `resources/idle.ts` `sessionIdleSince`, `isForgotten`, `serverBusy` (CPU null = busy, ports established), `trackBusy` / `idleSinceOf`, `emulatorIdleSince`. `resources/sampler.ts` `ResourceSampler` (30 s timer only while `setActive(true)`, two-phase enrich, lineage / prevCpu / busy maps pruned to live keys, `deviceUsed(DeviceUsedMessage)`, optional `ports` dep for R2, `onReport`). `win-procs.ts` `WinProcApi.usage` (`K32GetProcessMemoryInfo` + `GetProcessTimes`) + `nativeUsage`. `transcript.ts` `mentionsDevice` → `tool_use.device`, `TranscriptState.deviceCallAt`; `tracker.lastDeviceCallAt`, `monitor.lastDeviceCallAt`. `store.setResources` (emit only when changed besides `at`, in snapshot). `toast.ts` kind `idle`: `observeIdle(report)` (primes, one grouped toast per new forgotten episode, hides when none), `idleMinutes` / `idleWatch`, `formatBytes`, `serverLabel`; `server.ts` `onClientCount`, `notify.update.idleMinutes` via `sanitizeIdle`; `index.ts` `syncSampler` (windows > 0 or `toaster.idleWatch`), parentPort `device.used`. Tests `resources.test.ts`.
- Port table R2 (Agent B, docs §11ah): `resources/ports.ts` `parseTcpTable4` / `parseTcpTable6` (24 / 56-byte rows, network-order addr + port), `parseLsof` (`-F pnT`), `portsByPid` (LISTEN per pid, established per local port, pid ≤ 4 skipped), `bindTcpTable` / `winPortTable` (koffi `GetExtendedTcpTable`), `lsofPortTable`, `defaultPortTable` (off with `CCM_NATIVE_PROCS=0`), `portConflictIn` (EADDRINUSE / address already in use / port N is already in use → number only). `resources/fixture.ts` `CCM_RES_FIXTURE` JSON file → `fixtureProcReader` / `fixturePortTable` (re-read each pass). `transcript.ts` failed `tool_result` → `portConflict`, `TranscriptState.portConflict`; `tracker.lastPortConflict`, `monitor.portConflicts`. `sampler.ts` dep `conflicts`, `SessionRes.start/name`, `outsidePorts`, `portConflicts` (15 min, holder from port map). `index.ts` wires ports + conflicts and posts `{type: 'resources', report}` to the desktop parentPort. Tests `ports.test.ts`.
- Keep awake (Agent C): `index.ts` `postBusy` on every store change → parentPort `{ type: 'busy', agents, jobs }` (shared `busyCounts`) only when the counts change.
- Sensitive watch R5 (Agent D, docs §11aj): `sensitive/rules.ts` pure (`touchOf` Edit / Write / MultiEdit / NotebookEdit path or `commandHits` for Bash / PowerShell: git push -f, reset --hard, clean -fd, rm -rf / del /s / Remove-Item -Recurse with targets, adb uninstall, DROP TABLE; `normPath` handles `\\`, `/c/…`, `..`; `classifyTouch` applies groups / globs / ignore). `transcript.ts` `tool_use.touch` (transient). `sensitive/watch.ts` `SensitiveWatch` (`sensitive.json`, `check` dedupe 10 min per session + rule + path, safe dirs plans / todos / own projects slug / tmp/claude, `rootOf` = store repo root) → `tracker.toolActivity` pushes `sensitive` activity (live reads only). `toast.ts` kind `sensitive` (`observeSensitive`, `ruleLabel`). Phone R6: `Toaster.onPhone` episodes (waiting / question / permission + reminders, done ≥ `LONG_JOB_MS` 5 min via `trackWork`, job blocked, limit) honouring kinds (not done), quiet, snooze, not focus; `phoneName` = alias or cwd basename; `index.ts` posts them to parentPort, handles `sensitive.update` / `sensitive.ignore`; `store.setSensitive` / `projectRoot`.
- Follow-ups (v76): `resources/ports.ts` `netTcpPortTable(exec?)` = Windows port table without koffi (`CCM_NATIVE_PROCS=0` or the binding failed): one `powershell -NoProfile -NonInteractive` `Get-NetTCPConnection -State Listen,Established` per sampler pass (15 s timeout, JSON `{a, p, s, o}`), pure `parseNetTcp` (state number or name, drops bad port / pid, strips `%scope`) → `portsByPid`; `defaultPortTable` falls back to it. Same-line PowerShell statements need `;`: `CIM_SCRIPT` in `procs.ts` lacked it, so the CIM process fallback always failed to parse before (fixed). Masking: `maskSecrets` now lives in shared `secretMask.ts` (see protocol.md). Tests `ports.test.ts` +2.

## v77 (2026-11-01)
- R9: `toast.ts` `Toaster.observeDisk(DiskAlertMessage)` (kind `disk`, tag `disk:<label>`, danger → `phone` reason `disk` with `freeBytes`, quiet hours / kinds applied); `index.ts` parentPort `parseDiskAlert`.

## v80 (2026-11-03)

- `index.ts` parses `agent.note`; `toast.ts` `Toaster.observeNote` (TEXT `noteTitle` / `noteMore`, `hideFor` includes `note:`; attention follows "needs you", done follows "done" switch, info = Inbox only; quiet hours + snooze apply).
- `monitor.ts` `recordOf` stores `sessionId`; `history.ts` keeps it in `history.json`.
- v82 Telegram: `transcript.ts` `reply_text` signal → `TranscriptState.lastReply` (≤ 3000, memory only), `tracker.lastReply`, `monitor.replyOf`; `toast.ts` `ToastSnapshot.replyOf`, `Toaster.onTelegram` (done with `worked` / waits, not gated by kinds / quiet hours), `index.ts` posts to parentPort.
