# protocol — packages/shared

- `src/types.ts`: `TerminalSession`, `Agent` (role main|subagent), `ActivityEvent` (kind enum, data = labels only), `MonitorSnapshot`, `MonitorEvent`, `ServerMessage {seq, events[]}`, `ClientMessage {type:'resync'}`, `Patch<T>` (null = field cleared).
- `src/status.ts`: `PROTOCOL_VERSION`, `SUPPORTED_CLAUDE_VERSION`, `mapRegistryStatus` (busy→working, waiting→waiting, shell→idle+backgroundShell, idle→idle, else unknown), `mapTaskNotificationStatus` (completed|failed→error|stopped→cancelled), `mainAgentStatus`, `normalize*Status`, `isAgentFinished`.

| Event | Emitter | Consumer |
|---|---|---|
| snapshot | server on connect + on `resync` | web connection store → hydrate all stores |
| sessions.loading | MonitorStore.setLoading (index.ts: true before listen, false after the first reconcile) | connection store `sessionsLoading` |
| terminal.created/updated/removed | MonitorStore.upsertTerminal/removeTerminal | terminals store |
| agent.created/updated/removed | MonitorStore.upsertAgent/removeAgent | agents store |
| activity | MonitorStore.pushActivity | activity store |
| usage.reset | MonitorStore.resetUsage (UsageIndex start + scan end) | usage store `reset` |
| usage.updated | MonitorStore.updateUsage (changed buckets) | usage store `update` |
| usage.scan | MonitorStore.setUsageScan | usage store `setScan` |
| tool.span | MonitorStore.toolSpan (Monitor drains `SessionTracker.drainSpans`) | toolSpans store `upsert` |

Client → server: `resync`, `terminal.alias {terminalId, alias|null}` (collector sanitizes).
`TerminalSession.alias` = dashboard name; `title` stays registry name. `UsageBucket` = day|model|project|speed key + messages/input/output/cacheWrite5m/cacheWrite1h/cacheRead. `pricing.ts` `priceOf`/`estimateCost` (API list prices, checked date `PRICING_CHECKED_AT`).

Invariants: snapshot `seq` = last flushed seq; next message seq+1; gap → client sends resync. Events batched per `batchMs` (50ms).
Tokens: input = input + cache_creation; cacheRead separate; total = input + output; dedupe per message.id.

- Sprint A: `TerminalSession.permissionMode/gitBranch/compactions`, `Agent.contextTokens/contextWindow`; activity kinds `terminal.compacted` (data trigger/preTokens/postTokens), `terminal.mode` (mode), `launch.started` / `launch.failed` (title, mode, error notFound|failed); `Favorite {dir,label,addedAt}` in snapshot `favorites` + event `favorites.updated`; ClientMessage `favorite.toggle|remove|open` (`LaunchMode` new|continue). Shared `context.ts`: `contextWindowOf` (order: hints `reported` → `max(catalog, guess)`; guess = `[1m]`/settings/peak>200k else 200k), `contextLevel` (60/80/95), `modelFamily`.
- G2/G3/G7: `TerminalSession.statusSince`; `UsageSnapshot.roots` (cwd → repo root) + event `usage.roots {roots}` (additions only).
- ClientMessage `terminal.dismiss {terminalId?}`: removes ended (stale) sessions only; no id = all ended. Live sessions ignored.
- ClientMessage `favorite.rename {dir, label: string|null}` (sanitized like aliases; null/blank → folder basename).
- Sprint E–G: `Agent.effort`, `Agent.cacheTtl ('5m'|'1h')/cacheAt`, `TerminalSession.costUsd`; activity `job.blocked`/`job.done` (data.title); snapshot `jobs` (`BackgroundJob`), `limits` (`PlanLimits` fiveHour/sevenDay {usedPct 0–100, resetsAt}), `response` (`ResponseStats`), `modelNames`, `statusLineCommand`; events `jobs.updated`, `limits.updated`, `response.updated`, `models.updated`.
- `favorite.add {dir, label?}` (client) → collector validates local abs dir; rejection event `favorite.rejected {dir, reason}` (broadcast; clients match their pending add).
- Sprint H: `LimitWindow.forecast` (`LimitForecast`), `SessionRecord`, `DayTimeline`/`TimelineLane`/`TimelineSegment` (`LaneStatus`), `FocusWindowResult` (+ `appOnly` = app opened, tab unknown; `denied` = Automation refused). Client: `terminal.focusWindow {terminalId}`, `history.get`, `timeline.get`. Events: `terminal.focusResult`, `history.data`, `history.added`, `timeline.data` (all broadcast).

- `folder.pick {requestId}` (client) → `folder.picked {requestId,result,dir?}` broadcast; tab khớp requestId mới dùng. Result: ok|cancelled|busy|failed|unsupported.

