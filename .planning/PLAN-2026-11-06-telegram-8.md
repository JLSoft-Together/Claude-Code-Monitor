# PLAN — 8 cải tiến Telegram (2026-11-06)

Chủ nhân: "làm 1 → 8 dùng /manager-work-agent". Commit: **gom 1 commit cuối** (dừng trước git, chờ chủ nhân). Build/E2E được (memory build-test-after-code).
Ràng buộc đã chốt: topic chủ nhân tự tạo, 1 project = 1 topic; tài khoản Telegram chỉ để quét; mọi tin do bot gửi; bot `/new` tự gửi prompt.
Khảo sát (haiku, 2026-11-06): ghim theo session đã có (`pinTick` notifier.ts:1379, setting `pinStatus` mặc định tắt); nút ap/dn chỉ cho permission, `waiting` không có nút;
glyph Send ở RailRow.vue:190 + WorkspaceView.vue:1470; health chỉ có global + cờ `broken`; 429 `retry_after` không được dùng; ảnh từ Telegram chỉ thành đường dẫn trong prompt (actions.ts:197);
cảnh báo hạn mức (forecast) gửi General mọi chat (notifier.ts:1313, broadcastGeneral).

| # | Tính năng | WP |
|---|---|---|
| 1 | Ghim **1 tin trạng thái / topic** (gộp mọi session của project), sửa tại chỗ, có throttle | T3 |
| 2 | Nút dưới tin chờ/hỏi/permission: Đồng ý · Từ chối · Esc · 20 dòng cuối | T2 |
| 3 | Glyph ✈ trên tab/rail: bấm mở topic trong Telegram; menu "Mở topic trong Telegram" | T1 |
| 4 | Sức khoẻ từng topic: lần gửi cuối, lỗi gần nhất (text), trên cây Topic; tôn trọng 429 `retry_after` | T3 |
| 5 | Lệnh bot `/compact` `/close` `/focus` qua cổng chung (close/compact có nút xác nhận) | T2 |
| 6 | `/new` ở General hoặc topic nhiều project → bàn phím chọn project | T2 |
| 7 | Ảnh/file ảnh từ điện thoại → đính kèm ảnh vào ô nhập pane (như dán ảnh), chú thích thành prompt | T4 |
| 8 | Cảnh báo hạn mức (dự báo + chạm thật) gửi vào topic của project đang chạy (General nếu không có), 1 lần/kỳ reset | T3 |

Sóng: A = T1 ∥ T2 · B = T3 · C = T4 · D = T5 QA + docs.
Hot file: `apps/desktop/src/telegram/notifier.ts`, `actions.ts`, `inbound.ts` (T2 → T3 → T4 tuần tự); `packages/shared/src/telegram.ts`, `orreryApi.ts` (T2 → T3 → T4);
web i18n `apps/web/src/i18n/telegram-v82.ts` (T1 sóng A, T3 sóng B); `TelegramSettings.vue` (T3); `useTelegramInbound.ts`/`useSessionActions.ts` (T2 → T4).
Docs `docs/claude-code-integration.md` §11an + `.code_index` + `RELEASE-next.md`: T5.
