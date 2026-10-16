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
- v45: the process table is read in-process with koffi FFI (`collector/src/win-procs.ts`: `CreateToolhelp32Snapshot` → pid / ppid / exe name, `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetProcessTimes` → creation FILETIME, `NtQueryInformationProcess(ProcessCommandLineInformation = 60)` → command line, Windows 8.1+). About 15 ms and ≤ 16 ms CPU per full table instead of 1.1–1.4 s / 1.8–2.1 CPU-s per CIM spawn. Same FILETIME as CIM `CreationDate.ToFileTimeUtc()` (parity test, ± 1 µs). Processes we may not open (elevated, other users, System) have no start time; when a queried Claude pid or a `codex.exe` is one of them, that query goes to CIM as before. CIM is also the automatic fallback when koffi fails to load (logged once), and `CCM_NATIVE_PROCS=0` forces it. Packaged builds ship koffi as extraResources `koffi/node_modules` (win only) and pass its path as `CCM_KOFFI`.
- FILETIME compare tolerance: ± 10 000 units (1 ms).

## 7b. macOS / Linux (verified in the 2.1.289 bundle, 2026-10-09)

- Same `sessions/<pid>.json`; `procStart` = trimmed stdout of `ps -o lstart= -p <pid>` run with `LC_ALL=C TZ=UTC` (e.g. `Thu Oct  8 03:01:22 2026`, 1 s precision). No `procStartFt`.
- Collector (`process.ts`): `ps -o pid=,ppid=,lstart= -p <pids>` + `ps -o pid=,comm= -p <ppids>` (shell name), same env, no shell. `ps` exit 1 without stderr = some pids gone (parsed); missing `ps` / bad option / timeout → `null` (TTL only). Match = equal strings after collapsing spaces; a `procStart` that is not lstart-shaped keeps the session.
- Data dir (`datadir.ts`, mirrored in `statusline-bridge.mjs`): macOS `~/Library/Application Support/ccm`, Linux `$XDG_DATA_HOME/ccm` or `~/.local/share/ccm`.
- Open folder: macOS `/usr/bin/open`, Linux `xdg-open`; VS Code via `code` on PATH, macOS fallback `open -a "<...>/Visual Studio Code.app"`.
- macOS (since 2026-10-09, §11k/§11n): window focus (`focus-mac.ts`: exact tab by tty for Terminal.app / iTerm2, app-only `open -a` for JetBrains and other `.app` hosts), alerts (dock badge + bounce, desktop app only), launch from favorites (Terminal.app / iTerm2) and the folder picker (`choose folder`).
- Still unsupported on Linux (`unsupported`): window focus, folder picker, launch from favorites, system toast. On macOS the collector alone (no desktop app) has no toast.

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

Context window: `message.model` never carries `[1m]` (only `cost-state.modelUsage` keys do), and Claude Code 2.1.289 runs Opus/Sonnet 4.6+ and 5.x with a 1M window even when settings say plain `opus` (verified 2026-10-08: terminal showed ~9 % while the old 200k guess showed 44 % for the same ~88k tokens). `contextWindowOf` (`packages/shared/src/context.ts`) resolves, in order:
1. **Reported** (main agent only): `context_window.context_window_size` from the status line stdin, saved by the bridge as `contextWindow` in `<dataDir>/statusline/<session_id>.json` → `ContextHints.sessionWindows`.
2. **Catalog**: `runtime.max_input_tokens` per model id from `<claudeRoot>/cache/model-catalog/published-*.json` (`documentBytes` = base64 JSON, `surfaces.cc.model_selector_config[].models[]`; seen 1M for opus/sonnet 4.6+ and 5.x, 200k for haiku-4-5 and opus-4-1) → `ContextHints.modelWindows`. Combined as `max(catalog, guess)`.
3. **Guess**: 1M when the `model` field of `<claudeRoot>/settings.json` contains `[1m]` for the same family, or when the observed context already exceeded 200k; otherwise 200k.

Context percent (2026-10-10): the UI and the collector (context toast) show `contextUsedPct` = share of the room before auto-compact, `raw% / (100 − 16.5)`, the same buffer math as the user's status line (gsd-statusline). Verified on a 1M session: 306,010 tokens = 30.6 % raw, terminal 37 %, dashboard now 37 %. The 16.5 % buffer is the status line heuristic, not a value Claude Code reports; the raw % stays in the tooltip. Main agent: the bridge also saves `contextPct` = `100 − context_window.remaining_percentage` (else `used_percentage`) and `bufferPct` from `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (÷ `context_window.total_tokens` or 1M, same as the status line); the collector uses the reported % while its `at` is not older than the latest reply (`cacheAt`), else tokens ÷ window; buffer = bridge → collector env → 16.5. Result in `Agent.contextPct` (UI + context toast).

Only the `model` field of settings is read. UI levels: 60 / 80 / 95 %. Caveat: the catalog gives the model maximum; a plan/provider that caps lower is only correct with the status line bridge installed.

## 11d. Repo grouping and wait time (2026-10-07)

- Project cwd values are often sub folders (`app/src/main/java/...`) because Claude was started there. `RepoRoots` (`apps/collector/src/repo.ts`) maps each cwd to the nearest ancestor where `.git` exists (dir or worktree file) — `stat` only, nothing inside `.git` is read. It never climbs to the user's home dir or a drive root (a dotfiles repo there would swallow everything); no repo → the cwd itself. Real data: 216 cwds → 45 groups. Roots ship as `UsageSnapshot.roots` + `usage.roots` events; grouping is a UI toggle (default on).
- `TerminalSession.statusSince` = registry `statusUpdatedAt` → wait time, waiting queue order, reminders every 5 min (max 3 per waiting episode).

## 11e. Sprint E/F/G sources (verified 2026-10-08, keys only)

