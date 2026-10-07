# web — apps/web (Vue 3 + Vite + Tailwind v4 + Pinia + vue-i18n + Vue Flow)

Flow: `stores/connection.ts` (WebSocket /ws, seq check, resync, backoff 1→10s) → `apply()` → terminals / agents / activity stores → components.

- Stores: `terminals.ts` (byId, list stable order live→startedAt, patch null=delete), `agents.ts` (byTerminal, mainOf, lineage for highlight), `activity.ts` (newest first, cap 300), `settings.ts` (theme/locale → localStorage `ccm.theme`/`ccm.locale`, html class/lang), `ui.ts` (selectedAgentId, focusTerminal → focusRequest, resetLayout).
- `lib/`: `format.ts` (global `now` 1s clock, relativeTime, duration, compactNumber en-US), `status.ts` (status → glyph + i18n key + literal Tailwind classes), `layout.ts` (`computeLayout` grid-wrapped trees, `treeOrder` DFS by parentId with indent capped at depth 2, `visibleAgents` hide completed/cancelled subagents but keep ancestors of visible ones, `columnsFor(width)`), `patch.ts`.
- Components: `AppHeader` (connection, theme/lang toggles, stale banner) → `MetricsStrip`; `SessionList` → `SessionCard` (click = focus map); `AgentMap` (Vue Flow, hide-finished toggle from `settings.hideFinished`, nodes hold only agentId, incremental add/remove/updateNode, fit on `nodesInitialized`) → `AgentNode` (reads store, lineage dim via inject `ccm-highlight`), `AgentDetails`; `ActivityFeed`; `StatusIcon` (signature: Claude ✳ spinner glyph set).
- Theme tokens: `src/style.css` CSS vars `--ccm-*` (light :root, dark .dark) mapped in `@theme`. Never hex in components.
- i18n: `src/i18n/{en,vi}.ts` (vi typed against en). Activity keys `activity.<kind with _>`; unknown kind → raw kind.
- Index.html inline script sets theme before paint.
- Tests: `src/stores/stores.test.ts` (snapshot/patch/seq gap/activity cap/layout overlap).
Invariants: grid children `min-w-0` + `grid-cols-[minmax(0,1fr)]` (no horizontal scroll); map positions recomputed only on structure change.
