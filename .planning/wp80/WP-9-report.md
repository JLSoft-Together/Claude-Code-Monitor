# WP-9 report: tách WorkspaceView.vue + AgentMap.vue (một phần)

## Dòng trước / sau
- WorkspaceView.vue: 2517 -> 1873
- AgentMap.vue: 1769 -> 1566
- Mục tiêu <= ~900 dòng/file CHƯA đạt (mới xong các khối tách sạch, không đổi hành vi).

## File mới
workspace/view/: geometry.ts, useSidePanels.ts, useDialogRoots.ts, useTabStripVisuals.ts, useTabFlashRename.ts, useCloseFlow.ts (đóng pane + dust + undo toast + reopen), CloseConfirmDialog.vue, RunCloseDialog.vue, AgentChoiceDialog.vue.
map/: useLiveAnnounce.ts, useOffscreenCapsules.ts, useOfficeControls.ts, useMapFind.ts.

## Sửa test
officeView.test.ts: test "Office full screen" đọc source nên trỏ phần officeFs / phím Shift+F sang map/useOfficeControls.ts?raw.

## Kiểm
- typecheck web: sạch (có lúc lỗi do packages/shared/src/mcpRun.ts của WP-1 đang sửa dở, sau đó hết).
- vitest web full: 1653 test, 1 fail (officeView source-text) -> đã sửa, 66/66 pass lại.
- Không chạy build/E2E (luật: WP-8 làm). DOM / data-* / class giữ nguyên; teleport dialog giữ nguyên cấu trúc; ref="closeDialog"/"runCloseDialog" qua defineExpose({focus}).

## Còn lại để đạt ~900 (gợi ý WP sau)
WorkspaceView: tab strip template + tab context menu/actions, usePaneDrag + ghost, useStartLayouts (startGuard/adoptNew), 5 khối ViewPaneControls lặp lại, key handler onGlobalKey.
AgentMap: peer edges/flights (~165 dòng), menu + onCanvasKey, syncNodes/retireNodes, template toolbar (MapToolbar.vue).

## Changelog (không sửa changelog.ts)
en: Internal: Workspace and Agent Map code split into smaller modules (no visible change).
vi: Nội bộ: tách mã Workspace và Agent Map thành các module nhỏ hơn (không đổi giao diện).

## Dòng index đề xuất
- workspace/view/useCloseFlow.ts: useCloseFlow (confirm sheet, dust close, undo toast, reopen)
- workspace/view/useSidePanels.ts: useSidePanels (sidebar/explorer open + widths)
- map/useOffscreenCapsules.ts, map/useMapFind.ts, map/useOfficeControls.ts, map/useLiveAnnounce.ts: composables tách từ AgentMap.vue

## Nhật ký
- Từng bước: side panels, dialog roots, geometry, tab strip visuals, 3 dialog, closeFlow, flash/rename; AgentMap: live, capsules, office controls, find. typecheck sau mỗi cụm.
