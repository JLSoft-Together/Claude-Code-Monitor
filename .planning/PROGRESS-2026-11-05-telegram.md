# PROGRESS — Telegram QA follow-ups + v85 (2026-11-05)

Máy F: (`F:/work/web/Claude-Code-Monitor`). Mới nhất ở cuối. Trước đó: `PROGRESS-2026-11-04-telegram-review.md`.

## Phiên 2026-11-04 23:30 → 2026-11-05 01:43 (sau HANDOFF-2026-11-04-2326) — chủ nhân: test kịch bản còn lại, sửa theo góp ý
- [x] Bản dev QA dựng lại trên máy F: (build web + desktop, cổng 4319, CDP 9333, dữ liệu `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/{ud,data}`), chủ nhân dán token + ghép + topic #63 → `F:\work\android\WeJoy\last-war`.
- [x] QA #16 stop ĐẠT (`docs/qa/telegram-2026-11-04/08-stop-interrupted.png`); #18–#25 ghi trong `RESULT.md`.
- [x] `@bot all` trống → help; help gom nhóm từng dòng (`inbound.ts`).
- [x] `new` khi đã có session → hỏi + nút `➕` / `📨 <pane>` (kinds `nw`/`np`).
- [x] Prompt từ Telegram thêm dòng "gửi kết quả bằng telegram_send" (`actions.ts` `viaTelegram`; bỏ qua lệnh trần `/x`, `/compact`, `/clear`).
- [x] Tổng kết ngày: lần 1 không gửi vì app mở sau 21:00 → đúng thiết kế; ép lại 23:52 gửi được (msg 89).
- [x] v85 file lớn ≤ 2 GB qua MTProto (GramJS `telegram@2.26.22`, `telegram/mtproto.ts`), QA thật: `test-60mb.bin` vào topic #63 (lỗi đầu: access hash 0 → sửa `getInputEntity`).
- [x] Quét topic qua MTProto: `BOT_METHOD_INVALID` → không làm được, đã gỡ code.
- [x] Nhiều session: tên theo tab Orrery + `#n` (`uniquePaneNames`), nút chọn cho `stop` / `last` / tin thường (`pickMarkup`, kind `lt`).
- [x] Settings: Telegram thành trang riêng, 3 tab Kết nối / Nhận lệnh / Báo cáo (`TelegramSettings.vue`).
- [x] Kết nối topic theo session hoặc project: menu rail "Kết nối Telegram…" + `TelegramLinkDialog.vue`; `sessionRoutes` theo Claude session id, trang đẩy `ccm:telegram-panes`.
- [x] Người lạ tag bot → câu cố định (bật/tắt + sửa câu, `{owner}`), ≤ 5/phút (`strangerLimit`).
- [x] Tên topic: notifier học từ tin poll (`learn`), state `where` "Group › Topic".
- [x] Kiểm cuối 01:40: typecheck sạch; desktop 1213/1213, web 1692/1692.
- [ ] QA tay chưa làm: kết nối riêng session qua link, người lạ (cần tài khoản khác), tên topic sau khi gửi tin vào #63, `new` hỏi nút (#23).
- [x] 01:43 Handoff mới: `.planning/HANDOFF-2026-11-05-0143.md`

## Phiên 2026-11-05 01:45 → 02:20 (sau HANDOFF-0143) — chủ nhân: "làm hết đi, commit dần"
- [x] Commit việc cũ: `2864984` code, `c0d2b47` docs.
- [x] Menu tab ngang có Kết nối Telegram (trong `2864984`).
- [x] #1 reply theo Claude session qua restart/resume `2ed4fa2`.
- [x] #7 poll không chờ việc nặng + album `18e45ce`; sửa regex `screen` bị backspace `d925acd`.
- [x] #2 tiến độ % file lớn `88d4c9c`.
- [x] #3 icon ✈ rail + tab `bb0e2a2`.
- [x] #4 nút nối topic từ Telegram `eaef687`.
- [x] #5 pin trạng thái theo topic session `1eccf4d`.
- [x] #6 GramJS tách `gramjs.cjs`, main 2.9 → 1.4 MB `1668dc0`.
- [x] Kiểm: desktop 1217/1218 (1 lỗi chập chờn `layout-model-service`, chạy riêng 34/34 pass), web 1693/1693, typecheck sạch. Bản dev build lại + mở lại cổng 4319, receiving bật.
- [ ] QA tay trên bản dev: album, reply sau restart, nút 🔗/📁 trong topic mới, % file lớn, pin topic session, icon ✈.
