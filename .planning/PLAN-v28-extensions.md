# v28 — Extensions tab: install popular MCP servers, plugins and skills (global or per project)

## Context
User request: a UI listing commonly used MCP servers, plugins and skills, so picking one installs it into Claude Code **globally** (user scope) or **for one project**, with each MCP's status shown.
- MCP: Figma, Meshy AI ("meshAI"), Unity, Blender, GitHub, GitLab, Discord. Show auth needs + live status.
- Skills/plugins: pm-skills (phuryn/pm-skills), ui-ux-pro-max (nextlevelbuilder/ui-ux-pro-max-skill), frontend-design (Anthropic).

Decisions (asked):
- New **top-level header tab "Extensions"** (next to Monitor / Workspace / Usage / History). Desktop only.
- Install by running the **`claude` CLI** (`claude mcp add|add-json|remove|list|login`, `claude plugin install|uninstall|list --json`, `claude plugin marketplace add|list --json`). Never hand-write Claude's config.
- Tokens / API keys typed in a form (password inputs) and stored by the CLI in config. Project scope + secret → default to the `local` scope (stored in `~/.claude.json`, not committed) with a warning if the user picks the shared `.mcp.json`.
- Curated catalog + "Add source": a GitHub `owner/repo` marketplace, or a custom **http(s)** MCP URL.

Facts verified on this machine (CLI 2.1.299; project target 2.1.289 — re-check help text there):
- `claude plugin list --json` → `[{id, version, scope, enabled, installPath, mcpServers?, projectEnabled}]`; `claude plugin marketplace list --json` → `[{name, source, repo}]`; `plugin list --available --json` lists marketplace plugins.
- `claude mcp list` has no JSON: lines `name: target - ✔ Connected | ✗ Failed… | ⚠ Needs authentication | ⏸ Pending approval`; plugin servers appear as `plugin:<plugin>:<server>`, claude.ai connectors as `claude.ai <Name>`. It health-checks every server (slow, seconds).
- `claude mcp login <name>` = OAuth for HTTP/SSE (opens the browser). `-s/--scope local|user|project` on `mcp add`; `user|project|local` on `plugin install`. `plugin install` needs `-y` only for marketplace-declared commands — we never pass `-y`; such a plugin reports "needs confirmation in a terminal".

Catalog (from research, sources in the agent report; store `source` URLs in the catalog):
| id | kind | install | auth / fields | prereq |
|---|---|---|---|---|
| figma | mcp http | `https://mcp.figma.com/mcp` | OAuth → login | — (also offer plugin `figma@claude-plugins-official`) |
| meshy | mcp stdio | `npx -y @meshy-ai/meshy-mcp-server` (win32: `cmd /c npx …` via `add-json`) | `MESHY_API_KEY` | node |
| blender | mcp stdio | `uvx mcp-for-blender` | none; guide: `uvx mcp-for-blender install-addon`, enable add-on, Start MCP Server | uv |
| unity | plugin + guide | `unity@claude-plugins-official`; MCP = CoplayDev "MCP for Unity" configured from the Unity editor (guide + link only, status by name match) | — | Unity |
| github | mcp http | `https://api.githubcopilot.com/mcp/` + header `Authorization: Bearer <PAT>` | PAT | — |
| gitlab | mcp http | `https://gitlab.com/api/v4/mcp` (optional instance URL field) | OAuth → login | group must allow MCP |
| discord | mcp stdio | `docker run --rm -i -e DISCORD_TOKEN -e DISCORD_GUILD_ID saseq/discord-mcp:latest` | `DISCORD_TOKEN`, optional `DISCORD_GUILD_ID` | docker |
| pm-skills | marketplace `phuryn/pm-skills` | 9 plugins `pm-*@pm-skills`, user ticks which | — | — |
| ui-ux-pro-max | plugin | `ui-ux-pro-max@ui-ux-pro-max-skill` (marketplace `nextlevelbuilder/ui-ux-pro-max-skill`) | — | — |
| frontend-design | plugin | `frontend-design@claude-plugins-official` | — | — |

