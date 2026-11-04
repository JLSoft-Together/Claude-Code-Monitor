## WP-1: Review desktop + shared + collector Telegram (v82–v84)

- Mục tiêu: danh sách lỗi thật (correctness, bảo mật, rò rỉ) trong code Telegram chưa commit, mỗi lỗi có `file:line`, kịch bản lỗi cụ thể, mức (high/med/low), cách sửa gợi ý. KHÔNG sửa code.
- Phạm vi đọc: `packages/shared/src/telegram.ts`, `packages/shared/src/mcpDesk.ts` (phần telegram), `apps/desktop/src/telegram/*.ts`, `apps/desktop/src/pty/mcpTools/telegram*.ts`, `apps/desktop/src/mcpDesk.ts` (hàm `telegram`), `apps/desktop/src/main.ts` (grep `telegram`, `askPageTelegram`, `runLogs`), `apps/desktop/src/preload.ts` (telegram*), `apps/collector/src/transcript.ts` (`reply_text`), `apps/collector/src/toast.ts` (`onTelegram`). Bối cảnh: `docs/claude-code-integration.md` §11an / §11an-b / §11an-c, các PLAN v82–v84. Diff: `git diff` + file mới chưa track.
- Cấm: sửa bất kỳ file nào trừ báo cáo.
- Model: opus (input từ xa ghi vào PTY, chỉ-owner, token, file tải về).
- Soát kỹ:
  1. Chỉ owner: mọi đường (message, callback_query, pair) — có đường nào người lạ kích hoạt hành động / gửi phím / tải file / làm lộ thông tin (kể cả trả lời "không có quyền" quá nhiều = spam)?
  2. Ghép tài khoản: mã đoán được? dùng lại? hết hạn? pair trong group người khác thấy mã?
  3. Gửi phím vào PTY (`typeKeys`): kiểm trạng thái đúng lúc? race (session đổi trạng thái giữa lúc kiểm và lúc ghi)? phím sai cho Codex?
  4. File từ Telegram: path traversal, tên file, kích thước, ghi đè, `.git/info/exclude` khi worktree (`--git-path`), file bí mật.
  5. Diff gửi ra ngoài: lọc secret, file lớn, repo con.
  6. Token: có lộ trong log, lỗi, state, URL in ra ở đâu không (kể cả `fetch` lỗi kèm URL).
  7. Poll: vòng lặp, backoff, dừng khi tắt, 2 vòng chạy song song, conflict 409, offset.
  8. Rate limit, quiet hours qua nửa đêm, tổng kết ngày (đổi ngày), tin ghim (edit/xoá), health counters.
  9. HTML escape mọi chỗ ghép chuỗi gửi Telegram (parse_mode HTML) — có chỗ nào ghép text chưa escape / escape 2 lần?
  10. `reply_text` collector: câu trả lời cũ bị gửi nhầm cho lượt sau; sidechain/subagent.
  11. Kiểu / contract shared ↔ web ↔ desktop lệch nhau.
- Lệnh test (chỉ để hiểu, được chạy): `npm test -w @ccm/desktop -- test/telegram` · `npm run typecheck -w @ccm/desktop`.
- Nhìn thấy được: không
- Báo cáo: `.planning/wp/tg/WP-1-report.md`

## Nhật ký
