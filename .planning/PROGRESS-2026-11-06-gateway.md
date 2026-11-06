# PROGRESS — Orrery cổng gọi chung GĐ2→GĐ4 (2026-11-06)

## Tóm tắt hiện tại
- Plan: `.planning/PLAN-2026-11-06-unified-gateway.md`; brief `.planning/wp/gw/WP-1..4.md`.
- Commit: chủ nhân chưa nói → KHÔNG commit, gom message vào `.planning/COMMITS.md`, chờ "commit". Build/E2E được (memory build-test-after-code).
- ĐỢT XONG: WP-1..6 đạt, CHƯA commit (47 file sửa + file mới), message ở `.planning/COMMITS-gateway.md`.
- Nền chưa commit: GĐ1 (openSession, mint id) + GĐ Telegram+Workspace (useSessionActions, paneActions).
- Hot file: `packages/shared/src/orreryApi.ts` + `index.ts` (WP-1 chủ, WP-2 sau), `packages/shared/src/pty.ts` (WP-3), `stores/workspace.ts` (WP-3; WP-1 chỉ export nhỏ), i18n (WP-3).

## Phiên 2026-11-06 14:xx
- [x] WP-1 dispatcher + ccm:orrery — opus; `apps/desktop/src/orreryApi.ts`, `useOrreryApi.ts`, `ORRERY_ACTIONS` 23 action; typecheck sạch, web 1729, desktop 1299 (agent báo). (main sửa: App.vue `session.open` bỏ id khi nguồn ≠ mcp → pane mở từ link cũng mint session id)
- [x] WP-3 shim claude/codex cho Shell — opus; `pty/shim.ts`, `reopenAs`, `settings.agentShim`; typecheck sạch, desktop 1299, web 1732, e2e shell-agent 5/5; ảnh `docs/qa/gateway-2026-11-06/WP-3/` (main xem 03 OK). Phát hiện: resume session chưa có lượt chat → "No conversation found" → WP-5.
- [x] WP-5 resume chỉ khi session đã có lượt (`untouchedSession`, status working/waiting), layouts + restart giữ agent gõ tay — sonnet. Main chạy lại toàn bộ: typecheck 0 lỗi, web 1742, desktop 1312, collector 398+1 skip.
- [x] WP-4 QA dev + E2E + docs/index — sonnet; RESULT `docs/qa/gateway-2026-11-06/RESULT.md`; E2E v49-open 33, v80-mcp 23, shell-agent 5, rail 37, tier2 25, project-panes 23, tabs-cwd 17, links 22, v50-groups 31 (1 fail đo thời gian dust 73ms lúc máy tải, chạy lại pass). CHƯA KIỂM: codex/POSIX shim, Telegram new/resume thật, busy/rate tool mới. Lỗi tìm thấy 3 → WP-6.
- [x] WP-6 sửa 3 lỗi QA (chỉ `working` mới là lượt chat; list_sessions thêm agentSessionId; tên khớp rail) — sonnet. Main chạy lại: typecheck 0 lỗi, web 1744, desktop 1312.
- [x] WP-2 tool MCP list_sessions / send_to_session (chỉ điền sẵn) / close_session (chỉ pane do mình mở, có confirm + undo) — sonnet; `pty/mcpTools/sessions.ts`; bảng↔MCP_TOOLS kiểm bằng test (không codegen); desktop 1312, web 1740 (agent báo, main chạy lại sau WP-5)
- [ ] WP-4 QA + docs — sonnet, chờ WP-1..3
- [x] 14:25 Handoff mới: .planning/HANDOFF-2026-11-06-1425.md
