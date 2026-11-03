## WP-1: MCP registry + notify_owner, open_in_workspace, who_is_editing
- Hiện trạng: apps/desktop/src/pty/mcp.ts (146 dòng) chỉ có tool `open_session`; server HTTP `${ORRERY_API}/mcp`, Bearer per-pane token
  (presets.ts:49), docs §11w trong docs/claude-code-integration.md. Đọc kỹ cách open_session xác thực token → pane → project, rate limit, confirm.
- Làm:
  1. Tách registry: mỗi tool 1 module (`pty/mcpTools/<name>.ts`: schema, handler, doc), mcp.ts chỉ dispatch. open_session chuyển sang, hành vi y nguyên.
  2. `notify_owner(text ≤ 200 ký tự, level: info|attention|done)`: vào Inbox + toast (theo setting thông báo / quiet hours hiện có) + điện thoại nếu
     bật; tên pane/project của người gọi kèm theo; rate limit (vd 6/phút/pane, dư thì gộp). Không gửi prompt cho ai.
  3. `open_in_workspace(path, line?, diff?: boolean)`: path phải nằm trong project của pane gọi; mở viewer file (nhảy dòng) hoặc diff/Changes cho file
     đó ở tab hiện tại của project; không focus cướp nếu chủ nhân đang gõ (theo cách open_session xử lý).
  4. `who_is_editing(path)`: trả danh sách pane/session khác (tên, agent, lần sửa gần nhất) đang/đã sửa file đó gần đây, dùng dữ liệu OverlapChip
     sẵn có (Grep OverlapChip / overlap trong apps/desktop + apps/web + collector để tìm nguồn).
  5. Test vitest desktop cho từng tool (token sai, path ngoài project, traversal, rate limit). Docs §11w bổ sung từng tool + ví dụ gọi.
- Phạm vi: apps/desktop/src/pty/mcp.ts, pty/mcpTools/** (mới), chỗ nối IPC main↔renderer cần cho tool (ghi rõ), apps/web chỗ nhận lệnh mở file/diff +
  inbox nếu cần, apps/desktop/src/strings.ts (WP-1 là chủ vòng 1), docs/claude-code-integration.md §11w, test. Cấm: presets.ts (WP-2), App.vue (WP-3).
- Model: opus (IPC / auth / dữ liệu người dùng). Build + e2e liên quan: được (CCM_E2E_DBG=9446 CCM_E2E_PORT=4397, KHÔNG 4317); dùng `.planning/wp/build.lock`.
- Tiêu chí: open_session không đổi (e2e v49-open pass); 3 tool mới chạy được từ một pane claude thật hoặc bằng request HTTP giả có token; test bảo mật pass.
- Báo cáo `.planning/wp80/WP-1-report.md`.

## Nhật ký
- 2026-11-03 AUDIT: mcp.ts chỉ có open_session; luồng host → supervisor → main → page (`ccm:pane-open`). Toast/phone/quiet hours nằm ở collector (Toaster) → notify đi qua `host.post(agent.note)` như disk alert. OverlapChip dùng `overlapFiles` (git diff vs main) per checkout.
- CODE: registry `pty/mcpTools/*` (types, paths, openSession, notifyOwner, openInWorkspace, whoIsEditing, index); shared `mcpCall.ts`; relay generic `mcp`/`mcp-reply` + `ccm:mcp-call`/`ccm:mcp-reply`; web `useMcpCalls` (cài từ WorkspaceView), `workspace.showForAgent`, Inbox reason `note`, `lib/whoIsEditing`.
- REVIEW: đổi `done` note sang công tắc "needs you" (done toast mặc định tắt); ChangesPane không cướp focus khi đang gõ; unknown args vẫn bị bỏ qua như cũ (open_session y nguyên).
- TEST: typecheck desktop/web/collector/shared sạch; vitest desktop 1072/1072, web 1619/1619, collector 373 pass (1 skip); build web+desktop OK; e2e v80-mcp 23/23, v49-open 32/32.