Rules that still apply: load skills `frontend-design:frontend-design` + `ui-ux-pro-max:ui-ux-pro-max` before UI work; i18n en + vi (new file `i18n/extensions-v28.ts`, spread at the root); colours via tokens per `.planning/COLOR-SYSTEM.md` (status = icon + text + colour; connection states use `success`/`warning`/`danger` roles, not lifecycle status colours); Apple controls (`ccm-btn`, `ccm-field`, `ccm-sheet`, `SegmentedControl`, `AppSelect`, `ToggleSwitch`); no horizontal scroll; LF files. Copy this plan to `.planning/PLAN-v28-extensions.md`.

---

## Phase 0 — Spike (no code kept)
- `claude mcp login figma` under `execFile` without a TTY: does it open the browser and exit after the callback? If not → auth button falls back to "Run `/mcp` in a Claude session" (copy button) and opening a Workspace terminal with the command is out of scope.
- `claude plugin uninstall --help`, `claude mcp remove --help` flags; `CLAUDE_CONFIG_DIR` location of `.claude.json`.
- Timing of `claude mcp list` with ~5 servers.

## Phase A — Shared contract (`packages/shared/src/extensions.ts`, export from index)
- `ExtScope = 'user' | 'project' | 'local'`; `CatalogEntry {id, kind: 'mcp'|'plugin'|'marketplace'|'guide', name, vendor, description key, source url, transport?, fields: FieldSpec[] {key, label key, secret, required, pattern}, prereqs: ('node'|'uv'|'docker')[], plugins?: string[] (marketplace), oauth?: boolean}` + `CATALOG` constant.
- Status types: `McpState = 'connected'|'needsAuth'|'failed'|'pending'|'notInstalled'|'unknown'`, `McpStatus {name, state, scope?, viaPlugin?}`, `PluginStatus {id, scope, enabled}`, `ExtStatus {cli: boolean, prereqs: Record<…, boolean>, mcp, plugins, marketplaces, skills: {user: string[], project: string[]}}`.
- `ExtResult = {ok: true} | {ok: false, code: 'noCli'|'busy'|'cancelled'|'badInput'|'needsTerminal'|'failed'|'timeout', detail?: string (sanitized)}`.
- The page sends **catalog id + field values + scope + project dir**, never commands. Custom sources: `owner/repo` regex `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`, custom MCP = name `^[A-Za-z0-9_-]{1,40}$` + http(s) URL only (no custom stdio commands).

## Phase B — Desktop main (`apps/desktop/src/extensions/`)
- `cli.ts`: reuse `findClaudeCli` from `apps/collector/src/job-stop.ts` (desktop already imports collector source, see `main.ts` `datadir`); `runClaude(args, {cwd, timeout})` = `execFile` `shell:false`, `windowsHide`, env = `childEnv(process.env)` from `pty/presets.ts` (strips `CCM_*`, `ELECTRON_*`, session vars like `CLAUDECODE`), maxBuffer 4 MB. Prereq probe: `findOnPath` (`collector/src/win-exe.ts`) for `npx|uvx|docker`.
- `commands.ts` (pure, unit-tested): `buildInstall(entry, values, scope, platform)` → argv list(s) (marketplace add before plugin install when the marketplace is missing); `buildRemove`; `maskArgs` (secret values → `••••`) for dialogs/logs; `parseMcpList(text)`; `parsePluginList(json)`.
- `status.ts`: `readStatus(projectDir?)` = `plugin list --json` + `marketplace list --json` (cwd = project) + `mcp list` (cwd = project, cached 30 s, separate call so the fast part renders first) + scope lookup by reading names only from `~/.claude.json` (`mcpServers`, `projects[dir].mcpServers`) and `<dir>/.mcp.json` + skill folder names in `~/.claude/skills` and `<dir>/.claude/skills`. No config values ever leave main.
- `ipc.ts` `registerExtensionsIpc({isAppFrame, confirm})`: `ccm:ext-status(dir?)`, `ccm:ext-mcp-status(dir?)`, `ccm:ext-install({id, values, scope, dir?, plugins?})`, `ccm:ext-remove({kind, name, scope, dir?})`, `ccm:ext-login(name, dir?)`, `ccm:ext-add-source({type:'marketplace'|'mcp', …})`. All behind `isAppFrame`; project dir must be absolute, existing, realpath'd, not a filesystem root / UNC (reuse `preview/paths.ts`). One mutation at a time (`busy`). Every mutation shows a native consent `dialog.showMessageBox` with the masked command + target file/scope (pattern: `ccm:statusline-enable`, `main.ts:548`); strings in `strings.ts`. Logs use `maskLog`.
- `preload.ts` + web `lib/desktop.ts` `DesktopBridge`: `extStatus extMcpStatus extInstall extRemove extLogin extAddSource`. Wire in `main.ts`, dispose with the other IPC.