| Source | Read | Never read / forwarded |
|---|---|---|
| `assistant.effort` (fallback `perTurnEffort`) on transcript records | Latest value → `Agent.effort` (validated `[a-z]{2,12}`) | — |
| `message.usage.cache_creation.ephemeral_{1h,5m}_input_tokens` + record `timestamp` | Tier of the latest write → `Agent.cacheTtl`, time of the latest reply → `Agent.cacheAt`. A read-only reply keeps the previous tier. UI: cache expiry and the extra cost of rewriting `contextTokens` (API list prices, labelled estimate) | — |
| `<claudeRoot>/cache/model-catalog/*.json` | `catalog.config.models[].{id,name}` → snapshot `modelNames`; `published-*.json` decoded `surfaces.cc.model_selector_config[].models[].{id, runtime.max_input_tokens}` → context window per model (refreshed every 60 s) | `notice`, `description`, `catalog.state` |
| `<claudeRoot>/jobs/<id>/state.json` (`claude agents` / daemon jobs) | `state` (working / blocked / done), `tempo`, `name`, `inFlight.tasks/queued`, `tokens`, `sessionId` (UUID only, see §11h), file mtime. Polled every 5 s, cached by mtime; done jobs older than 24 h dropped | `intent`, `detail`, `output`, `linkScanPath`, `respawnFlags`, `children` |
| `<claudeRoot>/jobs/<id>/timeline.jsonl` | Last 4 KB, only `at` + `state` → `stateSince` | `text`, `detail` |
| `<claudeRoot>/daemon/roster.json` | Not read (holds socket paths and auth tokens) | everything |
| Status line JSON (opt-in, `scripts/statusline-bridge.mjs`) | The bridge writes only numbers to `<dataDir>/statusline/<session_id>.json`: `rate_limits.five_hour/seven_day.{used_percentage, resets_at (unix s)}`, `cost.total_cost_usd`, `context_window.context_window_size` (→ `contextWindow`). Collector: newest limits win (account wide) → `limits`; cost → `TerminalSession.costUsd`; window → main `Agent.contextWindow`. Files older than 7 days deleted | `transcript_path`, `cwd`, `workspace`, `session_name`, everything else |
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

## 11h. Background jobs — link, dismiss, stop (verified 2026-10-08, keys only)

A job is a background session started with `claude --bg` / dispatched from `claude agents`, run by the Claude Code daemon (`backend: "daemon"`, `template: "bg"`). Dir name under `<claudeRoot>/jobs/` = `daemonShort` = the short id that `claude attach|logs|stop|rm <id>` take. Other `state.json` keys seen (not read): `respawnFlags`, `bgIsolation`, `interactiveLineage`, `nameSource`, `resumeSessionId`, `cliVersion`, `cwd`, `createdAt`, `updatedAt`, `firstTerminalAt`, `needs`, `suggestedReply`, `inFlight.kinds`, `inFlight.drainableMonitors`. `<claudeRoot>/jobs/pins.json` (array) sits next to the job dirs and is skipped by the id regex. No pid is recorded in the job file; `<claudeRoot>/daemon/` holds `control.key` / `pipe.key` (auth for the daemon pipe) — never read — and `roster.json` (only `supervisorPid` is read, see Stop).

- **Link to a session**: `state.json.sessionId` (validated UUID) → `BackgroundJob.sessionId`. The web matches it against `TerminalSession.claudeSessionId`; a row is clickable (→ `ui.focusTerminal`) only when that session is currently tracked. No cwd fallback (several sessions share a cwd).
- **Dismiss** (`job.dismiss {jobId?}`): collector-side, keyed by `id + updatedAt`, persisted in `<dataDir>/dismissed-jobs.json` (2026-10-09). The job comes back if its file changes; done jobs still age out after 24 h.
- **Stop** (`job.stop {jobId}`): exception to observe-only, requested by the user. Uses the official CLI command `claude stop <id>` (`claude --help`: "Stop a background session. Its conversation is kept"), no pid kill. The collector resolves the real executable (`claude.exe` on PATH, `<PATH dir>/node_modules/@anthropic-ai/claude-code/bin/claude.exe` behind the npm `.cmd` shim, `~/.local/bin`) and runs it with `execFile` (no shell, 20 s timeout, inherited env). Only ids the collector itself read, not `done`, matching `^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$` (cannot be read as an option); one stop per job at a time. Exit 0 → `ok`; output `No job matching` → `notFound`; no executable → `noCli`; else `failed`. Result → activity `job.stopped` / `job.stopFailed {title, jobId, error}`. Not verified end to end against a live job (starting one would spend tokens); verified that `claude stop <unknown>` exits 1 with `No job matching '<id>'`. Which `state` a stopped job writes is unknown — the list just follows `state.json`.
- **Stopped/dead jobs keep their state** (verified 2026-10-09, CLI 2.1.295): a job whose worker is gone keeps `state.json` at `blocked` forever and `claude agents --json --all` still lists it (no `pid`). When the daemon has idle-exited (`daemon.log`: `idle 5s with no clients — exiting`), `daemon/roster.json` keeps the dead `supervisorPid` with `workers: {}`, and `claude stop <id>` exits 1 with `couldn't confirm <id> was stopped — the background service may be restarting` → `unconfirmed`. Deviation: on `unconfirmed` the collector reads `roster.json.supervisorPid`; if that pid is dead the result becomes `notRunning` (activity `job.stopped {error: 'notRunning'}`, job auto-dismissed). Missing/unknown roster → stays `unconfirmed`. `ok` / `notFound` / `notRunning` all auto-dismiss, since nothing rewrites `state.json`.

## 11i. Windows toast for waiting sessions (verified 2026-10-08, Windows 11 26200)

- Browser notifications need the bell + site permission and vanish after a few seconds, so the collector also sends a Windows toast when a session goes to `waiting` and no dashboard tab is visible + focused (`client.presence`). No tab connected still toasts.
- Sent with Windows PowerShell 5.1 + WinRT `ToastNotificationManager`, AUMID of powershell.exe (toast source reads "Windows PowerShell"). `scenario='reminder'` keeps it on screen until clicked.
- Limitation: PowerShell 5.1 cannot subscribe to WinRT events (`Register-ObjectEvent`: "cannot subscribe to Windows RT events"), so clicks use `activationType='protocol'` to `http://127.0.0.1:<port>/focus?t=<terminalId>&k=<per-process random key>`; the collector raises the terminal window and the page closes itself. Browser opens for a moment.
- Leaving `waiting` / user back on the dashboard removes the toast (`History.Remove(tag, 'ccm')`). Focus Assist / Do Not Disturb can still hide toasts.
- v45: one long-lived PowerShell host serves show / hide / health (`ps-host.ts`): requests are base64 JSON lines on its stdin (data, never script text), answers `<id>\t<result>` lines. Same AUMID, XML and actions as before; only the first request pays the ~1.3 s PowerShell + WinRT start, later ones take 5–45 ms. The host is respawned on the next request after a crash or a 15 s hang, exits after 10 min idle, and ends with the collector (stdin closes; `exit` hook kills it). Electron `Notification({ toastXml })` was not used: it shows under the app's AUMID, which the portable build has no Start Menu shortcut for, cannot remove a toast left by an earlier collector by tag/group, and has no registry health check.
- Off switch: Settings → Windows notifications (persisted `<dataDir>/notify.json`) or `CCM_TOAST=0`.
- v10: kinds `waiting` (+ reminder every 5 min while still waiting, max 3, not replayed for sessions already waiting at startup), `done` (off by default, not persistent), `job` (blocked background job), `loop` (error loop, shared `errorLoops` over the collector tool ring every 15 s), `limit` (5h forecast full within 1 h, once per window, not on first sighting). Only `waiting` / `job` use `scenario='reminder'`.
- Click flow v10: `GET /focus?k=&t=` returns a page that `POST /focus {t,k}` → `Monitor.focusWindow` result. `ok` → page closes; anything else → `/?focus=<terminalId>` opens the dashboard on that session. No `t` (limit, job without session) → dashboard. Raising after the page loaded replaces the old fixed 400 ms delay.
- Snooze moved to the collector (`<dataDir>/snooze.json`, `terminal.snooze`, `snooze.updated`) so toasts honour it; entry valid only for the same `statusSince`.
- Quiet hours (`notify.update.quiet`, local time of the collector machine, may cross midnight) silence toasts, browser notifications and chimes; tab title and badge still count.

