# DeepSeek CLI (Codewhale) integration

Verified 2026-11-03 against **Codewhale 0.10.2** (`ff466b2ed0bf`, Windows x64), the renamed DeepSeek-TUI
(github.com/Hmbown/DeepSeek-TUI, MIT). Plan: `.planning/PLAN-v81-deepseek.md`.

## Install

| Route | Command | Notes |
|---|---|---|
| npm (all OS, needs Node) | `npm i -g codewhale` | wrapper only; the first run of `codewhale` downloads the 128 MB release binary from GitHub Releases (prints `codewhale: downloading …`). Run `codewhale --version` once after install. |
| winget (Windows) | `winget install HunterBown.CodeWhale` | |
| script (macOS / Linux) | `curl -fsSL https://codewhale.net/install.sh \| sh` | |

Binaries: `codewhale`, alias `codew`. Detect with a PATH lookup + `codewhale --version` → `codewhale 0.10.2 (<hash>)`.

## Login (DeepSeek API key)

- `codewhale auth set --provider deepseek --api-key-stdin` — key on stdin, never echoed, stored in
  `~/.codewhale/secrets/secrets.json` (file backend). Never `--api-key` (visible in the process list).
- `codewhale auth status` — table `provider config keyring env status`, `deepseek … unset *` before login. Never
  prints a key. `codewhale auth clear --provider deepseek` logs out.
- Default provider is `deepseek` with no config file. `codewhale login` is a Codewhale cloud account (closed to
  new users) — not needed.
- Telemetry is **on** by default (PostHog, aggregate). Off: `codewhale config set telemetry false` or env
  `CODEWHALE_TELEMETRY=0` (env wins).

## CLI used by Orrery

- Interactive: `codewhale [PROMPT]` (a PROMPT is submitted — Orrery never passes one; prompts are prefilled by
  typing into the pane like Claude). `-r, --resume <SESSION_ID>` resumes by id or unique prefix; `--session-id`
  is an alias of `--resume` (no way to choose the id of a new session). `-C <DIR>` workspace. `--skip-onboarding`.
- Headless: `codewhale exec --auto "<prompt>"` (tools only with `--auto`), `--output-format stream-json`.
- Paths (`codewhale doctor`): home `~/.codewhale` (legacy `~/.deepseek` still read), `config.toml`,
  `settings.toml`, `sessions/`, `logs/`, `secrets/secrets.json`.

## MCP

- Config file: `~/.codewhale/mcp.json`, overridden by env **`DEEPSEEK_MCP_CONFIG`** (verified: `mcp list` reads
  the env path; also merges `<workspace>/.codewhale/mcp.json`).
- Orrery entry (verified `mcp list` → `orrery [enabled auth=bearer-token] http://127.0.0.1:<port>/mcp`):
  `{"servers":{"orrery":{"url":"http://127.0.0.1:<port>/mcp","bearer_token_env_var":"ORRERY_TOKEN"}}}`.
  URL must be literal (no documented `${VAR}` expansion) → the PTY host writes the file per port.
- MCP tools run without TUI approval prompts.

## Instructions, skills

- Project: `AGENTS.md` chain root → workspace. `CLAUDE.md` only with top-level
  `project_instruction_imports = ["claude"]` in `config.toml` (`config set` refuses this key; edit TOML;
  verified `config get` → `["claude"]`).
- Global: `~/.codewhale/AGENTS.md`; `~/.claude/CLAUDE.md` only with `[instruction_budget] claude_fallback = true`
  (Orrery writes its own `~/.codewhale/AGENTS.md` instead: the Claude file holds Claude-only skill tables).
- Skills: owned `~/.codewhale/skills`, `<ws>/.codewhale/skills`; read-only `~/.agents/skills`,
  `~/.claude/skills`, `<ws>/.claude/skills` (project ones after `/trust on --save`). Activate `/skill <name>`;
  the model can `load_skill`. Frontmatter `allowed-tools` / `model` / `agent` only warn.

## Status (for the Monitor)

Source: Codewhale `crates/hooks/src/lifecycle_outbox.rs` + `docs/changelog-lifecycle-outbox.md`. 0.10.2 reads the
`[lifecycle_outbox]` key (`codewhale config doctor`). **No live line seen yet** (no API key on the dev machine), so
everything below about line contents is from source only and the collector treats every field as optional.

