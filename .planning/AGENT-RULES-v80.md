# Rules for v80 subagents (Orrery, F:/work/web/Claude-Code-Monitor)

READ FIRST: CLAUDE.md (repo root), .planning/PLAN-v80.md (decisions) + .planning/IDEAS-2026-11-03.md, your brief .planning/wp80/WP-<n>.md,
.code_index/_meta.md + web.md (use Grep on web.md, it is >100 KB), .planning/COLOR-SYSTEM.md.
The approved wireframes are summarised in your brief (you cannot open the artifact links).

- Load skills `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max` before coding (project rule). Keep the existing Apple-style
  design system, theme tokens, system fonts, `ccm-*` utility classes and shared components (ToggleSwitch, SegmentedControl, ContextMenu,
  StatusIcon, PaneMore…). This is a simplification pass: change layout / entry points / density, do NOT remove features. Every action
  that leaves the visible UI must stay reachable (overflow menu ⋯, context menu, palette or shortcut) — list where it went in your report.
- All UI strings via vue-i18n in BOTH en and vi (full Vietnamese diacritics). New strings go in a NEW file
  `apps/web/src/i18n/ui-v80-<wp>.ts` shaped like `resources-v76.ts` (export `{ en, vi }` with one top-level key); do NOT edit en.ts / vi.ts /
  index.ts — write the import + spread lines under "Hot file cần thêm" and main wires them. Reusing existing keys is preferred.
- Colours via theme tokens only; status = icon + text + colour; popovers/menus/dialogs opaque (`ccm-menu`). Secondary text ≥ 11px
  (`text-2xs` = 12px; replace arbitrary `text-[10px]` / `text-[9px]` in your scope with ≥ `text-[11px]`), body 13px.
- Minimal comments: only "why" (~1 per 30–40 lines), no decorative headers, no restating code. Match surrounding style (no semicolons,
  single quotes, 2 spaces). Preserve CRLF line endings where files use them.
- Vue gotcha: a template mustache must not contain `}}`.
- Keep `data-*` hooks used by E2E (`apps/desktop/e2e/*.cjs`) and unit tests. Before renaming/removing any `data-*`, aria-label or test id,
  Grep apps/desktop/e2e and apps/web/src for it; if you must change it, update those E2E/unit files too (they are in your scope for that).
- Tooling quirks: Bash `grep` output is mangled by an rtk hook → use the Grep tool. Vitest output through rtk is empty → from apps/web:
  `npx vitest run <files> --reporter=json --outputFile=C:/Users/dauph/AppData/Local/Temp/claude/F--work-web-Claude-Code-Monitor/d43c58d3-978b-4ec5-8f1f-ae2ccabd7305/scratchpad/<name>.json`
  then `python -I C:/Users/dauph/AppData/Local/Temp/claude/F--work-web-Claude-Code-Monitor/d43c58d3-978b-4ec5-8f1f-ae2ccabd7305/scratchpad/vres.py <that json>`.
  Write scripts with the Write tool, not heredocs. `rtk proxy git status --porcelain` shows the real git status.
- Gate: `npm run typecheck -w @ccm/web` (and `-w @ccm/desktop` if touched) clean; related vitest + `src/i18n` tests pass. Do NOT run builds
  or E2E (WP-8 does). Never touch the app on port 4317 (owner's running app) or the phone RFCTB05YJWJ.
- NO GIT WRITES (no add / commit / stash / checkout -- / reset / push). Other agents' changes are in the tree: never revert files you did not
  touch. Never touch spikes/, bg_native_ad_cta.xml, git-gui.bat, apps/desktop/test/__snapshots__/fwp-host.test.ts.snap, apps/*/.vitest/.
- Do not edit `apps/web/src/lib/changelog.ts`. Put one en + one vi changelog line in your report.
- Do not edit `.code_index/*` (main/WP-8 does); put 1–3 index lines (file + symbol) in your report.
- Impossible / unsafe → sensible default, note it in the report, continue.
- Write the report to `.planning/wp80/WP-<n>-report.md` BEFORE answering (format in the brief). Final answer ≤ 18 lines, Vietnamese,
  call the user "chủ nhân", self "con".
- v80 extra: zero token cost stays the core principle — MCP tools are called BY the agent; no tool may send / submit a prompt to any agent
  (prefill only via existing insertInto, like open_session). Every MCP tool: per-pane token auth like open_session, validate every argument
  (paths must resolve inside the pane's project, no traversal; serials / config ids whitelisted chars), rate-limit anything user-visible,
  destructive actions need the native confirm, never return secrets / env / file contents outside the project. Document each tool in
  docs/claude-code-integration.md §11w (Codex in docs/codex-integration.md). Desktop native strings in apps/desktop/src/strings.ts (en + vi).
- Gate also: `npm run typecheck -w @ccm/desktop` + desktop vitest for touched modules.
