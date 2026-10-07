# Claude Code Integration — Phase 1 Discovery

Verified against **Claude Code 2.1.289** on Windows 11 (2026-10-07).

Method: read-only inspection of `~/.claude/` (field names, types, enum values, counts — no message content read) plus static reading of the bundled `claude.exe` to confirm enums and writer logic. No hooks installed, no prompts sent, no API calls.

All paths below are relative to the Claude config root: `CLAUDE_CONFIG_DIR` if set, otherwise `~/.claude`.

---

## 1. Summary

| Need | Source | Reliability |
|---|---|---|
| Discover running sessions | `sessions/<pid>.json` (session registry) | High — official record Claude writes for itself |
| Terminal identity | `pid` + `procStart` from registry | High — `procStart` = Windows FILETIME of process creation |
| Title | registry `name` (+ `nameSource`) | High |
| Main agent status | registry `status` + `waitingFor` | High — includes `waiting` (permission prompt etc.) |
| Current tool | transcript `<sessionId>.jsonl`, last `tool_use` without `tool_result` | High |
| Subagents | `<sessionId>/subagents/agent-<id>.meta.json` + `.jsonl` | High — 31/31 linked to parent tool call |
| Subagent completion | `<task-notification>` in parent transcript, or parent `tool_result` | High |
| Token usage | `message.usage` on assistant records, dedupe by `message.id` | High |
| Model | `message.model` on assistant records | High |
| Windows Terminal tab title | not readable per tab | V2 |

**Hooks are not needed for MVP.** The registry already exposes `waiting` and its reason.

---

## 2. Session registry — `sessions/<pid>.json`

One file per running Claude Code process. Filename is the PID. Next to it is `<pid>.<sha256>.key` — **never read** (credential material).

### Fields

| Field | Type | Notes |
|---|---|---|
| `pid` | number | Windows PID of `claude.exe` |
| `sessionId` | string (uuid) | **Changes on `/clear`** while PID stays the same |
| `cwd` | string | Working directory |
| `startedAt` | number (ms epoch) | |
| `procStart` | string | Windows FILETIME (100 ns since 1601) of process creation. Matches `Win32_Process.CreationDate` within < 1 µs (rounding) |
| `procStartFt` | string, optional | Claude prefers `procStartFt ?? procStart` |
| `version` | string | e.g. `2.1.289` |
| `kind` | enum | `interactive` · `bg` · `daemon` · `daemon-worker` |
| `entrypoint` | string | observed `cli`; also `claude-desktop`, `claude-vscode`, `local-agent`, … |
| `pidDomain` | string | `win32:<hostname>` |
| `name` | string | Session name (title). Changed by `/rename` |
| `nameSource` | enum | `user` · `peer` · `derived` · `collision` · `auto` · `hook` |
| `nameSince` | number (ms) | When the current name was set |
| `formerNames` | array, optional | |
| `status` | enum | `busy` · `shell` · `idle` · `waiting` |
| `waitingFor` | string, optional | Reason when `status = waiting` (see §3) |
| `statusUpdatedAt` | number (ms) | |
| `updatedAt` | number (ms) | Any write |
| `peerProtocol`, `peerFeatures` | number, string[] | Inter-session messaging capability |
| `messagingSocketPath` | string | Named pipe `\\.\pipe\LOCAL\cc-msg-…` — **never expose** |
| `agent`, `state`, `detail`, `tempo`, `needs` | optional | Classifier fields; `tempo` = `active` · `idle` · `blocked`. Not observed populated here; treat as optional extras |
| `jobId`, `parkedJobId`, `spare`, `bridgeSessionId`, `logPath`, `hostSessionId`, `tmux` | optional | Background/remote features; ignore in MVP |

### Lifecycle

- Written by Claude on start, on every status change, on rename, on `/clear`.
- Observed: only live PIDs have files → Claude removes its file on normal exit. A crash can leave a stale file.
- Claude's own reader: ignores non-canonical filenames, caps file size at 262 144 bytes, and **retries once on a torn (half-written) record**. The collector must do the same: parse failure → retry after a short delay → otherwise keep the previous state.
- Claude's own liveness check = `process.kill(pid, 0)` plus process-creation-time match. The collector copies this.

### Process tree (observed)

```text
WindowsTerminal.exe → powershell.exe → claude.exe   (claude.exe = registry pid)
```

Parent process name gives the `shell` field. Not needed for discovery.

---

## 3. Status mapping

