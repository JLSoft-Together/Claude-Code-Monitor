## WP-3a: Sửa lỗi review lõi Telegram (desktop + shared + collector + chọn pane)

- Mục tiêu: sửa các lỗi trong `.planning/wp/tg/WP-1-report.md` mục **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14** và trong
  `.planning/wp/tg/WP-2-report.md` các mục: **project con lồng nhau** (med), **typeKeys mất im lặng** (low), **race trạng thái phím**
  (low, giải bằng mục 1), **resumeList trùng id + resume kiểm session đang chạy** (low), **all() names rỗng → none/busy** (low),
  **create/resume cướp focus** (low: mở pane mà không activate nếu chủ nhân đang ở tab khác — dùng tuỳ chọn có sẵn của workspace nếu có,
  không thì để nguyên và ghi vào báo cáo).
- Quyết định main (DECISIONS 2026-11-04): MCP `telegram_receive` với `state: 'on'` phải qua **hộp xác nhận native** trên máy (như
  `free_port`), huỷ → lỗi `cancelled`; `off` / `status` không cần xác nhận. `telegram_notify` giữ như cũ.
- Chi tiết mục 1: ActionEntry giữ `since` (statusSince của episode, epoch ms hoặc ISO) + `tool`; `TelegramInbound` `keys` mang `since`
  (+ `tool`); trang so với `session.statusSince` (và tool đang chờ nếu biết), lệch → `state`. Shared parse/validate đủ.
- Chi tiết typeKeys: không được báo `ok` khi phím chưa ghi được. Giữ `typeKeys` tới khi PTY mở (hết hạn ~5 s thì bỏ) hoặc trang trả
  `state`/`unavailable` khi pane chưa kết nối; chọn cách gọn, giải thích trong báo cáo.
- Ngoài phạm vi đợt này (KHÔNG làm): WP-1 mục 12, 15, 16, 17; WP-2 mục install handler ngoài Workspace.
- Phạm vi file: `packages/shared/src/telegram.ts`, `packages/shared/src/mcpDesk.ts`, `apps/desktop/src/telegram/**`,
  `apps/desktop/src/pty/mcpTools/telegram*.ts`, `apps/desktop/src/mcpDesk.ts`, `apps/desktop/src/main.ts` (chỉ phần telegram),
  `apps/desktop/src/strings.ts` (chuỗi confirm), `apps/collector/src/transcript.ts` (+ toast/tracker nếu cần),
  `apps/web/src/composables/useTelegramInbound.ts`, `apps/web/src/stores/workspace.ts` (chỉ hàm telegram*), `apps/web/src/components/workspace/TermPane.vue` (chỉ watch typeKeys),
  test tương ứng trong `apps/desktop/test/telegram*.test.ts`, `apps/collector/test/telegram.test.ts`, `apps/web/src/stores/telegramInbound.test.ts`.
- Cấm đụng: `apps/web/src/components/**` (trừ TermPane watch), `apps/web/src/i18n/**`, `useAppToasts.ts`, `SettingsMenu.vue` — của WP-3b.
- Song song: WP-3b. Model: opus (duyệt quyền từ xa, chỉ-owner).
- Tiêu chí nghiệm thu:
  - [ ] Mỗi mục trên có test tái hiện (fail trước, pass sau) khi logic test được; mục không test được ghi lý do.
  - [ ] Bấm "Cho phép" ở tin cũ sau khi đã có lần xin quyền mới → `state`, không gõ phím (test).
  - [ ] Lượt bị ngắt không có end_turn → episode done không mang reply lượt trước (test collector).
  - [ ] Caption build lỗi luôn là HTML hợp lệ ≤ 1024 (test với detail 5000 ký tự có `&<>`).
  - [ ] `telegram_receive on` qua MCP hiện confirm; huỷ → không bật (test với confirm giả).
  - [ ] `npm run typecheck` (toàn repo) sạch; `npm test -w @ccm/desktop -w @ccm/collector -w @ccm/shared` và test web liên quan pass.
- Lệnh test: `npm test -w @ccm/desktop -- test/telegram` · `npm test -w @ccm/collector -- test/telegram.test.ts` · `npm test -w @ccm/web -- src/stores/telegramInbound.test.ts` · `npm run typecheck`.
- Nhìn thấy được: không
- Báo cáo: `.planning/wp/tg/WP-3a-report.md`

## Nhật ký
- 22:45 · bắt đầu: đọc WP-1/WP-2 report, code liên quan; baseline test desktop telegram 35/35, collector 3/3
- 22:48 · sửa shared (keys since/tool, nested), notifier (mục 1,3,6,7,8,9,10,11,13 + nested), host (4,5), inbound text (14)
- 22:53 · sửa collector transcript (mục 2, signal prompt), mcpDesk confirm telegram_receive on + strings + main confirm dep, web: nested/keysReady/telegramTyped/all/resume; typecheck sạch
- 23:00 · test: thêm desktop/test/telegram-review.test.ts (21), collector telegram.test.ts (+3), web telegramInbound.test.ts (+4); mutation check: 8 lỗi tái hiện fail khi bỏ fix; typecheck + toàn bộ test desktop/collector/web pass
- 23:01 · xong, báo cáo WP-3a-report.md
- 23:08 · vòng 1: sửa regression #10 (đếm theo fromId + trần 50) và #14 (keys busy có panes + câu keysBusy); test 58/58, web 8/8, typecheck sạch
