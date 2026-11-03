## WP-11 — XONG (QA v80 + dọn cuối)

### Việc 1: chuỗi free_port
- `apps/desktop/src/strings.ts` thêm `freePortTitle` / `freePortDetail` / `freePortConfirm` (en + vi); `resources/agentPorts.ts` bỏ `TEXT` / `freePortText`; `mcpDesk.ts` dùng `stringsFor(deps.locale())`. Test mcp-desk vẫn xanh (desktop 1106/1106).

### Gate (số thật)
- `npm run typecheck`: sạch tất cả workspace.
- vitest: web 622 file / 1659 test pass; desktop 404 file / 1106 pass; collector 143 file / 374 test (373 pass, 1 skip, 0 fail); shared: không có test.
- Build web + desktop OK (chỉ cảnh báo chunk lớn).
- FULL `node apps/desktop/e2e/run.cjs` (DBG 9444, PORT 4399): 1347 PASS, 1 FAIL.
  - FAIL duy nhất: v80-mcp "tools/list: open_session first + 3 new tools" — e2e kỳ vọng đúng 4 tên, giờ registry có 11 tool (WP-4/5 thêm). Không phải hồi quy app → sửa e2e (open_session đứng đầu + đủ 10 tool mới). Chạy lại riêng 2 lần: 0 FAIL cả hai.
  - Các script chỉ định đều pass: whats-new (GROUP_ORDER WP-10), workspace/agent-map (WP-9), v80-toasts, v49-open, v80-mcp, run-pane, v79-shots.
- `run.cjs` thêm `v80-mcp`, `v80-toasts` (trước shell-agent). Lưu ý: run.cjs chạy v79-shots nên ghi đè docs/qa/v79.

### Ảnh (docs/qa/v80/, đã Read từng ảnh) — xem RESULT.md
- ĐẠT: palette nhiều nhóm + tiền tố (01–04), panel Agent Map có mục "Lệnh gọi tool" (05), Changes nhóm "Chưa xem" (06), chồng 3 toast (07), công tắc tự reload trong menu Run (08), popover Hạn mức (10).
- CHƯA KIỂM (fixture không có dữ liệu): dòng tool thật của sub-agent, nút Tiếp tục ở History, dòng "Hết lúc…" của Hạn mức. Đều có unit test.
- Phát hiện nhỏ khi viết script (không phải lỗi): Changes chỉ xếp lại nhóm "Chưa xem" ở lần refresh kế tiếp (chủ ý, tránh xáo trộn khi đang bấm).
- Script mới `apps/desktop/e2e/v80-shots.cjs` (không thêm vào run.cjs vì ghi ảnh vào docs/qa).

### .code_index
- Thêm `## v80 (2026-11-03)` vào web.md, desktop.md, protocol.md, collector.md; dòng v80 trong _meta.md; mục v80 trong features.md (MCP tools, review queue, resume, auto reload, forecast, Ctrl+K, toast host, lazy overlays, measure.mjs).

### File
- `.planning/COMMITS-v80.md` (1 commit gom + 11 commit tách; danh sách không add: spikes/, bg_native_ad_cta.xml, git-gui.bat, fwp snapshot, .vitest/, docs/qa/, HANDOFF-2026-11-01-v76.md).
- `.planning/RELEASE-next.md` (changelog en + vi, chưa bump version).
- File app sửa trong WP: strings.ts, resources/agentPorts.ts, mcpDesk.ts; e2e: run.cjs, v80-mcp.cjs, v80-shots.cjs.

### Changelog
- (không thêm; xem RELEASE-next.md)
