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

Messages between sessions and agents (v54, §11y / §11z): `messagingSocketPath` and the `uds:` sender address are reduced to `sockKey` (first 16 hex of sha256 of the lower-cased path) at parse time and kept in RAM only; the path is never stored, sent or logged. The message text in `origin.body`, `origin.name` (sender-chosen label), `message.content`, `attachment.prompt`, the `queue-operation` envelope, the `SendMessage` input and `toolUseResult.message` / `display` is never read out of `extractSignals`. Only counts, ids (`msg_id`, record uuid, agent id), terminal ids and timestamps leave it; display names come from the registry / dashboard alias.

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
| `message.usage` of the first assistant record in the main transcript (v72) | `Agent.firstContextTokens`, same sum: the session's starting context | — |
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

1. `claude.cmd` (npm) is a shim; the agent process descends from the pane's shell (`powershell.exe → claude.exe`). The pane ↔ session link walks the ppid chain (PowerShell CIM `Win32_Process` / `ps -A -o pid=,ppid=`) from the registry pid up to the pane's shell pid, so typing `claude` by hand in a shell pane links too. While that session lives the pane shows and behaves as the agent (`Pane.agent` from `useWorkspaceLinks`, read through `presetOf`: header, icon, rail row, newline / image paste keys, attachments, send-to-agent targets) and turns back into a shell when it ends; spawn, restart, split, layouts, restore and the Compact flow keep the pane's own preset. Measured 2026-10-18 (Claude Code 2.1.302): shown ~2 s after Enter, back to Shell ~0.3 s after `/exit` (`e2e/shell-agent.cjs`). Codex 0.162 writes its rollout only with the first prompt, so a hand-typed `codex` shows as Codex from then on (`docs/codex-integration.md` §6).
2. When Agent Monitor itself is started from inside a Claude Code session, the session's own variables (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_ENTRYPOINT`, …) are inherited. A `claude` started under `CLAUDE_CODE_CHILD_SESSION` prints "Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker" and writes neither a transcript nor a registry record, so the monitor never sees it. The PTY host strips these (plus `CODEX_THREAD_ID`, `CODEX_SANDBOX*`) from every pane's environment; user configuration such as `CLAUDE_CODE_USE_BEDROCK` is kept.
3. ConPTY reports the shell pid asynchronously (0 right after spawn, set ~30 ms later); node-pty's `kill` only ends the shell on Windows, so panes are killed with `taskkill /T /F` (absolute path) to take the agent and its tools down too.
4. Session restore uses the session id the monitor already knows for the pane (registry `sessionId`, follows `/clear`); nothing is guessed from folders. Restoring is always a user action ("Restore previous workspace"), never automatic. Reopening an external session that is still live asks first: two instances on one session would both append to the same transcript.
5. Git worktrees are created and removed by the PTY host (token channel), never by the collector's dashboard socket: `git -C <dir> worktree add -- <repo>-wt/<branch> [<branch>|-b <branch>]`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`; removal refuses the main checkout, a dirty tree or a folder a live terminal runs in, and never uses `--force`. `git` is resolved by walking PATH ourselves because Windows process creation would try the project folder first.
6. Newline in an agent prompt (v52, verified 2026-10-16, Claude Code 2.1.289 / codex-cli 0.162.1, Windows 11 ConPTY): xterm.js sends `\r` for Shift+Enter and Ctrl+Enter, so both submitted. The earlier fix sent ESC + CR for Shift+Enter; Claude Code on ConPTY submits on it too (seen in `!` bash mode: the first line ran). LF (`\n`, what Ctrl+J types) inserts a newline in Claude Code's prompt (`e2e/v25.cjs`), so Claude / Codex panes now send LF for Shift+Enter and Ctrl+Enter (`lib/termKeys.ts` `newlineFor`; Ctrl+Shift+Enter stays the zoom shortcut). Codex 0.162.1 does not treat LF as Enter (checked with `/model` typed, nothing opened); whether it inserts a newline there was not confirmed because Codex's update prompt took the probe's keys. Shell panes keep plain Enter (ESC there is PSReadLine's revert-line).
7. Links (2026-10-18, Claude Code 2.1.302, Windows 11 ConPTY). How CLIs print them: Claude Code's sign-in URLs (`/mcp` → Authenticate, `/login`) always as OSC 8 (link component `assumeSupport: true`), other links only when `supports-hyperlinks` agrees; Ink hard-wraps them to its box width with real newlines, indent and sometimes `│` borders (rows are not `isWrapped`); Codex, shells and other tools print plain text, wrapped by themselves or by xterm. Claude Code `/tui fullscreen` tracks the mouse, selects itself and copies natively plus through OSC 52. Before: xterm's default OSC 8 handler asked `confirm()` then `window.open()` → `about:blank`, denied by `harden()`, so Ctrl+click did nothing; plain links were found only for loopback hosts; a selection copied `
` + indent; OSC 52 was ignored. Now (`TermPane.vue`, `lib/fileLinks.ts`): `linkHandler` opens OSC 8 http(s) links on Ctrl/⌘+click; `findLinks` finds every http(s) URL; `breaksInsideUrl` follows a plain URL across a hard break when the row is filled to the edge (within 8 columns, borders and padding ignored) with URL characters, the next row carries on with URL characters (not a new `http(s)://`) and the URL starts above, so hover / click / right-click get the whole URL; copy (Ctrl+C, ⌘C, the Edit menu `copy` event) runs `selectionText` = `joinWrappedLinks` with that test plus the OSC 8 uris seen (`oscLinks`, last 50); OSC 52 writes go to the clipboard (write only, `?` reads ignored) joined the same way; `macOptionClickForcesSelection` so Option-drag selects in mouse-tracking apps (Shift-drag elsewhere, xterm default). Remote URLs open in the system browser (`openExternal`), loopback ones in a browser tab. PTY children get `FORCE_HYPERLINK=1` (`childEnv`; Run panes drop it). ConPTY passes OSC 8, OSC 52 and mouse modes through (mouse modes only once the app's console input is in VT / raw mode). E2E `e2e/links.cjs` covers OSC 8 indented / boxed, plain cut at the edge / boxed / soft-wrapped, two separate URLs, and a mouse-tracking app (Shift-drag, Ctrl+click, OSC 52).
` + indent. Now: `TermPane` sets `linkHandler` (Ctrl/⌘+click, http(s) only; loopback → in-app browser, anything else → `shell.openExternal`), records the OSC 8 uris it sees and joins a copied selection only where both sides of a break belong to one of them (`lib/fileLinks.ts` `joinWrappedLinks`); right-click on a link copies it whole. Other links in Claude's answers use OSC 8 only when `supports-hyperlinks` agrees, so PTY children get `FORCE_HYPERLINK=1` (`childEnv`; Run panes drop it). ConPTY passes OSC 8 through (`e2e/links.cjs`).

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

## 11s. Git Log pane reads history with plain git (v30, desktop only, 2026-10-15; branch writes since v36, push since v54)

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
| Push (v54) | `push --porcelain [--set-upstream] <remote> refs/heads/<local>:refs/heads/<branch>` (argv from shared `pushArgs`; main checks the local branch exists, `<remote>` is in `git remote`, `<branch>` passes `check-ref-format --branch`) | in-app Push dialog: outgoing commits, target, the exact command; clicking Push runs it (owner decision 2026-10-17: no native confirm) | 120 s |

**v54 Push dialog reads** (`.planning/PLAN-v54-git-push.md`, `branches.ts` `pushPreview`, LOCAL 20 s): `remote`; `for-each-ref --format=%(upstream:remotename)%1f%(upstream:remoteref)%1f%(push:remotename) <ref>` (default target = upstream, else push remote / `origin` / the only remote, branch = local name); `rev-parse --verify -q refs/remotes/<remote>/<branch>^{commit}`; outgoing `log -z --format=… -n 101 <ref> --not <remote-tracking ref>` (new remote branch: `--not --remotes=<remote>`). Result from `--porcelain` stdout: `!` + `[remote rejected]` → `remote-rejected` (protected branch, hook), other `!` → `non-ff`. Explorer → Changes shows `↑N` from `status --porcelain=v2 --branch` (`# branch.upstream`, `# branch.ab`), no extra git call.

Network commands (120 s) kill the whole process tree on timeout (`execGit` `killTree`, so `git-remote-https` does not linger on Windows); a spawn error is reported as `failed`, not `timeout`. Never: force push (a rejected push only reports), non-fast-forward update, reset, deleting the current branch or a tag, checking out an existing branch. Delete is not driven by E2E (the native confirm cannot be clicked through CDP); `test/branches.test.ts` covers it against real repos.

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

- Every pane's environment gets `ORRERY_API=http://127.0.0.1:<pty host port>`, `ORRERY_TOKEN=<32 random bytes, hex, one per pane>` and `ORRERY_MCP_CONFIG=<dataDir>/orrery-mcp.json`. Inherited `ORRERY_*` (and `GOLAIM_*` from builds before the 2026-10-17 rename) are stripped first (a dev build started from a pane must not talk to the packaged app). The token never goes on a command line.
- The `claude` preset appends `--mcp-config $env:ORRERY_MCP_CONFIG` (posix `"$ORRERY_MCP_CONFIG"`), last because the flag is variadic. The file is static: `{"mcpServers":{"orrery":{"type":"http","url":"${ORRERY_API}/mcp","headers":{"Authorization":"Bearer ${ORRERY_TOKEN}"}}}}`. Only Claude started by a preset gets the tool; `~/.claude.json` is not touched, sessions outside the app see nothing. `claude` typed by hand in a shell pane, and Codex panes, have the env but no tool (not wired yet).
- `POST /mcp` on the PTY host: JSON-RPC answered with plain `application/json` (no SSE), `GET` → 405. Refused: Host other than `127.0.0.1:<port>`, any `Origin` header (browsers), a missing / unknown / exited-pane bearer token. Tool `open_session {agent?, cwd?, prompt?, name?, resume?}`; `cwd` defaults to the calling pane's current folder and goes through the same `resolveCwd` as WS spawns (absolute, existing, no UNC). Limits: 16 live terminals (pending opens count), 20 opens per calling pane per minute (raised from 3 by the owner, 2026-10-16).
- The host asks main (`parentPort` `open` → `open-reply`), main asks the page (`ccm:pane-open` → `ccm:pane-open-reply`, 5 s), the page splits the new pane next to the caller without moving focus (no room → a new tab of the same project, not activated) and replies; the pane then spawns over the normal WS with `open: <ticket>`. The ticket (60 s, one use) is how the host adds `--session-id <uuid it generated>` and `-n '<name>'` (≤ 40 letters, digits, space . _ -, starting with a letter or digit): the page still never sends a command string.
- `prompt` is never put on a command line (Windows PowerShell 5.1 does not escape `"` when passing a variable to a native exe, so a quote could split it into flags). Control characters are stripped (`cleanPanePrompt`, ≤ 8000 chars); once the pane is linked to its monitor session and that session is `idle` (not `waiting`: a dialog is open), the page pastes it into the input box like "Send to agent" and never presses Enter; unlinked after 20 s (or status unknown) it pastes anyway, and without bracketed paste newlines become spaces so nothing runs. Orrery still never submits a prompt. A ticket that expired or names another preset is ignored: the pane spawns as a plain preset.
- Confirmation is Claude's own tool permission ("Allow mcp__orrery__open_session?"; the server was named `golaim` until the GolAIm → Orrery rename on 2026-10-17, so an "always allow" given to `mcp__golaim__open_session` is asked again once); in `auto` / bypass permission modes Claude may not ask, the limits above still apply.

**Resume (both paths, 2026-10-16).** `resume` must be a session UUID for claude / codex. An Orrery pane already running that session (`agentSessionId`) is focused instead of a second one. A session the monitor still sees live in a terminal outside Orrery (registry `claudeSessionId` / `codexSessionId`, not stale, no pane) is refused with `live` (MCP error text / deeplink warning dialog): two instances would append to one transcript. Otherwise the pane spawns with `--resume` (no `--session-id` / `-n`).

**Verified on 2.1.289 (spike, 2026-10-16).** `${VAR}` in `url` and `headers` of a `--mcp-config` file is expanded from the process env. The client first POSTs `server/discover` (id `server-discover-probe-1`, `_meta` protocol `2026-07-28`); a `-32601` reply is fine, it then sends `initialize` (`protocolVersion` `2025-11-25`, `Accept: application/json, text/event-stream`), `notifications/initialized`, a `GET /mcp` for an SSE stream (405 accepted) and `tools/list`. `/mcp` lists the server under "Built-in MCPs (always available)" as `✔ orrery 1 tool`. `--session-id <uuid>` names the transcript `<uuid>.jsonl`; `-n` writes `custom-title` / `agent-name` records and shows in the prompt box border.

**More tools (v80, `.planning/PLAN-v80.md` WP-1).** One module per tool in `apps/desktop/src/pty/mcpTools/` (schema, handler, texts); `mcp.ts` only dispatches JSON-RPC, `tools/list` keeps `open_session` first. Every tool runs behind the same gate and per-pane token as `open_session`, and is bound to the calling pane (`ToolHost`): no tool submits or types anything into any agent, and the page's reply is re-validated by the host (`parseMcpPageResult`) before it reaches the agent. Path arguments (absolute, or relative to the pane's starting folder) must resolve inside that folder after `realpath` (`resolveInside`): `..`, absolute paths elsewhere, UNC / device paths, NUL / newlines, folders and links / junctions pointing out of the project are refused before the page is asked. Host → main `parentPort` `mcp` → `mcp-reply`, main → page `ccm:mcp-call` → `ccm:mcp-reply` (5 s; handler `composables/useMcpCalls.ts`, installed by WorkspaceView).

