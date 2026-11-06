## WP-5: chỉ resume session đã có ít nhất 1 lượt chat + việc tồn WP-3
- Vấn đề (QA WP-3): pane Claude (minted id hoặc gõ tay trong shell) chưa nhận prompt nào → đóng/khởi động lại → `claude --resume <id>` in "No conversation found" vì chưa có transcript. `useWorkspaceLinks.ts:~82` xoá `mintedSession` ngay khi thấy agent chạy.
- Mục tiêu:
  1. Một session chỉ được coi là "resume được" khi đã có ≥1 lượt chat. Tìm tín hiệu tin cậy có sẵn (ưu tiên dữ liệu collector: trạng thái terminal từng sang running/asked, số lượt, hoặc file transcript đã có; đọc `docs/claude-code-integration.md`, `packages/shared/src/types.ts` TerminalSession, `apps/collector`). Chọn cách ít đụng nhất, ghi lý do. Nếu cần đổi collector → được, kèm test.
  2. Chưa có lượt nào: `closedPane`, LAST snapshot, layout lưu (`lib/layouts.ts`), restart → mở lại agent MỚI (không `--resume`) cùng thư mục, không báo lỗi.
  3. `lib/layouts.ts:~16`: dùng `reopenAs` (WP-3) để pane shell có agent gõ tay được lưu như agent.
  4. Restart pane shell đang chạy agent gõ tay → mở lại agent đó với `--resume` (nếu đã có lượt), else shell như cũ.
- Phạm vi: apps/web/src/{stores/workspace.ts, composables/useWorkspaceLinks.ts, lib/layouts.ts, components/workspace/TermPane.vue (restart)}, collector nếu cần, tests.
- Cấm đụng: apps/desktop/src/pty/mcpTools/**, useSessionActions.ts, useOrreryApi.ts, useMcpCalls.ts, packages/shared/src/orreryApi.ts (WP-2 đang sửa).
- Model: sonnet | Nhìn thấy được: không (có thể QA dev nếu tiện)
- Tiêu chí: 1) có test: pane chưa có lượt → closedPane/LAST/layout không có resume; có lượt → có; 2) shell+agent qua layouts + restart đúng; 3) typecheck + test web/desktop/collector pass.
- Lệnh test: `npm run typecheck`; `npm test -w @ccm/web`; `npm test -w @ccm/collector`; `npm test -w @ccm/desktop`
- Báo cáo: `.planning/wp/gw/WP-5-report.md`
## Nhật ký
- Audit: collector không có số lượt; tín hiệu rẻ nhất = status terminal từng working/waiting (đã có ở web). Không đổi collector.
- Làm: field `Pane.untouchedSession`, `untouched()`, `sessionLinkPatch()`, reopenAs/resumeIdOf/layouts/TermPane.restart. Test web 1742, collector 398, desktop 1312, typecheck OK.
