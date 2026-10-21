# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

MVP phases 1–7 implemented. `PLAN.md` is the **source of truth** for scope; `docs/claude-code-integration.md` documents the verified Claude Code data sources, `docs/codex-integration.md` the Codex CLI ones (v16 scope extension, `.planning/PLAN-v16-codex.md`).

## Commands

npm workspaces (pnpm not installed on this machine). From repo root:

- `npm install` — install all workspaces
- `npm run dev` — UI work only: collector `--dev` (`127.0.0.1:4317`, no app key, no terminals) + Vite web (`127.0.0.1:5173`, proxies `/ws`). Give it its own `CCM_DATA_DIR`: it records the office timelapse into `timeline/<today>.jsonl` like the packaged app, so both would append to the same file and demo-fixture sessions would land in the real timeline
- `npm test` — Vitest in all workspaces; single file: `npm test -w @ccm/collector -- test/monitor.test.ts`
- `npm run typecheck`
- `npm run desktop` — build web, then run the Electron app from `apps/desktop/stage` (dev); runs `gradlew assemble` in `apps/layout-daemon` first when its jar / loose kit / layoutlib-dist is missing (JAVA_HOME if JDK 17–24, else newest fitting JDK in `~/.gradle/jdks` or Android Studio JBR — Gradle 8.14 refuses Java 25; `CCM_SKIP_DAEMON_BUILD=1` skips)
- `npm run desktop:dev` — Electron app with Vite HMR for the web UI (window loads `127.0.0.1:5173`); main/collector changes still need a restart. Close a running packaged app first (single-instance lock, port 4317)
- `npm run dist` — packages for the host OS (`scripts/dist.mjs`: win32 → `dist:win`, darwin → `dist:mac`, else exit 1); no cross builds (node-pty prebuilt is host-only)
- `npm run dist:win` — build web + desktop → `apps/desktop/release/` (NSIS Setup + Portable exe)
- `npm run dist:mac` — same → `.dmg` arm64 + x64; **macOS only** (or GitHub Actions workflow `desktop`)
- `npm run e2e -w @ccm/desktop [exe]` — CDP E2E against the dev build (or a packaged exe); build web + desktop first
- `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` — fake Claude root for load/UI testing; run the app (or `npm run dev`) with `CLAUDE_CONFIG_DIR=<printed root> CCM_VERIFY_PROCESSES=0`

