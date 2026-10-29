# protocol — packages/shared

Dashboard WebSocket (collector ↔ web) plus the shared types the desktop shell uses over IPC / the PTY socket. Paths are relative to `packages/shared/src` unless they name an app. Unions: `types.ts` `MonitorEvent` (server → client) and `ClientMessage` (client → server).

## Invariants

- On connect the server sends one `snapshot`, then `ServerMessage {seq, events[]}` batches (`batchMs` 50). Snapshot `seq` = last flushed seq; next message is seq+1; a gap → client sends `resync`.
- Direct replies: `ServerMessage.direct = true`, `seq: -1`, sent to the asking socket only (`ClientContext.reply`, collector `server.ts`); web applies them without the seq check.
- Batches merge `terminal|agent|link.updated` per id (last value per field, folded into a pending `created`, never across `removed`). `Patch<T>`: `null` = field cleared.
- Unknown event types / fields are ignored; unknown statuses map to `unknown` (`status.ts` `normalize*Status`).
- Terminal / session id comes from process / session identity, never the title. `TerminalSession.alias` = dashboard name, `title` = registry name.
- `ActivityEvent.data` carries labels only, never raw tool arguments or session content.
- Tokens: input = input + cache_creation; cacheRead separate; total = input + output; deduped per `message.id`.

## Server → client events

Emitter = collector `MonitorStore` method (`store.ts`) unless noted; consumer = `apply` in web `stores/connection.ts`.

| Event | Emitter | Web consumer |
|---|---|---|
| `snapshot` | `snapshotMessage` on connect + `resync` | `hydrate` (all stores) |
| `sessions.loading {loading}` | `setLoading` (true before listen, false after the first pass) | `connection.sessionsLoading` |
| `terminal.created/updated/removed` | `upsertTerminal` / `removeTerminal` | `terminals` (removed also clears `toolSpans`, `peers`) |
| `agent.created/updated/removed` | `upsertAgent` / `removeAgent` | `agents` |
| `link.created/updated/removed` | `upsertLink` / `removeLink` ← `peers.ts` `PeerLinkStore` | `peers` |
| `activity` | `pushActivity` | `activity` |
| `usage.reset` / `usage.updated` / `usage.scan` | `resetUsage` / `updateUsage` / `setUsageScan` (`usage.ts` `UsageIndex`) | `usage.reset/update/setScan` |
| `usage.roots {roots}` | `setProjectRoots` (additions only) | `usage.setRoots` |
| `favorites.updated` | `setFavorites` | `favorites.replaceAll` |
| `favorite.rejected {dir, reason}` | `rejectFavorite` (broadcast; tab matches its pending add) | `favorites.reject` |
| `tool.span` | `toolSpan` (on open + close) | `toolSpans.upsert` |
| `jobs.updated` / `limits.updated` / `codexLimits.updated` / `response.updated` / `models.updated` | `setJobs` / `setLimits` / `setCodexLimits` / `setResponse` / `setModelNames` | `extras.*` |
| `notify.settings` / `snooze.updated` | `setNotify` / `setSnoozes` | `extras.setNotify` / `snooze.replaceAll` |
| `history.added` | `historyAdded` | `history.add` |
| `history.data`, `timeline.data`, `toolSpans.data` | direct reply (`Monitor.sendHistory` / `sendTimeline` / `sendToolSpans`) | `history`, `toolSpans.applyData` |
| `terminal.focusResult`, `terminal.openResult` | direct reply (`Monitor.focusWindow` / `openFolder`) | `ui.reportWindowResult` / `reportOpenResult` |
| `folder.picked {requestId, result, dir?}` | direct reply (`Monitor.pickFolder`), else `store.folderPicked` | `connection.pickFolder` resolver by requestId |
| `diagnostics.data`, `notify.testResult` | direct reply (collector `index.ts`) | `extras.setDiagnostics` / `setToastTest` |

Snapshot (`MonitorSnapshot`) also carries `favorites`, `jobs`, `limits`, `codexLimits`, `response`, `modelNames`, `statusLineCommand`, `dayStartedAt` (first start of the local day, break reminders), `notify`, `snoozes`, `loading`, `peerLinks`.

