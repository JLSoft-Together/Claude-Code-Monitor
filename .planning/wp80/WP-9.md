## WP-9: Tách WorkspaceView.vue + AgentMap.vue (không đổi hành vi)
- Mục tiêu: mỗi file chính ≤ ~900 dòng; tách theo trách nhiệm thành component con + composable (vd WorkspaceTabBar.vue, WorkspaceCanvas.vue,
  useWorkspaceDialogs.ts, useWorkspaceKeys.ts; AgentMap: useMapLayout.ts, MapToolbar.vue, useMapGestures.ts…). Không đổi DOM / data-* / class mà e2e
  hoặc test dùng (Grep apps/desktop/e2e + *.test.ts trước). Không đổi logic, chỉ di chuyển; props/emit rõ ràng, không prop drilling quá 2 tầng (dùng
  provide/inject như WP-4 đã làm với ccm-pane-bar nếu cần).
- Đo trước/sau: số dòng từng file; build OK; e2e liên quan workspace + agent-map đều pass (p2–p6, split, tabs-cwd, tier2, rail, sidebar, pane-drag,
  v49-open, v50-groups, v51-compact, v52-polish, v80-toasts, agent-map, links, browser, explorer…). Nếu quá nhiều thì chạy FULL run.cjs 1 lần ở cuối.
- Phạm vi: components/workspace/WorkspaceView.vue + file con mới trong components/workspace/view/**, components/AgentMap.vue + components/map/** mới,
  composables mới. Cấm: CommandPalette (agent WP-10 đang sửa), apps/desktop/**, stores/workspace.ts + shared mcpCall (agent WP-1 đang sửa), en.ts/vi.ts.
- Model: sonnet. Build/e2e: `.planning/wp/build.lock`, CCM_E2E_DBG=9454 CCM_E2E_PORT=4389, KHÔNG 4317. Làm từng file một, chạy test sau mỗi bước, ghi Nhật ký.
- Báo cáo `.planning/wp80/WP-9-report.md` (dòng trước/sau, file mới, test).

## Nhật ký
