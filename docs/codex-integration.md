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
- A Codex run is visible only once its rollout exists, and 0.162 writes it with the first prompt (checked 2026-10-18:
  `codex` idle at its prompt for 20 s, no `sessions/` folder created). `codex` typed in a Workspace shell pane therefore
  shows as Codex only after the first prompt.
- Codex Desktop / IDE threads are out of scope (ignored by originator).
- No Codex usage history or cost: no reliable GPT price table; counters only appear on live agents.
- Codex subagent records (`source.subagent.thread_spawn.parent_thread_id`) were not present on this machine; parsing is
  tolerant (any nested `parent_thread_id`).

## 7. Data folder `~/.codex` (v76 R7, verified 2026-11-01 on Codex 0.162 / app-server of 0.164 alpha, Windows 11; sizes / names only)

`~/.codex` = 6.9 GB here. Dot folders are not where the size hides: they are only `.sandbox-bin` (439 MB: one `codex-command-runner-<version>.exe` per Codex version since 0.130 + a 335 MB `codex.exe` copy for the sandbox user) and `.tmp` (111 MB: plugin sync staging). The "missing 4.5 GB" of the first estimate were `generated_images` (2.4 GB, **already a junction to `L:\AI\codex_cache`**, so it is not on C: at all), `sessions/` (2.26 GB rollouts) and `thread_history_1.sqlite` (1.83 GB), none of them hidden. Group table: `packages/shared/src/agentData.ts`.

| Group (id) | Entries | Kind | Size here | Orrery may |
|---|---|---|---|---|
| rollouts | `sessions/YYYY/MM/DD/rollout-*.jsonl`, `archived_sessions` | history (resume, Orrery Codex runs) | 2.26 GB | move |
| threads | `thread_history_*.sqlite*`, `state_*.sqlite*`, `session_index.jsonl`, `history.jsonl`, `goals_*`, `queue_*`, `memories*`, `attachments` | history | 1.84 GB | move |
| generatedImages | `generated_images` | history (owner's images) | 2.4 GB (junction here) | move (the junction is copied as a junction) |
| codexLogs | `log/`, `sandbox*.log` | cache | < 1 MB | clean |
| logDb | `logs_*.sqlite*` | cache (database Codex keeps open) | 72 MB | move only |
| codexCache | `cache/`, `models_cache.json` | cache | 72 MB | clean |
| codexTemp | `.tmp/`, `tmp/` | cache, used live | 111 MB | clean only while no `codex` runs |
| codexPrograms | `packages/` (app-server daemon 923 MB), `plugins/` (510 MB), `.sandbox-bin/`, `vendor_imports/` | program | 1.88 GB | move only |
| codexExtensions | `skills`, `rules`, `AGENTS.md`, `hooks.json` | config | small | move only |
| codexSettings | `config.toml*`, `.codex-global-state.json*`, `version.json`, `app-server-*`, lock folders, migration markers, … | config | small | move only |
| codexCredentials | `auth.json`, `.sandbox-secrets`, `.sandbox`, `cap_sid`, `installation_id` | config / secret | small | move only, never read |
| unknown | `sqlite/` (a second set of `logs_2` / `state_5` / `codex-dev.db`, 253 MB), `ambient-suggestions`, `tui-thread-reference-capabilities`, `visualizations`, … | unknown | | move only |

Moving `~/.codex` follows docs/claude-code-integration.md §11al (refused while any `codex` / `codex.exe` process runs, including the Codex desktop app). Not verified: Codex's Windows sandbox grants its sandbox user access to `CODEX_HOME` (`.sandbox`, `cap_sid`); the copy does not carry ACLs, so the first sandboxed run after a move may set them up again.

## 8. MCP `orrery` in a Codex pane (v80 WP-2, verified 2026-11-03 on codex-cli 0.162.1)

Codex supports streamable HTTP MCP servers with a bearer token read from an env var, and `-c key=value` overrides at start (no write to `~/.codex/config.toml`):

```
codex mcp add --help        -> --url <URL> (streamable HTTP), --bearer-token-env-var <ENV_VAR>
codex -c "mcp_servers.orrery.url=http://127.0.0.1:4317/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN mcp get orrery
  -> enabled: true / transport: streamable_http / url: http://127.0.0.1:4317/mcp / bearer_token_env_var: ORRERY_TOKEN
```

- The url must be literal (config has no `${VAR}` expansion), so the shell expands `ORRERY_API` in the launch line; a `-c` value that is not valid TOML is read as a raw string, so no inner quotes.
- The token never appears on the command line: Codex reads it from `ORRERY_TOKEN` (set by the PTY host in the pane env).
- `pty/presets.ts` `agentCommand` adds both `-c` flags for the codex preset when `opts.mcp` (new and `codex resume`, before the subcommand). Same per-pane token and tools as §11w of claude-code-integration.md.
- Not run: a real Codex session (no prompt sent, zero token cost); only `codex mcp get` and unit tests (`apps/desktop/test/pty.test.ts`).
- v80 WP-5 tools `preview_layout`, `list_servers`, `free_port` (§11w "Main-side tools") work the same from a Codex pane: same token, the pane's starting folder and shell process tree decide what is inside the project / `mine`; `free_port` still needs the owner's native confirm.
- v80 WP-4 tools `run_app`, `run_status`, `run_log`, `device_screenshot` (§11w "Run / device tools") work the same from a Codex pane: the Run root is the Codex pane's starting folder, the page must know the pane, shared Run configurations still need the owner's trust confirm.
- Tools (v80 WP-1): `open_session`, `notify_owner`, `open_in_workspace`, `who_is_editing` all work from a Codex pane: Codex sends `Authorization: Bearer <ORRERY_TOKEN>` to `http://127.0.0.1:<port>/mcp`, which is exactly what `mcpGate` accepts (Host `127.0.0.1:<port>`, no `Origin`, 64-hex bearer) and the host maps to the calling pane like a Claude pane (`ORRERY_TOKEN` is set for every preset in `pty/host.ts` `spawn`). Paths resolve inside the Codex pane's starting folder; `who_is_editing` already lists Codex panes. Checked by code + the HTTP E2E (`e2e/v80-mcp.cjs`, same token path); not yet driven from a real Codex session.
