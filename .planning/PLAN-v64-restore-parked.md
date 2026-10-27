# PLAN v64 — Restore workspace chọn project, pane ngủ

Chủ nhân (2026-10-27): mở lại app có 4 project / 17 session, bấm Khôi phục thì 17 pane cùng spawn + `claude --resume` → đơ.
Muốn giữ bố cục 4 project nhưng chỉ chạy project cần.

Chốt:
- Banner "Khôi phục workspace trước" liệt kê project (theo `Tab.project`, gộp tab cùng project) + số session, có checkbox.
  Project tích → pane chạy như cũ; không tích → bố cục giữ nguyên, pane terminal ở trạng thái **ngủ** (`PaneState 'parked'`).
- Pane ngủ chỉ chạy khi bấm (nút ▶ Tiếp tục trong pane, Enter khi pane focus, menu tab/nhóm "Chạy cả tab"). Đổi tab / focus không tự chạy.
- Pane ngủ sống qua reload cửa sổ (sessionStorage giữ pane `parked` dù chưa có `sessionId`) và vẫn nằm trong snapshot `ccm.workspace.last`.
- Viewer (browser / file / git) không có tiến trình nên luôn mở bình thường.

Code:
- `stores/workspace.ts`: `PaneState` + `'parked'`; `restoreLast(run?: ReadonlySet<string>)`; `wake(keys)`; `lastProjects` cho banner; persist `parked`.
- `TermPane.vue`: không connect khi `parked`; thẻ ngủ + nút; watch state `parked → starting` thì spawn.
- Rail / sidebar / Mission / paneHead: trạng thái `parked` (chữ "Đang ngủ", icon trăng, không spinner).
- `WorkspaceView.vue`: banner checkbox; menu tab "Chạy cả tab" khi tab có pane ngủ.
- i18n en/vi.
