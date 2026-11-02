## WP-8: QA — build app desktop, test đủ, chụp từng màn
- Mục tiêu: chứng minh v79 chạy trên app desktop thật (bản dev build), không hồi quy.
- Bước:
  1. `npm run typecheck` (root, mọi workspace) sạch.
  2. Unit: web, desktop, collector, shared (vitest, theo quirk trong AGENT-RULES: chạy từ apps/<ws> với reporter json + vres.py). Ghi số pass/fail.
  3. Build: `npm run build -w @ccm/web && npm run build -w @ccm/desktop`.
  4. E2E đủ: `node apps/desktop/e2e/run.cjs` với `CCM_E2E_DBG=9444 CCM_E2E_PORT=4399` (9333 bị chặn; 4317 là app thật của chủ nhân — không đụng,
     không tắt). Fail → đọc script fail, phân loại: hồi quy v79 (ghi file:line, đề xuất sửa) / flaky (chạy lại riêng script đó 2 lần) / môi trường.
  5. Chụp màn (qua CDP như các e2e có sẵn, hoặc viết `apps/desktop/e2e/v79-shots.cjs` dựa trên cdp.cjs, dùng demo fixture `scripts/demo-fixture.mjs`):
     Monitor (cột mở, cột đóng), Session card hover + menu, Agent Map, Workspace 1 pane, Workspace split 2 pane, rail với ≥ 6 dự án, header popover
     Hạn mức, Settings từng trang (10), tìm kiếm Settings, History, Usage, Devices (trống), Extensions, Git Log toolbar mở, theme sáng + tối cho
     Monitor/Workspace/Settings. Lưu `docs/qa/v79/*.png` + `docs/qa/v79/RESULT.md` (mỗi mục ĐẠT/LỖI + ghi chú: tràn ngang, chữ < 11px, lệch, màn đen).
     Nếu viết v79-shots.cjs ổn định thì thêm vào danh sách trong run.cjs (ghi report).
- Phạm vi file: docs/qa/v79/**, apps/desktop/e2e/v79-shots.cjs (mới), apps/desktop/e2e/run.cjs (thêm tên), sửa e2e hỏng do selector v79 đổi
  (ghi rõ từng sửa). KHÔNG sửa code app (src) — lỗi app ghi vào report để main giao WP sửa.
- Phụ thuộc: WP-1..7 | Model: sonnet.
- Tiêu chí: [ ] typecheck sạch · [ ] unit 4 workspace có số thật · [ ] build OK · [ ] E2E kết quả thật từng script · [ ] ảnh đủ danh sách, mtime sau
  lần sửa code cuối · [ ] RESULT.md.
- Báo cáo: `.planning/wp/WP-8-report.md`

## Nhật ký
- typecheck sạch; unit web 1593/1593, desktop 1057/1057, collector 372/373 (1 skip), shared không có test; build OK
- E2E full đang chạy nền; viết xong apps/desktop/e2e/v79-shots.cjs (chờ chạy sau E2E)
- E2E full: 1163 pass / 30 fail (52 script); đang rerun từng script fail để phân loại
- đã sửa e2e: p2 p5 p6 v25 extensions log flutter-preview pane-drag v69-ide v77a shell-agent; rerun
- đã sửa/ rerun e2e: còn lỗi thật v70 queue (TermPane:334), v50 dust (hitch frame 2); chạy v79-shots
- v79-shots chạy lại OK; phát hiện bug Settings layout (@container tự style), v70 queue
