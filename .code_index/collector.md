# collector — apps/collector

Flow: registry dir + projects dir (fs.watch) + reconcile 5s → Monitor → SessionTracker → MonitorStore (diff/batch) → server (ws /ws, static web dist).

- `config.ts` `loadConfig`: CLAUDE_CONFIG_DIR, CCM_PORT (4317), CCM_STALE_TTL_MIN (120), CCM_WEB_DIST, CCM_VERIFY_PROCESSES.
- `registry.ts` `readRegistry`: canonical `<pid>.json` only, whitelisted fields (never socket path / .key), 256KB cap, torn-record retry → `'unreadable'` keeps previous state.
- `process.ts` `isPidAlive`, `queryProcesses` (1 batched PowerShell CIM call: creation FILETIME + parent name), `procStartMatches` (±1ms).
- `tailer.ts` `JsonlTailer`: byte-offset tail, buffer remainder (partial line/utf8), reset on truncate.
- `transcript.ts` `extractSignals` (tool_use/result, usage, model, task-notification tags only, turn_end, end_turn) + `TranscriptState` (open tools, usage map, lastAt).
- `tracker.ts` `SessionTracker`: per terminal (`terminalIdOf` = pid:procStart). Finds transcript (slug guess then scan), discovers `subagents/*.meta.json` (flat dir, nested via `parentAgentId`), `recordLinks` collects Agent tool_use / notifications from main + all subagent transcripts, resolves subagent status after all reads (notification > foreground tool_result > end_turn), `buildTerminal`, `buildAgents`, activity drafts (suppressed in catch-up).
- `monitor.ts` `Monitor`: reconcile (new → verify procStart → catch-up sync; changed → rename/waiting/clear activity; missing/dead → stale; TTL → remove), `verifyLive` 60s, watchers route by sessionId (debounce 150ms).
- `store.ts` `MonitorStore`: maps + activity ring (300), diff → patch, batch flush, seq.
- `server.ts` `startServer`: 127.0.0.1, Host+Origin must be local (anti DNS-rebinding/cross-site WS), `/health`, `/ws`, static SPA fallback.
- Tests: `test/units.test.ts`, `test/monitor.test.ts` (fixture claude root, fake deps).