- Config: `<home>/config.toml` (`CODEWHALE_HOME`, else `~/.codewhale`, else legacy `~/.deepseek`), table
  `[lifecycle_outbox]` key `path` (may start with `~`). Unset = no outbox. Settings → DeepSeek → sync adds
  `path = "~/.codewhale/notifications/outbox.jsonl"` when none is set (never changes one the user set;
  `TEMPLATES_VERSION` 2 offers the sync again to existing installs).
- File: JSONL, one `RuntimeEventEnvelope` per line `{schema_version: 1, seq, event, kind, thread_id, turn_id|null,
  item_id|null, timestamp, created_at, payload}`. Events / kinds: `session_start` / `session.started`,
  `session_end` / `session.ended` (TUI only), `turn_start` / `turn.started`, `turn_end` /
  `turn.completed|failed|interrupted`, `turn_stalled` / `turn.stalled`, `subagent_spawn` / `subagent.spawned`,
  `subagent_complete` / `subagent.completed`. Every payload has `workspace` (absolute); subagent events
  `payload.subagent` (shape not documented). Several processes append to one file; `seq` repeats across
  processes; only a crash can leave a torn last line. `thread_id` is empty for a fresh headless `exec` run.

### What the Monitor does (v81 WP-E, `apps/collector/src/deepseek/`)

- `outbox.ts`: `outboxPathFrom` reads only that key; `parseOutboxLine` keeps event, a fixed-vocabulary `kind`, thread
  id (`[A-Za-z0-9._:-]{1,128}`, empty → line ignored), time, absolute workspace and, for subagents, an id plus a
  slug-like name (`id|agent_id|subagent_id`, `name|agent_type|type|role`; a bare string is the id). Free text is
  never kept even though the payload is pre-redacted. `DeepseekThreadState`: working from `turn_start` to
  `turn_end`, `turn_stalled` keeps working, `turn.failed` → idle + activity `turn.failed`, `session_end` → ended.
- `monitor.ts` `DeepseekMonitor`: tails the file (`JsonlTailer`, first read from the last 256 KB to rebuild live
  sessions, lines > 256 KB dropped, truncation resets, a new inode / birth time = rotation read whole), `fs.watch`
  on the outbox folder + the home (config changes re-resolve the path). Publishes terminals `deepseek:<thread_id>`
  (`provider: 'deepseek'`, `deepseekSessionId`, `cwd` = workspace) with main agent `…:main` and subagents
  `…:sub:<id>`; activity `turn.started|completed|failed|interrupted`, `agent.started|completed|failed|cancelled`
  (subagents), `terminal.started|ended`. Ended sessions drop after `CCM_STALE_TTL_MIN`. `CCM_DEEPSEEK=0` turns it off.
- `processes.ts`: `codewhale(.exe)`, `codewhale-windows-x64.exe`, `codew(.exe)` (npm wrapper runs
  `node_modules/codewhale/bin/downloads/codewhale.exe`) via the shared walker in `codex/processes.ts`
  (`listProcessesNamed`, koffi table with CIM fallback, `ps` on macOS / Linux). Scans only on a new session and every
  60 s while one is live (same cadence as Codex). Only `-C/--workspace` (absolute) and `-r/--resume/--session-id`
  are kept from the command line. `matchDeepseekProcesses`: one process per session — resume id (prefix), then
  workspace, then nearest start before `session_start` (−2 s … +120 s), then a lone earlier process. The matched pid
  is the terminal's `processId`, so Workspace panes link through the PTY host's `owners` walk.
- Ending: `session_end`, the matched process exits, a good scan finds no Codewhale process at all, or 15 min without a
  line and no process. At start, sessions without a matching process after a good scan are left out.

Unverified (check once a key is set): real `thread_id` format (the web hands it to `-r` only when it is a UUID);
`payload.subagent` shape; whether `/new` in the TUI emits `session_end` for the old session (if not, the old one
keeps the process until it exits); whether `turn_stalled` is followed by `turn_end`; whether `timestamp` is ISO.
