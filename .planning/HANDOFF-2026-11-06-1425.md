# HANDOFF — Orrery cổng gọi chung (2026-11-06 14:25)

Đọc file này là làm tiếp được. Tiếng Việt, gọi user "chủ nhân", xưng "con"; chủ nhân nhắn qua Telegram → báo bằng MCP `telegram_send`.
Thay `HANDOFF-2026-11-06-1144.md`. Nhật ký: `.planning/PROGRESS-2026-11-06-gateway.md` (+ `PROGRESS-2026-11-06-telegram-ux.md` phần trước).

## 1. Đang ở đâu
- `F:/work/web/Claude-Code-Monitor`, branch `master`. Đã commit: `495d3ee` (Telegram UX), `d2c17e4` (viền focus pane chia đôi).
- **CHƯA commit**: GĐ1 + Telegram/Workspace + WP-1..6 cổng chung (47 file sửa + file mới, xem `git status`). Message đề xuất: `.planning/COMMITS-gateway.md` (gợi ý gom 1 commit vì nhiều WP chạm chung file).
- Kiểm cuối (14:2x, chạy thật): typecheck 0 lỗi; web 1744/1744; desktop 1312/1312; collector 398 + 1 skip. E2E (WP-4): v49-open 33, v80-mcp 23, shell-agent 5, rail 37, tier2 25, project-panes 23, tabs-cwd 17, links 22, v50-groups 31 (1 fail đo thời gian khi máy tải, chạy lại pass).
- Đang chạy: bản dev QA (Vite 5173 `CCM_PORT=4319`, Electron collector 4319, CDP 9333, data `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg`) do WP-4 dựng lại. Hook toàn cục không đổi (backup `.../orrery-qa-tg/claude-settings.backup-2026-11-06.json`).
- Bị chặn: không. Chờ chủ nhân "commit".

## 2. Đã làm (chi tiết: plan + `.planning/wp/gw/WP-*-report.md`, docs §11w/§11ao, `.code_index/_meta.md` dòng 2026-11-06)
- GĐ1: `workspace.openSession` + `OPEN_POLICY` (`packages/shared/src/orreryApi.ts`), mint `--session-id` cho mọi pane claude (`mintedSession`).
- Telegram+Workspace: `composables/useSessionActions.ts` (resolveTarget…), `lib/paneActions.ts` + `usePaneActions.ts` (menu tab/rail/group chung).
- WP-1: `ORRERY_ACTIONS`, dispatcher main `apps/desktop/src/orreryApi.ts`, 1 kênh `ccm:orrery`, executor `useOrreryApi.ts`.
- WP-2: tool MCP `list_sessions`, `send_to_session` (chỉ điền sẵn), `close_session` (chỉ pane mình mở, confirm + undo) — `pty/mcpTools/sessions.ts`.
- WP-3: shim `claude`/`codex` cho pane Shell (`pty/shim.ts`, công tắc Settings `agentShim`, `reopenAs`).
- WP-5/6: chỉ resume session đã có lượt (`untouchedSession`, chỉ status `working`), layouts/restart giữ agent gõ tay; list_sessions có `agentSessionId`, tên khớp rail.

## 3. Việc tiếp
1. Chủ nhân "commit" → `git add` file trong `git status` trừ danh sách cấm (§4), message theo `COMMITS-gateway.md`, KHÔNG trailer.
2. CHƯA KIỂM (RESULT.md): shim codex + POSIX, Telegram new/resume thật qua `ccm:orrery` (cần bật nhận lệnh — bản dev không được bật vì tranh poll với app cài), lỗi busy/rate tool mới.
3. Tồn: `pty/host.ts` vẫn gửi `t: open|mcp|mcp-desk` (supervisor map sang action) — có thể cho host gửi thẳng tên action; `close_session` qua MCP không chạy hiệu ứng dust; restart pane agent (không phải shell) vẫn dùng `pane.resume` gốc.
4. "tắt dev": kill electron commandline chứa `orrery-qa-tg` + dừng Vite 5173; kiểm hook.
5. Release khi chủ nhân đặt version: `.planning/RELEASE-next.md`.

## 4. Ràng buộc
- Không tự commit/push; không trailer. Đừng đụng `bg_native_ad_cta.xml`, `git-gui.bat`, `spikes/`, `docs/qa/v79|v80/`, `apps/*/.vitest/`.
- Chủ nhân đã chốt: API = 1 cổng cho mọi nguồn kể cả agent Claude/Codex; bot `/new` tự gửi prompt, MCP/link chỉ điền sẵn; tối đa 16 pane cho bot/MCP/link, không chặn menu; topic Telegram tự tạo, 1 project = 1 topic; tài khoản Telegram chỉ để quét.
- Quirk: Vite giữ module cũ khi agent sửa dở → tải lại trang; E2E cần `CCM_E2E_DBG=9444` khi bản dev giữ 9333; `rtk grep` có lúc hỏng → tool Grep / `rtk proxy grep`.

## 5. Đọc lại
`.planning/PLAN-2026-11-06-unified-gateway.md` → `.planning/PROGRESS-2026-11-06-gateway.md` → `docs/qa/gateway-2026-11-06/RESULT.md` → docs §11ao.
