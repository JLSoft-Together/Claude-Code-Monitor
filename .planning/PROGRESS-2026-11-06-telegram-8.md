# PROGRESS — 8 cải tiến Telegram (2026-11-06)

## Tóm tắt hiện tại
- Plan `.planning/PLAN-2026-11-06-telegram-8.md`; brief `.planning/wp/tg8/T*.md`. Commit: gom 1 cuối (chủ nhân chọn). Build/E2E được.
- Trước đợt: commit `24142ee` (cổng chung).
- Sóng A xong (T1 ĐẠT, T2 chờ review opus). Sóng B: T3 ĐẠT; T2 đang sửa theo review; T4 chờ T2.

- ĐỢT XONG 2026-11-06: 5/5 WP ĐẠT, CHƯA commit (gom 1 cuối, chờ chủ nhân). Phần cần bot thật CHƯA KIỂM → `docs/qa/telegram8-2026-11-06/RESULT.md`.

## Bảng WP
| WP | Model | Trạng thái | Vòng | Test | Review | Commit | Ghi chú |
|----|-------|------------|------|------|--------|--------|---------|
| T1 glyph ✈ mở topic (3) | sonnet | ĐẠT | 1 | web 1751 | main xem ảnh OK | gom cuối | glyph rail cũ không bấm được (pointer-events-none) đã sửa |
| T2 lệnh/nút/picker (2,5,6) | sonnet | ĐẠT | 2 | desktop 1353, web 1757 | opus 6 điểm → đã sửa 6/6 (TTL 5', since, tác giả picker, gone) | gom cuối | bot thật CHƯA KIỂM |
| T3 ghim topic, health, hạn mức (1,4,8) | sonnet | ĐẠT | 1 | desktop 1346, web 1756, collector 401+1 | main xem ảnh OK | gom cuối | ghim/429 thật CHƯA KIỂM; sửa thêm shared/phone.ts; 429 hold chỉ xếp hàng sendText |
| T4 ảnh → đính kèm (7) | sonnet | ĐẠT | 1 | desktop 1358, web 1761 | T5 thử Claude thật: [Image #1] + caption tự gửi, Claude trả lời | gom cuối | main sửa: dấu cách giữa token ảnh và caption (+test) |
| T5 QA + docs | sonnet | ĐẠT | 1 | E2E 9 file 0 fail | — | gom cuối | docs §11an-j, RESULT.md 11 kịch bản thử tay; lỡ gửi 2 prompt thay 1 (vô hại) |

Thống kê: 5 WP sonnet + 1 reviewer opus (T2: 1 HIGH 2 MED 3 LOW, sửa vòng 2) + 1 khảo sát haiku. Không escalate. Lỗi lặp: Vite giữ module cũ khi agent sửa dở → touch/reload.

## Phiên 16:5x — chủ nhân test tay (cách 2)
- Nhận lệnh: app cài tắt → bản dev bật; route thử t5proj → Test Bot group › Orrery (#8). Kết quả: 1 focus ĐẠT · 2 prompt + ghim ĐẠT · 3 nút Esc/tail ĐẠT (dùng AskUserQuestion; máy để defaultMode auto nên không có tin xin quyền) · 4 ảnh ĐẠT · 5 compact ĐẠT (chủ nhân tự Enter /compact) · 6 /new picker ĐẠT · 7 close ĐẠT (tên nút khó phân biệt) · 8 sức khoẻ topic ĐẠT, ✈ KHÔNG hiện cho project route.
- Đã trả lại: dev nhận lệnh tắt, gỡ route thử, đóng pane; app cài nhận lệnh bật lại.
- Chủ nhân: "giờ anh muốn thiết kế cho nó tự gửi đi" → C1 Compact tự gửi /compact + resume (sonnet). C2 ✈ cho project route + nút chọn pane có trạng thái/thời gian (sonnet). Cả 2 chạy song song.
- [x] C1 Compact tự gửi (sonnet): useCompact auto + `settings.compactAuto` (mặc định bật), dừng khi gõ tay/huỷ/10'; CLAUDE.md câu ngoại lệ v51 + docs §11x cập nhật. Main QA Claude thật t5proj: handoff → /compact tự gửi → resume tự gửi, Claude làm tiếp (`docs/qa/telegram8-2026-11-06/C1/compact-auto-real.png`).
- [x] C2 ✈ cho project route + nút chọn pane "tên · trạng thái · tuổi" (sonnet): `telegramRouteOf`, `paneLabel`; ảnh `C2/glyph-project-route.png`.
- Kiểm tổng (main): typecheck 0 lỗi, web 1770/1770, desktop 1359/1359. CHƯA commit (gom cuối).