## Phase C — Web
- `stores/ui.ts` `View` + `'extensions'`; `AppHeader.vue` tabs (icon `Puzzle`, only when `desktop`); `App.vue` view branch; `CommandPalette.vue` nav entry `c:extensions`.
- `stores/extensions.ts`: `target` (`'global'` | project dir, persisted `ccm.ext.target`), `status`, `mcpLoading`, `busy` per id, `lastResult`; `refresh()` on view enter / target change / after mutations.
- `components/extensions/ExtensionsView.vue`: toolbar = scope `SegmentedControl` (Global | Project) + project `AppSelect`-style picker (sources merged like `LaunchPicker.vue:45-73`: recent, favorites, live cwds, "Choose folder…" via `desktop.pickFolder`) + refresh + "Add source". Sections: **MCP servers**, **Plugins & skills**, **Other installed** (non-catalog servers/plugins/skills found, remove only). Banner when CLI missing.
- `ExtensionCard.vue`: name, vendor, one-line description, state badge (icon + text + colour: Connected / Needs sign-in / Failed / Pending approval / Installed via plugin / Not installed), scope chip, prereq warning (e.g. "Docker not found"), actions Install / Sign in (OAuth) / Remove / Docs link (`openExternal`).
- `InstallSheet.vue` (`ccm-sheet` pattern from `QuickSetup.vue`/`DiagnosticsDialog.vue`, focus trap, Esc): fields (secret = password + show toggle), scope (Global / Project: "Only me (local)" default when a secret is present, "Shared via .mcp.json" with a commit warning), pm-skills plugin checklist, guide steps for Blender/Unity, command preview (masked), result.
- `AddSourceSheet.vue`: marketplace `owner/repo` → after add, list its plugins (`plugin list --available --json`) to install; or custom MCP name + URL + optional header.
- i18n `i18n/extensions-v28.ts` (en + vi) incl. catalog descriptions and guide steps.

## Phase D — Docs + index
- `docs/claude-code-integration.md`: new section — the app now changes Claude config only through the `claude` CLI after native consent (mcp/plugin scopes, `mcp list` parsing, `.mcp.json` approval). `.code_index/{desktop,web,protocol,_meta}.md`. CLAUDE.md "What this is" one line.

## Verification
- `npm test -w @ccm/desktop -- test/extensions.test.ts`: argv per catalog entry × scope × platform (win32 `cmd /c npx`), masking, `parseMcpList` on the captured real output (incl. long `plugin:claude-mem` line, `claude.ai` connector, pending/needs-auth lines), path validation, busy lock, consent cancel = no run (fake runner).
- `npm test -w @ccm/web` (store + i18n parity), `npm run typecheck`.
- E2E `apps/desktop/e2e/extensions.cjs` (+ `run.cjs`): tab renders, real read-only status loads, install sheet opens/validates — no installs.
- Manual: `npm run desktop` → install frontend-design to a scratch project (project scope) → `.claude/settings.json` gains `enabledPlugins`; install GitLab globally → Sign in → status Connected; remove both; check the `mcp list` view in a terminal matches.
