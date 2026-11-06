## WP-4: QA tích hợp + tài liệu cổng chung
- Mục tiêu: QA thật trên bản dev các đường gọi sau WP-1..3; docs §11ao hoàn chỉnh (bảng action, nguồn, chính sách, tool MCP mới, shim); `.code_index` cập nhật.
- Model: sonnet | Phụ thuộc: WP-1, WP-2, WP-3
- Kịch bản: menu mở Claude (id có ngay, ✈ mở), URL `agent-monitor://open` (dev không đăng ký protocol → gọi IPC tương đương), MCP open_session/list_sessions/send_to_session từ pane Claude thật (gọi /mcp bằng token pane qua curl trong pane), shell gõ `claude` → có tool orrery + id, đóng → mở lại resume; E2E có sẵn: `npm run e2e -w @ccm/desktop` các file liên quan (v49-open, shell-agent, rail) nếu chạy được.
- Bằng chứng: `docs/qa/gateway-2026-11-06/` ảnh + RESULT.md.
- Báo cáo: `.planning/wp/gw/WP-4-report.md`
- Thêm (sau WP-1/2/3/5): hot file docs/index chủ là WP-4: `.code_index/{_meta,desktop,web,protocol}.md`, docs §11ao (kênh `ccm:orrery` thay ccm:pane-open/mcp-call/telegram-inbound; ORRERY_ACTIONS; 3 tool MCP mới + lỗi target/busy, cũng ghi ở §11w; shim + giới hạn `.cmd`; `untouchedSession` resume chỉ sau lượt đầu), `.planning/RELEASE-next.md` thêm dòng en/vi.
- QA thêm: tool MCP list_sessions/send_to_session/close_session gọi thật từ pane (curl `$env:ORRERY_API/mcp` với Bearer `$env:ORRERY_TOKEN` JSON-RPC tools/call trong pane shell; KHÔNG in token ra ảnh/log); pane Claude chưa có lượt đóng → mở lại không `--resume`.
- Bản dev: main/host đã đổi → `cd apps/desktop && node build.mjs`, khởi động lại Electron dev (chỉ kill electron commandline chứa `orrery-qa-tg`; lệnh ở `.planning/HANDOFF-2026-11-06-1144.md` §3). Không đụng app cài, kiểm `diff -q ~/.claude/settings.json C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/claude-settings.backup-2026-11-06.json` trước/sau. E2E có thể cần `CCM_E2E_DBG=9444`.
## Nhật ký
- 14:00 build desktop, restart Electron dev (kill chỉ electron `orrery-qa-tg`); settings.json = backup.
- QA bước 1–11 (menu, URL second-instance, /mcp, curl list/open/send/close, shim, resume trước/sau lượt) ĐẠT; ảnh `docs/qa/gateway-2026-11-06/WP-4/`.
- E2E 9 file (v49-open, v80-mcp, shell-agent, rail, tier2, v50-groups, project-panes, tabs-cwd, links) đạt; v50 dust flake 1 lần rồi pass.
- Docs: §11w (3 tool + lỗi), §11ao (ccm:orrery, ORRERY_ACTIONS, shim, untouchedSession), `.code_index/{_meta,desktop,web,protocol}.md`, RELEASE-next en/vi.
- Dọn: đóng mọi pane thử; dev (5173/4319/9333) còn chạy.