- `notify_owner {text, level?: info|attention|done}`: one line ≤ 200 chars (control and bidi-override characters removed, `cleanNoteText`). The page files it in the Inbox as the newest note of the caller's monitor session (memory only, dismiss with E brings it back on the next note); main then posts `agent.note` to the collector, which shows a toast for `attention` under the **needs you** (waiting) switch and for `done` under the **done** switch (off by default: then a `done` note is Inbox only), with quiet hours and snooze, and sends it to the phone (if enabled; text through `maskSecrets`); `info` is Inbox only. The toast / phone name is the owner's alias or the folder name, never the auto title. Limit 6 notes per pane per minute: the rest fold into one note (last text, most urgent level, "+N more") sent when the window frees; the agent is told it is held.
- `open_in_workspace {path, line?, diff?}`: the file viewer at `line`, or with `diff: true` the project's Changes pane with that file selected (a missing file is allowed for diff: a deletion). An already open viewer / Changes pane is reused; a new one splits next to the caller (no room → a new tab of the project, not activated). Nothing is activated, the view is not switched, and Changes does not move keyboard focus while the owner types in a terminal or field. Limit 20 per pane per minute.
- `who_is_editing {path}`: other running Claude / Codex panes whose checkout has the file among its changes against the main branch (the Overlap radar's `overlapFiles`: committed since the merge base + uncommitted): other worktrees of the same repository, and panes in the caller's own folder (`sameCheckout`: the change is there, who made it cannot be told). Each entry: name (alias / tab name / folder, never the auto title), agent, status, branch, checkout root, last activity, and the file's mtime in that checkout (the host stats only a same-named file inside the root the page named). Reads git status and mtimes only, never file contents. Limit 20 per pane per minute.

Example from a shell pane (PowerShell): `$b = @{jsonrpc='2.0';id=1;method='tools/call';params=@{name='who_is_editing';arguments=@{path='src/app.ts'}}} | ConvertTo-Json -Depth 6 -Compress; Invoke-RestMethod -Method Post -Uri "$env:ORRERY_API/mcp" -Headers @{Authorization="Bearer $env:ORRERY_TOKEN"} -ContentType 'application/json' -Body $b`. Same shape for `notify_owner` (`arguments=@{text='Tests pass';level='done'}`) and `open_in_workspace` (`arguments=@{path='src/app.ts';line=42}` or `@{path='src/app.ts';diff=$true}`). Claude asks its own permission per tool (`mcp__orrery__notify_owner`, …). Codex panes get the same four tools since v80 WP-2 (`-c mcp_servers.orrery.*`, same per-pane `ORRERY_TOKEN`; docs/codex-integration.md §8).

**Main-side tools (v80 WP-5).** `preview_layout`, `list_servers` and `free_port` are answered by the desktop main process, not the page: host `{t:'mcp-desk', call}` → `PtySupervisor.relayDesk` → `opts.onDesk` = `main.ts` `desk` (`apps/desktop/src/mcpDesk.ts` `createDesk`) → `{t:'mcp-reply'}`, re-checked by the host with `parseMcpDeskResult` (`packages/shared/src/mcpDesk.ts`). The call carries the pane's starting folder and shell pid (root of its process tree).

- `preview_layout {path, device?: phone|tablet, theme?: light|dark}`: a layout XML (`res/layout*/` or a loose XML with a view root, ≤ 1 MB, path inside the pane's folder, checked again in main) rendered by the XML Layout Preview daemon (`LayoutIpc.agentRender`, own render slot per pane, phone 1080×2340 @ 440 dpi / tablet 1600×2560 @ 320 dpi, dark = night mode). The call is the warm-up signal: no JVM runs before it (owner rule). While the daemon is not ready the first call starts it (cached project model, then `daemon.ensure()`) and waits at most 1.5 s, then answers `starting` with `retryInSec` from the cold-start stage; it never downloads the layoutlib kit (needs the owner's consent → `bundle-missing`) and never starts the Gradle model build / auto compile. The PNG goes to the capture folder `shots/` (`layout-<name>[-dark]-<stamp>.png`, swept by its retention) or, without one, `%TEMP%/orrery-layout` (newest 20 kept); the answer is that path, size, render time and ≤ 12 diagnostics (one line, ≤ 300 chars). 10 per pane per minute.
- `list_servers {}`: servers / LISTEN ports from the newest Resources report (`resources` message, sampled every 30 s while a window is open): name, kind, ports, idle seconds, orphan, and `mine` = in the pane's process tree (pid table now: koffi, else CIM / `ps`), under an agent session whose process is in that tree, or with a working folder inside the pane's folder (this project rule is off when the pane starts at a drive root, the home folder or above it). The masked command line is returned for `mine` only; ports held outside every agent come back as port + process name only. 20 per pane per minute.
- `free_port {port}`: stops the holders of that port only when every holder is `mine` (one foreign holder refuses the whole request: `not-mine`; outside agents → `outside`; emulators → `emulator`, use Devices; an agent session process or the pane shell → `self`). Then the Resources v76 stop path (`resKill`: pid + creation time re-read, Gradle / Kotlin daemons busy in the last 2 min refused, tree kill) with **one native confirm worded for the agent** ("An agent in “<folder>” wants to free port N", en / vi in `resources/agentPorts.ts` `freePortText`); one agent confirm at a time (`confirm-open`), 3 per pane per minute, the host waits up to 10 min for the answer. Result: stopped pids, or `cancelled` when the owner declined.

**Run / device tools (v80 WP-4).** `run_app`, `run_status`, `run_log` are answered by the page (`apps/web/src/lib/mcpRun.ts` `createRunCalls`, wired in `useMcpCalls`; the caller must be a pane the page knows), `device_screenshot` by main (`main.ts` `pageMcp` → `screenshotMcp` → `apps/desktop/src/devices/mcpShot.ts` `mcpScreenshot`, the page is not asked). The Run root is the calling pane's starting folder; the page reaches main only through the existing Run IPC, so `resolveDir` still gates that folder. The host re-checks every answer (`packages/shared/src/mcpRun.ts` `parseMcpRunResult`: ids / serials `^(?!-)[A-Za-z0-9_.:@%-]{1,128}$`, known kinds / states only, ANSI / control / bidi characters stripped, lists capped) and masks all text again with `createLogMasker` (home → `~`, tokens, `key=value` secrets) before it reaches the agent.

- `run_app {action: start|reload|restart|stop, config?, device?, full?}`: `config` must be an id of the project's Run configurations (`run.loadConfigs`), `device` an id of `run.devicesFor(config)` (a config that pins a device refuses another one); defaults = the Run bar's pick, which is never changed (`run.startConfig`). `start` refuses a (config, device) pair that is already live (`running`); `restart` = Rerun (main stops the old run first); `stop` / `reload` act on the pair's live run, else the run the Run pane shows / the newest live one, like the buttons; `reload` needs state `running`, `full: true` = hot restart. Shared / imported configs still get main's native trust confirm (`TrustStore`); no free command, nothing is installed but what the config builds. The page replies within 4 s (`RUN_REPLY_MS`; main waits 5 s): a start still waiting for the confirm or an old run answers `waiting` (not an error) and carries on. 6 / minute / pane.
- `run_status {}`: configs (id, name, kind, pinned device, selected), all Run devices (serial, name, platform, ready / unauthorized / offline, selected), the 5 newest runs of the project: state `starting|running|stopping|crashed|stopped` (+ raw `RunState`), device, start / end time, `lastError` in one line (failure code + detail, else the last parsed build error, else the newest crash block of the log, else the last error line of a failed run). 30 / minute / pane.
- `run_log {lines? 1–200 = 50, errorsOnly?}`: the last lines of the run the Run pane shows (renderer copy, `LOG_CAP` 5000; output from before a window reload is gone: `partial`), `errorsOnly` = level E / F or lines with error / exception / fatal / failed / failure, plus up to 20 parsed build errors (`file:line:col`). 30 / minute / pane.
- `device_screenshot {serial?}`: `adb exec-out screencap -p` through `DeviceManager.screencap` (its ready check) on a device that is online and `ready` in `snapshot()`; without `serial`: the device of the project's newest live run, else the only ready device, else `several` with the list / `no-device`. Saved with Orrery's name (`shotName`) in the capture folder's `shots/` (v76, owner-picked, its retention applies), else `<tmp>/orrery-shots` (newest 30 kept). Returns path + width × height. Gives up after 7 s (the host waits 8 s) and then saves nothing. Never installs, never changes a setting; `secure` windows are reported as such. 10 / minute / pane.

**Deeplink path.** `agent-monitor://open?agent=claude|codex|shell&cwd=<absolute folder>[&resume=<session uuid>]` for callers outside the app (Claude in another terminal, scripts): `resume` (claude / codex, bare UUID only, else the link is ignored) reopens an unfinished session with `claude --resume` / `codex resume` (cwd must be its project folder); no prompt or name is read from the link (any web page can create one), the folder must be absolute (Windows: with a drive letter), local and existing (`apps/desktop/src/openLink.ts`). **No confirmation** (owner decision 2026-10-16, after being told any web page can fire the link): links are queued one at a time and capped at 10 per minute (`takeLinkSlot`), more are dropped. What still protects a folder a page picks: Claude Code asks its own "trust this folder?" before loading a new folder's project settings / hooks, and a shell pane only runs the user's profile. Registered for packaged builds only: Windows via `setAsDefaultProtocolClient`, macOS via `protocols` in `electron-builder.yml` + `open-url` (queued until boot). From Git Bash: `cmd //c start "" "agent-monitor://open?agent=claude&cwd=D:%5Cwork%5Capp"`; macOS: `open "agent-monitor://open?cwd=/Users/me/app"`.

## 11x. Compact from the context menu: handoff → `/compact` → resume (v51, desktop only, 2026-10-16)

Plan `.planning/PLAN-v51-compact-handoff.md`. Owner decision: the menu item **Compact…** (rail row, strip tab, Mission Control tile of a Claude / Codex pane) **sends** one prompt (bracketed paste, then `\r` 200 ms later) asking the agent to write a handoff to `<session cwd>/.planning/HANDOFF-YYYY-MM-DD-HHmm.md` and stop. This is the only place the app submits text to an agent, and only on the owner's click while the effective status is `idle` (disabled while working, while `waiting` on a permission or question — typed text would land in that dialog — and when the pane is not linked).

- Slash commands are TUI input: the model cannot run `/compact` / `/clear` itself. When the agent went `working` → `idle` and the file exists (`readFile` kind `text`; `missing` keeps waiting), the app **types** `/compact` (raw keys, so the slash menu opens on it) without Enter.
- Compaction is detected from `TerminalSession.compactions` (transcript `system/compact_boundary`, Codex rollout compaction) growing past the value at that step; then "Read `<file>` and continue." is prefilled (no Enter) and the flow ends. A compaction the owner runs by hand at any step ends it the same way.
- The flow is runtime state on the pane (`Pane.compact`), never persisted; closing / exiting the pane drops it, the menu offers **Cancel compact** meanwhile.
- v52: the pane header also offers the same action as a chip ("Context 82% · Compact…") once the main agent's context reaches `CONTEXT_THRESHOLDS.warning` and the flow could start (`compactState` `ready`). It is only a shortcut to the menu item: nothing is sent until the owner clicks it.
- v52 undo close (`reopenClosed`): a closed Claude / Codex pane comes back with `--resume <agentSessionId>`, the same path as v49 `resume`; a session already running in another pane is not reopened twice.

## 11y. Main ↔ subagent messages mid-run: `Agent.msgIn` / `Agent.msgOut` (v54, verified 2026-10-16, Claude Code 2.1.289, keys / ids / timestamps only)

Plan `.planning/PLAN-v54-main-agent-messaging.md`, research `.planning/RESEARCH-v54-main-agent-messaging.md` §3.1 / §3.5. The collector publishes two counters on subagent agents and nothing else; the UI pulses when one grows (never on snapshot / `agent.created`). Session ↔ session messages get their own section.

Verified on every transcript under `~/.claude/projects` (583 files, 278 subagent transcripts) by a read-only script outside the repo that printed field names, id shapes, timestamps and counts only.

| Direction | Where | Record | Count |
|---|---|---|---|
| main → subagent (`SendMessage`, `to` = subagent id) | `subagents/agent-<id>.jsonl` | `user` with `origin {kind:"coordinator"}` (no other origin field), `isMeta`, `uuid`, `timestamp`, top-level `agentId` = file id; delivered mid-turn: `attachment {type:"queued_command", source_uuid, prompt, isMeta, origin {kind:"coordinator"}}` | 46 (14 user + 32 queued) = 46 `SendMessage` calls from main; equal per agent for all 24 agents |
| subagent → parent, hand-back (`SubagentHandback`) | parent transcript: main, or the parent subagent's for a nested agent | `user` with `origin {kind:"peer", from, senderTaskId, handback:true, name?, body}` (`from` = `senderTaskId` = `a` + 16 hex, always a subagent of the same session); or `attachment queued_command` (`source_uuid`, `delivery_id?`, `timestamp`, same origin) | 259 (main 166 user + 90 queued; nested 3, in the parent subagent's transcript) |
| subagent → main, `SendMessage {to:"main"}` | sender: `tool_use` in `agent-<id>.jsonl`; receiver: main gets `attachment queued_command` with `origin {kind:"peer", from:<id>}` **without** `handback` (11 s later) | 1 |

