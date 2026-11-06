# COMMITS chờ chủ nhân (đợt cổng chung 2026-11-06)

1. ✨ Workspace: one entry for opening sessions, Claude session id known at launch (GĐ1)
2. ♻️ Workspace/Telegram: one pane action layer for bot commands and context menus
3. ♻️ Orrery API: one action table, a main dispatcher and one ccm:orrery channel for MCP, links and the Telegram bot (WP-1)
4. ✨ Workspace: claude / codex typed in a shell pane get Orrery MCP and a session id, and reopen with --resume (WP-3)
5. ✨ Orrery MCP: list_sessions, send_to_session (prefill only) and close_session for panes the caller opened (WP-2)
6. 🐛 Workspace: resume only sessions that took a turn; layouts and restart keep a hand-typed agent (WP-5)
7. 📝 Orrery API: QA evidence, docs §11w / §11ao, code index and release notes for the unified gateway (WP-4)
8. 🐛 Workspace/MCP: a dialog is not a turn; list_sessions ids and names match the pane (WP-6)

Đề xuất thực tế: các WP chạm chung file (workspace.ts, orreryApi.ts, useSessionActions.ts) nên gom 1 commit:
✨ Orrery API: one gateway for menus, links, the Telegram bot and agent MCP tools; shell-typed agents and session ids