Writer logic in `claude.exe`:

- `waiting` when a reason exists, else `busy` while loading / delegated work active, else `idle`.
- `shell` = main loop `idle` **and** at least one background shell task is still running.

`waitingFor` values: `permission prompt` · `input needed` · `worker request` · `sandbox request` · `dialog open` · or a dialog-specific string. Treat it as free text.

| Raw `status` | Display status | Extra shown |
|---|---|---|
| `busy` | `working` | current tool |
| `waiting` | `waiting` | `waitingFor` |
| `shell` | `idle` | label "background shell running" |
| `idle` | `idle` | |
| missing / other | `unknown` | |
| PID dead or `procStart` mismatch | `stale` | kept 120 min, then removed |

---

## 4. Identity

| ID | Value | Why |
|---|---|---|
| Terminal ID | `${pid}:${procStart}` | Stable across `/clear` (sessionId changes) and safe against PID reuse |
| Main agent ID | `${terminalId}:main` | One per terminal |
| Subagent ID | `agentId` from `agent-<agentId>.jsonl` | Unique |

On `/clear`: same terminal, new `claudeSessionId`. The collector switches the tailed transcript and clears that terminal's subagents (they belong to the old session).

---

## 5. Transcripts — `projects/<cwd-slug>/<sessionId>.jsonl`

`<cwd-slug>` = cwd with non-alphanumerics replaced by `-` (e.g. `D:\work\web\claude-code-monitor` → `D--work-web-claude-code-monitor`). Don't compute it — locate by glob `projects/*/<sessionId>.jsonl`.

Append-only JSONL, often > 1 MB. Tail by byte offset; tolerate a partial last line.

### Record types (observed, 25 recent sessions)