- Direct replies: `ServerMessage.direct = true`, `seq: -1`; web applies without seq check. Used for history.data, timeline.data, terminal.focusResult, folder.picked, terminal.openResult, diagnostics.data.
- `terminal.open {terminalId, app: explorer|vscode}` → `terminal.openResult {terminalId, app, result}`.
- `diagnostics.get` → `diagnostics.data: Diagnostics`.
- `TerminalSession.diff?: GitDiffStat {files, insertions, deletions, untracked, at}`.
- `MonitorSnapshot.dayStartedAt?: string` — first collector start of the local day (break reminders).
- ClientMessage `favorite.reorder {dirs: string[]}` (≤100, each ≤1024 chars) — full desired order; `favorites.updated` broadcasts list in that order.
- `BackgroundJob.sessionId?`; `JobStopResult = ok|notFound|noCli|failed`; activity `job.stopped`/`job.stopFailed` (`data.jobId`, `data.error`); ClientMessage `job.dismiss {jobId?}` (done jobs only; none = all done) and `job.stop {jobId}` (≤64 chars, validated in `server.ts`).
- `ToastState = on|off|unsupported`; ClientMessage `client.presence {attentive, locale?}` (per socket, dropped on close); settings messages see v10 line.
- v10 notify: snapshot `notify?: NotifySettings {toast, kinds: Record<ToastKind,bool>, quiet: QuietHours}` (replaces `toast?`) + `snoozes?: Record<terminalId, SnoozeEntry {until ms, since}>`; events `notify.settings` (NotifySettings), `snooze.updated {snoozes}`; client `notify.update {toast?, kinds?, quiet?}` (replaces `notify.toast`), `terminal.snooze {terminalId, minutes|null}`. Shared `notify.ts`: `TOAST_KINDS`, `inQuietHours`, `sanitizeQuiet/Kinds`, `remindersDue`, `snoozedUntil`, `errorLoops` (moved from web).
- v11: `TerminalSession.note?`; `ToastKind` + `stuck|context`; `NotifySettings.stuckMinutes` + `health?: ToastHealth (ok|globalOff|appOff|unknown)`; client `notify.test` → direct `notify.testResult {result, health?}`, `terminal.note {terminalId, note|null}`, `notify.update.stuckMinutes`. Shared `quietFor`, `STUCK_CHOICES`, `sanitizeStuck` in `notify.ts`.
- Tool spans: `ToolSpan {id (tool_use id), terminalId, agentId, tool, start, end?, outcome?: ToolOutcome ok|error|interrupted}`; event `tool.span` (broadcast on open + close); client `toolSpans.get {terminalId?, since?}` → direct `toolSpans.data: ToolSpansData {terminalId?, since?, spans}` (closed with end ≥ since + all open).

- v16 Codex: `Provider = 'claude'|'codex'`; `TerminalSession.provider/codexSessionId/codexVersion` (`entrypoint` = Codex mode), `Agent.provider` (`type` = mode exec|tui|plugin|subagent|app-server, `contextPct` always set, raw ratio); ids `codex:<threadId>` (run in a Claude terminal / own terminal) and `codex:<threadId>:main`. Snapshot `codexLimits?: PlanLimits` (+ `plan`), event `codexLimits.updated` (MonitorStore.setCodexLimits → extras store). `Diagnostics.codex?`. Codex activity reuses `agent.*` with `data.agentType = 'codex'`, `data.description` = title.
- Wait labels: shared `status.ts` `waitReason(waitingFor)` → `WaitReason` `permission|question|other` (permission prompt/sandbox/worker request → permission; input needed/dialog open → question; else other, shown raw). Tool-specific text is web-side.
- C2b: shared `notify.ts` `ToastMessage` (`toast.show {tag,title,persistent}` | `toast.hide {tag}`), `parseToastMessage`, `badgeCount`; collector → desktop over parentPort only (no body/url).
- `favorite.open {dir, mode, terminalApp?}` (client): `TerminalApp = 'terminal'|'iterm'`, used on macOS only; server drops any other value (field removed). `launch.failed` activity `data.error`: `LaunchErrorCode` = notFound|denied|notInstalled|failed (denied/notInstalled macOS only).