## Client → server messages

Shape-checked in collector `server.ts` (unknown / malformed dropped, `maxPayload` 128 KB), dispatched in `index.ts`.

| Message | Handler | Notes |
|---|---|---|
| `resync` | `server.ts` | resend snapshot |
| `terminal.alias {terminalId, alias\|null}` | `Monitor.setAlias` | `aliases.ts` `sanitizeAlias` (control chars → space, trimmed, max length) |
| `terminal.note {terminalId, note\|null}` | `Monitor.setNote` | |
| `terminal.dismiss {terminalId?}` | `Monitor.dismissEnded` | ended sessions only; no id = all ended |
| `terminal.focusWindow {terminalId}` | `Monitor.focusWindow` | → `FocusWindowResult` (`appOnly`, `denied` on macOS) |
| `terminal.open {terminalId, app}` | `Monitor.openFolder` | `OpenApp` explorer \| vscode |
| `terminal.snooze {terminalId, minutes\|null}` | collector `snooze.ts` → `setSnoozes` | |
| `favorite.toggle / remove / rename / reorder / add` | `Monitor.toggleFavorite` / `removeFavorite` / `renameFavorite` / `reorderFavorites` / `addFavorite` | rename blank → folder name; reorder ≤ 100 dirs × 1024 chars; add = local absolute dir, else `favorite.rejected` |
| `favorite.open {dir, mode, terminalApp?}` | `Monitor.openFavorite` | `LaunchMode` new \| continue; `TerminalApp` terminal \| iterm (macOS, other values dropped); failures → activity `launch.failed` `LaunchErrorCode` |
| `folder.pick {requestId}` | `Monitor.pickFolder` | requestId ≤ 64; result ok \| cancelled \| busy \| failed \| unsupported |
| `history.get`, `timeline.get`, `toolSpans.get {terminalId?, since?}`, `diagnostics.get` | `Monitor.send*` / `diagnostics` | direct replies |
| `job.dismiss {jobId?}`, `job.stop {jobId}` | `Monitor.dismissJobs` / `stopJob` | jobId ≤ 64; `JobStopResult` ok \| notFound \| notRunning \| unconfirmed \| noCli \| failed |
| `client.presence {attentive, locale?}` | `Toaster.setPresence` | per socket, dropped on close |
| `notify.update {toast?, kinds?, quiet?, stuckMinutes?}`, `notify.test` | `Toaster.update` / `test` | sanitized via `notify.ts` |

## Shared modules