- **(a) One message, several lines.** Each hand-back in main is one `queue-operation enqueue` (content starts `<agent-message from="a…">`) plus exactly **one** delivery record: `user` (main idle on arrival, 166) or `queue-operation remove` (`reason: absorbed_mid_turn`) + `attachment queued_command` (main busy, 91). 257 enqueues = 257 delivery records; no `source_uuid` equals a `user.uuid`; no key repeats. The delivery record follows its enqueue within 0.1 s (p90; max 8.9 s). Subagent transcripts have no `queue-operation`. The collector counts delivery records only (key `uuid` / `attachment.source_uuid`, then the record `uuid`, then `@<timestamp>`), ignores the enqueue, and keeps keys per agent so a re-read never counts twice.
- **(b) A hand-back ends a run.** 261 `SubagentHandback` calls (all succeeded) for 259 records; 241 of 245 agents hand back once, the others were woken again by `SendMessage` (2 or 4+ hand-backs). The `completed` task-notification follows the last hand-back by ~9 s (median). So `msgOut` grows when a subagent finishes and the UI merges it with the "done" pulse; the only message up mid-run is `SendMessage {to:"main"}`.
- **(c) Coordinator records** carry `timestamp`, `uuid` (user) / `source_uuid` (queued) and `agentId`. They are written when the subagent takes the message, 0.5–270 s after main's `SendMessage` (median 8.6 s): `msgIn` grows on delivery, not on send.
- **(d) Waking a finished subagent** (`toolUseResult.resumedAgentId`, 13 calls) still writes the coordinator record into the same `subagents/agent-<id>.jsonl` (13 / 13). The collector keeps such an agent `completed` (resolution is final, unchanged), so its `msgIn` can grow on a finished agent.

Collector:

