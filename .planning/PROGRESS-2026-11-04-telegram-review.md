# PROGRESS 2026-11-04 — soát + chốt Telegram

## Tóm tắt hiện tại

- Plan: `.planning/PLAN-2026-11-04-telegram-review.md`, brief ở `.planning/wp/tg/`. Commit từng phần (cả phiên), `master`, không push.
- Review xong: WP-1 (opus) 1 high / 6 med / 10 low · WP-2 (sonnet) 0 high / 2 med / 11 low.
- Đang: WP-3a (opus, lõi) + WP-3b (sonnet, UI) sửa song song.
- QA: bản dev chạy ở cổng 4319 / CDP 9333 (`%TEMP%\orrery-qa-tg`), token đã lưu (`@PoorDog_JinVu_Bot`); quét group trả rỗng → chờ chủ nhân tag bot trong topic. Telegram Web tab chưa đăng nhập.
- Quyết định mới: `.planning/DECISIONS.md` 2026-11-04 (confirm native cho `telegram_receive on`; quyền tự test).

## Nhật ký

- [x] WP-1 review lõi — báo cáo `wp/tg/WP-1-report.md`, test 35/35 pass
- [x] WP-2 review web — báo cáo `wp/tg/WP-2-report.md`, test 11/11 pass
- [~] WP-3a giao opus, chạy nền (mục WP-1 1–11,13,14 + WP-2 lồng project / typeKeys / resume / all)
- [x] WP-3b UI fix — TelegramToggle / SettingsMenu / useAppToasts / TelegramSettings / i18n + stores/telegram.test.ts, test web 1688 pass, typecheck web sạch, review main (stat + grep comment) sạch; CHƯA NHÌN → QA bản dev; commit gộp vùng web sau WP-3a
- Hoãn (ghi lại cho đợt sau): WP-1 mục 12 (diff file untracked), 15 (glob bí mật của người dùng), 16 (việc nặng chặn poll), 17 (album ảnh); WP-2 cài handler ngoài Workspace.
