# Commit đề xuất v80 (chưa commit — chờ chủ nhân nói "commit")

Các WP chạm chung file (i18n en/vi, shared index, main.ts, host.ts, useMcpCalls, stores/run.ts, run.cjs), nên gom 1 commit là an toàn nhất:

🔌 v80 agent MCP tools and review flow: notify_owner / open_in_workspace / who_is_editing, run_app / run_status / run_log / device_screenshot, preview_layout / list_servers / free_port, Codex gets the Orrery MCP, review queue in Changes, Continue from History, Run auto reload, limit forecast, one Ctrl+K search, sub-agent tool timeline, one toast stack, lazy dialogs, Workspace / Agent Map split

Nếu muốn tách theo WP (mỗi commit `git add` đúng file trong report WP đó; en.ts / vi.ts / shared index / main.ts / e2e chung đi với WP cuối chạm):
1. 🔌 MCP tool registry plus notify_owner, open_in_workspace and who_is_editing (WP-1; pty/mcpTools, mcp.ts, host.ts, shared mcpCall, collector toast note, web useMcpCalls)
2. 🔌 Codex panes get the Orrery MCP server via -c overrides (WP-2; pty/presets.ts)
3. ⚡ Lazy-load recap, diagnostics, resources, shortcuts and update dialogs with idle prefetch (WP-3; lib/lazyOverlay.ts, App.vue, 5 dialogs)
4. ▶️ MCP run_app, run_status, run_log and device_screenshot (WP-4; shared mcpRun, mcpTools/run*, devices/mcpShot.ts, lib/mcpRun.ts)
5. 🖥️ MCP preview_layout, list_servers and free_port with a native confirm (WP-5; mcpDesk.ts, resources/agentPorts.ts, layout/ipc.ts, strings.ts)
6. 🔎 Review queue in Changes, Continue from History, optional Run reload after the agent finishes (WP-6; reviewQueue, runAutoReload, HistoryView, history.ts / monitor.ts)
7. 📈 Limit forecast in the status popover and launch warning, per-project device reselect and Wi-Fi reconnect (WP-7; headerStatus, LaunchPicker, run store)
8. 🔔 One toast stack replacing the break, phone fail and undo toasts, plus scripts/measure.mjs (WP-8; toasts store, ToastHost, useAppToasts)
9. 🧱 Split WorkspaceView and AgentMap into smaller modules (WP-9; workspace/view, map/)
10. ✨ Ctrl+K searches sessions, projects, files and settings with prefixes; sub-agent tool timeline (WP-10; paletteSearch, CommandPalette, AgentDetails, agentTools)
11. ✅ QA: e2e v80-mcp / v80-toasts in run.cjs, v80-shots, free_port strings moved to strings.ts, .code_index v80 (WP-11)

Không add: spikes/, bg_native_ad_cta.xml, git-gui.bat, apps/desktop/test/__snapshots__/fwp-host.test.ts.snap, apps/*/.vitest/, docs/qa/, .planning/HANDOFF-2026-11-01-v76.md (sửa cũ).
docs/perf/ (baseline từ scripts/measure.mjs) nên add cùng WP-8.