Desktop only since v2.0.0 (`.planning/PLAN-v19-desktop-only.md`): the collector exits unless started by the app (`CCM_APP_KEY`, required as header `x-ccm-app` on every request but `/health`) or with `--dev`. Collector env: `CCM_APP_KEY`, `CCM_TOAST_LINK` (`agent-monitor://`, set by the app on Windows), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` (`~/.codex`), `CCM_CODEX=0` (tắt Codex), `CCM_PORT`, `CCM_STALE_TTL_MIN` (120), `CCM_PEER_TTL_MIN` (60, session ↔ session message links drop after that many quiet minutes), `CCM_WEB_DIST`, `CCM_VERIFY_PROCESSES=0`, `CCM_KOFFI` (koffi path, set by the app on Windows), `CCM_NATIVE_PROCS=0` (process table via PowerShell CIM instead of koffi), `CCM_TOAST=0` (tắt toast / alert), `CCM_TOAST_BACKEND=electron` (desktop macOS: alert → dock badge/bounce), `CCM_DATA_DIR` (`%LOCALAPPDATA%/ccm`, macOS `~/Library/Application Support/ccm`: usage cache + aliases, `timeline/` office timelapse (7-day retention) and `office-names.json`).

Deviations from `PLAN.md` are allowed only when a discovered Claude Code limitation forces them, and must be documented in `docs/claude-code-integration.md`.

## What this is

**Orrery** (renamed from Claude Code Monitor on 2026-10-11, then Agent Monitor → GolAIm on 2026-10-15, then GolAIm → Orrery on 2026-10-17 — an orrery is the clockwork model of planets circling a sun, like sub-agents around their main agent; userData stays pinned to the `Agent Monitor` folder; repo folder, npm package names `@ccm/*`, `appId` `dev.ccm.monitor`, data dir `ccm`, `CCM_*` env and `ccm.*` storage keys keep the old prefix on purpose so installs update in place). A local-only desktop app (Windows exe, macOS `.dmg`; no browser mode since v2.0.0) that observes running Claude Code CLI sessions (target version **2.1.289**) — plus Codex CLI runs (**0.162.0**), shown under the Claude agent that launched them — across multiple terminals and shows sessions, terminal titles, and the main-agent → sub-agent hierarchy in realtime. Since v28 an Extensions tab installs curated MCP servers / plugins into Claude Code (global or per project) only via the `claude` CLI after a native confirm (docs §11r). Since v30 a Git Log pane shows a project's history (docs §11s); since v36 its Branches toolbar can also create, fast-forward, fetch and delete branches (delete only after a native confirm). Since v59 the Explorer tree shows Atom Material file / folder icons as in IntelliJ with that JetBrains plugin (MIT, bundled by `scripts/gen-file-icons.mjs`; Settings → Appearance → File icons switches back to Simple) (`.planning/PLAN-v59-file-icons.md`). Since v58 Settings holds several GitHub accounts added by personal access token (sealed by the OS keychain, never sent back to the page); push / fetch / pull of a github.com https remote use the repo's account, picked in the Push dialog or automatically by access (`.planning/PLAN-v58-github-accounts.md`). Since v49 a Claude session in a Workspace pane can open new panes through the PTY host's MCP server `orrery`, tool `open_session` (per-pane token, prompt only prefilled, never submitted), and `agent-monitor://open` does the same from outside without a confirm (owner decision; 10 links a minute, `resume=<uuid>` reopens an unfinished session, no prompt) (docs §11w). Since v50 split tabs show as groups in the rail, tabs can be named, status counts running subagents, Mission Control is a card grid, and deletes disintegrate into dust (`.planning/PLAN-v50-workspace-groups.md`). Since v52 a pane can be zoomed to fill its tab, closes can be undone (agents come back with `--resume`, dust flies back together), rows and headers show the running tool and time, pane headers collapse by container width, inactive panes can be dimmed, and Mission Control fills the screen with filter and 1–9 keys (`.planning/PLAN-v52-workspace-polish.md`). Since v60 the Monitor center can show the Habblaud pixel-art office (one room per project, a character per agent, social life, sound, day timelapse; vendored as `packages/habblaud`, MIT) (`.planning/PLAN-v60-habblaud-office.md`).

Core principle: **Observe → Normalize → Broadcast → Render**. Monitoring must never send prompts to Claude Code, call the Claude API, or spawn another LLM agent — zero additional token cost. Single owner-approved exception (v51): the Workspace menu item **Compact…** submits one handoff prompt into an idle agent pane the owner picked; `/compact` and the resume line are typed / prefilled only (docs §11x).

## Planned architecture

```
apps/collector   Node.js + TS. Discovers Claude processes, session files, hook events, terminal titles.
                 Normalizes into shared types, keeps in-memory state, serves WebSocket on 127.0.0.1 only.
apps/web         Vue 3 + TS + Vite + Tailwind + Pinia + vue-i18n + Vue Flow (Cytoscape.js fallback).
packages/shared  Event protocol + TerminalSession / Agent types shared by both apps.
apps/desktop     Electron shell (Windows + macOS): hosts collector in utilityProcess, tray, packaging.
```

Key cross-cutting contracts:

- **Protocol**: on connect the server sends one `snapshot`, then only incremental events (`terminal.created|updated|removed`, `agent.created|updated|removed`, `activity`). Unknown event types/fields are ignored; unknown statuses map to `unknown`.
- **Identity**: terminal/session ID is derived from process/session identity, never from the terminal title (titles change and are a tracked field).
- **Data sources**: prefer official Claude Code hooks/session files over scraping ANSI terminal output; combine with Windows process tree + file watchers only where structured data is missing. Do not guess undocumented formats — inspect the installed version first (Phase 1 deliverable: `docs/claude-code-integration.md`).
- **Frontend stores** (Pinia): `connection`, `terminals`, `agents`, `activity`, `settings`, `ui`. On disconnect keep last state visible and mark it stale; auto-reconnect.
- **Performance**: no high-frequency polling, Agent Map updates nodes incrementally (no full rebuild per event), activity list capped (~200–500), batch event bursts.
- **No database** in MVP.

## Hard rules from the plan

- Never display token counts unless reliable data exists — never invent values.
- Never expose session contents, env vars, secrets, or raw tool arguments to the frontend/logs without sanitizing.
- No horizontal page scrolling: `overflow-x-hidden` at app level, Agent Map pans/zooms inside its own canvas, long paths truncate with tooltips.
- All UI strings via vue-i18n (`en`, `vi`); all colors via theme tokens (dark/light, persisted). Status = icon + text + color, never color alone.
- Colors: follow `.planning/COLOR-SYSTEM.md` (roles + rules): accent fill vs `accent-ink` text, status colours for lifecycle only, `success`/`warning`/`diff-*`/`agent-*`/`favorite` for other meanings, ink ladder not opacity.
- Design system: Apple (macOS HIG), spec in `.planning/AUDIT-v18-deck-reference.md` §4. Default palette Apple (systemBlue accent, neutral greys), light + dark; v25 extra themes (Xcode, GitHub, Solarized, Monokai, Dracula, Material, One Dark, JetBrains Islands) live in `apps/web/src/themes.css` as palette-only blocks, contrast-checked by `lib/themes.test.ts`.
- Font: system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`; mono `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`. These stay the defaults; since v27 users can pick a code font and an interface font (Settings → Text, `lib/fonts.ts`) from open-licence fonts bundled in the app (`fonts.css` + `public/fonts-LICENSES.txt`, generated by `scripts/gen-fonts.mjs`; latin / latin-ext / vietnamese, upright only). Never load fonts from the network.
- Visual style: technical developer tool — dense but calm, no gradients/decoration. Translucent material (blur) only on chrome layers: toolbar, sidebar. Popovers, menus and dialogs are opaque (owner, 2026-10-15: a menu nested in a blurred layer lost its blur and showed the text below). Content surfaces stay opaque.
- Before frontend work, load the skills `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max` (`PLAN.md` calls them `/front-end-design` and `/ui-ux-promax`).

## Code index

Maintain a compact architecture index in `.code_index/` (same convention as the Android/Flutter indexers, adapted to this stack). Read it **before** any code task to find the right files; update it **after** the task.

- `_meta.md` — 1–2 line summary per change with file path + symbol reference, no long changelogs.
- `collector.md` — data sources → normalizers → state store → WebSocket broadcaster.
- `web.md` — WebSocket client → Pinia stores → components (dashboard, session cards, Agent Map, activity).
- `protocol.md` — event types and shared models in `packages/shared`, and which side emits/consumes each.
- `desktop.md` — Electron shell: boot flow, collector host, bridge install, packaging layout.

"Why"/invariant/trade-off notes belong in `.code_index/` or `.planning/`, not in source comments.

## MVP phase order

1. Discovery (inspect Claude Code 2.1.289, write integration doc) → 2. Collector → 3. Frontend foundation → 4. Dashboard (header, metrics, session cards, activity) → 5. Agent Map → 6. Polish → 7. Validation. Do not start large-scale UI before Phase 1 is complete.