| `type` | Use in monitor |
|---|---|
| `assistant` | `message.content[]` blocks: `tool_use` (name, id), `text`, `thinking`. `message.usage`, `message.model`, `message.id`, `stop_reason` (`tool_use` · `end_turn`) |
| `user` | `tool_result` blocks (`tool_use_id`, `is_error`); `toolUseResult` object; `<task-notification>` text |
| `system` | subtypes `turn_duration` (turn finished), `compact_boundary`, `local_command`, `away_summary` |
| `queue-operation` | `enqueue` / `dequeue` / `remove` of queued input; carries `<task-notification>` for background tasks |
| `attachment` | Many types; `task_status` is relevant, rest ignored |
| `ai-title`, `last-prompt`, `cost-state`, `mode`, `permission-mode`, `file-history-*`, `atis-latch` | Ignored in MVP (`ai-title` / `last-prompt` are content — don't expose) |

Common fields on message records: `uuid`, `parentUuid`, `timestamp`, `sessionId`, `cwd`, `version`, `gitBranch`, `isSidechain`, `agentId` (in subagent files).

Unknown `type`s must be ignored — the set grows between versions.

### Current tool

Last `tool_use` block (name only) whose `id` has no matching `tool_result` yet. Clear it when the result arrives or on `system/turn_duration`.

### Tokens

Each assistant API message is written once **per content block** with the **same** `message.id` and identical `usage` (1 318 duplicates, 0 mismatches). Sum `usage` once per `message.id`.

`usage` keys: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, plus extras. Token data is reliable → may be shown in MVP.

---

## 6. Subagents — `projects/<cwd-slug>/<sessionId>/subagents/`

Per subagent:

- `agent-<agentId>.jsonl` — its transcript (`isSidechain: true`, same record schema).
- `agent-<agentId>.meta.json`:

| Field | Observed values |
|---|---|
| `agentType` | `general-purpose`, `Explore`, `fork`, custom names |
| `description` | short task label (shown, per decision 6) |
| `toolUseId` | id of the `Agent` tool_use in the spawning transcript (main, or the parent subagent's transcript) |
| `parentAgentId` | present only when `spawnDepth ≥ 2`: agentId of the spawning subagent |
| `spawnDepth` | `1` (spawned by main), `2` (spawned by a subagent) — observed |
| `requestShape` | `background` (only value observed) |
| `requestNonInteractive` | boolean |
| `isFork`, `model` | optional |

### Parent link

`meta.toolUseId` = `tool_use.id` of an `Agent` tool call in the parent transcript — 31/31 matched.

### Nested subagents (verified 2026-10-07)

- Stored **flat** in the same `<sessionId>/subagents/` dir, not under the parent agent.
- `meta.parentAgentId` = parent subagent id, `spawnDepth: 2`, `requestShape: background`.
- The `Agent` tool_use + `async_launched` result live in the **parent subagent's** transcript.
- `<task-notification>` for the nested agent lands in **both** the parent subagent transcript (user message) and the main transcript (`queue-operation`).
- Collector: `parentId = parentAgentId` when that agent is known, else main agent. Notifications and foreground results are collected from main + every subagent transcript; resolution runs after all transcripts are read.

### Lifecycle signals

| Event | Signal |
|---|---|
| Created | new `meta.json` (watch the `subagents/` dir) |
| Launched (background) | parent `tool_result` with `toolUseResult.status = "async_launched"` — **not** completion |
| Current tool | last unanswered `tool_use` in `agent-<id>.jsonl` |
| Completed / failed / stopped | parent transcript gets `<task-notification>` containing `<tool-use-id>` + `<status>`; status enum `completed` · `failed` · `stopped` |
| Foreground agent done | parent `tool_result` for `toolUseId` with a non-async result |
| Fallback | subagent's last record is `assistant` with `stop_reason = end_turn` |

Mapping: `completed` → `completed`, `failed` → `error`, `stopped` → `cancelled`, no signal + parent ended → `unknown`.

Parse `<task-notification>` only for the tags `<tool-use-id>`, `<task-id>`, `<status>`. Never forward `<summary>` / `<result>` (content).

### Nesting

Only `spawnDepth = 1` observed. Nested subagents (depth ≥ 2) — file location not yet confirmed; verify in Phase 7 by spawning a subagent that spawns another. Model already supports `parentId` chains.

---

## 7. Windows-specific notes

- `fs.watch` on Windows may coalesce or drop events → watchers + reconcile scan every ~5 s.
- Liveness: `process.kill(pid, 0)` (cheap, every reconcile).
- PID reuse: verify `procStart` vs process creation time **once when a session is first seen** and every ~60 s, using a single batched PowerShell/CIM query for all PIDs. Claude itself spawns PowerShell for this (~1 s), so never call it per event.
- FILETIME compare tolerance: ± 10 000 units (1 ms).

---

## 8. Terminal title

- Claude writes its own console title (spinner `◐`/`◑`/`✳` + title), so the default Windows Terminal tab shows Claude's title.
- Windows Terminal hosts many tabs in one window; Win32 cannot read per-tab titles → deferred to V2.
- MVP title = registry `name`; rename via `/rename` updates `name` + `nameSource = user` and the watcher picks it up.

---

## 9. Privacy rules (enforced in collector)

Never read: `sessions/*.key`, `.credentials.json`, `session-env/`, `shell-snapshots/`, `paste-cache/`, `file-history/`.

Never forward to frontend: `messagingSocketPath`, tool inputs, message text, thinking, `lastPrompt`, `ai-title`, task-notification `<summary>`/`<result>`, `toolUseResult.prompt`, env values.

Forwarded: name, cwd, pid, status, `waitingFor`, tool **names**, `agentType`, `description`, model, token counts, timestamps.

---

## 10. Deviations from PLAN.md

| PLAN | Change | Reason |
|---|---|---|
| Process scan for discovery | Registry dir watch | Registry is official and cheaper |
| Terminal ID from "process/session identity" | `pid:procStart` | `sessionId` changes on `/clear` |
| Status `shell` TBD | → `idle` + "background shell" label | Verified writer logic |
| Hooks needed for `waiting` | Not needed | Registry has `waiting` + `waitingFor` |
| Tokens "only if reliable" | Reliable, dedupe by `message.id` | Verified |
| No database | JSON cache files in `CCM_DATA_DIR` (`usage-index.json`, `aliases.json`) | Full transcript scan ~12 s for 1.7 GB, and Claude deletes transcripts after `cleanupPeriodDays` (30) — history needs a local aggregate. Stores counts + cwd only |
| Terminal title from Windows Terminal | Dashboard alias + `/rename` / `claude -n` | WT tab rename lives only in WT's UI; no per-tab API and UIA tabs carry no PID |
| Observe-only (never start processes) | Favorites launcher: `wt.exe -w 0 nt -d <dir> powershell -NoExit -Command claude [--continue]`, fallback detached `powershell.exe` with `cwd` | User-requested. Only on an explicit click, only for dirs the user starred (server resolves the dir from its own `favorites.json`; the client never sends a free path to launch). Fixed command line, dir passed as `-d`/`cwd` only; paths containing `;` or `"` skip wt (wt sub-command separator). Starting `claude` costs no tokens until the user types |

## 11. Phase 7 validation results (2026-10-07)

| Scenario | Result |
|---|---|
| Real background subagent (Explore) | Detected via `meta.json`, tokens + current tool streamed, `completed` from task-notification < 1 s |
| Collector restart | Web shows `Reconnecting` + stale banner, keeps data, reconnects and resyncs |
| 5 sessions × growing subagents, 800 ms ticks (`scripts/demo-fixture.mjs`) | Collector CPU 0.2 %, RAM 77 MB |
| Idle on real data | CPU 0.0 %, RAM 65 MB |
| Rename / waiting / `shell` / `/clear` / dead PID / torn record / TTL removal | Covered by `apps/collector/test/monitor.test.ts` |
| 375 · 768 · 1024 · 1440 px, dark/light, EN/VI | No horizontal scroll (`scrollWidth == clientWidth`) |

Note: the internal tool `SubagentHandback` appears briefly as a subagent's current tool before completion.

## 11b. Usage history (verified 2026-10-07)

- `usage` keys on every assistant record: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `speed` (`standard` | `fast`, sometimes absent), `service_tier`, `inference_geo`, `server_tool_use`, `iterations`.
- Local data: 301 transcripts, 19 160 unique messages, 2026-09-06 → 2026-10-07; models `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `<synthetic>` (ignored).
- Cache read is > 95 % of all tokens → UI keeps the four types separate and hides cache read by default in token charts.
- Collector `UsageIndex` (`apps/collector/src/usage.ts`): per-file byte offset + per-file buckets (day × model × cwd × speed), dedupe by `message.id` **globally** — `--resume` / fork copies earlier assistant records (same id) into the new transcript (54 copies found locally). Each file keeps the ids it owns; a deleted transcript keeps its buckets but releases its ids. A shrunk file is recounted. Real data: cold scan 7 s for 300 files, warm start 0.1 s, cache 0.4 MB.
- Cost = API list prices (`packages/shared/src/pricing.ts`, platform.claude.com pricing page, checked 2026-10-07), fast mode uses fast input/output rates with the same cache multipliers. `inference_geo` / subscription billing are ignored → shown as an estimate.

## 11c. Session signals added in Sprint A (verified 2026-10-07, keys/enums only)

| Record | Used | Not used |
|---|---|---|
| `permission-mode` `{permissionMode}` (seen: `auto`; Claude also writes `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`) | Latest value → `TerminalSession.permissionMode`; change → `terminal.mode` activity (not for the first record) | — |
| `system/compact_boundary` `compactMetadata.{trigger, preTokens, postTokens}` | `terminal.compacted` activity, `compactions` count, context reset to `postTokens` | `content`, `preservedSegment`, `preservedMessages`, `logicalParentUuid` |
| `gitBranch` on message records | Latest → `TerminalSession.gitBranch` (`HEAD` = detached) | — |
| `message.usage` of the latest assistant record | `Agent.contextTokens` = input + cache write + cache read | — |
| `cost-state` `{totalCostUSD, modelUsage[model]{inputTokens, outputTokens, thinkingTokens, cacheRead/CreationInputTokens, webSearchRequests, costUSD}, totalLinesAdded/Removed, total*Duration}` | Not yet (F4/F6) | — |

Context window: `message.model` never carries `[1m]` (only `cost-state.modelUsage` keys do), so `contextWindowOf` (`packages/shared/src/context.ts`) uses 1M when the `model` field of `<claudeRoot>/settings.json` contains `[1m]` for the same family, or when the observed context already exceeded 200k; otherwise 200k. Only the `model` field of settings is read. UI levels: 60 / 80 / 95 %.

## 11d. Repo grouping and wait time (2026-10-07)

- Project cwd values are often sub folders (`app/src/main/java/...`) because Claude was started there. `RepoRoots` (`apps/collector/src/repo.ts`) maps each cwd to the nearest ancestor where `.git` exists (dir or worktree file) — `stat` only, nothing inside `.git` is read. It never climbs to the user's home dir or a drive root (a dotfiles repo there would swallow everything); no repo → the cwd itself. Real data: 216 cwds → 45 groups. Roots ship as `UsageSnapshot.roots` + `usage.roots` events; grouping is a UI toggle (default on).
- `TerminalSession.statusSince` = registry `statusUpdatedAt` → wait time, waiting queue order, reminders every 5 min (max 3 per waiting episode).

## 11e. Sprint E/F/G sources (verified 2026-10-08, keys only)

| Source | Read | Never read / forwarded |
|---|---|---|
| `assistant.effort` (fallback `perTurnEffort`) on transcript records | Latest value → `Agent.effort` (validated `[a-z]{2,12}`) | — |
| `message.usage.cache_creation.ephemeral_{1h,5m}_input_tokens` + record `timestamp` | Tier of the latest write → `Agent.cacheTtl`, time of the latest reply → `Agent.cacheAt`. A read-only reply keeps the previous tier. UI: cache expiry and the extra cost of rewriting `contextTokens` (API list prices, labelled estimate) | — |
| `<claudeRoot>/cache/model-catalog/*.json` | `catalog.config.models[].{id,name}` → snapshot `modelNames` (refreshed every 60 s) | `notice`, `description`, `catalog.state` |
| `<claudeRoot>/jobs/<id>/state.json` (`claude agents` / daemon jobs) | `state` (working / blocked / done), `tempo`, `name`, `inFlight.tasks/queued`, `tokens`, file mtime. Polled every 5 s, cached by mtime; done jobs older than 24 h dropped | `intent`, `detail`, `output`, `linkScanPath`, `respawnFlags`, `children` |
| `<claudeRoot>/jobs/<id>/timeline.jsonl` | Last 4 KB, only `at` + `state` → `stateSince` | `text`, `detail` |
| `<claudeRoot>/daemon/roster.json` | Not read (holds socket paths and auth tokens) | everything |
| Status line JSON (opt-in, `scripts/statusline-bridge.mjs`) | The bridge writes only numbers to `<dataDir>/statusline/<session_id>.json`: `rate_limits.five_hour/seven_day.{used_percentage, resets_at (unix s)}`, `cost.total_cost_usd`. Collector: newest limits win (account wide) → `limits`; cost → `TerminalSession.costUsd`. Files older than 7 days deleted | `transcript_path`, `cwd`, `workspace`, `session_name`, everything else |
| Registry status change waiting → busy | Duration → `ResponseStats` (today, median, waits > 5 min; > 8 h ignored), persisted `<dataDir>/response-stats.json` | — |

`rate_limits` exists only for Pro/Max subscribers (docs: code.claude.com/docs/en/statusline). The bridge is never installed automatically: the settings menu shows the snippet to paste; an existing status line is kept with `--chain "<old command>"`.
`metrics/costs.jsonl` is written by a third-party plugin, not Claude Code → ignored.

## 11f. Sprint H — derived data and window focus (2026-10-08)

No new Claude Code source; everything below is derived from data already read.

| Feature | Input | Stored | Notes |
|---|---|---|---|
| Limit forecast | Status line `used_percentage` samples (`limits`) | `<dataDir>/limit-history.json` (5h: last 2 h, one sample/min; 7d: last 48 h, one sample/10 min) | Least squares over 1 h (5h) / 24 h (7d), needs ≥ 10 min / 2 h of history; samples reset when `resets_at` moves or the % drops. `LimitWindow.forecast {pctPerHour, fullAt, beforeReset}`, labelled estimate |
| Session history | Terminal + agent counters at the moment a session ends | `<dataDir>/history.json`, newest 1000 | Title, cwd, branch, model, start/end, token counters, subagent count, compactions, status-line cost, working/waiting time. No content. Sent on request (`history.get`), new entries as `history.added` |
| Status timeline | Registry status + `statusUpdatedAt` | `<dataDir>/timeline.json`, current local day | Segments working / waiting / idle per session; open segments from before a restart are closed at the last save. Sent on request (`timeline.get`) |
| Error loop | Activity `tool.started` / `tool.failed` (tool names only) | — (web) | ≥ 5 failures in 5 min and ≥ half of the calls |
| Same-checkout warning | `cwd` → repo root (`usage.roots`) + `gitBranch` | — (web) | Worktrees have their own root, so they never match |
| Away summary, daily budget, recap/CSV | Existing stores | Budget in `localStorage` (`ccm.budget`) | CSV cells starting with `= + - @` are prefixed with `'` |

**Window focus (`terminal.focusWindow`)** — the client sends only a `terminalId`; the collector looks up the live tracker's registry PID and runs a fixed PowerShell script (`apps/collector/src/focus.ts`, PID passed in an environment variable). It walks the parent chain (claude.exe → shell → host) to the first process with a visible main window: classic consoles resolve on the shell, Windows Terminal and VS Code on the host process. When the shell was handed to Windows Terminal (default-terminal delegation, no parent link) and exactly one WT window exists, that window is used. Before that walk, the script attaches to the session's own console for a moment (`AttachConsole(pid)` → `GetConsoleWindow` → `FreeConsole`): under ConPTY the hidden pseudo-console window is owned by the hosting terminal window (Windows Terminal sets the owner per tab), and under a classic console it is the visible console window itself, so the exact window is known even with several WT windows open. Only when that link is missing (VS Code, old WT) does the parent walk run; there several WT windows answer `ambiguous` instead of a guess. Tab titles are never matched, and no tab is switched — only the right window is raised. Foreground-lock rules: the script attaches to the foreground thread's input queue; if that fails it taps Alt (goes to the current foreground app, never to the terminal) and retries. Nothing is ever typed into a terminal. Results: `ok | notFound | ambiguous | failed | unsupported`.

**PWA** — `manifest.webmanifest` + `sw.js` (production build only). The service worker caches the app shell (`/`, icons, hashed `/assets/*`) and never touches `/ws` or `/health`; the collector serves everything outside `/assets/` with `no-cache` so a new build replaces the worker. `navigator.setAppBadge` shows the waiting count on the installed app icon.

## 11g. Sprint I/J — local actions and git state (2026-10-08)

**Folder picker (`folder.pick`)** — `apps/collector/src/folder-pick.ts` shows the Windows folder dialog (IFileOpenDialog, folder mode) owned by an invisible topmost form; the chosen path returns base64 UTF-8. No client text reaches the script.

**Open folder (`terminal.open`)** — the client names a session and an app (`explorer` | `vscode`); the collector takes that tracker's own `cwd` and spawns `explorer.exe <dir>` or `Code.exe <dir>` directly (no shell). `code` on PATH is a `.cmd` shim that Node only runs through a shell, so `Code.exe` is located next to the PATH `bin` folder or in the default install folders; `ELECTRON_RUN_AS_NODE` is stripped so a collector started from a VS Code terminal still opens the editor. Results: `ok | notFound | noApp | failed | unsupported`.

**Uncommitted changes (`TerminalSession.diff`)** — new, read-only data source: `git -C <cwd> diff --shortstat HEAD` plus `git ls-files --others --exclude-standard --directory --no-empty-directory` (untracked folders count once). Runs 2 s after a session leaves `busy` and once when it is first seen, 5 s timeout, `GIT_OPTIONAL_LOCKS=0` so it never takes `index.lock` from the session's own git commands. Only counts leave the collector — no file names, no content. Outside a repo (or without git) the field is absent.

**Per-socket replies** — answers to one tab's request (`history.data`, `timeline.data`, `terminal.focusResult`, `folder.picked`, `terminal.openResult`, `diagnostics.data`) are sent only to that socket as `{ seq: -1, direct: true, events }`, outside the broadcast sequence, so they never trigger a resync in other tabs.

**Diagnostics (`diagnostics.get`)** — collector self-report: start time, Node/platform, Claude root and watcher state, process-check flag, live/ended counts, status line report count and last time, usage scan state, data folder, connected tabs. Paths are the user's own local folders; nothing from session files.

**Snooze** — browser-only (localStorage `ccm.snooze`), bound to the waiting episode (`statusSince`): a new wait is never pre-snoozed.

**Break reminders (`MonitorSnapshot.dayStartedAt`)** — collector-owned, not a Claude Code source: `<dataDir>/day-start.json` keeps the first collector start of the local day (`daystart.ts`); restarts later that day keep the morning time. The web reminds every 45 minutes from it (midnight if the collector has run since yesterday), deduplicated across tabs via localStorage.

## 12. Open items

| Item | State |
|---|---|
| Nested subagent (depth ≥ 2) | **Resolved** — verified on real data (see §6), test `links nested subagent to its parent` |
| Foreground `Agent` call | Not reproducible here: every observed call (main and nested) is `requestShape: background`. Handled by fallback: non-async `tool_result` for `toolUseId` → completed / error (test `completes foreground subagent`); last fallback `end_turn` |
| Crash case | Not reproduced on purpose (would kill a user session). Covered by test: registry file left behind + dead PID → `stale`, running subagents → `unknown`, removed after TTL |
| `kind = bg` / daemon | Decision: show every `kind` with a visible kind label |
