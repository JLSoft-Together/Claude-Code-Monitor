## WP-A: lệnh gửi lúc app tắt + 2 bản dùng chung bot
- Mục tiêu:
  1. Hiện `pollLoop` (`apps/desktop/src/telegram/notifier.ts`) lần đầu gọi `getUpdates offset:-1` rồi bắt đầu từ update mới nhất → mọi tin gửi lúc app tắt bị bỏ. Sửa: lần đầu lấy các update đang chờ (Telegram giữ 24 h); tin của chủ nhân có lệnh hợp lệ (qua `commandOf`) gửi trong **60 phút** gần nhất (`message.date`) thì KHÔNG chạy ngay mà gom lại; nếu có ≥ 1 → gửi 1 tin vào từng topic có lệnh: "Có N lệnh gửi lúc Orrery tắt:" + danh sách ngắn (đã che bí mật, cắt ~80 ký tự/dòng) + nút `▶️ Chạy hết` / `🗑 Bỏ qua` (kind mới trong `actions.ts`, ACTION_RE). Bấm chạy → xử lý lần lượt như tin mới (`onMessage`). Tin cũ hơn 60 phút, callback cũ, tin người lạ → bỏ, không trả lời người lạ. Ghép mã (`pair`) cũ → bỏ.
  2. Khi `getUpdates` trả `conflict` (409, bot đang được poll ở nơi khác): đặt `lastError = 'conflict'` (đã có), thêm state `pollConflict: true` hiện trong Settings › Telegram (tab Kết nối/overview, `TelegramSettings.vue`) câu rõ: "Bot đang được một bản Orrery khác (hoặc chương trình khác) nhận lệnh. Tắt bên kia hoặc tắt Nhận lệnh ở đây." + nút "Thử lại". Sau **3 lần conflict liên tiếp** thì dừng vòng poll ở bản này (receiving giữ nguyên trong file, nhưng `pollRun=0`), không spam log; nút Thử lại gọi `syncPoll` lại. Hết conflict → xoá cờ.
- Phạm vi file: `apps/desktop/src/telegram/{notifier,actions,inbound,api}.ts`, `packages/shared/src/telegram.ts` (TelegramState thêm field), `apps/desktop/src/telegram/ipc.ts` + `apps/desktop/src/preload.ts` + `apps/web/src/lib/telegram.ts` + `apps/web/src/stores/telegram.ts` (chỉ nếu cần IPC "thử lại"), `apps/web/src/components/TelegramSettings.vue`, `apps/web/src/i18n/telegram-v82.ts`, test `apps/desktop/test/telegram-*.test.ts`. Cấm đụng file khác.
- Skill: đọc `.code_index/_meta.md` (dòng 2026-11-05) + `docs/claude-code-integration.md` §11an–§11an-e.
- Tiêu chí nghiệm thu:
  - [ ] Test: update chờ của chủ nhân 10 phút trước khi khởi động → không gửi vào session, bot gửi tin hỏi kèm 2 nút; bấm ▶️ → `askPage` nhận đúng lệnh theo thứ tự; bấm 🗑 → không gì chạy.
  - [ ] Test: update 2 giờ trước → bỏ, không hỏi.
  - [ ] Test: 3 lần `getUpdates` 409 → `state().pollConflict === true`, vòng poll dừng; gọi thử lại → poll chạy lại; poll ok → cờ về false.
  - [ ] Text en + vi; HTML escape; secret che bằng masker có sẵn.
  - [ ] `npm run typecheck` sạch; `npm test -w @ccm/desktop -- test/telegram` + `npm test -w @ccm/web` pass.
- Lệnh test: như trên.
- Nhìn thấy được: có (dòng cảnh báo trong Settings) — subagent không chạy app → ghi CHƯA NHÌN; main kiểm trên bản dev.
- Báo cáo: `.planning/wp/tg2/WP-A-report.md`
