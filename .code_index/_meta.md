# _meta

- 2026-10-07 Phase 1 discovery → `docs/claude-code-integration.md`.
- 2026-10-07 Phase 2 collector: `apps/collector/src/*` (Monitor, SessionTracker, MonitorStore, server) + `packages/shared/src/{types,status}.ts`; npm workspaces (pnpm absent).
- 2026-10-07 Phase 3–5 web: `apps/web/src/*` (stores, AgentMap/layout, SessionCard, ActivityFeed, i18n en/vi, theme tokens `style.css`).
- 2026-10-07 Phase 6–7: stable session order (`stores/terminals.ts`), wrapped map layout (`lib/layout.ts`), `scripts/demo-fixture.mjs` load generator; validated reconnect, real subagent, CPU 0–0.2%.
- 2026-10-07 Nested subagents: `parentAgentId` → `parentId` (`apps/collector/src/tracker.ts` `recordLinks`, `buildAgents`); tree layout `treeOrder` + hide-finished filter `visibleAgents` (`apps/web/src/lib/layout.ts`), toggle in `AgentMap.vue`, `settings.hideFinished` (`ccm.hideFinished`).
