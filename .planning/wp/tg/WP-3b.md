## WP-3b: Sửa lỗi review giao diện Telegram + Settings resize

- Mục tiêu: sửa các mục trong `.planning/wp/tg/WP-2-report.md`:
  1. `TelegramToggle.vue` bỏ qua lỗi `toggle()` → báo lỗi (toast qua `stores/toasts`, chuỗi `telegram.setError.*` có sẵn).
  2. `SettingsMenu.vue` resize: đóng dialog giữa lúc kéo → `resizing` kẹt / không lưu (dùng `lostpointercapture` hoặc dọn khi đóng);
     handle đè thanh cuộn, `pointerdown.prevent` chặn focus chuột.
  3. `useAppToasts.ts`: toast `telegram-fail` tự đóng khi state mới không còn `lastError`.
  4. `TelegramSettings.vue`: "Xoá token" cần xác nhận (inline confirm 2 bước trong UI, không dùng `window.confirm`); xoá `token` ref khi
     Settings đóng.
- Phạm vi file: `apps/web/src/components/TelegramToggle.vue`, `TelegramSettings.vue`, `SettingsMenu.vue`, `lib/dialogSize.ts`,
  `composables/useAppToasts.ts`, `stores/telegram.ts`, `lib/telegram.ts`, `i18n/telegram-v82.ts`, `i18n/ui-v79-settings.ts`, test liên quan.
- Cấm đụng: `useTelegramInbound.ts`, `stores/workspace.ts`, `TermPane.vue`, mọi file ngoài `apps/web` — của WP-3a.
- Song song: WP-3a. Model: sonnet.
- Rule repo: i18n en+vi, theme token, motion khi đổi trạng thái, không comment, a11y, perf (không timer khi ẩn).
- Tiêu chí nghiệm thu:
  - [ ] 4 mục trên sửa xong; mục logic có test (dialogSize / store).
  - [ ] `npm run typecheck -w @ccm/web` sạch (lỗi do file WP-3a đang sửa thì ghi rõ); `npm test -w @ccm/web` pass.
- Lệnh test: `npm test -w @ccm/web` · `npm run typecheck -w @ccm/web`.
- Nhìn thấy được: có — CHƯA NHÌN được cũng được (main QA bằng app dev sau).
- Báo cáo: `.planning/wp/tg/WP-3b-report.md`

## Nhật ký
- 1 TelegramToggle toast loi; 2 SettingsMenu resize (endResize, lostpointercapture, focus, handle nho hon + mb); 3 useAppToasts remove khi het lastError; 4 TelegramSettings confirm 2 buoc + xoa token khi dong; i18n clearAsk/Yes/No; test stores/telegram.test.ts
