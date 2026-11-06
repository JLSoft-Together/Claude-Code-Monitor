# HANDOFF — Orrery: 8 cải tiến Telegram (2026-11-06 16:45)

Đọc file này là làm tiếp được. Tiếng Việt, gọi user "chủ nhân", xưng "con"; chủ nhân nhắn qua Telegram → báo bằng MCP `telegram_send`.
Thay `HANDOFF-2026-11-06-1425.md`. Nhật ký + Bảng WP: `.planning/PROGRESS-2026-11-06-telegram-8.md`.

## 1. Đang ở đâu
- `master`, HEAD `24142ee` (cổng chung đã commit). Đợt 8 cải tiến Telegram: **5/5 WP ĐẠT, CHƯA commit** — chủ nhân chọn "gom 1 commit cuối". Message: `.planning/COMMITS-telegram-8.md`.
- Kiểm cuối (chạy thật): typecheck 0 lỗi; web 1761/1761; desktop 1358/1358; collector 401+1 skip (T3). E2E (T5) rail 37, tier2 28, v49-open 33, v80-mcp 23, links 22, shell-agent 5, project-panes 23, tabs-cwd 17, v50-groups 32 — 0 fail.
- QA thật: ảnh từ Telegram → khay → Claude thật nhận `[Image #1]` + caption và trả lời (T5). Phần cần bot thật CHƯA KIỂM: nút Esc/tail, /compact /close /focus, /new picker, ghim theo topic, 429, hạn mức, mở topic supergroup → 11 kịch bản thử tay trong `docs/qa/telegram8-2026-11-06/RESULT.md`.
- Đang chạy: bản dev QA (Vite 5173, Electron 4319/CDP 9333, data `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg`). Hook toàn cục không đổi.

## 2. Đã làm (chi tiết: `.planning/wp/tg8/T*-report.md`, `T2-review.md`, docs §11an-j)
- T1 glyph ✈ tab/rail bấm mở topic + mục menu. T2 nút Esc/tail, lệnh /compact /close(owner) /focus có xác nhận TTL 5', /new picker ở General (review opus 6 điểm đã sửa).
- T3 ghim 1 tin/topic, topicHealth (lastSentAt/lastError), hàng đợi 429, limitAlert (dự báo + chạm thật) vào topic project đang chạy. T4 ảnh → khay đính kèm Claude (clipboard hệ thống), album 1 lượt. T5 QA + docs + index + RELEASE-next.

## 3. Việc tiếp
1. Chủ nhân "commit" → `git add` file trong `git status` trừ §4, message `.planning/COMMITS-telegram-8.md`, không trailer.
2. Chủ nhân thử tay theo RESULT.md trên app cài (cần build/cài bản mới hoặc release) → lỗi nào giao WP sửa.
3. "tắt dev" / release khi chủ nhân đặt version (`.planning/RELEASE-next.md`).

## 4. Ràng buộc
- Không tự commit/push; không trailer. Đừng đụng `bg_native_ad_cta.xml`, `git-gui.bat`, `spikes/`, `docs/qa/v79|v80/`, `apps/*/.vitest/`.
- Đã chốt: topic tự tạo, 1 project = 1 topic; tài khoản Telegram chỉ để quét; bot `/new` tự gửi prompt, MCP/link chỉ điền sẵn; close từ Telegram chỉ owner + xác nhận.
- Bản dev không bật nhận lệnh (tranh poll với app cài). Vite giữ module cũ khi file sửa dở → touch file + reload.