## PTY channel (v18, desktop only) — `packages/shared/src/pty.ts`
Separate WS from the dashboard socket (desktop `pty-host.cjs`, not the collector). `PTY_PRESETS` claude|codex|shell, `PtyClientMessage` spawn/attach/resize/kill, `PtyServerMessage` ready/pid/exit/gone/error(message: preset|cwd|limit), `PtyEndpoint` {url, protocol} from preload, `PtySessionInfo` for quit census. Keystrokes/output are binary frames.
- P2: client `{t:'owners', pids}` (any authenticated socket, no session needed) → `{t:'owners', owners: {pid: sessionId} | null}` (null = process scan failed). Used by web `useWorkspaceLinks` over `PtyConnection.request` (throwaway socket).
- P4: client `wt.list {cwd}` / `wt.add {cwd, branch}` / `wt.remove {cwd, path}` → `wt.list {repo, worktrees: PtyWorktree[]}` | `wt.added {path, branch}` | `wt.removed {path}` | `wt.error {code: WorktreeError, detail?}`; host → attached socket `branch {branch|null}` on spawn/attach/HEAD change.
- P5: `spawn.resume` = UUID (`isAgentSessionId`), claude/codex only; host refuses otherwise (`error preset`); presets build `claude --resume <id>` / `codex resume <id>`.
- v2.1.0 PTY: client `cwd {cwd}` (shell folder from OSC 7 / 9;9, attached session) → host `cwd {cwd|null}` (validated real dir, re-sent on attach); `PtySessionInfo.liveCwd`.
- v28 Extensions (desktop IPC only, no WS events) — `packages/shared/src/extensions.ts`: `ExtScope` user|project|local, `CatalogEntry` (`install`: http | stdio | plugins | guide; `fields` with anchored `pattern`; `match` alias names), `CATALOG`, `PM_SKILLS`, `checkFields`, name regexes (`MARKETPLACE_REPO`, `MCP_NAME`, `PLUGIN_NAME`, no leading `-`), status `ExtStatus` / `McpServerRow` / `PluginRow`, `ExtResult` codes noCli|busy|cancelled|badInput|needsTerminal|failed|timeout, requests `ExtInstallRequest` / `ExtRemoveRequest` / `ExtSourceRequest`, `parseMcpLine`.

- v30 Git Log: desktop IPC only (`ccm:log-*`, no WebSocket events); shared types in `packages/shared/src/gitlog.ts` (`LOG_PAGE`, `LogQuery` (+ v36 `notRef`: `git log <branch> --not <notRef>`), `LogCommit`, detail / diff results). v36 `packages/shared/src/gitBranch.ts`: `checkBranchName` (mirrors `check-ref-format --branch`), `BranchOpError`, `BranchOpResult` (`detail` = one sanitized stderr line).
- v31 Run (desktop IPC only) — `packages/shared/src/run.ts`: `FlutterProject` / `AndroidProject` (`RunProject`), `RunDetectResult`, `FlutterEnv` / `AndroidEnv` + `EnvIssue {code, detail}` (i18n `run.env|validate|fail|error.<code>`), `RunDevice` / `RunEmulator`, `RunConfig` = flutter | android | custom, `RunCommandPreview`, `RunState` + `isRunLive`, `RunSession`, `RunLogLine` (stream build|app|logcat), `BuildError`, `RunEvent` session|log|error|devices|projects|configs, `RunStartRequest`, `RunResult`, `RUN_SHARED_DIR`.
- v40 Flutter widget preview (desktop IPC only) — `packages/shared/src/flutterPreview.ts`: invoke `ccm:fwp-scan(path, withEntries)|start(root, deviceId, flavor)|show(id)|stop|get`, push `ccm:fwp-state` (`FwpSnapshot`). `FwpEntry.skipped` private|params|unknown|type|part; `FwpError.code` (i18n `fwp.error.<code>`) incl. build|reload-failed (while running), device-lost|exited (after start, state `stopped`).
- v45: `MonitorSnapshot.loading?` (first pass still running; absent = done) + event `sessions.loading {loading}`. Batches merge `terminal|agent.updated` per id (last value per field, folded into a pending `created`, never across `removed`); a new socket's first message is the snapshot.
- v54 `Agent.msgIn?` (main → this subagent mid-run, coordinator records) / `Agent.msgOut?` (hand-backs + `SendMessage {to:"main"}` from it): counts only, subagents only, absent when 0, sent in `agent.created` / `agent.updated` (collector `tracker.buildAgents`); web pulses on increase only. Docs §11y.
- v54 peer links (collector side, docs §11z): `PeerLink {id = a<b ? a>b : b>a, kind 'message', a, b, ab, ba, firstAt, lastAt, lastDir, lastAgentId}` from `PeerLinkStore` → `MonitorStore.upsertLink/removeLink` → events `link.created` / `link.updated` (field patch, coalesced per id) / `link.removed` (TTL `CCM_PEER_TTL_MIN` or a terminal forgotten), snapshot `peerLinks`; activity `peer.message` (terminalId = sender, agentId = sending agent, `data.title` sender name, `data.to` receiver name), live only. `opened` links stay web-only.
- v49 pane open (`pty.ts`): `PtyClientMessage` spawn `open?` (ticket id from an accepted open; host adds `--session-id`/`-n`); `PaneOpenRequest {id, from? (caller PTY session id; absent = deeplink), preset, cwd, prompt?}`, `PaneOpenResult` `{ok, paneKey}` | `{ok:false, error: PaneOpenError unavailable|limit|cwd|preset|rate|failed}`, `PANE_OPEN_PROMPT_MAX` 8000, `cleanPanePrompt` (CRLF→LF, C0/C1 controls but \t\n stripped, trim). Host ↔ main parentPort `{t:'open', req}` / `{t:'open-reply', id, result}`; main ↔ page IPC `ccm:pane-open` / `ccm:pane-open-reply`.
