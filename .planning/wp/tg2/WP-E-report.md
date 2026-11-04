## WP-E — DONE
Đã đổi: packages/shared/src/telegram.ts (state `digest`, patch `digest`, sanitizer); apps/desktop/src/telegram/api.ts (`digestHtml`, DIGEST_HEAD); notifier.ts (FileShape/DEFAULTS/readShape/state/set, `digestMsgs`, `digestDone` sau `handle`); TelegramSettings.vue (công tắc `data-telegram-digest`, tab Báo cáo); i18n/telegram-v82.ts (en+vi); test mới apps/desktop/test/telegram-digest.test.ts (7 test).
Tiêu chí 5/5 (test tắt, bật+"done 2 times", permission giữa chừng, ngày mới, edit lỗi, patch/state, typecheck/test).
Audit: diff chỉ trong phạm vi. Review: key = agentOfTerminal ?? terminalId; chatId đổi → tin mới; edit không qua take(); edit không có nút → gửi inline_keyboard rỗng để xoá nút cũ; tin quá 4096 → bỏ reply; map giới hạn 500; tắt digest giữa chừng → lần bật lại cùng ngày vẫn sửa tin cũ (chấp nhận được). Quiet hours/reportedAt/countsFor đi trước nhánh digest nên không đổi.
Test: npm test -w @ccm/desktop -- test/telegram → 110 pass/0 fail; npm test -w @ccm/web → 1700 pass; npm run typecheck → sạch.
Nhìn: CHƯA NHÌN (không chạy app).
Hot file: notifier.ts (file lớn, WP khác cũng sửa — edit của con áp sạch).
Ngoài phạm vi: .code_index/_meta.md và docs §11an-e CHƯA cập nhật (brief nhắc nhưng ngoài danh sách file) — main bổ sung.
Commit: ✨ Telegram: optional digest groups a session's finished reports into one message per day, edited with a counter instead of sending new ones
