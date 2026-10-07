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

## 12. Open items

| Item | State |
|---|---|
| Nested subagent (depth ≥ 2) | **Resolved** — verified on real data (see §6), test `links nested subagent to its parent` |
| Foreground `Agent` call | Not reproducible here: every observed call (main and nested) is `requestShape: background`. Handled by fallback: non-async `tool_result` for `toolUseId` → completed / error (test `completes foreground subagent`); last fallback `end_turn` |
| Crash case | Not reproduced on purpose (would kill a user session). Covered by test: registry file left behind + dead PID → `stale`, running subagents → `unknown`, removed after TTL |
| `kind = bg` / daemon | Decision: show every `kind` with a visible kind label |
