## WP-2: Tool MCP `orrery` sinh từ bảng action + action session cho agent
- Mục tiêu: danh sách tool MCP (`apps/desktop/src/pty/mcpTools/index.ts` MCP_TOOLS) sinh từ `ORRERY_ACTIONS` (WP-1): mỗi tool = 1 action, tên tool cũ giữ nguyên (alias) để skill/agent cũ không gãy; thêm action là agent Claude/Codex có tool ngay. Thêm 3 tool mới cho agent:
  - `list_sessions`: các pane agent/shell cùng project với pane gọi (tên, preset, trạng thái, sessionId) — chỉ đọc.
  - `send_to_session`: điền sẵn chữ vào ô nhập của 1 pane cùng project (KHÔNG tự gửi; giống open_session prompt), từ chối pane chính nó, giới hạn tần suất như open_session.
  - `close_session`: chỉ đóng pane do chính pane gọi mở (`openedBy`), có undo như đóng tay.
- Phạm vi: apps/desktop/src/pty/mcpTools/**, apps/desktop/src/pty/mcp.ts (nếu cần), packages/shared/src/orreryApi.ts (thêm action — phối hợp: WP-1 đã xong), apps/web/src/composables/useOrreryApi.ts (executor cho 3 action mới), apps/web/src/stores/workspace.ts (hàm nhỏ nếu cần), i18n nếu có chữ UI, tests.
- Cấm đụng: pty/host.ts, presets.ts, shellInit.ts (WP-3).
- Phụ thuộc: WP-1 | Model: sonnet (spec rõ) | Nhìn thấy được: không
- Tiêu chí: 1) tools/list giữ đủ tool cũ cùng tên + schema tương thích; 2) 3 tool mới có schema, sanitize, kiểm cùng project, rate limit; 3) DeepSeek bỏ hand_back/deepseek như cũ (`mcpToolsFor`); 4) test cho từng tool mới + snapshot danh sách tool; typecheck + test pass.
- Lệnh test: `npm run typecheck`; `npm test -w @ccm/desktop`; `npm test -w @ccm/web`
- Báo cáo: `.planning/wp/gw/WP-2-report.md`
## Nhật ký
- Thêm 3 tool vào McpPageCall/ORRERY_ACTIONS (session.list|sendTo|close), tool desktop `mcpTools/sessions.ts`, logic web trong useSessionActions (listFor/typeInto/closeOpened) + handler useMcpCalls. Host relay đã generic (không sửa host.ts). Typecheck sạch, desktop 1312, web 1740.