- v11: toast kinds `stuck` (threshold now stored by the collector, `notify.update.stuckMinutes`) and `context` (main agent ≥ 95 %, once per crossing). Waiting toasts get a third action "Snooze 15 min" → `GET /snooze?k=&t=&m=15` (same per-process key), page closes itself. Settings "Send test" + registry check: `HKCU\...\PushNotifications\ToastEnabled = 0` (all off) or `HKCU\...\Notifications\Settings\<powershell AUMID>\Enabled = 0` (PowerShell blocked); missing values mean on. Do Not Disturb / Focus state is not readable here, so the test result hint mentions it.

## 11j. Desktop app (Electron, 2026-10-09)

Windows-only shell in `apps/desktop` (plan `.planning/PLAN-v12-electron.md`). Deviations from the Node/bat setup:

1. **Status line command.** Claude Code spawns the status line command itself and cannot read inside `app.asar`; the portable exe extracts to a new temp dir per run. The desktop host copies the bridge to `%LOCALAPPDATA%\ccm\bin\statusline-bridge.mjs` and passes `CCM_STATUSLINE_BRIDGE` + `CCM_STATUSLINE_COMMAND` to the collector (`config.ts`; `index.ts` uses it for Settings). Command: `node "<bridge>"` when `node` is on PATH (always for portable / dev); otherwise `"<...>/bin/statusline-bridge.cmd"`, which runs the installed app exe with `ELECTRON_RUN_AS_NODE=1`.
2. **Collector process.** Bundled to `collector.cjs` (esbuild, CJS, unpacked from asar) and run with `utilityProcess.fork`. Signals do not reach a utility process on Windows, so the host posts `'shutdown'` over `parentPort`; `index.ts` runs the normal `shutdown()` (state save). Host kills after 4 s. If `/health` on the port already answers (bat collector running), the app reuses it and forks nothing.
3. **Toasts unchanged.** Still PowerShell 5.1 + powershell.exe AUMID (§11i), so they work in the portable build without a Start Menu shortcut; clicks open the default browser (`/focus`), not the app window. App window via `ccm://` is a follow-up.
4. **`ELECTRON_RUN_AS_NODE` stripped** from the env of terminals opened by `launcher.ts`, so a `claude` started from the dashboard never inherits it (would make child Electron apps run as Node).
5. **Window origin.** The window loads `http://127.0.0.1:<port>/`, not `file://`, because `server.ts` only accepts http localhost origins and the web app builds its WS URL from `location.host`.

## 11k. macOS desktop (dmg, 2026-10-09)

Plan `.planning/PLAN-v13-macos-dmg.md`. Same app as §11j with these differences:

