# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

MVP phases 1–7 implemented. `PLAN.md` is the **source of truth** for scope; `docs/claude-code-integration.md` documents the verified Claude Code data sources, `docs/codex-integration.md` the Codex CLI ones (v16 scope extension, `.planning/PLAN-v16-codex.md`).

## Commands

npm workspaces (pnpm not installed on this machine). From repo root:

- `npm install` — install all workspaces
- `npm run dev` — UI work only: collector `--dev` (`127.0.0.1:4317`, no app key, no terminals) + Vite web (`127.0.0.1:5173`, proxies `/ws`)
- `npm test` — Vitest in all workspaces; single file: `npm test -w @ccm/collector -- test/monitor.test.ts`
- `npm run typecheck`
- `npm run desktop` — build web, then run the Electron app from `apps/desktop/stage` (dev)
- `npm run dist:win` — build web + desktop → `apps/desktop/release/` (NSIS Setup + Portable exe)
- `npm run dist:mac` — same → `.dmg` arm64 + x64; **macOS only** (or GitHub Actions workflow `desktop`)
- `npm run e2e -w @ccm/desktop [exe]` — CDP E2E against the dev build (or a packaged exe); build web + desktop first
- `node scripts/demo-fixture.mjs --sessions=5 --subagents=3` — fake Claude root for load/UI testing; run the app (or `npm run dev`) with `CLAUDE_CONFIG_DIR=<printed root> CCM_VERIFY_PROCESSES=0`

Desktop only since v2.0.0 (`.planning/PLAN-v19-desktop-only.md`): the collector exits unless started by the app (`CCM_APP_KEY`, required as header `x-ccm-app` on every request but `/health`) or with `--dev`. Collector env: `CCM_APP_KEY`, `CCM_TOAST_LINK` (`agent-monitor://`, set by the app on Windows), `CLAUDE_CONFIG_DIR`, `CODEX_HOME` (`~/.codex`), `CCM_CODEX=0` (tắt Codex), `CCM_PORT`, `CCM_STALE_TTL_MIN` (120), `CCM_WEB_DIST`, `CCM_VERIFY_PROCESSES=0`, `CCM_TOAST=0` (tắt toast / alert), `CCM_TOAST_BACKEND=electron` (desktop macOS: alert → dock badge/bounce), `CCM_DATA_DIR` (`%LOCALAPPDATA%/ccm`, macOS `~/Library/Application Support/ccm`: usage cache + aliases).

Deviations from `PLAN.md` are allowed only when a discovered Claude Code limitation forces them, and must be documented in `docs/claude-code-integration.md`.

## What this is

**Agent Monitor** (renamed from Claude Code Monitor on 2026-10-11; repo folder, npm package names `@ccm/*`, `appId` `dev.ccm.monitor`, data dir `ccm`, `CCM_*` env and `ccm.*` storage keys keep the old prefix on purpose so installs update in place). A local-only desktop app (Windows exe, macOS `.dmg`; no browser mode since v2.0.0) that observes running Claude Code CLI sessions (target version **2.1.289**) — plus Codex CLI runs (**0.162.0**), shown under the Claude agent that launched them — across multiple terminals and shows sessions, terminal titles, and the main-agent → sub-agent hierarchy in realtime.

Core principle: **Observe → Normalize → Broadcast → Render**. Monitoring must never send prompts to Claude Code, call the Claude API, or spawn another LLM agent — zero additional token cost.

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
- Design system: Apple (macOS HIG), spec in `.planning/AUDIT-v18-deck-reference.md` §4. One palette (systemBlue accent, neutral greys), light + dark.
- Font: system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`; mono `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`. No web fonts.
- Visual style: technical developer tool — dense but calm, no gradients/decoration. Translucent material (blur) only on chrome layers: toolbar, sidebar, popovers/menus. Content surfaces stay opaque.
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
