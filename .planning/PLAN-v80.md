# PLAN v80 (2026-11-03): tool MCP cho agent, móc nối, tối ưu, UX
Nguồn: `.planning/IDEAS-2026-11-03.md` (chủ nhân: "đợi xong thì dùng /manager-work-agent làm các phần đề xuất đó").
Commit: KHÔNG (rule global; release 3.0.0 là lần được phép riêng) → message ở `.planning/COMMITS-v80.md`. Build + test: được.
Luật agent: `AGENT-RULES-v80.md`. Brief: `wp80/WP-<n>.md`.

| WP | Nội dung | Model | Vòng |
|---|---|---|---|
| 1 | MCP: tách registry tool trong pty/mcp.ts + notify_owner, open_in_workspace, who_is_editing | opus | 1 |
| 2 | Codex pane nhận MCP orrery (nếu Codex 0.162 hỗ trợ HTTP MCP) | sonnet | 1 |
| 3 | Tối ưu: dialog cấp app mount lazy (defineAsyncComponent) | sonnet | 1 |
| 4 | MCP: run_app / run_status / run_log, device_screenshot | opus | 2 |
| 5 | MCP: preview_layout, list_servers / free_port | opus | 2 |
| 6 | Móc nối: hàng chờ review, History → Tiếp tục, agent xong → Run reload | sonnet | 3 |
| 7 | Móc nối: dự báo hạn mức, thiết bị mặc định theo dự án | sonnet | 3 |
| 8 | Tối ưu: gộp 5 kiểu toast; script đo bundle + khởi động | sonnet | 4 |
| 9 | Tách WorkspaceView.vue / AgentMap.vue (không đổi hành vi) | sonnet | 4 |
| 10 | UX: Ctrl+K chung (session, file, setting, hành động); node map → dòng thời gian tool | sonnet | 5 |
| 11 | QA: build + E2E full + ảnh | sonnet | 6 |

Hot file (main chủ): i18n en.ts / vi.ts, apps/desktop/src/strings.ts (WP ghi "Hot file cần thêm"), App.vue (WP-3 vòng 1, WP-8 vòng 4), docs/*-integration.md (mỗi WP thêm mục riêng, main gộp nếu đụng).
