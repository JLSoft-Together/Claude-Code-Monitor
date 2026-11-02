## WP-11 — Sửa Workspace / Monitor sau QA (ĐẠT)

### Đã đổi
- `components/workspace/TermPane.vue` pickMore 'queue': anchor = `more.value?.button?.getBoundingClientRect()` (PaneMore là fragment nên `$el` không có rect).
- `components/workspace/WorkspaceView.vue`: bỏ nút ⋯ thứ 2 trên thanh tab (+ toàn bộ code helpOpen/onHelp*, import icon thừa); thêm vạch ngăn `data-explorer-divider` giữa nhóm điều khiển pane và nút Explorer; `toggleDim` chỉ đổi setting, thông báo a11y chuyển sang watch `settings.dimInactive`.
- `components/AppHeader.vue` moreEntries: thêm `dim` (chỉ khi view workspace và tab hiện tại ≥ 2 pane), `shortcuts`, `tour` (chỉ ở view workspace). Phím tắt giữ nguyên.
- `lib/tour.ts`: bước `keys` của Workspace tour trỏ `data-tour="compact"` (nút ⋯ của AppHeader). `i18n/workspace-v25.ts`: câu thân bước keys nói "menu ⋯ trên thanh đầu".
- `components/MainNode.vue`: bỏ pill trạng thái (StatusIcon + dòng hoạt động đã nói trạng thái/tool).
- SessionCard: không đổi — dòng 2 đã là tool khi có, chỉ ghi chữ trạng thái khi không có tool; header chỉ còn icon.
- Rail: `lib/rail/railModel.ts` thêm `isSolo()` + `RAIL_BADGE` (RailRow dùng lại); `rail/RailClusterView.vue`: dự án solo (live, 1 checkout, 1 pane, không nhóm) = 1 dòng: folder + tên + (nhánh) + badge trạng thái + thời gian, bấm = focus pane, nút chevron riêng `data-rail-solo-toggle` mở dòng pane; `WorkspaceSidebar.vue`: `soloOpen` (mặc định gập, không lưu), `isShut`/`isShutKey` dùng cho tab-stop, menu, ArrowLeft/Right, rename, collapse-all/expand-all. ≥ 2 pane giữ như WP-3.
- Test/e2e: `lib/rail/rail.test.ts` thêm `isSolo` (+ sửa tên it 'checkout lines'); `e2e/v52-polish.cjs` (dim ở `[data-more-views]` menu) và `e2e/v25.cjs` (shortcuts/tour ở menu header).

### Lỗi 1-5 đạt?
1. ĐẠT — v70-tools pass 42/42 (lần 1 có 1 FAIL "response body is shown" ở bước .http, chạy lại pass; flaky, không liên quan).
2. ĐẠT — thanh tab 1 pane chỉ còn 1 ⋯ (ảnh 04); dim/phím tắt/guide trong ⋯ header (ảnh 05, 08).
3. ĐẠT — node Agent Map chỉ còn icon + dòng "Đang chạy" (ảnh 02).
4. ĐẠT — solo 1 dòng (ảnh 06), mở bằng chevron thấy dòng pane (ảnh 07).
5. KHÔNG TÁI HIỆN — v50-groups pass 3/3 lần chạy sau thay đổi (đã fail 2/2 ở WP-8, frame 2 57–60ms). So code với HEAD: không thấy thay đổi v79 nào chạy trong đường dust (onLeave/pinLeaving/onDustLeave y như HEAD); hitch ở frame đầu của dust (captureRect + gỡ tab) phụ thuộc tải máy khi 2 WP chạy song song. Kết luận: flaky do tải, không sửa.

### Test số thật
- `npm run typecheck -w @ccm/web` sạch. Vitest web toàn bộ: 597 file / 1596 pass / 0 fail (rail + i18n: 128 pass).
- Build web + desktop OK. E2E (CCM_E2E_DBG=9445 CCM_E2E_PORT=4398), exit 0: v70-tools, v52-polish, v50-groups, rail, tier2, split, agent-map, p6, v25, v76b, v78, v51-compact, shell-agent.

### Ảnh (docs/qa/v79/WP-11/)
01-monitor-map, 02-map-node-crop, 03-workspace-1-pane, 04-tab-bar-crop, 05-header-more-menu, 06-rail-solo-collapsed, 07-rail-solo-expanded, 08-header-more-menu-split. Script: scratchpad/wp11-shots.cjs (không commit).

### Ngoài phạm vi / lưu ý
- Hành động dời chỗ: Dim → ⋯ header (khi tab split); Phím tắt, Hướng dẫn Workspace → ⋯ header. Hàng đợi prompt vẫn ở ⋯ pane.
- Thông báo a11y Dim giờ phát cả khi đổi từ Settings (watch).
- Không chạy e2e cho shots badge trạng thái solo bằng agent thật (fixture chỉ shell).

### Changelog bổ sung
- en: The Workspace tab bar has a single ⋯ button; a project with one pane takes one rail row.
- vi: Thanh tab Workspace chỉ còn một nút ⋯; dự án chỉ có một pane chiếm một dòng ở rail.

### Index gợi ý (.code_index)
- `lib/rail/railModel.ts` `isSolo`, `RAIL_BADGE`; `RailClusterView.vue` solo head (`data-rail-solo-toggle`); `WorkspaceSidebar.vue` `soloOpen`/`isShut`.
- `AppHeader.vue` moreEntries có dim/shortcuts/tour; `WorkspaceView.vue` không còn menu help.
