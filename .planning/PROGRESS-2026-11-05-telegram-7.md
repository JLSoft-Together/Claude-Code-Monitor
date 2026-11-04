# PROGRESS — Telegram 7 gợi ý (2026-11-05)

Plan: `.planning/PLAN-2026-11-05-telegram-7.md`. Brief: `.planning/wp/tg2/`. Mới nhất ở cuối.
Trước đó: `PROGRESS-2026-11-05-telegram.md`.

## Tóm tắt hiện tại
- Commit từng gói, không push. Build để QA trên bản dev (4319) do main làm.
- WP chạy tuần tự A → B → C → D → E (cùng chạm notifier.ts).

## Phiên 2026-11-05 02:30 (manager-work-agent) — chủ nhân: "làm cả 7 cái"
- [~] WP-A giao sonnet; khảo sát nguồn câu hỏi AskUserQuestion cho WP-C giao haiku.
- [x] Khảo sát AskUserQuestion (haiku): app chưa có options; hướng: đọc tool_use từ transcript, chỉ nhãn, chỉ đi Telegram → brief `wp/tg2/WP-C.md`.
- [x] WP-A backlog + conflict — notifier/actions/inbound/TelegramSettings, test desktop telegram 73/73, web 1693/1693, typecheck sạch (main sửa: lưu `lastUpdate` để lô cuối trước khi tắt không bị hỏi lại, reset khi đổi token, +1 test). Banner CHƯA NHÌN. aaa8d3d
- [~] WP-B giao sonnet.
- [x] WP-B menu "/" + tail — inbound/notifier/useTelegramInbound/paneSnapshots, desktop telegram 86/86, web 1697/1697, typecheck sạch (main sửa: nhận `/lệnh` trần nếu thuộc menu, +1 test). 7c85274
- [~] WP-C giao sonnet.
- [x] WP-C câu hỏi thành nút — collector askOf/openAsks (chỉ question + labels, chỉ đi episode Telegram), notifier qa, web keyOf; collector 398, desktop telegram 94, web 1700, typecheck sạch. Phím số CHƯA XÁC MINH trên TUI thật → QA tay. (main sửa: dấu cách DEVICE_COMMAND_RE) c8db911
- [~] WP-D giao opus.
- [x] WP-D thành viên — shared members/sanitizer, notifier roleOf/mayPress, UI Thành viên; desktop telegram 103, web 1700, typecheck sạch; UI CHƯA NHÌN (main sửa: ký tự bidi thật trong regex → \u escape). b1002f1
- [~] WP-E giao sonnet.
- [x] WP-E gom báo xong — notifier digestDone, api digestHtml, công tắc Báo cáo; desktop telegram 110, web 1700, typecheck sạch; UI CHƯA NHÌN. f5963be
- [x] Main: build web + desktop, bản dev mở lại 4319 (receiving bật). Nhìn: `docs/qa/telegram-2026-11-04/10-members.png` (Thành viên), `11-digest.png` (Gom báo xong) — ĐẠT. Banner conflict CHƯA NHÌN (cần bản thứ 2 poll cùng token).
- [x] Docs §11an-g, `.code_index/_meta.md`, DECISIONS (thành viên).
- [ ] QA tay chủ nhân: lệnh lúc app tắt (tắt app, nhắn, mở lại), menu "/" trong group, `tail`, câu hỏi AskUserQuestion bấm nút (phím số chưa xác minh), thêm thành viên bằng tài khoản khác, gom báo xong.
- [x] Handoff mới: `.planning/HANDOFF-2026-11-05-0400.md`
- [x] Tắt bản dev QA, trả hook `~/.claude/settings.json` về `C:/Users/dauph/AppData/Local/ccm/bin/hook-bridge.mjs`; chủ nhân bảo commit + push.