1. **Build.** DMG needs macOS (`hdiutil`, framework symlinks): `npm run dist:mac` on a Mac or the `desktop` GitHub Actions workflow (`macos-latest`). Targets `dmg` arm64 + x64.
2. **Signing.** No Developer ID: ad-hoc (`mac.identity: '-'`), `hardenedRuntime: false` (ad-hoc + hardened runtime fails Electron library validation), not notarized. Gatekeeper blocks first launch → Privacy & Security → Open Anyway.
3. **PATH.** Finder/Dock launches get launchd's minimal PATH, so `main.ts` merges `$SHELL -ilc` PATH (5 s timeout) before forking the collector: `node` (bridge command), `git`, `code`, `claude` resolve like in Terminal.
4. **Bridge without node.** `statusline-bridge.sh` (`ELECTRON_RUN_AS_NODE=1 exec <app exe>`), chmod 755. The exe path is baked in, so the app offers `moveToApplicationsFolder()` when run from the DMG / Downloads (translocated).
5. **Shell.** App menu (app / edit / window roles) for Cmd C/V/Q/W; menu bar icon `ccmTrayTemplate.png`; `activate` reopens the window; login item without `path/args` (opens shown, `--hidden` is Windows only); no AUMID / balloon.
6. **Alerts, focus, launch (2026-10-09; live results in §11n).**
   - Alerts: the desktop app sets `CCM_TOAST_BACKEND=electron`; with `process.parentPort` the collector posts `{type:'toast.show',tag,title,persistent}` / `{type:'toast.hide',tag}` (no body, no url). `attention.ts` bounces the dock (`critical`) on a new tag, sets the badge to the number of persistent alerts, settles on window focus, clears on quit and when the collector exits. Settings Test bounces without a badge. Native notifications are refused for ad-hoc apps (§11n), so badge + bounce stay until Developer ID signing.
   - Waiting labels: `permission prompt` + `ExitPlanMode` = "Needs plan approval"; with another tool = "Needs approval: <tool>"; `input needed` = "Asking you"; unknown values shown raw (`waitReason()` in shared, `waitDisplay` in web).
   - Focus results: `ok`, `appOnly` (info), `denied` (-1743), `notFound` (no tab on that tty, no fallback). Bundles must be absolute paths; at most 8 ancestors are walked. Verified live: Terminal ok, iTerm2 ok, WebStorm appOnly.
   - Launch: `osascript -e SCRIPT dir cmd` (argv only; cmd is `claude` or `claude --continue`). Terminal.app `do script` opens a new window; iTerm2 (by bundle id) a new window with the default profile. The dir goes through `quoted form of`; dirs with control characters are refused because `do script` / `write text` type the line into the shell's line editor, where `^U` and similar bypass quoting. Timeout 60 s (covers the consent prompt). Picker: `choose folder`, 10 min, `-128` = cancelled. Errors `activity.launchError.{denied,notInstalled,failed}`. Verified with the dir `a b'c`. The terminal choice is `ccm.launchTerminal` in localStorage.
   - **Automation permission.** The first use per target app (Terminal, iTerm2) shows the macOS consent prompt. If denied, the user re-enables it in System Settings → Privacy & Security → Automation.

## 11l. Port clash with OpenTelemetry (2026-10-09)

`4317` is also the OTLP/gRPC default, so a local OTel collector (Claude Code's `CLAUDE_CODE_ENABLE_TELEMETRY`) takes it first. Default kept at 4317: changing it would change the web origin and drop every `localStorage` setting, the installed PWA and bookmarks. Instead `EADDRINUSE` makes the collector print the cause and exit with code `3`; the desktop host treats that code as fatal without restarting and shows a port message.

## 11m. Tool spans (2026-10-09)

A span is one tool call: `tool_use.id` in an assistant message paired with `tool_result.tool_use_id` in a later user message. Start and end are the transcript line timestamps; outcome is `ok`, `error` (`is_error`) or `interrupted` (a `turn_end` closes every span still open for that agent). Only the tool name (cut to 80 chars) and timestamps are read: inputs, outputs and results are never stored or sent. Subagent transcripts never contain `system/turn_duration`, so the collector also closes spans as `interrupted` when a subagent resolves to a finished status (at its `completedAt`) and when the session ends (at the end time); otherwise they would stay open until the tracker is dropped.

Limits: 2000 spans per session, spans older than 2 h are dropped. Spans are recorded during catch-up of existing transcripts too, but `tool.span` is broadcast only for changes seen live. The dashboard fetches history with `toolSpans.get` (optional `terminalId`, optional ISO `since`, max 40 chars) and gets one `toolSpans.data` reply; an unknown `terminalId` returns an empty list.

## 11n. Waiting reasons and macOS automation (verified 2026-10-09, macOS 15, Claude Code 2.1.289)

Registry `waitingFor` observed live (1 s poll of `sessions/<pid>.json`), matched to the open `tool_use` in the transcript (tool names and timestamps only):

| `waitingFor` | Open tool | Meaning |
|---|---|---|
| `input needed` | `AskUserQuestion` | Claude is asking the user |
| `permission prompt` | `Bash` | tool permission |
| `permission prompt` | `ExitPlanMode` | plan approval |

A read-only command (`ls ~`) ran without a prompt (`busy → idle`). `sandbox request`, `worker request`, `dialog open` were not observed; they stay as documented in §3.

macOS process tree for a Terminal.app session: `claude (ttys006) → -zsh → login → /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal` (3 hops; login shells show a leading `-`; Terminal.app lives under `/System/Applications/Utilities`, so match the bundle name, not `/Applications`). JetBrains: `claude (ttys003) → /bin/zsh → /Applications/WebStorm.app/Contents/MacOS/webstorm`. `sdk-cli` sessions run under `bun` with no tty and no `.app` ancestor.

AppleScript `tell application "Terminal"` → `tabs of windows` → `tty of t is "/dev/ttysNNN"` → `set selected`, `set index of window to 1`, `activate` selects the right tab (`ok`); an unknown tty returns `notFound`. No Automation prompt appeared for a host that already had the permission; a new app identity will be asked once.

Native notifications: an Electron `Notification` from the dev binary (`com.github.Electron`) fails with `UNErrorDomain error 1` (notifications not allowed) without any permission dialog, and the installed ad-hoc signed app (`dev.ccm.monitor`, `Signature=adhoc`) shows no prompt either; neither appears in `com.apple.ncprefs`. Native macOS notifications therefore need a Developer ID signature. The desktop app uses a dock badge and `dock.bounce('critical')` instead, which need no permission.

## 11o. Embedded terminals — deviation from "monitoring never sends prompts" (v18, desktop only, verified 2026-10-14, Claude Code 2.1.294, Windows 11)

**Deviation.** PLAN.md says monitoring never sends prompts. The desktop app now hosts terminals (Workspace view) where the user types into Claude Code / Codex / a shell that Agent Monitor spawned. The rule is kept in spirit and stated precisely:

- Agent Monitor itself still never writes a prompt, never calls an API, never spawns an LLM on its own. Only the user's own keystrokes and pastes travel to a PTY the user opened. Zero extra tokens.
- Terminals that Agent Monitor did not spawn (Windows Terminal, Terminal.app, IDEs) stay strictly read-only; writing into another process's console is not attempted.
- Launch commands are fixed presets (`claude`, `codex`, the shell; `claude --resume <uuid>` / `codex resume <uuid>` with a validated UUID). The page never sends a command string.
- There is no browser mode (v2.0.0): the collector answers only requests carrying the per-run app key, which Electron adds to its own windows; `npm run dev` (UI work) has no terminals. Windows toast buttons use `agent-monitor://` links handled by the app instead of opening a browser tab.

**Why this is safe enough.** The PTY host is a separate Electron `utilityProcess` on `ws://127.0.0.1:<random>/pty`. Each connection needs a fresh 32-byte token (in `Sec-WebSocket-Protocol`, compared in constant time), Host 127.0.0.1 and the app origin. The token reaches only top-level app frames through the preload, and only while the collector on the port is the app's own child (a borrowed or foreign collector page gets nothing). The collector page is served with a Content-Security-Policy (`script-src 'self'` + the hash of the inline pre-paint script, no `unsafe-eval`), so injected markup cannot run script and reach the shell.

**Findings while building it.**

1. `claude.cmd` (npm) is a shim; the agent process descends from the pane's shell (`powershell.exe → claude.exe`). The pane ↔ session link walks the ppid chain (PowerShell CIM `Win32_Process` / `ps -A -o pid=,ppid=`) from the registry pid up to the pane's shell pid, so typing `claude` by hand in a shell pane links too.
2. When Agent Monitor itself is started from inside a Claude Code session, the session's own variables (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_ENTRYPOINT`, …) are inherited. A `claude` started under `CLAUDE_CODE_CHILD_SESSION` prints "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker" and writes neither a transcript nor a registry record, so the monitor never sees it. The PTY host strips these (plus `CODEX_THREAD_ID`, `CODEX_SANDBOX*`) from every pane's environment; user configuration such as `CLAUDE_CODE_USE_BEDROCK` is kept.
3. ConPTY reports the shell pid asynchronously (0 right after spawn, set ~30 ms later); node-pty's `kill` only ends the shell on Windows, so panes are killed with `taskkill /T /F` (absolute path) to take the agent and its tools down too.
4. Session restore uses the session id the monitor already knows for the pane (registry `sessionId`, follows `/clear`); nothing is guessed from folders. Restoring is always a user action ("Restore previous workspace"), never automatic. Reopening an external session that is still live asks first: two instances on one session would both append to the same transcript.
5. Git worktrees are created and removed by the PTY host (token channel), never by the collector's dashboard socket: `git -C <dir> worktree add -- <repo>-wt/<branch> [<branch>|-b <branch>]`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`; removal refuses the main checkout, a dirty tree or a folder a live terminal runs in, and never uses `--force`. `git` is resolved by walking PATH ourselves because Windows process creation would try the project folder first.

## 11p. Attachments tray — image paste key and reading the input box (v25, desktop only, verified 2026-10-14, Claude Code 2.1.299, Windows 11; v37 removal and image paste re-verified 2026-10-15 on 2.1.294, the `claude` on PATH then)