- `transcript.ts` `extractSignals`: `coordinator_msg {key, at}` (`user` / queued command with `origin.kind` `coordinator`), `handback {from, key, at}` (`origin.kind` `peer`, `origin.handback === true`, `from` matches `^a[0-9a-f]{16}$`), `send_main {key = tool_use id, at}` (`SendMessage` whose `input.to === "main"`; nothing else of the input is read). A peer record without `handback` (the receiving copy of `to:"main"`) is ignored, so that message is counted once, on the sender side.
- `tracker.ts`: `coordinator_msg` / `send_main` credit the agent whose transcript holds them (main's own are ignored); `handback` credits `origin.from` wherever it is read. A hand-back for an agent not discovered yet waits in the map (catch-up reads main before `subagents/`), so the agent is created with its count. Keys reset on `/clear`. `buildAgents` sets `msgIn` / `msgOut` only when > 0; the store diff turns a change into an `agent.updated` patch. Catch-up builds the counts; these messages never create activity.
- Line filter (§11v): an `attachment` line is parsed only when it has a raw `"type":"queued_command"` and `"kind":"coordinator"` / `"kind":"peer"`; the lite catch-up keeps head lines with those kinds too.
- New code run read-only over the same data: 307 sessions, `msgIn` total 46, `msgOut` total 260 (259 hand-backs + 1 `to:"main"`), 0 activity.

Privacy: the message text sits in `origin.body`, `origin.name`, `message.content`, `attachment.prompt`, the enqueue `content`, the `SendMessage` input (`message`, `summary`, `content`, `recipient`) and `toolUseResult.message`. None leaves `extractSignals`: a signal holds a key (record uuid, tool_use id or timestamp), the sender agent id (regex-checked) and a timestamp, and the agent gets two numbers. `to` is only compared with `"main"`. Tests: `units.test.ts` (no fake body in the signals), `monitor.test.ts` (no `secret` in events or snapshot).

## 11z. Session ↔ session messages: peer links (v54, verified 2026-10-16, Claude Code 2.1.289, Windows 11, keys / ids / timestamps only)

Plan `.planning/PLAN-v54-main-agent-messaging.md` §6 P0 (owner ran two `claude` sessions A and B and had them `SendMessage` each other; only the record structure was read), research §3.1 / §4 / §5.

Verified on disk:

| Side | Source | Fields read |
|---|---|---|
| Registry | `sessions/<pid>.json` `messagingSocketPath` (`\\.\pipe\LOCAL\cc-msg-…`, 54 chars), `name` | path → `sockKey` only (≤ 300 chars, else none) |
| Sender | `assistant` `tool_use` `SendMessage` (`input.to` = session name, or the raw `uds:…` address when replying) → `user` `toolUseResult {success, message, display, msg_id}` (`msg_id` = UUID) | `success === true`, `msg_id` (`^[A-Za-z0-9_-]{8,64}$`); a result with `pin` / `resumedAgentId` is a send to a subagent (§11y) and is skipped. The transcript is main's or a subagent's: that agent becomes `lastAgentId` |
| Receiver, idle | `queue-operation enqueue` (`<cross-session-message from="uds:<path>" [hop-chain=…] from-name="…" from-mode="…">`) → `dequeue` → `user` `isMeta:true, turnOrigin:"peer", promptSource:"system", origin {kind:"peer", from:"uds:<path>", msg_id, name, fromMode, hopChain?, body}` | `origin.kind`, `origin.from` (prefix `uds:` only), `origin.msg_id`, `uuid`, `timestamp` |
| Receiver, busy | not seen yet; by analogy with hand-backs (§11y a) an `attachment queued_command` with the same `origin` | same, key `source_uuid` |

- `from` without `uds:` is **exactly** the sender's `messagingSocketPath` (Windows does not percent-encode; the collector still runs `decodeURIComponent`, keeping the raw text when it is malformed). `msg_id` on the sender equals `origin.msg_id` on the receiver, both directions. Sender result and receiver enqueue were < 10 ms apart; the receiver's delivery record 36–67 ms after the sender's result on the two real messages.
- Counted from the **receiver** only: one `user` / queued delivery record = one message; the enqueue is ignored (same rule as §11y). Peer messages are read from main transcripts only (they are addressed to the session).
- `bridge:` / `did:` / `unknown` senders, held / refused deliveries and `notify_when_idle` are P5 (not read).

Collector:

- `registry.ts` `socketKey(path)` = sha256(lower-cased path) → 16 hex; `RegistryRecord.sockKey`.
- `transcript.ts` signals `peer_in {fromKey, msgId?, dedupeKey, at}` (`fromKey` = `socketKey(decode(from without uds:))`, `dedupeKey` = record `uuid` / `source_uuid` / `@<timestamp>`), `peer_sent {msgId, at}`.
- `tracker.ts` queues them per sync (`drainPeers`: inbound from the main transcript with `live = !catchUp`; sent from main and every subagent transcript with the agent id).
- `peers.ts` `PeerLinkStore`: sender terminal = live tracker whose `record.sockKey` = `fromKey` (an ended one if no live one), else the terminal that wrote the matching `peer_sent`. Link id `a < b ? a>b : b>a` (string compare, same as web `peerLinkId`), `kind: 'message'`, `ab` / `ba` per direction, `firstAt` / `lastAt` / `lastDir` / `lastAgentId` (sender's agent from `peer_sent`, else `<terminal>:main`). Dedupe by `msg_id`, else receiver + `dedupeKey`. A live message whose `peer_sent` is not in yet waits up to 2 s (the two transcripts are read by different syncs), then counts with the main agent. A sender that cannot be resolved stays pending until the end of the reconcile pass, then is dropped (one-sided messages are P5). A message whose sender resolves to the receiver itself is ignored. Messages older than the TTL are skipped; a link is removed (`link.removed`) after `CCM_PEER_TTL_MIN` (60) minutes without a message or when either terminal is forgotten (stale TTL / dismiss).
- `monitor.ts`: drains each tracker after a sync, `flush()` after every live sync, `flush(true)` + `prune()` at the end of each reconcile (catch-up messages are resolved once every tracker of the first pass is known). Each live message adds activity `peer.message {terminalId: sender, agentId, data.title: sender name, data.to: receiver name}` (alias or registry title, never `origin.name` / `from-name`). Catch-up builds links with no activity.
- `store.ts`: snapshot `peerLinks`, events `link.created` / `link.updated` (field patch, folded per id in a batch like agents) / `link.removed`.
- Demo: `node scripts/demo-fixture.mjs --peers=N` gives every fake session a socket path, seeds N messages (both sides, empty body; ~30 % sent from a subagent) and keeps sending one now and then while it runs.

## 11aa. Devices tab: wireless ADB (v61, desktop only, 2026-10-21)

Plan `.planning/PLAN-v61-adb-devices.md`. Source: the Orrery Devices tab replaces the escrcpy-style device list with the SDK's own `adb` (resolved by `findAdbTools`: Settings `androidSdk`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, default SDK dir, PATH; adb is never bundled). Nothing here touches Claude Code.

**Verification status.** The output lines below are the formats the parsers in `apps/desktop/src/devices/parse.ts` accept (fixtures in `apps/desktop/test/devices-parse.test.ts`). They were checked against the platform-tools output formats documented in AOSP sources, **not against a live device in this session**. `e2e/devices.cjs` runs the real app against a fake adb (`e2e/fixtures/run-fakes/adb.js`) that prints the same lines.

Commands (always an args array through `Spawner`, never a shell; page-supplied values are validated in `devices/ipc.ts`, anything starting with `-` is refused):

| Purpose | Command | Output line parsed |
|---|---|---|
| List / track | `adb devices -l`, `adb track-devices -l` | `<id>  <state> [usb:<p>] [product:<x>] [model:<x>] [device:<x>] [transport_id:<n>]`; states `device` / `unauthorized` / `offline` / `recovery` / `sideload` / `bootloader` / `no permissions (…)`, anything else `unknown` |
| Connect | `adb connect <host:port>` | `connected to <addr>` / `already connected to <addr>`; failures `failed to connect to '<addr>': …`, `cannot connect to <addr>: …`, `failed to authenticate to <addr>` |
| Pair | `adb pair <host:port> <6 digits>` | `Successfully paired to <addr> [guid=<id>]` / `Failed: …` |
| Disconnect | `adb disconnect <id>` | `disconnected <id>` / `error: no such device '<id>'` |
| USB to Wi-Fi | `adb -s <id> shell ip -f inet addr show wlan0`, `adb -s <id> tcpip 5555`, then (after 1 s) `adb connect <ip>:5555` | `inet <ip>/<n> …` |
| mDNS | `adb mdns check`, `adb mdns services` | `<name>\t<_adb-tls-pairing._tcp \| _adb-tls-connect._tcp \| _adb._tcp>\t<host:port>` after a `List of discovered mdns services` header |

- **adb clients are killed by PID only, never as a tree** (`killAdbClient`, passed as `kill` to `collect` / `createAdbWatch` by the Devices commands, the Devices tracker and the Run device service). The first client after boot is the parent of `adb fork-server`, so `taskkill /T` (or SIGKILL to the POSIX group) on a timed-out `adb connect` or on the tracker would stop the server and drop every Wi-Fi connection. The Android runner's own `logcat` / `install` children still use `killTree` (follow-up).
- **`adb connect` exits 0 on failure.** The result is decided from the output line, never from the exit code (a non-zero code or a timeout only means adb itself failed). An empty output is a failure.
- **mDNS needs platform-tools 31 or newer** (`adb mdns check` prints `unavailable` or fails on older ones). An adb server that was started without mDNS lists no services until it is restarted (`adb kill-server`); the UI reports `mdns-unavailable` / `no-devices` instead of hanging.
- **QR pairing**: the page shows `WIFI:T:ADB;S:orrery-<8 hex>;P:<6 digits>;;` (name from `crypto.randomBytes(4)`, password from `crypto.randomInt`, zero-padded). Main polls `mdns services` every 1 s: a `_adb-tls-pairing._tcp` entry with that name (wait 60 s) runs `adb pair <host:port> <password>`, then the phone's `_adb-tls-connect._tcp` entry (wait 30 s) runs `adb connect`. Cancelling, closing the popover or the owning window stops it.
- **History file** `<CCM_DATA_DIR>/adb-devices.json` (`{ version: 1, autoConnect, devices: { [id]: { alias, model, wifi, lastSeen } } }`): remembered ready device ids with aliases and `lastSeen`, written with tmp + rename, at most 200 entries (oldest `lastSeen` dropped), only when the ready set or an alias changes. `unauthorized` devices and `emulator-*` serials are never saved; the map has a null prototype and a `__proto__` key is dropped on load. Auto-connect (default on) runs `adb connect` once per app run for each remembered Wi-Fi id, without starting a tracker. The tracker runs only while a window holds the Devices view.
- Forget (remove history rows) asks a native confirm first; Disconnect does not. The E2E has no auto-answer for that native dialog, so it stops at Disconnect.

Deviation: escrcpy drives adb through adbkit inside its preload; Orrery runs the adb CLI from the main process instead (no new desktop dependency, one trust boundary, the page gets ids and results only). The web side adds only `qrcode` (QR tile rendering).

## 11y. Hook bridge — compaction and auto-mode denials (v66, desktop only, verified 2026-10-28, Claude Code 2.1.294 binary, keys only)

Opt-in: Quick setup → Hook bridge (off by default). After a native confirm that shows the exact `hooks` block, the app adds one entry per event to `~/.claude/settings.json` (backup first, other hooks kept; Turn off removes only entries whose command contains `hook-bridge`):

```json
{ "hooks": { "PreCompact": [{ "hooks": [{ "type": "command", "command": "<node> \"<app>/bridge/hook-bridge.mjs\"", "async": true }] }] } }
```

Same for `PostCompact`, `PermissionDenied` and (since v72) `PermissionRequest`. `async: true` (present in 2.1.294: "runs in background without blocking") keeps Claude Code from waiting on the script.

Payload keys read (stdin JSON; anything else is dropped unread):

| Event | Keys used | Keys ignored |
|---|---|---|
| `PreCompact` | `session_id`, `hook_event_name`, `trigger` (`manual`/`auto`) | `custom_instructions`, `transcript_path`, `cwd` |
| `PostCompact` | `session_id`, `hook_event_name` | `compact_summary`, `trigger` |
| `PermissionDenied` | `session_id`, `hook_event_name`, `tool_name` | `tool_input`, `tool_use_id`, `reason`, `mcp_server` |

`scripts/hook-bridge.mjs` writes `<CCM_DATA_DIR>/hooks/<session uuid>.json` = `{v, sessionId, at, compactingSince?, compactTrigger?, deniedCount, deniedTools (≤ 5 names matching `^[\w.:-]{1,80}$`)}`; it never prints, always exits 0, and ignores a `session_id` that is not a UUID. The collector (`hooks.ts` `HookReader`) reads that folder on the existing extras poll (no new watcher) and copies the fields onto `TerminalSession`; a `compactingSince` older than 15 min (`COMPACT_STALE_MS`) is dropped as a lost `PostCompact`. The UI shows "Compacting · 1m" on the session card / map node and "Auto mode denied N×" with the tool names in the tooltip.

### `PermissionRequest` and the allow-rule advisor (v72, verified 2026-10-29 in the installed Claude Code 2.1.294 binary, keys only)

2.1.289 is no longer installed on this machine; the check ran on the `claude.exe` of `@anthropic-ai/claude-code` 2.1.294 (npm global). `PermissionRequest` is in the hook event list ("When a permission dialog is displayed") with input schema `{ hook_event_name: "PermissionRequest", tool_name, tool_input, permission_suggestions?: PermissionUpdate[], mcp_server? }` plus the common fields (`session_id`, `cwd`, …). `PermissionUpdate` `addRules` = `{ type: "addRules", rules: [{ toolName, ruleContent? }], behavior: "allow" | "deny" | "ask", destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg" }`: the rules Claude Code itself would add on "Yes, don't ask again". Rule text is `toolName` or `toolName(ruleContent)` (e.g. `Bash(npm run test:*)`, `WebFetch(domain:platform.claude.com)` appears in the bundle); a shell prefix rule ends in `:*` (the bundle also accepts ` *`).

Since v72 the hook bridge also registers `PermissionRequest` (`async: true`, so no decision is returned and the dialog is unchanged; an install from before v72 reads as `partial` until turned on again). Per dialog it appends one line to `<CCM_DATA_DIR>/hooks/permission-asks.jsonl` (rotated to `permission-asks.1.jsonl` past 512 KB): `{ at, cwd, tool, rules, prefix? }`. Kept: `addRules` + `allow` suggestions whose content matches `^[\w .:*@+,~-]{1,120}$` with no word over 40 chars (no paths, quotes, `=`, long tokens), at most 3; for `Bash` / `PowerShell` up to two leading words of `tool_input.command` (`^(?:\./)?[\w.:@+-]{1,30}$`, stops at a flag or path). Dropped unread: the rest of `tool_input`, `mcp_server`, other suggestion types. The collector ignores the file (not a session UUID name).

Desktop `preview/permRules.ts` reads it only when the Permission prompts dialog opens (`ccm:perm-read`): last 7 days, `cwd` inside the project, re-validated. It also reads the rule strings of `<project>/.claude/settings.json` and `settings.local.json`. Ticked rules go through `ccm:perm-allow`: validated (`parsePermRule`, never `isRiskyPermRule`: bare / `*` shell rules, metacharacters, `rm`, `curl`, interpreters, `git push` …), merged into `permissions.allow` of `settings.local.json` only (other keys and indent kept, `.ccm-backup` first) after a native confirm showing the exact line diff; refused when the file changed meanwhile. `settings.json` is never written.

Deviation: the hook gives the moment a dialog opens but not when it is answered, so the advisor shows counts and last time, no total waiting time. Auto-mode denials come from the existing `deniedTools` of open sessions.

### Background context sources (v72, verified 2026-10-29 in the installed Claude Code 2.1.294 binary)

The bundle's memory types are `User` (`<config>/CLAUDE.md`), `Project` (`CLAUDE.md`), `Local` (`CLAUDE.local.md`), `Managed` (policy folder `CLAUDE.md`) and `AutoMem`; rules folders are `<project>/.claude/rules` and `<config>/rules`; its own config-audit text lists `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` in the project root and ancestors, `.claude/CLAUDE.md`, `.claude/AGENTS.md`, `~/.claude/CLAUDE.md` and the files they import. Desktop `preview/contextSources.ts` (`ccm:ctx-sources`, run when the dialog opens, never polled) lists exactly those that exist for the session folder and its ancestors (nested sub-folder files load on demand and are left out), `@imports` up to 5 hops (text outside code), `<config>/projects/<slug>/memory/MEMORY.md` (start) and the other memory files (on demand), `SKILL.md` of user / project skills (name + description until used), `.mcp.json`, MCP server names per scope and enabled plugin names. Only paths, sizes and line counts reach the page. The dialog shows sizes in KB and labels them as file size, not tokens; the only token numbers are `firstContextTokens` / `contextTokens` from transcript usage. The policy folder path (`C:\Program Files\ClaudeCode`, `/Library/Application Support/ClaudeCode`, `/etc/claude-code`) follows the public docs; it was not seen in the bundle as a literal.

## 11ab. Tool / skill / subagent / MCP call counts (v73, verified 2026-10-29, Claude Code 2.1.294 transcripts, names only)

- Source: the usage scan (`usage.ts` `UsageIndex`) already reads every `projects/**/*.jsonl` line. Assistant lines carry `message.content[]` blocks `{type:'tool_use', id, name, input}`; Claude Code writes **one line per content block with the same `message.id`** (8 306 split messages in the 400 newest transcripts), so token dedupe by `message.id` stays, but tool calls on later lines of a message are counted when the id is owned by the same file (a `--resume` copy in another file is skipped).
- Read fields: `name`; for `Skill` only `input.skill` (seen keys `skill`, `skill` + `args`); for `Agent` / `Task` only `input.subagent_type` (missing → `general-purpose`, Claude Code's default); MCP server = the part between `mcp__` and the next `__` of the tool name. No other input field is read.
- Errors: user lines with `"is_error":true` (raw match, then parse) carry `tool_result.tool_use_id`; matched against the last ≤ 500 open `tool_use` ids of that transcript, kept in memory only (an error whose call was ingested before a collector restart is not counted).
- Counts per `day|kind|name|project(cwd)` persist in `usage-index.json` (`CACHE_VERSION` 4, one full rescan after update). `toolstats.get {days: 7|30, project|null}` → `toolstats.data` aggregates on request.
- "Not used in 30 days" compares names from the desktop `ccm:ext-status` (skill folder names under `<config>/skills` and `<project>/.claude/skills`, configured MCP server names) with calls in the same project filter. Plugin skills are not listed (deviation: their folders need the plugin install paths). MCP names are compared after reducing to `[A-Za-z0-9_-]`, case-insensitive. Nothing is disabled: the button opens the Extensions tab.

## 11ac. Usage limit hit and "continue at reset" (v73, verified 2026-10-29 on Claude Code 2.1.294 transcripts + binary strings)

- When a request is refused by the plan limit, 2.1.294 appends an **assistant** line with `model: "<synthetic>"`, `isApiErrorMessage: true`, `error: "rate_limit"`, `apiError: "usage_limit_reached"`, `apiErrorStatus: 429`, and `quotaLimits {status:"rejected", resetsAt:<epoch seconds>, rateLimitType:"five_hour"|…}` (same data in `apiErrorParams.rate_limit_info`). Text: `You've hit your session limit · resets 5:40am (Asia/Ho_Chi_Minh)`. Subagent transcripts get the same line (`isSidechain: true`).
- Right after it, the main transcript gets `{type:"system", subtype:"informational", level:"notice", content:"Usage limit reached · continuing automatically at 5:40am · esc to cancel"}`: **Claude Code 2.1.294 has its own auto-continue** (`quota-auto-resume`), which at the reset queues the prompt "Your claude.ai usage limit has reset. Continue the task…" and writes `Usage limit reset · continuing automatically`. Every main-session hit in the local transcripts (6 sessions, 2026-10-15…28) had it. Binary strings also show `Automatic continue cancelled · /rate-limit-options to re-arm` (esc) and a variant for a session moved to the background; those were not seen in a transcript, so the collector only matches their fixed prefixes.
- Collector: `transcript.ts` signals `limit_hit` (only `resetsAt`, `rateLimitType`, timestamp) and `limit_resume` (prefix match, nothing stored); `TranscriptState.limitHit` → `TerminalSession.limitHit {at, resetsAt, window, autoResume}`; cleared by the next real (`model` ≠ `<synthetic>`) reply or the reset notice.
- App (deviation from the idea's "no auto continue exists"): the pane chip "Waiting for reset 14:30" + "Schedule continue" still only **prefills** text via `insertInto` at reset + 15 s (one `setTimeout`, no polling, never Enter). When Claude Code armed its own auto-continue, the dialog says so; a schedule is cancelled when the agent replies again, so the two do not stack.

## 11ad. Hooks manager: where hooks live and how Orrery turns one off (v74, desktop only, verified 2026-10-29 on Claude Code 2.1.294, Windows 11, keys / shapes only)

Read on the installed CLI (`claude --version` 2.1.294; settings schema strings in the binary) and the files of this machine; no hook command or setting value was copied here.

- **Files.** User: `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json`. Project: `<project>/.claude/settings.json` (shared) and `<project>/.claude/settings.local.json` (this machine). Managed / policy settings and `--settings` files exist too (binary strings) but Orrery neither reads nor writes them. A user-level `settings.local.json` exists on this machine (only `permissions`, `enabledPlugins`, `disabledMcpjsonServers`); whether Claude Code reads hooks from it is not documented, so Orrery ignores it.
- **Shape.** `hooks: { <Event>: [ { matcher?: string, hooks: [ <entry>, … ], description?: string } ] }`. `matcher` is absent for events without one, a tool-name regex / `A|B` list for tool events (`Bash`, `Edit|Write`, `*`), or a source list for `SessionStart` (`startup|resume|clear|compact`). `description` appears only in plugin files.
- **Entry types** (schema in the binary): `command` (`command`, optional `args` exec form without a shell, `if` permission-rule filter, `shell: 'bash' | 'powershell'`, `timeout` seconds, `statusMessage`, `once`, `async`, `asyncRewake`, `rewakeMessage`, `rewakeSummary`, `cloud`), `http` (`url`, `headers`, `timeout`), `prompt` / `agent` (LLM evaluated, `prompt`, `model`), `mcp_tool`. A command runs through bash (Git Bash on Windows) or PowerShell on Windows without Git Bash, unless `args` or `shell` say otherwise.
- **Events** (binary enum): Setup, SessionStart, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, SubagentStart, SubagentStop, Stop, StopFailure, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, TeammateIdle, SessionEnd. Input on stdin: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode?`, … plus per event (`tool_name` / `tool_input` / `tool_use_id`, `prompt`, `source`, `trigger`, `stop_hook_active`, `agent_id` / `agent_type`, `message` / `notification_type`, …).
- **Plugins.** `<root>/plugins/installed_plugins.json` (`version: 2`, `plugins: { "<name>@<marketplace>": [ { scope: 'user' | 'project' | 'local', projectPath?, installPath, version, … } ] }`). Hooks of a plugin: `<installPath>/hooks/hooks.json` (`{ description?, hooks: {…} }`, same shape) and / or `hooks` in `<installPath>/.claude-plugin/plugin.json` (an inline event object, or path(s) relative to the plugin). Commands use `${CLAUDE_PLUGIN_ROOT}` (also `${CLAUDE_PLUGIN_DATA}`). On / off per plugin is `enabledPlugins: { "<id>": boolean }` in the settings files (local over project over user).
- **No per-hook off switch.** The entry schema has no `disabled` / `enabled` field; only `disableAllHooks: true` (all hooks) and `allowManagedHooksOnly` exist. So Orrery turns a settings hook off by moving the entry out of the file into `<CCM_DATA_DIR>/hooks-disabled.json` (`{ version: 1, entries: [ { key, file, event, matcher, hook, at } ] }`, key = sha256 of file + event + matcher + canonical entry JSON), and back on by appending it to the first group with the same matcher (or a new group). Every write: native confirm with the masked diff, re-read (text + mtime) = `changed`, `<file>.ccm-backup`, tmp + rename, all other keys and their order kept, file indent / EOL kept. Plugin hooks are read-only (turn the plugin off in Extensions); Orrery's own bridge hooks (command contains `hook-bridge`) are badged and never toggled or test-run.
- **Test run.** Only on click, native confirm the first time per hook per app run. The command (re-read by id in the main process; the page never sends one) runs like Claude Code would (exec form / bash / PowerShell), cwd = project or home, stdin = a made-up payload for the event, env = `PATH`, `PATHEXT`, `HOME`, `USERPROFILE`, `SystemRoot`, `SystemDrive`, `windir`, `ComSpec`, `TEMP` / `TMP` / `TMPDIR`, `APPDATA`, `LOCALAPPDATA`, `LANG`, `CLAUDE_CONFIG_DIR` + `CLAUDE_PROJECT_DIR` (+ `CLAUDE_PLUGIN_ROOT`), killed after 10 s; exit code, duration and the last 4 KB of stdout / stderr (home and token-like text masked) go to the page. `prompt` / `agent` / `http` / `mcp_tool` entries are never run (LLM / network).

## 11ae. CLAUDE.md / memory doctor: memory folder, frontmatter and limits (v75, desktop only, verified 2026-10-29 on Claude Code 2.1.294, Windows 11, shapes and binary constants only)

- **Folder.** Auto memory of a project lives in `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<slug>/memory/`, slug = the session cwd with every non `[A-Za-z0-9]` character replaced by `-` (`F:\work\web\Claude-Code-Monitor` → `F--work-web-Claude-Code-Monitor`); same `projectDir` lookup as §11y (drive-letter case may differ on Windows). Files: `MEMORY.md` (index) plus one `<name>.md` per memory, sometimes one level of subfolders.
- **Index.** `MEMORY.md` lines are `- [Title](file.md) — one-line hook`; links are relative to the memory folder. The binary (`wu="MEMORY.md",QL=200,vne=25000`) cuts the index after **200 lines** or **25 000 characters** of trimmed text and appends `> WARNING: MEMORY.md is … Only part of it was loaded`. Memory files not in the index are only found by Claude when it lists the folder.
- **Memory frontmatter.** Two shapes on this machine (143 files surveyed): older `name` / `description` / `type` at the top level, newer `name` / `description` top level with `metadata: { node_type: memory, type: user|feedback|project|reference, originSessionId, modified }`. The doctor accepts `type` in either place. Bodies link other memories as `[[name]]` (name = frontmatter `name` or file stem).
- **Size warning.** `/doctor`-style context warnings in the binary: `Large <file> will impact performance (<n> chars > <limit>)` with limit `max(40000, round(contextWindow × 0.05 × …))` (`D8n=40000`, `O8n=0.05`), and `Instruction files will impact performance: … chars in total > max(120000, limit)`. The doctor uses the 40 000-character floor per CLAUDE.md / rules / import / memory file.
- **Doctor (Orrery).** Read-only, on click, from the background context dialog: same file set as §11y (`contextSources`), text read in main (≤ 256 KB), only path + line + kind + the offending token go to the page. Checks: `[[link]]` with no memory, index link to a missing file, memory not in the index, frontmatter missing `name` / `description` / `type`, duplicate `name`, `@import` target missing, relative path tokens (prose / inline code, not fences) whose first segment exists in the project or a folder ≤ 2 levels down but the full path does not, files over the limits above. Findings in the project or the Claude config folder open at the line; others show the path only. "Fill into agent" only prefills a cleanup prompt. Not checked: two memories that contradict each other (needs reading meaning, not structure).

## 11af. Search past sessions by prompt — the one sanctioned read of session contents (v75, verified 2026-10-29 on Claude Code 2.1.294 transcripts, Windows 11)

**Deviation, owner-approved 2026-10-29 (SPEC-v75 idea 7):** History → "Find a past session" reads the owner's own old prompts. Bounds: only on a click / Enter, only user-prompt records (rules below), each shown snippet ≤ 200 chars after secret masking (shared `secretMask.ts` `maskSecrets`, the one rule set since v76: tokens, opaque runs, `password|secret|token|api_key = value`, home → ~), results live in the page only while History is open (closing it cancels and clears), nothing is indexed, cached or logged. Cancelled by a new search, the Cancel button / Esc, leaving History or a closed socket; ≤ 200 sessions per search.

Record survey (150 newest top-level transcripts, 5 279 `type: "user"` records, all `version` 2.1.294; keys / flags / first tag only):

| User record kind | Shape | Prompt? |
|---|---|---|
| Typed prompt | `content` string, `promptSource: "typed"`, `origin {kind:"human"}` (also `queued`, `suggestion_accepted`); older records: no `promptSource` / `origin` | yes |
| SDK prompt | `promptSource: "sdk"`, `content` array of `text` (+ `image`) blocks | yes (text blocks only) |
| Tool result | `content` array with `tool_result`, `toolUseResult`, `sourceToolAssistantUUID` (4 394 of 5 279) | no |
| Meta | `isMeta: true` (skill bodies, image paths, `<local-command-caveat>`, `sourceToolUseID` attachments) | no |
| System-injected | `promptSource: "system"`: `origin.kind` `task-notification` (`<task-notification>`), `peer` (§11z), `auto-continuation`; main → subagent `origin.kind: "coordinator"` (§11y) | no |
| Slash command / local output | content starting `<command-name>` / `<command-message>` / `<command-args>`, `<local-command-stdout>`; `!` shell: `<bash-input>`, `<bash-stdout>` / `<bash-stderr>` | no |
| Compaction summary | `isCompactSummary: true`, `isVisibleInTranscriptOnly: true`, text "This session is being continued…" | no |
| Sub-agent | `isSidechain: true`; such files live in `<session>/subagents/` and are never opened (only `projects/<slug>/<uuid>.jsonl`) | no |

- Titles: `custom-title {customTitle}` (`/rename`) wins over `ai-title {aiTitle}`; session start = first user record `timestamp`, branch = last non-`HEAD` `gitBranch`, folder = first user record `cwd`.
- Scan (`apps/collector/src/prompt-search.ts`): files newest first by mtime, date range by mtime (7 / 30 / 90 days / all), project filter by slug prefix then `cwd` under the project; lines are streamed, only lines holding `"type":"user"` without `"tool_result"` / `"isMeta":true` (or a title record) are parsed; lines over 2 MB (pasted images) are skipped whole; `setImmediate` between files; progress at most every 250 ms. A 30-day search over this machine's transcripts took ~17 s.
- Resume uses the Workspace path (`workspace.resumeSession('claude', cwd, id)` → `claude --resume <uuid>`, prompt never sent); Open folder only opens a `cwd` the collector itself found for that client's search (`promptSearch.open {searchId, sessionId}`).

## 11ag. Process metrics and forgotten sessions / servers / daemons (v76, verified 2026-11-01 on Claude Code 2.1.294, Windows 11)

Owner-approved polling exception (SPEC-v76): one process pass every 30 s, only while a window is connected or the `idle` alert is on (`apps/collector/src/resources/sampler.ts`), ~25 ms per pass on this machine with 5 sessions. No prompt, API call or file read; only the OS process table.

- **Process tree under Claude Code (observed, names / argv shape only):** Bash tool = Git Bash `bash.exe -c "source ~/.claude/shell-snapshots/…"` directly under `claude.exe` (nested `bash.exe` below it); PowerShell tool = `cmd.exe /d /s /c ""chcp.com" 65001 … & powershell …"`; stdio MCP servers = `cmd.exe /d /s /c "npx <server>"` → `node.exe`, or `uvx.exe` / `bun.exe` / `node.exe` / app exes directly, each with `conhost.exe`. So a direct `cmd.exe` child counts as a tool shell only when it hosts a shell; everything else directly under `claude.exe` is treated as MCP and only adds to the session's RAM (owner: no separate MCP tracking).
- **Measurement:** Windows koffi `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `K32GetProcessMemoryInfo` (`WorkingSetSize`, `PrivateUsage`) + `GetProcessTimes` (kernel + user), only for pids in a report; command lines (`NtQueryInformationProcess` 60) only for java / dart / emulator / qemu and the shown process, cached per pid + creation time. `CCM_NATIVE_PROCS=0` / no koffi → one `Get-CimInstance Win32_Process` per pass (`WorkingSetSize`, `KernelModeTime + UserModeTime`, `CommandLine`). macOS / Linux: one `ps -A -o pid=,ppid=,rss=,time=,lstart=,command=` (Linux `time` has 1 s resolution, so CPU % below ~3 % / cores is coarse). RAM = working set / RSS; CPU % = Δ CPU time / Δ wall / cores (100 % = whole machine). A process that cannot be opened has null RAM / CPU and is never called idle.
- **Pid reuse:** every process is keyed by pid + creation time; a `ppid` whose process was created after the child is a reused pid, not the parent (Windows keeps dead parents' pids).
- **Idle rules** (threshold `idleMinutes`, Settings, 15 / 30 / 60 default / 120 / 240 / off): session = live, status idle / waiting, no subagent `working`, no background job `working` for its `claudeSessionId`, `lastActivityAt` older than the threshold. Shell / dev server / Gradle / Kotlin / Dart daemon = CPU < 1 % at every sample and no established connection to its LISTEN ports (port table: R2) for the threshold, counted only from when Orrery first saw it. Emulator (`emulator` / `qemu-system-*` with `-avd <name>`, serial from `-port <n>`) = no Orrery adb use of that AVD / serial (desktop `device.used` message) and no session shell call matching `adb` / `flutter run` / `install…Debug` (transcript `tool_use` input checked once, only a timestamp kept, never the command) for the threshold; CPU is ignored because an idle emulator still burns CPU.
- **Orphans:** a process seen as a descendant of a live session is remembered (pid + creation time → session) while it lives; once that session's process is gone it is listed as an orphan, always "forgotten". Processes orphaned before Orrery started (or while it was closed) are not recognised; nothing is guessed from names.
- **Daemons** (`org.gradle.launcher.daemon.bootstrap.GradleDaemon <version>`, `KotlinCompileDaemon` + `kotlin-*-<version>.jar`, Dart `language-server` / `analysis_server`, `flutter_tools.snapshot daemon`) are listed machine-wide, with the JDK folder holding `bin/java` and the session they were first seen under. None were running during this survey; the shapes come from the Gradle / Kotlin / Dart launch commands, covered by unit tests.
- Command lines go out through `maskSecrets` (home → `~`), cut to 200 chars. Event `resources` (`ResourceReport`), sent only when something besides `at` changed, and in the snapshot once sampled.

## 11ah. Port table, port conflicts and stopping processes (v76 R2, verified 2026-11-01 on Claude Code 2.1.294, Windows 11)

Same 30 s pass as §11ag (`apps/collector/src/resources/ports.ts`); no socket is ever opened or probed, nothing off this machine is scanned.

- **Windows:** koffi `iphlpapi.GetExtendedTcpTable(…, AF_INET / AF_INET6, TCP_TABLE_OWNER_PID_ALL)`, size query then read (retried on `ERROR_INSUFFICIENT_BUFFER`). Layouts: `MIB_TCPROW_OWNER_PID` = 6 DWORDs (24 bytes: state, local addr, local port, remote addr, remote port, pid); `MIB_TCP6ROW_OWNER_PID` = 56 bytes (local addr[16], scope, port, remote addr[16], scope, port, state, pid). Addresses and ports are in network byte order (port = first two bytes big-endian). `bOrder` is a 4-byte `BOOL`. Measured: 26 ms for the first read of both tables including the koffi load, 31 pids / 40 listening ports on this machine. `CCM_NATIVE_PROCS=0` turns the port table off (no PowerShell fallback: `Get-NetTCPConnection` takes seconds).
- **macOS / Linux:** `lsof -nP -iTCP -sTCP:LISTEN,ESTABLISHED -F pnT` (`p<pid>`, `n<local>[-><remote>]`, `TST=<state>`); `*` = all addresses, brackets / `%zone` dropped. lsof exits 1 when nothing matches; its stdout is still used.
- **Per process:** LISTEN sockets grouped by pid and port (addresses joined); `established` = ESTABLISHED rows whose local port is that port (accepted connections). Pids 0 / 4 (System) are skipped. Ports of shells / dev servers / daemons go to `ServerRes.ports` (a LISTEN port makes a shell a `dev-server`; any established connection keeps it busy); LISTEN ports of processes outside every agent tree go to `ResourceReport.outside` (max 100, open / copy only, never stopped).
- **Port conflicts:** a `tool_result` with `is_error: true` (Claude Code 2.1.294 writes a failed Bash call as `content: "Exit code N\n<output>"`, string) whose text matches `EADDRINUSE …:<port>`, `address already in use …<port>` or `port <port> is already in use` keeps only the port number and timestamp (`TranscriptState.portConflict`); the text is never stored. Non-error results (a Read of source containing "EADDRINUSE") are ignored. `ResourceReport.conflicts` lists the newest one per session for 15 minutes with the process now listening on that port (`holder`) when the table knows it.
- **Stopping (desktop):** the collector posts every report to the app over the utilityProcess port; `ccm:res-kill` accepts at most 50 `{ pid, start }` pairs (`parseKillTargets`), each must be in the newest report with the same creation time and is re-read live (`liveStarts`: native table / CIM / `ps -o lstart`) before and after one native confirm that lists name, RAM, masked command line and, for a session, the `claude --resume` hint. Daemons with CPU in the last 2 minutes (`lastBusyAt`) are refused. Windows `taskkill /T /F /PID`, POSIX TERM to the tree then KILL after 5 s; emulators with a known AVD go through `adb emu kill` first. Sessions in Workspace panes are closed from the page through the pane close path (busy sheet + undo close), never killed by pid. `CCM_RES_FIXTURE` (E2E) replaces the process and port tables with a JSON file and makes the app record pids to `<fixture>.killed` instead of stopping anything.

## 11ai. Images in transcripts, capture folder and keeping the machine awake (v76 R3 / R4, verified 2026-11-01 on Claude Code 2.1.294, Windows 11)

Images (structure only, no content printed: a script read keys, `source.type`, `media_type` and the length of `data` in the 400 newest transcripts under `projects/`):

- **Pasted images are stored inline.** A user record (`type: "user"`) carries `message.content[]` items `{ type: "image", source: { type: "base64", media_type: "image/png" | "image/jpeg", data } }` — the full base64 bytes, in the `.jsonl` itself. 673 such items (395 PNG, 278 JPEG) in those 400 files; `api-request-blob` records repeat some of them (86).
- **An image file the agent reads is stored inline too:** the `Read` tool's `tool_result.content[]` holds the same `{ type: "image", source: { type: "base64", … } }` shape (2 224 items: JPEG, PNG, a few WebP). Together ≈ 898 M base64 characters in the 400 files — the bulk of `projects/` size.
- `~/.claude/paste-cache/` holds only text pastes (`<hash>.txt`); there is no image cache folder.
- Consequence for "attach as file": the prompt carries `@<path>` instead of `[Image #N]`, so the user record holds no image and the PNG stays on disk for the owner / later sessions. The transcript still grows when the agent Reads the file (once, as a tool result): the option avoids the pasted copy, not every copy. The Settings hint says so.

Capture folder (desktop only, `apps/desktop/src/capture/`): config in `<DATA_DIR>/capture.json` (`dir`, `asFile`, `keepDays` 1/3/7/14/30, `maxGb` 1/2/5/10/20; default none / on / 7 / 2) — kept by main, not in page `localStorage` (deviation from SPEC `ccm.captureDir`), because the startup sweep and the recorder run before the page loads. The folder only comes from the native picker (`ccm:capture-pick`); the page may only clear it. Missing root / folder → `problem: 'missing'`, one native notification per folder per run, recordings back in `<tmp>/orrery-rec`, screenshots back to clipboard paste; not writable → `not-writable`. Shots: `ccm:capture-shot { png (data:image/png;base64, PNG signature, ≤ 32 MB), device, frame? }` → `<dir>/shots/<device sanitized [A-Za-z0-9._-], ≤ 40>-<yyyyMMdd-HHmmss>[-n][-fN].png` (written `wx`, path checked inside `shots/`). Recordings: `<dir>/recordings/orrery-rec-<ms>.mp4`; a dropped token (4th recording, quit) keeps a file in the folder and deletes one in temp; Save defaults to `<dir>/recordings/`. Retention (start + every 6 h): only names matching `orrery-rec-<digits>.mp4` in `recordings/` and the shot pattern in `shots/`; older than `keepDays`, then oldest past `maxGb`; files behind a live token are skipped. Startup also deletes every `orrery-rec-*.mp4` in `<tmp>/orrery-rec` (no token survives a restart) and unfinished MP4s (`mp4Complete` false) in `recordings/`. E2E: `CCM_E2E_CAPTURE_DIR` replaces the folder dialog.

Keep awake (`apps/desktop/src/power/awake.ts`): the collector posts `{ type: 'busy', agents, jobs }` over the utilityProcess port whenever the counts change (`busyCounts`: sessions with status `working` + subagents `working`; background jobs `working`). Main holds one `powerSaveBlocker.start('prevent-app-suspension')` (system sleep only, never the display) while any is > 0 and for 2 minutes after the last stops (`decideAwake`, one timer re-armed per change, no polling); mode in `<DATA_DIR>/keep-awake.json` (`off` / `running` / `plugged` default; `plugged` = not on battery via `powerMonitor.isOnBatteryPower()` + `on-battery` / `on-ac`). A collector exit resets the counts to 0 (the grace still applies). Electron drops the blocker with the process on quit / crash. E2E: `CCM_E2E_POWER=battery|ac`, `CCM_E2E_AWAKE_GRACE_MS`.

## 11aj. Sensitive file / command watch and phone notifications (v76 R5 / R6, verified 2026-11-01 on 2.1.294)

**Source.** The same `assistant` → `message.content[].tool_use` blocks the tracker already reads (§11m). Input shapes counted on the 300 newest transcripts of this machine: `Edit` `{file_path, old_string, new_string, replace_all}`, `Write` `{file_path, content}`, `Bash` / `PowerShell` `{command, description?, timeout?, dangerouslyDisableSandbox?}`. `MultiEdit` (`file_path`) and `NotebookEdit` (`notebook_path`) did not occur in 2.1.294 transcripts; they are handled by name in case a model / setting still emits them.

**What is kept.** `sensitive/rules.ts` `touchOf` turns a call into a `ToolTouch` (file path, or the rule ids a shell command matches plus the paths a recursive delete targets) inside `extractSignals`; the tracker classifies it at once against the session cwd (repo root when known), the groups, own globs and the per-project ignore list, then drops it. Only `{rule, path (project-relative / ~/… / …/last/3/segments), file (absolute, for Open file), tool, project}` reaches the `sensitive` activity. Never `old_string` / `content` / the command text. Catch-up reads (app start) produce no warnings; the same rule + path in one session warns once per 10 minutes.

**Outside the project.** Not outside: `<claudeRoot>/plans`, `<claudeRoot>/todos`, `<claudeRoot>/projects/<cwd slug>` (the session's own memory) and `<tmp>/claude` (scratchpads). Git-bash paths `/c/…` are read as `C:\…`. A delete target with an unknown variable (`$OUT`) is not judged; `~`, `$HOME`, `%USERPROFILE%`, `$env:USERPROFILE` are.

**Warning only.** Nothing is blocked; blocking is Claude Code's permission system. Since R5b a hit can be turned into a Claude Code deny rule on request (§11ak).

**Phone (R6), the owner-enabled "sends outside" exception.** Off by default. The collector `Toaster` reports episodes over the utilityProcess port (`{type: 'phone', episode, reason, name, tool?, since?}`): waiting / question / permission (also at the 5-minute reminders), a turn that worked ≥ 5 minutes, a blocked background job, the 5-hour limit forecast. Toast kind toggles (except `done`), quiet hours and snooze apply; window focus and the global toast switch do not. Desktop main sends only when enabled, configured and `powerMonitor.getSystemIdleTime()` ≥ the chosen minutes; once per episode, at most 20 per hour, `net.fetch` with a 10 s timeout, first failure of a run → one in-app notice. Payload: app name, the session alias or folder name (never the auto title, which Claude Code summarises from the chat), reason, tool name, minutes; through `maskSecrets`. ntfy server, topic and Discord webhook URL are sealed with `safeStorage` in `<DATA_DIR>/phone.json` and never returned to the page (only `configured` + host). E2E: `CCM_PHONE_URL_OVERRIDE` (loopback http only) and `CCM_E2E_IDLE_S`.

## 11ak. "Block next time": deny rules from a sensitive hit (v76 R5b, verified 2026-11-01 in the installed Claude Code 2.1.294 binary, rule text and settings keys only)

**Syntax, as the bundle of `@anthropic-ai/claude-code` 2.1.294 (`bin/claude.exe`, npm global) states it.** Settings keys `permissions.allow` / `permissions.deny` / `permissions.ask` (arrays of `"Tool(specifier)"`); settings load user → project → local, later overriding earlier. Its own settings reference: "Prefix wildcard: `Bash(git *)` — matches `git`, `git status`…", example `"deny": ["Bash(rm -rf *)"]`; the legacy `:*` suffix is still parsed ("Prefix cannot be empty before :*"); a `*` before the rest of a command matches any options inserted there (a warning for allow rules, wanted for deny). File rules: "path rules in `permissions` use `Edit(path)` for every file-writing tool (Write, Edit, NotebookEdit) and `Read(path)` for reads. `Write(path)`, `NotebookEdit(path)` … are not matched by file permission checks"; patterns seen in the bundle: `Read(**/.env)`, `Edit(**/.claude/**)`, `Read(~/.ssh/**)`, `Edit(//**/.github/**)` (`//` = absolute). On Windows the `PowerShell` tool has its own rules of the same form (`PowerShell(git checkout -b *)`). Matching was not exercised (that would need a live agent); the rules follow the bundle text.

**Mapping** (`packages/shared` `denyRulesFor(rule, tool)`; the page sends only the rule id + tool, desktop derives the rules again):

| Sensitive rule | Deny rules |
|---|---|
| secret glob `G` / own glob `G` without `/` (chars `[\w.*?@+~-]`, not only wildcards), hit by a file tool | `Edit(**/G)` |
| `git-force-push` (Bash / PowerShell) | `T(git push --force *)`, `T(git push -f *)`, `T(git push * --force *)`, `T(git push * -f *)` |
| `git-reset-hard` | `T(git reset --hard *)`, `T(git reset * --hard *)` |
| `git-clean` | `T(git clean *)` (git refuses to clean without `-f` by default, so blocking it whole loses little) |
| `rm-rf` (Bash only) | `Bash(rm -rf *)`, `Bash(rm -fr *)`, `Bash(rm -Rf *)` — every recursive force delete, not only outside the project |
| `adb-uninstall` | `T(adb uninstall *)`, `T(adb * uninstall *)` |
| `outside-project`, `drop-table`, `del-s`, `remove-item-recurse`, own globs with `/` | none (no faithful rule: location, SQL inside a string, cmd / PowerShell flag orders); no button |

**Write path.** IPC `ccm:sensitive-deny` `{project, rule, tool, scope}`: the project must be a pane root / grant / known repo (`checkDir` of the preview IPC) or a `cwd` from `<config>/sessions/*.json` (or the git root above one); scope `project` → `<project>/.claude/settings.json`, `local` → `settings.local.json`, `user` → `$CLAUDE_CONFIG_DIR/settings.json` (else `~/.claude`). Invalid JSON or a non-array `allow` / `deny` → refused, nothing written. Rules already in `deny` are skipped (none new → no confirm). Native confirm shows the file and the line diff; the file is re-read after it (changed → refused), the old file copied to `<file>.orrery-bak`, the new text written to a temp file and renamed. Other keys, their order, indent and line endings are kept. E2E answers the confirm by patching `dialog.showMessageBox` over the main inspector.

## 11al. Agent data: what is in `~/.claude`, cleaning, image strip and moving it to another drive (v76 R7, desktop only, verified 2026-11-01 on Claude Code 2.1.294, Windows 11; sizes / names / record keys only)

Survey (read-only script over the real folder: names, sizes, mtimes, link flags; no file content printed). This machine: `~/.claude` 10.98 GB, 33 k files. The binary's own list of config-dir entries (`$bn` set in `bin/claude.exe`) was used to name entries that did not exist here. Group table = `packages/shared/src/agentData.ts` `DATA_GROUPS`; any name not in it is **unknown** and never cleaned.

| Group (id) | Entries | Kind | Size here | Read by | Orrery may |
|---|---|---|---|---|---|
| transcripts | `projects/` (`<slug>/<id>.jsonl` 4.67 GB, `<slug>/<id>/subagents/*.jsonl` 5.43 GB, `tool-results/` 84 MB, `memory/`) | history | 10.18 GB | `--resume`, `/resume`, Orrery History, stats, memory | strip images (opt-in), move |
| liveSessions | `sessions/<pid>.json` | history | 0.5 MB | Claude Code peers, Orrery (pid, cwd, status) | move |
| promptHistory | `history.jsonl`, `paste-cache/` (text pastes referenced from history) | history | 1.8 MB | up-arrow / Ctrl+R | move |
| checkpoints | `file-history/<session>/<hash>@vN` | history | 68 MB | `/rewind`, Orrery Changes | move |
| notes | `plans`, `todos`, `tasks`, `teams`, `agent-memory*`, `memory`, `usage-data` | history | small | sessions / memory | move |
| debugLogs | `debug`, `logs`, `telemetry`, `statsig`, `traces`, `startup-perf`, `api-dumps`, `dump-prompts` | cache | 0 here | nothing after the session | clean |
| shellSnapshots | `shell-snapshots/snapshot-*.sh`, `session-env/<session>/` | cache, used live | 2.9 MB | every Bash tool call of a **running** session sources its snapshot | clean only while no `claude` runs |
| appCache | `cache/` (changelog, model catalog), `image-cache`, `mcp-discovery-cache`, `mcp-*-cache.json`, `stats-cache.json` | cache | 1 MB | refetched | clean |
| plugins | `plugins/` (`cache/` = installed plugin versions 552 MB, `marketplaces/` git clones 141 MB) | program | 693 MB | plugin loader | move only (deleting `cache/` uninstalls plugins; Claude Code itself drops `.orphaned_at` versions) |
| extensions | `skills`, `agents`, `commands`, `hooks`, `output-styles`, `workflows`, `rules`, … | config | 28 MB | owner-written | move only |
| settings | `settings*.json*`, `CLAUDE.md`, `keybindings.json`, `policy-limits*`, `remote-settings*`, `backups/` (`.claude.json` rotations), `daemon*`, `state`, `jobs`, `ide`, `chrome`, … | config | small | Claude Code | move only |
| credentials | `.credentials.json`, `channels/` (Discord bot token) | config / secret | small | sign-in | move only, never read |
| unknown | e.g. `.caveman-active.*`, `metrics/`, `dist/`, `homunculus/`, `GLOSSARY.md` (third-party plugins, owner files) | unknown | small | ? | move only |

- **Retention.** `cleanupPeriodDays` ("Number of days to retain chat transcripts before automatic cleanup (default: 30)", binary text) is unset here, and indeed no file under `projects/` is older than 30 days: the 10 GB are one month of work, 5.4 GB of it subagent transcripts. Raising `cleanupPeriodDays` keeps more; the image strip below only touches transcripts older than 30 / 60 / 90 days, so with the default it finds nothing — the honest answer for this machine. `~/.claude.json` (+ its `.backup` / `.tmp` siblings) lives in the home folder, outside `~/.claude`, and is not moved.
- **Links already present.** `skills/app-store-screenshots` is a junction into `~/.agents/skills`. Copy, verify and delete keep junctions / symlinks as links and never walk into them (`fsTree.ts`: `lstat` reports a junction as a symbolic link).

**Image strip** (`apps/desktop/src/agentData/strip.ts`, opt-in, default off). Base64 sits in four places in 2.1.294 records (400 newest files): `message.content[].content[].source.data` (Read tool result, 1161 items, 278 M chars), `toolUseResult.file.base64` (Claude Code's own copy of the same Read image, `{type: 'image', file: {base64, type, originalSize, dimensions}}`, 274 M chars), `message.content[].source.data` (pasted, 45), `attachment.prompt[].source.data` (`queued_command`, 3). Every `{type: 'image', source: {type: 'base64', data}}` becomes `{type: 'text', text: '[Image removed by Orrery …]'}` (valid content for both user messages and tool results); `toolUseResult.file.base64` becomes `""`, keys kept. Lines without `"base64"` are copied byte for byte. Only `projects/**/*.jsonl` whose last write is older than the chosen age (30 / 60 / 90 days) and whose session id is not in a live `sessions/<pid>.json`. Per file: temp `<file>.orrery-strip-tmp` → every line re-parsed and `extractSignals` (the collector's transcript reader) must give the same signals → original copied to `<chosen folder>/orrery-transcripts-<date>-<ms>/<slug>/…` → size / mtime unchanged since start → rename → mtime restored (Claude Code's retention and Orrery ages see the same session). Resume of a stripped session works; the model sees the placeholder text instead of the image.

**Clean** (cache groups only): files of the chosen groups older than 0 / 7 / 30 / 90 days, never one changed in the last 24 h (checked again just before each delete); `idleOnly` groups refuse while a `claude` process runs. One native confirm with count, size and group names.

**Move to another drive.** Refused while any process named `claude` / `claude.exe` (CLI, Workspace panes and the Claude desktop app, which also uses `~/.claude`) runs — the page lists them. Target = `<picked folder>/.claude` (same base name, so path rules such as `Edit(**/.claude/**)` still match after Claude Code resolves the link); must not exist, not be inside the source (or contain it), be on a local drive (Windows `Win32_LogicalDisk.DriveType` 2 / 3; no UNC; macOS / Linux: not an smbfs / nfs / afpfs / webdav / cifs mount) and have size × 1.02 + 256 MB free (`fs.statfs`). Steps, each written to `<DATA_DIR>/agent-data-move.json` first: copy (byte progress, Cancel deletes the partial copy, mtimes kept, links re-created as links, sockets skipped) → verify (same relative paths, types and sizes; SHA-256 of 48 spread files + the largest; > 256 MB files hash first + last 8 MB) → agent processes checked again → collector stopped (its `fs.watch` handles would block the rename on Windows) → `rename(source, <source>.orrery-moved-<ms>)` → junction (`fs.symlink(target, source, 'junction')`, no admin needed; macOS / Linux `symlink`) → top-level listing through the link compared with the original → collector started again (re-reads sessions through the link). Undo: removes the link, renames the original back and offers to copy back files written at the new place after the move (newer mtime or new path); after **Delete original** it copies everything back instead (verified). An app crash between rename and link is rolled back at the next start before the collector runs (`recoverMoves`); a crash during the copy leaves an "interrupted" record whose partial copy can be deleted from the page. No environment variable is set. `%APPDATA%/Claude` (Claude desktop app, 11 GB here) is listed read-only.

## 11am. DeepSeek CLI (Codewhale) panes and `hand_back` (v81, desktop only, verified 2026-11-03 on Codewhale 0.10.2, Windows 11)

Details of the CLI: `docs/deepseek-integration.md`. Plan `.planning/PLAN-v81-deepseek.md`.

- Preset `deepseek` runs `codewhale --skip-onboarding` (`-r <uuid>` to resume) inside the user's shell like `codex`. Orrery never passes a positional prompt (Codewhale would submit it); `open_session` prompts are prefilled as for Claude.
- MCP: the pane gets `DEEPSEEK_MCP_CONFIG` pointing at a file Orrery writes per PTY host port (`orrery` http entry with `bearer_token_env_var: ORRERY_TOKEN` plus the user's own `~/.codewhale/mcp.json` servers, because the env var replaces that file).
- **Owner decision (2026-11-03): second exception to "prompts are only prefilled".** MCP tool `hand_back {report, summary}`, callable only from a `deepseek` pane opened by another Claude / Codex pane (`openedBy`): the host checks `report` is an existing `.md` inside the caller's folder (≤ 1 MB) and limits it to one call per 2 minutes per pane; the page then **submits** the fixed `handBackPrompt` text into the origin pane through the same prefill + `\r` path as Compact (§11x), only once the origin's effective status is `idle`. Origin closed, a shell, or already holding a pending prefill → refused, nothing is typed.
- **Paused by the owner (2026-11-03)**: unless the app runs with `CCM_DEEPSEEK_FEATURE=1`, the whole DeepSeek feature is off: the PTY host refuses `deepseek` panes (spawn and layout restore → `preset`, no `orrery-mcp-deepseek.json`, no Codewhale PATH lookup), main registers no `ccm:deepseek-*` IPC (no `codewhale` process for status / install / login / sync / update) and preload exposes no DeepSeek bridge (`ccm:deepseek-enabled`, sync), so the page offers no DeepSeek launch, split, rail entry or Settings page and a remembered `deepseek` default falls back to `claude`; also `tools/list` has no `hand_back`, `open_session` offers only claude / codex / shell (a `deepseek` call → `preset`), the instructions drop DeepSeek, and DeepSeek panes get no `DEEPSEEK_MCP_CONFIG` (nothing runs Codewhale anyway). Only the Monitor (passive outbox read, `docs/deepseek-integration.md`) stays. `pty/mcpTools/index.ts` `mcpToolsFor`, `openSessionDef`, `pty/presets.ts` `presetEnabled`, `host.ts` `DEEPSEEK`, `main.ts` `DEEPSEEK_FEATURE`, web `lib/desktop.ts` `hasDeepSeek` / `presetEnabled`. E2E split / browser expect 4 menu items (no DeepSeek) by default.
- Settings → DeepSeek installs (winget / npm / install script after a native confirm showing the command), logs in by piping the API key to `codewhale auth set --provider deepseek --api-key-stdin` (the key is never stored by Orrery, logged or sent back to the page) and syncs rules / skills / MCP servers from Claude into `~/.codewhale` (managed block in `AGENTS.md`, `project_instruction_imports`, missing `mcp.json` servers by name, `orrery-*` skills); every overwrite keeps a `.orrery-backup`.

## 11an. Telegram reports into project topics (v82, desktop only, 2026-11-04; Bot API, plan `.planning/PLAN-v82-telegram.md`)

- **Flow**: collector `Toaster.onTelegram` posts `{type: 'telegram'}` episodes over the utilityProcess port (done with `worked` ms and the last assistant reply, waiting / question / permission) for every session, not filtered by toast kinds or quiet hours; desktop `telegram/notifier.ts` `TelegramNotifier.handle` decides: app switch on, project of `cwd` has a route (longest project prefix), `worked ≥ doneMinutes`, waits only with `waiting` on, once per episode, ≤ 20 / min per chat and 120 / h. A session first seen already working has no known start and is not reported.
- **Last reply**: `transcript.ts` signal `reply_text` (text blocks of main-transcript assistant records, same message id appended), kept as `TranscriptState.lastReply` on `end_turn`, ≤ 3000 chars, in collector memory only (never on the WebSocket). It leaves the machine only when the owner turned on `includeReply`, through `maskSecrets`, as a Telegram expandable quote.
- **Agent reports**: MCP `telegram_send {text ≤ 3000, file?}` and `telegram_notify {on|off|status}` are desk calls (`mcpDesk.ts`). `telegram_send` only while reports are on; the file goes through `resolveInside` (pane root), secret names (`SECRET_FILE_GLOBS`) are refused, > 50 MB is sent as a path line. A report during a turn suppresses that turn's done message.
- **Slash command**: Settings installs `~/.claude/commands/bot-tele-send-notify.md` (or under `CLAUDE_CONFIG_DIR`) after a native confirm; it only calls `mcp__orrery__telegram_notify`. It works in sessions opened in Orrery (the `orrery` MCP server).
- **Secrets**: the bot token is sealed with `safeStorage` in `<DATA_DIR>/telegram.json` and never returned to the page or logged (it is part of the Bot API URL path). Chat ids, topic ids and names are not secret and are shown.
- **Listing topics**: the Bot API has no method for it (`getForumTopics` is MTProto only, needs a user login → not used). "Scan" calls `getUpdates` (no offset, so nothing is consumed) for `my_chat_member` / messages: chat title + `is_forum`, topic names from `forum_topic_created` on `reply_to_message`. Updates are kept by Telegram for 24 h, so a topic without a recent message is missing until someone writes in it. Seen chats / topics are remembered in `telegram.json` `known`. `getChatMember(chat, bot)` gives admin + `can_manage_topics`; with it, `createForumTopic` makes a topic named after the project and routes it. Private invite links (`t.me/+…`) cannot be resolved by a bot.
- **Commands from Telegram (stage 2, owner-approved third exception to "prompts are only prefilled", 2026-11-04)**: off by default and after every restart (`receiving` is memory only); on through `/bot-tele-receive on` (MCP `telegram_receive`, command file installed from Settings after a native confirm) or the Settings switch, and only once one Telegram account is paired (Settings shows a 6-digit code for 5 min, the owner sends `@bot pair <code>`; `owner` id kept in `telegram.json`). While on (or pairing) main long-polls `getUpdates` (50 s, ≥ 1 s between calls, backlog skipped with `offset: -1` first, 409 → `conflict`, e.g. another consumer such as the Claude Code Telegram channel plugin on the same bot). Only messages from the owner's id that mention `@bot` or reply to a bot message, in a chat + thread that has a route, are used; everyone else is ignored silently (counted in `ignored`). ≤ 10 commands / min per chat. Text goes through `inboundPrompt` (no ESC / control / bidi characters, ≤ 2000) and is asked of the page (`ccm:telegram-inbound`): `workspace.telegramInbound` picks the running Claude / Codex Workspace pane of the route project (the session of the replied-to report if any; several panes without a reply → the bot lists them), sets `prefill` + `prefillSubmit` like `hand_back` (sent once the agent is idle), never over a pending prefill or Compact flow. Sessions outside Orrery cannot be written to. Every delivered command is filed in the session's Inbox and shown as a toast; the bot answers in the topic (sent / queued / list / error). `@bot status` lists the project's panes.

### 11an-b. Telegram actions (v83, `.planning/PLAN-v83-telegram-actions.md`, 2026-11-04)

- Inline buttons only while receiving is on; `callback_query` is acted on only from the paired owner (others: `answerCallbackQuery` "only the paired account", counted in `ignored`). `callback_data` = `<kind>:<12-char key>`, the key maps in main memory (500 newest) to terminal, project, cwd and topic; unknown / used keys answer "no longer valid".
- **Approve / deny** under permission messages of Claude sessions: the page checks the session is still `waiting` with `waitReason` permission and the pane is Claude, then `typeKeys` writes `1` (approve) or Esc (deny) straight into the PTY (`TermPane.vue` watch). The keys follow Claude Code 2.1.x's permission dialog (number selects an option, Esc rejects); **not verified on a live dialog yet — owner tries once**. The buttons are removed after use (`editMessageReplyMarkup`).
- **Continue / run tests** under finished messages go through the v82 `send` path (prefill + submit when idle). **Show diff**: `telegram/host.ts` `projectDiff` (`git diff HEAD` at the session cwd's repo, files named like secrets skipped, `maskSecrets`), sent as `changes.diff`.
- **`@bot stop`** answers with a confirm button; pressing it writes Esc only while the session is `working`.
- **`@bot screen [serial]`**: first ready online device of the Devices tab (`deviceManager.screencap`) → `sendPhoto`.
- **Files from Telegram** (photo / voice / audio / video / document replying to the bot or with `@bot` in the caption): `getFile` + download (Bot API limit 20 MB) → `saveInbound` `<project>/.orrery/telegram/<stamp>-<name>` (name sanitised, secret names refused, `/.orrery/` appended to the repo's `info/exclude`) → prompt "the user sent … saved at <path>" + caption. No speech-to-text.
- **Alerts** (`alerts`, default on): `phone` episodes `limit` / `disk` (already filtered by the collector's toast kinds / quiet hours) → General of every routed group; `RunManager` session `failed` → project topic, once per run session.
- **Day summary** (`summary.enabled/at`): counters per route project from every telegram episode (done, minutes, waits, permissions) and failed runs; main `tick()` each minute sends one message per group after `at`, once a day.
- **Telegram quiet hours** (`quiet`, may cross midnight): done / waiting / permission episodes and the summary are skipped; alerts, run failures and answers to the owner still go out.

### 11an-c. More Telegram commands (v84, `.planning/PLAN-v84-telegram-more.md`, 2026-11-04)

- Same gate as v82 / v83 (receiving on, paired owner only). Page actions over `ccm:telegram-inbound`: `new` (`workspace.open('claude', project)`, prompt as `prefill` + `prefillSubmit`), `all` (every running agent pane of the project without a pending prefill), `resumeList` (ended Claude sessions of the project from the terminals store with `endedAt` + `claudeSessionId`, not open in a pane, 8 newest) and `resume` (`workspace.open('claude', cwd, id)` → `claude --resume`).
- **`@bot run [config]`**: `RunManager.configs(project)` without configs that `needsTrust` (shared / imported: their confirm dialog exists only on the machine); one match runs, several → buttons. Device = pinned one or the first ready device. When that run session turns `running`, a device screenshot follows after 8 s (once). Failures send `run.log` (last 200 lines main kept from `RunEvent` `log`, already masked by RunManager, masked again).
- **`@bot last`**: the latest `reply` main saw in a done episode of that terminal (memory, 200 terminals), even when `includeReply` is off; masked.
- **Pinned status** (`pinStatus`, default off): `tick` (60 s) asks the page `status` per route, `sendMessage` + `pinChatMessage` once (message id in `telegram.json` `pins`), then `editMessageText` only when the text changed; "message to edit not found" → posted and pinned again.
- **Health** (`state.health`): last send / receive / poll, sends and errors today, counted in `TelegramNotifier.call`.

### 11an-d. Review fixes (2026-11-04, `.planning/wp/tg/WP-1-report.md`, `WP-3a-report.md`)

- **Approve / deny bound to its prompt**: the action keeps the episode's `since` (+ `tool`); the page presses keys only while the session is still waiting on that same prompt (`keysReady`), else `state`. A permission episode without `since` gets no buttons. Two back-to-back prompts with an unchanged `statusSince` are not told apart (not seen on 2.1.289 yet).
- **Keys reported only once written**: `workspace.telegramTyped` waits for `TermPane` to write `typeKeys` (1.5 s, else dropped and `unavailable`); a second press meanwhile → `busy`.
- **`telegram_receive on` over MCP** asks a native confirm (owner decision, `.planning/DECISIONS.md`); `deskReplyMs` 600 s.
- **Replies**: collector signal `prompt` (a real user prompt) clears the reply of the previous turn, so an interrupted turn sends no stale reply.
- **Nested topics**: requests carry `nested` (routes inside the project); panes, `all` and resume lists of a sub-project with its own topic are left to that topic.
- **Pairing**: wrong codes are counted per Telegram user (5 → that user is blocked for this code); 50 wrong codes overall cancel the code.
- Captions cut before escaping (valid HTML ≤ 1024); `.orrery/` excluded unanchored; diff uses exclude pathspecs instead of one argument per file; pins stored as `{chatId, messageId}` and dropped when the route changes; the summary day is persisted (no second summary after a restart); a token change restarts polling; ignored-message broadcasts are throttled.
- Still open: untracked files in the diff, the owner's own sensitive globs, heavy commands blocking the poll loop, albums.

### 11an-e. QA follow-ups and large files (2026-11-05, `.planning/PLAN-v85-telegram-big-files.md`)

- **Help**: `@bot help`, `/start` and a bare `@bot all` answer the grouped command list (a bare `all` used to be typed into the pane as the prompt "all").
- **`new` with open sessions**: the bot asks first — `➕ New session`, plus one `📨 <pane> · <state>` button per open pane when a prompt was given (sends the prompt there). Pressing one clears the other buttons.
- **Prompts from Telegram** (`send`, `new`, `all`, files, `📨`) end with one line saying the message came from Telegram and to report with `telegram_send` (attaching the asked-for file), so "send the APK here" reaches the topic.
- **Large files (≤ 2000 MB)**: the Bot API caps bot uploads at 50 MB. Settings › Telegram › Large files takes an `api_id` + `api_hash` (my.telegram.org, sealed by safeStorage like the token) and uploads files over 50 MB from `telegram_send` over MTProto as the same bot (npm `telegram` = GramJS 2.26.22, pinned; `telegram/mtproto.ts`). The MCP call returns at once with `uploading`; the bot posts "⏫ uploading" and later the file or a failure line. The group is resolved with `getInputEntity` (bots may call `channels.getChannels` with access hash 0 to learn the real hash; sending with hash 0 fails as a chat error). The MTProto session is sealed in `telegram.json`, dropped on a token / key change, re-made once on an auth error; the client closes after 2 idle minutes; one upload at a time.
- **Topic listing is not possible for bots**: `channels.getForumTopics` answers `BOT_METHOD_INVALID` (tried 2026-11-05), so topics still come from messages seen by the bot or a pasted link.
- **Daily summary**: when Orrery starts after the summary time it skips that day and marks it done, so moving the time later the same day sends nothing until tomorrow (by design).
- **Replies follow the session**: a bot message sent for a session is remembered as chat:message → Claude session id (`telegram.json` `replies`, last 300), so replying to it reaches that session after an app restart or a resume into another terminal; if the session is not open the bot says so.
- **Albums**: Telegram sends each photo of an album as its own update and only the first carries the caption. Items with the same `media_group_id` are gathered for 1.5 s; when one is addressed to the bot, all files (max 10) are saved and sent as one prompt.
- **Poll never waits on heavy work**: buttons and messages with a file or `screen` run beside the poll (downloads / screenshots 2 at a time), plain messages keep their order. A 20 MB download no longer holds back ⏹.
- **Large file progress**: the "⏫ Uploading" message is edited with the percentage at most every 15 s, then becomes ✅ sent or ⚠️ failed (a failure also posts a new message so it notifies).
- **Connect from Telegram**: tagging the bot in a topic that is not connected answers with 🔗 one button per open session and 📁 one per project (the page sends name + cwd with `ccm:telegram-panes`).
- **Pinned status per session topic**: with pinned status on, a session topic gets its own pin listing only that session (pin key `s:<session>`); disconnecting unpins it.
- **Linked glyph**: rail rows and Workspace tabs whose Claude session is connected show a paper plane, tooltip "Telegram: Group › Topic"; the tab menu also has *Connect to Telegram…*.
- **Bundle**: GramJS is built as `stage/gramjs.cjs` (esbuild plugin `gramjs-apart`, `dynamic-import` off so it is a `require`), so `main.cjs` dropped from 2.9 MB to 1.4 MB.

### 11an-f. Claude's question as buttons (2026-11-05, `.planning/wp/tg2/WP-C.md`)

- **Exception to §9**: while an `AskUserQuestion` `tool_use` has no `tool_result` yet, the collector keeps in memory only the first question's `question` (≤ 200) and `options[].label` (≤ 6 labels, each ≤ 60) plus `multiSelect` (`transcript.ts` `askOf`, `TranscriptState.pendingAsk`). `description`, `preview`, `header` and further questions are never kept. It leaves the collector once, inside the Telegram episode of a `question` wait (`TelegramEpisodeMessage.ask`, `parseTelegramAsk` in shared), never in the snapshot or any WebSocket event, so the page never sees it. The desktop main masks it (`maskSecrets`) and sends it to the owner's paired Telegram topic only.
- **Buttons**: a single-select question with ≤ 6 options gets one button per option (kind `qa`, only while receiving). `multiSelect`, more than 6 options or no ask → the question and the numbered list, no buttons (the owner replies with text as usual). A press asks the page for `keys` `key: 'option'` + `option: n`; the page types `String(n)` only if the pane still waits (`waitReason` question) in the same episode (`since`). Then the buttons are removed and "Chose …" is posted; a second press says the button is no longer valid.
- **ExitPlanMode** permission: same Allow / Deny keys as other permissions (`1` / Esc), only the labels read "Approve plan" / "Reject plan". No "keep the plan and give feedback" key was added.
- **Not verified on the real TUI**: that a digit key selects option n of the AskUserQuestion dialog (assumed from the permission prompt, where `1` allows), and that it needs no Enter. QA by hand with a real Claude pane before relying on it.
- **Timing**: the ask is read when the wait starts. If the transcript line is not tailed yet at that moment the message goes without options (text reply still works).

### 11an-g. Backlog, conflicts, menu, tail, members, digest (2026-11-05, `.planning/PLAN-2026-11-05-telegram-7.md`)

- **Commands sent while Orrery was off**: the first poll reads the pending updates (Telegram keeps them 24 h, up to 5 pages of 100) instead of skipping to the newest. Owner commands of a known topic from the last 60 min are listed per topic (masked, 80 chars, ≤ 8) with `▶️ Run all` / `🗑 Skip` (kinds `bg` / `bx`); nothing runs by itself. `telegram.json` `lastUpdate` keeps the last handled update id, because Telegram confirms an update only on the next getUpdates and the last batch before quitting would come back; it is cleared with a new token.
- **Bot polled elsewhere (409)**: 3 conflicts in a row stop this app's poll and set state `pollConflict`; Settings › Telegram shows a banner with Retry (`receiving: true` again restarts the poll).
- **"/" menu**: `setMyCommands` (scope `all_group_chats`, en + the app locale) once per command list (`telegram.json` `commandsHash`, reset with a new token). A bare `/status` (what the menu sends in a group with one bot) counts as addressed when it is one of the menu commands; `/status@other_bot` does not.
- **`tail [n]`**: the last n (default 30, max 80) plain lines of the session's xterm buffer (`lib/paneSnapshots.ts`), masked in main, cut to the last 3500 chars, `<pre>`. Session picked like `last` (reply / session topic / one pane / buttons `tl`).
- **Members**: the owner adds people who recently mentioned the bot (memory only, last 20) as `read` (status / last / tail / help, buttons 💬 📜 📄) or `full` (everything but Allow / Deny, topic links, backlog and pairing). `telegram.json` `members` (≤ 20, sanitized); the role is read on every message and button press; a member's prompt carries the name saved in the app, not their Telegram name (DECISIONS 2026-11-05).
- **Digest** (off by default): a session's "done" reports of the day are one message edited with a counter (`digestHtml`); permission / question / waiting stay new messages; a failed edit sends a new message.

### 11an-h. Session links follow the session's life, topic map (2026-11-05, `.planning/PLAN-2026-11-05-telegram-topic-map.md`)

- **A session link ends with its session** (owner decision 2026-11-05): `setPanes` drops a session ↔ topic link when the agent that had a terminal loses it (Claude quit, process died, pane closed) and, by default, when the same pane switches to a new session id (`/clear`). The page sends only panes whose agent still runs (`useTelegramInbound` `agentLive`: a pane keeps `agentSessionId` after its agent quits, which used to keep the session "open", so `resume` hid it). A session that died while the app was off is freed once per run, 3 min after start (`sweepStale`, from `setPanes` / the 60 s tick), when its agent did not come back in a pane; until then its topic answers "not open, send resume".
- **Keep** (📌, `TelegramSessionRoute.keep`): the link stays after the session ends and follows `/clear` / resume in the same pane, as before.
- **Notice**: an unlink posts one silent line in the topic: ended → `↩️ <name>` (resume, kind `rs`) + `🔗` open sessions without a topic; `/clear` → `🔗 <name>` for the new session id. Buttons only while receiving is on. A topic just unlinked still knows its project in memory, so `resume` typed there lists the project's ended sessions.
- **`where`** (menu + help): what the topic is connected to (session + open state + keep, or project); owner gets `✂️ Disconnect` (kind `ul`, owner only).
- **Broken topic**: a send to a route answered with `chat` (thread / chat not found, 403, not enough rights) adds `chatId:threadId` to `telegram.json` `broken`; the next good send clears it. State routes / session routes carry `broken: true`.
- **Settings › Telegram › Topics › Topic map**: one block per topic with its project rows and session rows (open state, topic dropdown, 📌 keep, test to the session's topic, show pane, disconnect), "Disconnect n closed sessions". The ✈ glyph on tabs / rail rows opens the link dialog. Topic map has its own tab; above 3 rows a filter (text + All / Not delivering / Open / Closed) shows, broken topics sort first, row actions show on hover / focus. The overview carries a setup strip (Bot · Group · Topics · Paired · Receiving), each step opens its tab.
- **Topic icon follows its sessions** (opt-in `telegram.json` `topicIcons`, Settings › Reports): every minute (`tick` → `iconTick`) each linked forum topic gets `editForumTopic` `icon_custom_emoji_id` for the most urgent state of its panes (waiting ❓ > working ⚡ > idle ✔); ids come from `getForumTopicIconStickers` (first matching emoji wins, U+FE0F ignored). A session with its own topic counts only there. At most one edit per topic per 20 s; `chat` error (no Manage topics right) stops that chat for the run; General (no thread) is skipped. A topic that loses its route, or the switch turned off, gets its icon removed (`''`).

## 12. Open items

| Item | State |
|---|---|
| Nested subagent (depth ≥ 2) | **Resolved** — verified on real data (see §6), test `links nested subagent to its parent` |
| Foreground `Agent` call | Not reproducible here: every observed call (main and nested) is `requestShape: background`. Handled by fallback: non-async `tool_result` for `toolUseId` → completed / error (test `completes foreground subagent`); last fallback `end_turn` |
| Crash case | Not reproduced on purpose (would kill a user session). Covered by test: registry file left behind + dead PID → `stale`, running subagents → `unknown`, removed after TTL |
| `kind = bg` / daemon | Decision: show every `kind` with a visible kind label |
