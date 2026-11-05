# PLAN 2026-11-05 — Telegram topic map + session link lifecycle

Owner asks (2026-11-05): session ends → topic unlinks; `/clear` (new id in same pane) also unlinks by default; do all 9 UX ideas.

Done earlier today: `dropEnded`, `agentLive`, Session ↔ Topic group.

1. Topic map: Settings › Telegram › Kết nối lists one block per topic with what it routes to (project / session), replaces the two separate lists.
2. Session row: topic dropdown to move it (shared `TelegramSessionRouteInput` takes `chatId` / `threadId` as well as `link`).
3. Session row: send test (`test(project, session?)`).
4. `@bot where` in a topic: what the topic is linked to + open state; buttons Disconnect / Link another.
5. Auto unlink posts one silent line in the topic: ended (↩️ Resume, 🔗 Link) or `/clear` (🔗 Link new session).
6. Per session link `keep`: link survives end, follows `/clear` / resume (old behaviour).
7. Workspace tab / rail glyph: tooltip names the topic, click opens the link dialog.
8. Broken link: send fails with thread / chat gone or no rights → route `broken` (persisted, cleared on next ok send / relink); row shows warning + fix.
9. "Disconnect all closed sessions" button.
