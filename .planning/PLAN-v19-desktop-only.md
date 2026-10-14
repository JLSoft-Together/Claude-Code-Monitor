# v19 — Bỏ chế độ trình duyệt (desktop only)

Chủ nhân chốt 2026-10-14: chỉ dùng app desktop. Lý do kỹ thuật: collector chạy riêng (.bat / npm start) giữ cổng 4317 → app mượn cổng → khoá terminal; trang mở được từ mọi trình duyệt local là bề mặt tấn công thừa khi trang có shell.

## Làm

1. **Khoá collector cho app**: desktop sinh `CCM_APP_KEY` (32 byte ngẫu nhiên / lần chạy) → collector. Mọi HTTP (trừ `/health`) và WS upgrade phải có header `x-ccm-app` khớp (so sánh constant-time) → không thì 403. Electron gắn header qua `session.webRequest.onBeforeSendHeaders` (page JS không đọc được).
   Collector chạy không có key → thoát, trừ `--dev` (`npm run dev`, chỉ để làm UI với Vite).
2. **Desktop**: bỏ "mượn collector" (`external`, `watchExternal`, `onTakeover`, `e2e/takeover.cjs`); cổng bận → màn lỗi port-in-use. Bỏ mục tray "Mở trong trình duyệt".
3. **Toast Windows**: nút/click toast trước mở trình duyệt `http://127.0.0.1:4317/focus?...`. Đổi sang protocol `agent-monitor://focus|snooze?...` (app đăng ký khi đã đóng gói) → main: hỏi trang có pane của session đó không (có → hiện app, nhảy tới pane) → không thì POST `/focus` (đưa terminal ngoài lên) → thất bại thì hiện app + chọn session. Bỏ route GET `/focus` + `focusPage`.
4. **Web**: bỏ PWA (manifest, đăng ký SW); `sw.js` thành kill-switch (xoá cache, tự gỡ) cho profile đã cài SW cũ.
5. **Xoá**: `Agent-Monitor.bat`, `Claude-Code-Monitor.bat`, `scripts/launch.mjs`, script `start` / `launch` (root + collector start). Sửa README, CLAUDE.md, docs, `.code_index`.

## Giữ

- `npm run dev` (collector `--dev` + Vite 5173) cho phát triển UI.
- Guard `hasTerminals` trong web (Vite dev chạy trong trình duyệt).
- Linux: không còn cách chạy cho người dùng (chưa có bản desktop Linux).
