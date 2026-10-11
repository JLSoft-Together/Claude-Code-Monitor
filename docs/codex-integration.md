# Codex CLI Integration — Discovery (Codex 0.162.0, verified 2026-10-11)

Scope extension requested 2026-10-11 (plan: `.planning/PLAN-v16-codex.md`): Claude Code sessions on this machine call
`codex exec` (Bash tool, also from subagents) and the `codex@openai-codex` plugin (app-server). The monitor shows those
runs inside the calling Claude session and other Codex CLI runs as their own sessions. Same rules as Claude Code: read
local files only, never send prompts, never call an API, never show content.

## 1. Sources

| Source | Used | Notes |
|---|---|---|
| `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local time>-<threadId>.jsonl` | yes | One file per thread, append-only JSONL. Folder and file name use local time. |
| `$CODEX_HOME/session_index.jsonl` | yes | `{id, thread_name, updated_at}`; later lines win. Titles only. |
| Process table (`codex.exe` / `codex`) | yes | Liveness + who launched the run (parent chain). |
| `state_5.sqlite`, `logs_2.sqlite` | no | Private schema; `node:sqlite` is experimental; `codex exec` does not write the log db. |
| `auth.json`, `config.toml`, `history.jsonl` | never | Credentials / user content. |

`CODEX_HOME` defaults to `~/.codex`. `CCM_CODEX=0` turns the whole Codex side off.

## 2. Rollout records (keys used)

Every line is `{timestamp, ordinal?, type, payload}`; `payload.type` is the first key of the payload, so a line can be
classified from its first 256 bytes (`codex/rollout.ts` `classifyLine`).

| type / payload.type | Fields read |
|---|---|
| `session_meta` (line 1) | `id`, `timestamp` (thread creation), `cwd`, `originator`, `source`, `cli_version`; `source` object → `parent_thread_id` (subagent) |
| `turn_context` | `model`, `effort` (fallback `collaboration_mode.settings`) |
| `event_msg` `task_started` / `task_complete` / `turn_aborted` | turn open / closed / aborted; `model_context_window` |
| `event_msg` `token_count` | `info.total_token_usage` (thread cumulative), `info.last_token_usage`, `model_context_window`; `rate_limits` (`limit_id` `codex`, `primary`/`secondary` `{used_percent, window_minutes, resets_at}` epoch s, `plan_type`) |
| `response_item` `function_call` / `custom_tool_call` / `local_shell_call` | `call_id`, `name` (`namespace.name` for MCP) → current tool |
| `response_item` `*_call_output` | `call_id` → tool finished |
| `compacted` | counted, never parsed (lines are megabytes) |

Skipped without parsing: `message`, `reasoning`, `world_state`, `token_usage_record`, `item_completed` and every other
line. Observed 2026-10-11: 216 rollouts, 3.1 GB, largest 1.5 GB, single lines of several MB (base64 images).

`originator` / `source` → mode: `codex_exec` + `exec` → **exec**; `codex-tui` + `cli` → **tui**; `Claude Code` (the
plugin's app-server `clientInfo.name`) → **plugin**; `source` object → **subagent**; `vscode` otherwise
(`Codex Desktop`, IDE) → ignored; anything else → **app-server**.

## 3. Reading strategy

- Head: `readSessionMeta` parses line 1 (≤ 4 MB; regex fallback on the first 64 KB when the line is longer).
- Tail: `RolloutTailer` starts 8 MB before the end for files seen first, drops the cut line, reads in 4 MB chunks and
  never buffers a line it will skip. Turn state works mid-file because `total_token_usage` is cumulative and a turn's
  last line is `task_complete` (any turn activity after the last marker = open turn).
- Measured: meta of the 1.5 GB rollout 4 ms, 8 MB tail 29 ms; collector start with the Codex side ≈ 0.6 s (one
  PowerShell process query).

## 4. Processes and launch link

- Windows: one PowerShell CIM query lists all processes (pid, parent, creation) and `codex.exe` command lines; the
  parent chain only follows parents created before their child (pid reuse). macOS/Linux: `ps -A -o pid=,ppid=,lstart=,comm=`
  + `ps -o pid=,args=` for codex pids. Command lines are reduced to subcommand + `resume <uuid>` in memory and dropped.
- Launch chain from Claude Code (observed): `claude.exe → bash.exe → bash.exe → node.exe (codex.js) → codex.exe`.
- Thread ↔ process: no registry, so a thread belongs to the exec / TUI process that started 2 s before … 120 s after
  `session_meta.timestamp` (closest wins, one thread per process), or to the process whose command line resumes it.
  A TUI `/new` thread goes to the only TUI process when there is one. Plugin / app-server threads share one process and
  are never paired; subagents inherit their parent's process.
- Claude link, in order: (1) a live Claude session pid in the parent chain; (2) plugin threads: same cwd as a live
  Claude session; (3) the chain is cut right above a shell/runtime (`bash`, `timeout`, `node`, …) whose parent already
  exited — MSYS hands `exec` over to a new process, so `timeout 600 codex exec …` loses its parent — or the run ended
  before the scan: the Claude session with the latest Bash/PowerShell call whose command mentions `codex` (≤ 10 min
  before, ≤ 5 s after the thread start). A chain that tops out at a GUI app (Windows Terminal, editor) is a user run.
- Calling agent: the agent (main or subagent) of that session whose codex-mentioning shell call is the latest before
  the thread start; main agent otherwise. `transcript.ts` keeps only the call time, never the command.

## 5. Status

| Codex state | Child agent (in a Claude session) | Own session |
|---|---|---|
| turn open, process alive | working | working |
| `task_complete` | completed | idle (TUI) / ends with the process (exec) |
| `turn_aborted` | cancelled | idle |
| process gone while turn open | cancelled | stale, main agent cancelled |
| no process to watch (plugin, failed scan) and no write for 15 min | unknown | stale |

Startup shows only running threads: exec / TUI threads need a live process after a successful scan; others need an
open turn written within 15 min. Finished runs from before the collector start are not rebuilt. At most 20 finished
Codex runs are kept per Claude session; finished runs and ended sessions go after `CCM_STALE_TTL_MIN`.

Tokens follow the Claude convention: input = `input_tokens − cached_input_tokens`, cache read = cached, total = input +
output. Context = `last_token_usage.total_tokens` ÷ `model_context_window` (plain ratio, no Claude auto-compact buffer).
Rate limits: window ≤ 1 day → 5-hour slot, longer → weekly slot; newest `token_count` across all rollouts wins, seeded at
start from the newest rollout of today/yesterday; forecast via `LimitHistory` (`<dataDir>/codex-limit-history.json`).

## 6. Limitations (cannot be fixed from these sources)

- Approval prompts are not written to the rollout, so Codex never shows **waiting**; a tool waiting for approval looks
  like a running tool.
- `codex resume --last` / picker resumes carry no id: such a thread is unpaired and its liveness falls back to the
  15-minute write timeout.
- Codex Desktop / IDE threads are out of scope (ignored by originator).
- No Codex usage history or cost: no reliable GPT price table; counters only appear on live agents.
- Codex subagent records (`source.subagent.thread_spawn.parent_thread_id`) were not present on this machine; parsing is
  tolerant (any nested `parent_thread_id`).