- `types.ts` — wire models: `TerminalSession`, `Agent` (role main \| subagent, `provider`, `contextPct`, `msgIn` / `msgOut`), `ActivityEvent`, `MonitorSnapshot`, `MonitorEvent`, `ClientMessage`, `ServerMessage`, `Patch<T>`, `UsageBucket` / `UsageSnapshot`, `Favorite`, `BackgroundJob`, `PlanLimits` / `LimitWindow.forecast`, `ResponseStats`, `SessionRecord`, `DayTimeline`, `ToolSpan`, `GitDiffStat`, `Diagnostics`, `NotifySettings`, `SnoozeEntry`, `PeerLink`, `Provider` (claude \| codex). Collector + web.
- `status.ts` — `PROTOCOL_VERSION`, `SUPPORTED_CLAUDE_VERSION`, `mapRegistryStatus`, `mapTaskNotificationStatus`, `mainAgentStatus`, `normalizeTerminalStatus` / `normalizeAgentStatus`, `isAgentFinished`, `waitReason` → `WaitReason`. Collector + web.
- `context.ts` — `contextWindowOf` (reported → catalog / guess), `contextUsedPct` / `contextRawPct` / `usablePct` (`AUTOCOMPACT_BUFFER_PCT` 16.5), `contextLevel`, `modelFamily`. Collector + web.
- `pricing.ts` — `priceOf`, `estimateCost` (API list prices, `PRICING_CHECKED_AT`). Collector usage + web.
- `notify.ts` — `TOAST_KINDS`, quiet hours / kinds / stuck sanitizers, `quietFor`, `remindersDue`, `snoozedUntil`, `errorLoops`, `ToastMessage` + `parseToastMessage` / `badgeCount` (collector → desktop `attention.ts` over parentPort, no body / url). Collector, web, desktop.
- `pty.ts` — PTY socket (desktop `pty-host.cjs`, separate from the dashboard WS; keystrokes / output are binary frames): `PTY_PRESETS`, `isAgentSessionId` (spawn `resume`, claude / codex only), `PtyClientMessage` (spawn / attach / resize / cwd / kill / owners / `wt.*`), `PtyServerMessage` (ready / pid / exit / gone / error / owners / branch / cwd / `wt.*`), `WorktreeError`, `PtyEndpoint`, `PtySessionInfo`, pane open `PaneOpenRequest` / `PaneOpenResult` / `PaneOpenError` / `cleanPanePrompt` (`PANE_OPEN_PROMPT_MAX` 8000; host ↔ main `open` / `open-reply`, main ↔ page `ccm:pane-open*`). Desktop + web.
- `extensions.ts` — `CATALOG`, `PM_SKILLS`, `checkFields`, name regexes, `ExtStatus` / `ExtResult`, install / remove / source requests, `parseMcpLine`. Desktop IPC + web.
- `gitlog.ts` — `LOG_PAGE`, `LogQuery` (`notRef`), `LogCommit`, refs / detail / contains results, `isHash`. Desktop IPC + web.
- `gitBranch.ts` — `checkBranchName`, `BranchOpError`, `BranchOpResult`. Desktop + web.
- `run.ts` — Run projects / envs / devices / configs, `RunState` + `isRunLive`, `RunEvent`, `RunStartRequest` / `RunResult`, `RUN_SHARED_DIR`. Desktop IPC + web.
- `flutterPreview.ts` — `FwpEntry` (v55 `kind?: 'class'`, skip reasons `ctor` / `web`) / `FwpScanResult` / `FwpSnapshot` / `FwpError` / `FwpResult` (`ccm:fwp-*`). Desktop IPC + web.
- `drawable.ts` — `drawableKind`, `drawableFolderKind`, `xmlRootName`, `DRAWABLE_ROOTS`. Desktop `layout/ipc.ts` + web `lib/drawablePreview.ts`.
- `layoutXml.ts` — `isLayoutRootName`, `isLooseLayoutXml`. Desktop + web layout preview.
- `entryName.ts` — `checkEntryName` (new file / folder names). Desktop `preview/explorer.ts` + web `CreateEntryDialog.vue`.
- `index.ts` — re-exports.

`office.snapshot {payload: OfficeSnapshot}` (server -> client) is a direct reply from `OfficeHub` to clients that sent `office.subscribe {on}` (client -> server, boolean checked in `server.ts`); never batched into `seq`. `GET /api/timeline/days` and `/api/timeline/:day` are plain HTTP behind the app key.

## Devices (v61, desktop IPC, not the WS protocol)

- `devices.ts` — `AdbDevice`, `AdbState`, `AdbTransport`, `AdbMdnsService`, `DevErrorCode`, `DevResult` / `DevBatchResult`, `DevSnapshot`, `QrStatus`, `DevEvent` (`devices` / `qr`). Desktop `src/devices/*` emits, web `stores/devices.ts` consumes over `ccm:dev-*`; the collector and the WebSocket protocol are untouched.

## v66 / v67 (2026-10-29)

- `heatmap.get` (client → server) → `heatmap.data {payload: UsageHeatmap}` (direct reply, not batched).
- `Agent.firstContextTokens` (v72, main only): prompt size of the first reply in the transcript.
- `TerminalSession` optional `compactingSince`, `compactTrigger` (`manual` | `auto`), `deniedCount`, `deniedTools` (≤ 5 tool names) — from the hook bridge, absent when it is off.
- `pty.ts`: `wt.add.copy?: string[]` (glob list), `wt.added.copied?: string[]` (paths copied).
