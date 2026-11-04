# PROGRESS 2026-11-04 — soát + chốt Telegram

## Tóm tắt hiện tại

- Xong đợt: review (WP-1/2) → sửa (WP-3a/3b + vòng 1) → soát lại → commit 5 phần → QA trên bản dev với Telegram thật.
- Commit (master, chưa push): `7c76076` · `1491352` · `c98b5f0` · `2580eeb` · `6d34d93` (+ commit QA).
- QA: `docs/qa/telegram-2026-11-04/RESULT.md` — 16/17 ĐẠT, mục `@bot stop` chờ chủ nhân xác nhận câu trả lời của bot.
- Còn mở: WP-1 #12 (diff bỏ file untracked), #15 (glob bí mật người dùng), #16 (lệnh nặng chặn poll), #17 (album); WP-2 handler ngoài Workspace; create/resume cướp focus.
- Chủ nhân nên `/revoke` token bot (đã lộ trong chat).

## Nhật ký

- [x] WP-1 review lõi (opus) — `wp/tg/WP-1-report.md`; soát lại `WP-1-verify.md`
- [x] WP-2 review web (sonnet) — `wp/tg/WP-2-report.md`
- [x] WP-3a sửa lõi (opus) + vòng 1 (pair theo người gửi, keys busy) — desktop 1208, web 1692, collector 393 pass, typecheck sạch (main chạy lại)
- [x] WP-3b sửa UI (sonnet) — test web pass, review main sạch
- [x] main sửa: `pty/host.ts` `deskReplyMs` 600 s cho `telegram_receive`; docs §11an-d; `.code_index/_meta.md`
- [x] Commit 5 phần — hash ở trên
- [x] QA bản dev (main, CDP + chủ nhân nhắn từ Telegram Desktop) — RESULT.md
- [x] 23:26 Handoff mới: `.planning/HANDOFF-2026-11-04-2326.md` (HANDOFF-latest.md cùng nội dung)
