## WP-2 — DONE
- Đã đổi: `packages/shared/src/mcpCall.ts` (3 call/result mới, SessionRef, lỗi `target`|`busy`), `orreryApi.ts` (action `session.list|sendTo|close`, MCP_TOOL_ACTION, parse+clean text); desktop `pty/mcpTools/sessions.ts` (mới), `index.ts`, `runCommon.ts`, `mcp.ts` (instructions), 3 map lỗi cũ thêm target/busy; web `useSessionActions.ts` (listFor/typeInto/closeOpened), `useMcpCalls.ts` (3 handler).
- Tiêu chí 4/4. Tool cũ giữ tên/thứ tự/schema, 3 tool mới nối cuối; DeepSeek vẫn chỉ bỏ hand_back/deepseek.
- Audit: host.ts relay `page()` generic nên không phải sửa. "Sinh từ ORRERY_ACTIONS" làm bằng test đối chiếu bảng↔MCP_TOOLS (không codegen: mỗi tool cần schema/mô tả viết tay) — lệch nhỏ so brief.
- Review: pane gọi không tồn tại → `caller`; khác project/chính nó/shell/đã exit → `target`; prefill đang chờ hoặc Compact → `busy` (không ghi đè); text rỗng/ctrl-chars/>8000/không phải string bị từ chối trước rate+page; rate 20/phút; send chỉ điền sẵn (prefillSubmit tắt). close chỉ pane `openedBy`=caller, qua requestClose như tay: pane đang chạy → hỏi chủ nhân (confirm), có undo; đang có sheet đóng khác → `busy`. Không lộ nội dung terminal/env/token (chỉ tên, agent, status, id).
- Test: typecheck sạch; desktop 1312/1312 (+13, `mcp-sessions.test.ts`, sửa snapshot `mcp.test.ts`); web 1740/1740 (+8 `agentSessions.test.ts`).
- Nhìn: không áp dụng
- Hot file cần thêm: `.code_index/desktop.md`, `web.md`, `protocol.md`, `_meta.md`; docs §11w/§11ao (3 tool + lỗi target/busy); skill/README liệt kê tool.
- Ngoài phạm vi: đóng qua MCP không chạy hiệu ứng dust (nằm trong useCloseFlow của view); không sửa workspace.ts/host.ts.
- Commit message đề xuất: `✨ Orrery MCP: list_sessions, send_to_session (prefill only) and close_session for panes the caller opened`