Probe: `claude` in a node-pty (110×36) rendered by `@xterm/headless`; image put on the clipboard with `System.Windows.Forms.Clipboard.SetImage`; Enter never pressed.

1. **Image paste key.** On Windows Claude Code reads a clipboard image on **Alt+V** (`ESC v`): the status line shows "Pasting…", then `[Image #N]` appears in the prompt. `^V` (`\x16`, what the app sent before v25) does nothing there. macOS / Linux keep Ctrl+V. `usePaneAttachments.imagePasteKey` picks the key per platform; it is used for Ctrl/⌘+V in a pane, the browser screenshot hand-off and the tray.
2. **Input box.** The prompt sits between two full-width `─` rules with a `❯ ` prefix; the empty box shows a dim placeholder (`Try "…"`). Status lines (model, mode, status-line output) are below the lower rule; "↓ N more" and earlier messages are above. `lib/promptAttachments.ts` reads only the rows between the two lowest rules in the bottom 40 rows, so earlier messages that mention `[Image #1]` or `@file` are never counted.
3. **Tokens.** Images: `[Image #1]`, `[Image #2]`, … in paste order. File mentions typed through bracketed paste stay as typed: `@package.json`, `@"docs/a b.md"` (quoted form accepted, no autocomplete interference).
4. **Removal.** One Backspace right after `[Image #N]` removes the whole placeholder (and the image). A mention is plain text: one Backspace per character. Ctrl+U clears the line. The tray (v37) erases an item that sits before the cursor on the cursor's row (`eraseKeys`): ← to just after it (ESC [ D, or ESC O D in application-cursor mode), Backspace (one for a placeholder, one per character for a mention, plus the space after it), then → back; one key per write, erases queued, and pastes into the pane (`insertInto`, tray inserts) wait until the queue is idle. Items on other rows (a soft wrap and a typed newline look the same on screen), after the cursor, or with characters of uncertain cell width before the cursor (wide, emoji, zero-width, combining) are left to the user ("remove it in the terminal"). The caret: an Ink app may hide the terminal cursor and draw its caret as one inverse-video cell, leaving the real cursor where its last frame ended; so the tray takes the one inverse cell inside the box when there is one, else the cursor if it is inside the box, else gives up. The erase is closed-loop: after the ← burst it reads the caret back and nudges until it sits right after the token (a placeholder may move as one unit), re-checks before any Backspace, and counts the removal only when the redrawn prompt holds one token fewer. While a mention is erased one Backspace at a time, the shortened mention at the cursor (`cursorToken`) gets no tray row. A mention with a `:line[:col]` suffix (`@lib/main.dart:12:5`, `@"a b.dart":12:5`, the Run pane's "Send to agent") points at a place in a file and gets no row either. Arrow-key erase verified on a real pane with Claude Code 2.1.294 (`e2e/v25.cjs`: any-order removal, Backspace, no ghost rows); there the terminal cursor did sit on the caret (no inverse cell), the inverse-cell path is the fallback. A removal clicked while another erase or insert is in flight skips the pre-check (the screen is mid-change) and is checked by the queued erase on a settled screen.
5. **Codex 0.154 not verified** (its first run in this folder asks to trust it; answering would change the user's Codex config). Codex panes get file mentions only; Codex's own Ctrl+V is left as it was.

Privacy: the screen is read in the page only, for the pane's own prompt; nothing reaches the collector, logs or storage. Tray items (names, paths, thumbnails ≤ 96 px) live in memory and are dropped with the pane. Inserting an image replaces the system clipboard; the UI says so.

## 11q. Quick setup writes `statusLine` into Claude's settings.json (v27, desktop only, 2026-10-14)

The status line bridge (§ plan limits) needs a `statusLine` entry in Claude Code's `settings.json`. Until v27 the app only showed a snippet to paste. The first-run quick setup (`QuickSetup.vue`) can now write it; this is the only place the app writes Claude Code's configuration files itself (the v28 Extensions tab changes config only through the `claude` CLI, §11r). Monitoring itself is unchanged (no prompts, no API calls).

- File: `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json` (`apps/desktop/src/statusline.ts` `claudeSettingsFile`).
- Read only to classify (`readStatusLine`): `ours` (command contains `statusline-bridge`), `other`, `none` (no key / no file), `unreadable` (not plain JSON, e.g. comments; the app never rewrites it and falls back to the snippet).
- Write only from IPC `ccm:statusline-enable` after a **native confirm** that shows the exact `statusLine` JSON and the file path; the page cannot write by itself.
- `other`: the old command is kept and run after the bridge: `<bridge> --chain-b64 <base64 of the old command>` (base64 survives every shell's quoting; `scripts/statusline-bridge.mjs` decodes it, `--chain "<cmd>"` still works). Other fields of the old `statusLine` (e.g. `padding`) and every other key are preserved.
- The previous file is copied to `settings.json.ccm-backup`; the new one is written to a temp file and renamed. Claude Code reads it for new sessions.

## 11r. Extensions tab installs MCP servers and plugins through the `claude` CLI (v28, desktop only, verified 2026-10-15, Claude Code 2.1.299, Windows 11)

A user request (not monitoring): a tab listing popular MCP servers (Figma, Meshy AI, Unity, Blender, Godot, GitHub, GitLab, Discord) and plugins (pm-skills, ui-ux-pro-max, frontend-design, Unity) to install for every project or one. This is the second place the app changes Claude Code's configuration (after §11q). It never edits those files itself: every change is one or more `claude` CLI calls, run from Electron main after a **native confirm** that lists the exact commands (secrets shown as `••••`). The page sends a catalog id + field values; main builds the argv (`apps/desktop/src/extensions/commands.ts`). Monitoring is unchanged; no prompts, no API calls (the CLI subcommands used do not start a model turn).

- CLI: `findClaudeCli` (collector `job-stop.ts`), `execFile` without a shell, env = PTY `childEnv` (no `CCM_*`, `ELECTRON_*`, parent-session vars) + `NO_COLOR`. cwd = the project folder for `project` / `local` scope (both commands resolve the project from cwd), else home. One change at a time.
- MCP: `claude mcp add-json -s user|project|local <name> '<json>'` (one code path for http + stdio; Windows wraps `npx` as `cmd /c npx`, which Claude Code needs for `.cmd` shims). `project` → `<dir>/.mcp.json` (committed; the UI warns when a token would go there and defaults to `local`); `local` → `~/.claude.json` `projects["<dir with />"].mcpServers`; `user` → `~/.claude.json` `mcpServers` (`$CLAUDE_CONFIG_DIR/.claude.json` when set). Remove: `claude mcp remove <name> -s <scope>`. OAuth: `claude mcp login <name>` (opens the browser; 5 min timeout).
- Status: `claude mcp list` has no JSON. Lines are `<name>: <command or url> - <glyph> <status>`; the status starts at the first ` - ` followed by `✔ ✗ ✘ ⚠ ⏸`, because commands and error details contain ` - ` too. A `✘ Failed to connect — … Authorization header (HTTP 401)` line is a failure, not a sign-in (the parser reads only the head of the status). Plugin servers show as `plugin:<plugin>:<server>`, claude.ai connectors as `claude.ai <Name>`. `.mcp.json` servers show `⏸ Pending approval` until approved in a session. The command health-checks every server (seconds), so it is a separate IPC call, cached 30 s. Scopes come from reading **names only** from `~/.claude.json` and `<dir>/.mcp.json`; no value leaves main.
- Plugins: `claude plugin marketplace add <owner/repo> [--json]` (`--json` result `{outcome, marketplace}`), `claude plugin install <name>@<marketplace> -s <scope>` (`project` → `<dir>/.claude/settings.json` `enabledPlugins`), `claude plugin uninstall <id> -s <scope>`, `claude plugin list --json` (`projectPath` on project/local rows), `--available --json` (`{installed, available: [{pluginId, name, marketplaceName, description}]}`). `-y` is never passed: a plugin with a marketplace-declared install command fails with `needsTerminal` and the user installs it from a terminal.
- Skills: the tab lists folder names in `~/.claude/skills` and `<dir>/.claude/skills` (read-only). The three requested skill packs are plugins.
- Unity has no CLI install: CoplayDev "MCP for Unity" configures Claude Code from the Unity editor, so the card shows the steps and its status once a server named `unityMCP` / `UnityMCP` / `unity-mcp` appears. Unity's own `unity@claude-plugins-official` is a skills plugin.
- `claude mcp login <name>` (2.1.289) refuses without a TTY ("stdin isn't a terminal, so authentication can't be completed here"), so Sign in opens a workspace shell that types the command; the IPC `ccm:ext-login` path is only a fallback when terminals are unavailable.
- Godot: `Coding-Solo/godot-mcp` (`npx -y @coding-solo/godot-mcp`, optional `GODOT_PATH` env, needs Godot 4 installed; no editor plugin). Godot Editor (`tomyud1/godot-mcp`) is a guide card: AssetLib plugin "Godot AI Assistant tools MCP" + `claude mcp add godot-editor -- npx -y godot-mcp-server` (README names it `godot`, renamed so it does not collide with the Godot card), WebSocket 6505. Funplay MCP for Godot (`FunplayAI/funplay-godot-mcp`) is a guide card too: its editor dock writes server `funplay` (`npx -y funplay-godot-mcp`, env `FUNPLAY_GODOT_MCP_URL` / `_TOKEN`), HTTP 127.0.0.1:8765.
- Tested against the real CLI with `CLAUDE_CONFIG_DIR` pointed at a temp folder: `add-json` in all three scopes, `mcp list` states (connected / pending / 401 failure), `marketplace add` + project `plugin install` + `uninstall`.

## 11s. Git Log pane reads history with plain git (v30, desktop only, 2026-10-15; branch writes since v36)

Not monitoring: an IntelliJ-style log of a project's repo. The v30 history commands below are read-only (the v36 branch actions are listed after them) and every command runs through `execGit` (`GIT_LITERAL_PATHSPECS=1`, no colour, no pager, `-c log.showSignature=false`: a user `log.showSignature=true` would print the signature check before each signed commit's record and corrupt parsing).

- Refs: `for-each-ref --format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket) refs/heads refs/remotes refs/tags`, `remote`, `symbolic-ref -q --short HEAD`, `rev-parse -q --verify HEAD`, `config user.name`.
- Log: `log --topo-order -z --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s --skip=N -n 501` (`LOG_PAGE + 1`, the extra row tells whether more follow) + `--branches --remotes --tags HEAD` (no stash) or one ref; filters `--since=/--until=` (ISO) and `-- <paths>`; text and user use `--grep=` and `--author=` (regex-escaped when the regex toggle is on). Matching is `--fixed-strings`, or `--extended-regexp` with the regex toggle, plus `--regexp-ignore-case` unless match case is on. A 4–40 hex text is also resolved with `rev-parse --verify -q <text>^{commit}` and shown first; the result then carries `injected: 1` so the next page's `--skip` counts only git's own rows.
- Commit: `show -s` (author, committer, body) + `diff-tree -r -z -M --name-status|--numstat <first parent or empty tree> <hash>`. Plain `diff-tree <hash>` prints nothing for a merge, hence the explicit first parent.
- Branches containing: `branch -a --contains <hash> --format=%(refname)`, only when asked. Full refnames, because `%(refname:short)` prints `refs/remotes/origin/HEAD` as a bare `origin` and a detached HEAD as `(HEAD detached at …)`; only `refs/*` lines are kept, `refs/remotes/*/HEAD` is dropped and `refs/heads/` / `refs/remotes/` are stripped for display.
- File diff: `diff <first parent or empty tree> <hash> -M --no-ext-diff --no-textconv -U1000000 -- [orig] <path>`, 3 MB cap then 3-line context (same as §11o Changes).
- Refresh: the git-dir watcher also reacts to `packed-refs`, `FETCH_HEAD`, `ORIG_HEAD` and `refs/` (recursive). The page reloads the list only when HEAD or a ref hash changed.

**v36 Branches toolbar — the Log is no longer read-only** (user request; `.planning/PLAN-v36-log-branches-toolbar.md`, `apps/desktop/src/preview/branches.ts`). Only these git writes exist, each started by a click on the toolbar, argv built in main (the page sends a ref, never a command), `GIT_TERMINAL_PROMPT=0`, stderr passed through `sanitizeGitError` (first line, `user:token@` stripped):

| Action | Command | Confirm | Timeout |
|---|---|---|---|
| New Branch | `check-ref-format --branch <name>`, `rev-parse --verify -q <base>^{commit}`, then `branch -- <name> <hash>` or `switch -c <name> <hash>` | in-app dialog (name + "switch to it") | 20 s |
| Delete (local) | `branch -d -- <name>`; not merged → `branch -D -- <name>` | **native confirm in main showing the exact command**; `-D` needs a second native confirm | 20 s |
| Delete (remote) | `push <remote> --delete refs/heads/<branch>` | native confirm showing the exact command | 120 s |
| Update Selected | current branch `pull --ff-only --no-rebase`; other tracked branch `fetch <remote> <remoteRef>:refs/heads/<b>` (git refuses a non-fast-forward) | none: fast-forward only, nothing local is lost | 120 s |
| Fetch | `fetch --all --no-write-fetch-head` (git < 2.29: without the flag), no prune | none | 120 s |

Network commands (120 s) kill the whole process tree on timeout (`execGit` `killTree`, so `git-remote-https` does not linger on Windows); a spawn error is reported as `failed`, not `timeout`. Never: force push, non-fast-forward update, reset, deleting the current branch or a tag, checking out an existing branch. Delete is not driven by E2E (the native confirm cannot be clicked through CDP); `test/branches.test.ts` covers it against real repos.

## 11t. Multi-project Workspace: rail, Spaces, Mission Control (v38, desktop only, 2026-10-15)

Not monitoring: how the Workspace groups its own panes. Plan `.planning/PLAN-v38-multi-project.md`.

- Worktrees fold by git's common dir: `ccm:project-root` also returns `common` from `git rev-parse --path-format=absolute --git-common-dir` (fallback without `--path-format` for git < 2.31, resolved against the toplevel, realpath). Main checkout = parent of `<common>/.git`; a bare repo has none. Until git answers, a tab sits in a provisional `plain:<folder>` cluster folded by the `<repo>-wt/<branch>` name; stored rail order matches that alias too.
- A tab's project (`Tab.project`) is fixed when the tab opens; a `cd` never moves it. Header actions (new tab, scripts, Run…, layouts) use the checkout's own path, never the main checkout of a worktree (that folder may not be allowed).
- Rows show the session name (alias, else Claude's own name) and `Agent · <state>` only — no prompt, no assistant text (the collector stores none). Run panes show their run state (Building / Running / Run failed); a failed run counts as "needs you".
- Remembered projects (`workspace.recentDirs`, no pane open) still group by repo: the page calls `ccm:project-root` with `remembered = true`, and for a folder outside every allowed root the host answers only `{ root, repo, common }` from `git rev-parse` (absolute existing directory, realpath). That answer grants nothing: the toplevel is not registered as a known repo, so Changes / Log / scripts / file reads there stay refused until a pane opens in it. Why this is acceptable: the page can already open a terminal in any folder, so knowing whether a folder is a git checkout adds no reach; `rev-parse` reads no file contents and runs no hooks. Pane lookups never send the flag, so their retry-until-the-PTY-is-up path (which registers the repo) is unchanged.
- Mission Control snapshots are the last 14 rows read from the mounted xterm buffer when a space is first shown, memoised per tab while Mission Control stays open; a Run pane shows the tail of its focused run's log from the run store. Memory only, never stored, never sent over IPC, rebuilt on every open.
- Close project with a live run asks first, then stops the runs (`runStop`) before closing the panes.

## 11u. File editor writes files (v42, desktop only, 2026-10-15)

Not monitoring: the file viewer can edit a text file and save it. Plan `.planning/PLAN-v42-file-editor.md`. The only write path is `ccm:file-write {path, text, expectedMtime?}` (`apps/desktop/src/preview/fileWrite.ts`).

- Only on an explicit save (Ctrl/⌘+S, the Save button, Save in the close sheet or in the quit dialog); never auto-save. Only existing files: no create, rename or delete through this channel.
- Gate: top-level app frame (`isAppFrame`); the file's realpath (symlinks resolved) must sit inside an allowed root (live pane cwds, granted folders) or a repo toplevel registered from one, the same folders the viewer / Explorer reach. A symlink that points outside is refused (`denied`), never followed for writing.
- Refused: text > 4 MB, a file on disk that is binary (NUL in the first 8 KB) or not valid UTF-8 (`encoding`), and a stale `expectedMtime` (`conflict`: the file changed after the page read it; the page shows Reload / Keep mine / Compare, and only Keep mine adopts the new mtime so the next save overwrites). The page itself keeps files > 2 MB, > 50k lines, binary or non-UTF-8 view only.
- Written as the file was: original line-break style (dominant one when mixed; LF when the file has none) and UTF-8 BOM kept. Atomic: temp file `.name.<random>.ccm-tmp` in the same folder (`wx`, original mode), then rename over the real path; on Windows a busy rename (EPERM / EACCES / EBUSY from an indexer, antivirus or watcher) is retried 5 times with backoff, then `busy` and the temp file is removed.
- Nothing logs the text; results carry only `{ok, path, mtimeMs, size}` or an error code.
- Quit: the page reports its unsaved editors (`ccm:editor-dirty`, names + paths only); `confirmQuit` asks Save / Don't save / Cancel first, Save sends `ccm:editor-save-all` and quits only if every save succeeded (15 s timeout counts as failure).
- Live layout / drawable preview: `ccm:layout-render` / `ccm:drawable-render` take an optional `text` (≤ 1 MB) rendered instead of the file; the file path still has to pass the gate and resolves resources / the project model. Nothing is written for a preview.
- Loose kit (v44, `.planning/PLAN-v44-loose-xml-library-kit.md`): a layout with no usable Gradle project model (loose XML, or a project not built yet) renders with a bundled kit (ConstraintLayout 2.2.1, AppCompat 1.6.1, Material 1.12.0 + render-path deps, ~14 MB, `layout-daemon/loose-kit/`) loaded as the daemon's project; default theme `Theme.Material3.DayNight.NoActionBar`, root `tools:theme` wins. A real project model always replaces it. Read-only: built at package time, nothing downloaded or written at runtime.

## 11v. Boot order and transcript reading (v45 performance, 2026-10-15, record types checked on Claude Code 2.1.294)

Plan `.planning/PLAN-v45-performance.md`, audit `.planning/AUDIT-2026-10-15-performance.md`.

- **Listen first.** The collector serves `/health` and `/ws` before the first reconcile; the snapshot carries `loading: true` and an event `sessions.loading {loading: false}` ends it. Sessions arrive as normal `terminal.created` / `agent.created` while the first pass publishes them (no `terminal.started` activity, as before). Clients that ignore the field see an empty list that fills in. Process verification (`verifyNew`), Codex start and the usage index run after listen. A new socket gets pending events flushed before it joins, so its first message is always the snapshot.
- **Record types without signals are not parsed.** A transcript line is parsed only when it has a raw `"type":"assistant|user|system|permission-mode|queue-operation"` key; `attachment`, `mode`, `ai-title`, `last-prompt`, `atis-latch`, `file-history-*` lines (≈ 40 % of the bytes of a long main transcript) only give `gitBranch`, read from the last raw `"gitBranch":"…"` key. JSON string contents escape quotes, so a raw match is a real key; a nested match only costs a parse.
- **Finished subagents at catch-up.** When the main transcript already reports a subagent finished (notification or foreground result) and both that time and the file's mtime are older than the 2 h span retention, its catch-up records no spans and drops `user` lines before the last 1 MB unparsed, unless a line holds `<task-notification>` or the `tool_use_id` of an Agent/Task call. Tokens, model, context and links come from assistant lines, which are always parsed. Verified on real data: the 42 finished subagents of the live sessions and every closed span were identical to the old full read.
- **Targeted sync.** The projects watcher passes the changed file names: only the main transcript and the subagent files named are tailed (plus a `readdir` for new subagents). Reconcile (5 s, and registry changes) reads unresolved subagents only; every tracker gets a full read once a minute as a safety net, and at session end.
- Store batches (50 ms) merge `terminal.updated` / `agent.updated` per id (last value per field; folded into a pending `created`; never across a `removed`). The server serialises each batch once for all sockets.

## 11w. Agents open Workspace panes: MCP `open_session` and `agent-monitor://open` (v49, desktop only, verified 2026-10-16, Claude Code 2.1.289, Windows 11)

Plan `.planning/PLAN-v49-workspace-open-api.md`. Before v49 an agent asked to "open another session" started `wt.exe` / `powershell` itself: the new process lived in a foreign window (a running process cannot be moved into our ConPTY) and inherited `CLAUDE_CODE_CHILD_SESSION`, so it wrote no transcript and the monitor never saw it (§11o finding 2). Now the PTY host spawns it like any pane.

**Agent path (MCP).**

- Every pane's environment gets `GOLAIM_API=http://127.0.0.1:<pty host port>`, `GOLAIM_TOKEN=<32 random bytes, hex, one per pane>` and `GOLAIM_MCP_CONFIG=<dataDir>/golaim-mcp.json`. Inherited `GOLAIM_*` are stripped first (a dev build started from a pane must not talk to the packaged app). The token never goes on a command line.
- The `claude` preset appends `--mcp-config $env:GOLAIM_MCP_CONFIG` (posix `"$GOLAIM_MCP_CONFIG"`), last because the flag is variadic. The file is static: `{"mcpServers":{"golaim":{"type":"http","url":"${GOLAIM_API}/mcp","headers":{"Authorization":"Bearer ${GOLAIM_TOKEN}"}}}}`. Only Claude started by a preset gets the tool; `~/.claude.json` is not touched, sessions outside the app see nothing. `claude` typed by hand in a shell pane, and Codex panes, have the env but no tool (not wired yet).
- `POST /mcp` on the PTY host: JSON-RPC answered with plain `application/json` (no SSE), `GET` → 405. Refused: Host other than `127.0.0.1:<port>`, any `Origin` header (browsers), a missing / unknown / exited-pane bearer token. Tool `open_session {agent?, cwd?, prompt?, name?, resume?}`; `cwd` defaults to the calling pane's current folder and goes through the same `resolveCwd` as WS spawns (absolute, existing, no UNC). Limits: 16 live terminals (pending opens count), 3 opens per calling pane per minute.
- The host asks main (`parentPort` `open` → `open-reply`), main asks the page (`ccm:pane-open` → `ccm:pane-open-reply`, 5 s), the page splits the new pane next to the caller without moving focus (no room → a new tab of the same project, not activated) and replies; the pane then spawns over the normal WS with `open: <ticket>`. The ticket (60 s, one use) is how the host adds `--session-id <uuid it generated>` and `-n '<name>'` (≤ 40 letters, digits, space . _ -, starting with a letter or digit): the page still never sends a command string.
- `prompt` is never put on a command line (Windows PowerShell 5.1 does not escape `"` when passing a variable to a native exe, so a quote could split it into flags). Control characters are stripped (`cleanPanePrompt`, ≤ 8000 chars); once the pane is linked to its monitor session and that session is `idle` (not `waiting`: a dialog is open), the page pastes it into the input box like "Send to agent" and never presses Enter; unlinked after 20 s (or status unknown) it pastes anyway, and without bracketed paste newlines become spaces so nothing runs. GolAIm still never submits a prompt. A ticket that expired or names another preset is ignored: the pane spawns as a plain preset.
- Confirmation is Claude's own tool permission ("Allow mcp__golaim__open_session?"); in `auto` / bypass permission modes Claude may not ask, the limits above still apply.

**Resume (both paths, 2026-10-16).** `resume` must be a session UUID for claude / codex. A GolAIm pane already running that session (`agentSessionId`) is focused instead of a second one. A session the monitor still sees live in a terminal outside GolAIm (registry `claudeSessionId` / `codexSessionId`, not stale, no pane) is refused with `live` (MCP error text / deeplink warning dialog): two instances would append to one transcript. Otherwise the pane spawns with `--resume` (no `--session-id` / `-n`).

**Verified on 2.1.289 (spike, 2026-10-16).** `${VAR}` in `url` and `headers` of a `--mcp-config` file is expanded from the process env. The client first POSTs `server/discover` (id `server-discover-probe-1`, `_meta` protocol `2026-07-28`); a `-32601` reply is fine, it then sends `initialize` (`protocolVersion` `2025-11-25`, `Accept: application/json, text/event-stream`), `notifications/initialized`, a `GET /mcp` for an SSE stream (405 accepted) and `tools/list`. `/mcp` lists the server under "Built-in MCPs (always available)" as `✔ golaim 1 tool`. `--session-id <uuid>` names the transcript `<uuid>.jsonl`; `-n` writes `custom-title` / `agent-name` records and shows in the prompt box border.

**Deeplink path.** `agent-monitor://open?agent=claude|codex|shell&cwd=<absolute folder>[&resume=<session uuid>]` for callers outside the app (Claude in another terminal, scripts): `resume` (claude / codex, bare UUID only, else the link is ignored) reopens an unfinished session with `claude --resume` / `codex resume` (cwd must be its project folder); no prompt or name is read from the link (any web page can create one), the folder must be absolute (Windows: with a drive letter), local and existing (`apps/desktop/src/openLink.ts`). **No confirmation** (owner decision 2026-10-16, after being told any web page can fire the link): links are queued one at a time and capped at 10 per minute (`takeLinkSlot`), more are dropped. What still protects a folder a page picks: Claude Code asks its own "trust this folder?" before loading a new folder's project settings / hooks, and a shell pane only runs the user's profile. Registered for packaged builds only: Windows via `setAsDefaultProtocolClient`, macOS via `protocols` in `electron-builder.yml` + `open-url` (queued until boot). From Git Bash: `cmd //c start "" "agent-monitor://open?agent=claude&cwd=D:%5Cwork%5Capp"`; macOS: `open "agent-monitor://open?cwd=/Users/me/app"`.

## 12. Open items

| Item | State |
|---|---|
| Nested subagent (depth ≥ 2) | **Resolved** — verified on real data (see §6), test `links nested subagent to its parent` |
| Foreground `Agent` call | Not reproducible here: every observed call (main and nested) is `requestShape: background`. Handled by fallback: non-async `tool_result` for `toolUseId` → completed / error (test `completes foreground subagent`); last fallback `end_turn` |
| Crash case | Not reproduced on purpose (would kill a user session). Covered by test: registry file left behind + dead PID → `stale`, running subagents → `unknown`, removed after TTL |
| `kind = bg` / daemon | Decision: show every `kind` with a visible kind label |
