# PLAN v79: làm gọn UI (Monitor, Workspace, Settings, màn phụ)

Nguồn: wireframe chủ nhân duyệt 2026-11-03
- Settings A: https://claude.ai/artifact/PCMaYSQzDjo1vZ34GXnBEz
- Monitor / Workspace / chrome / màn phụ: https://claude.ai/artifact/HNxQvJpojdow5CaN2fArjk

Nguyên tắc (frontend-design + ui-ux-pro-max + web-design, CLAUDE.md thắng khi lệch): mỗi trạng thái hiện 1 lần
ở mỗi tầng, mỗi màn 1 điểm nhấn, không lồng thẻ, chữ phụ ≥ 11px, hành động không lặp giữa nút hiện và menu ⋯,
giữ theme / font hệ thống / token màu (COLOR-SYSTEM). Không đổi tính năng, chỉ đổi bố cục + lối vào.

## Quyết định (chủ nhân "ok làm đi" 2026-11-03, câu hỏi treo lấy mặc định đề xuất)
- Tên trạng thái locale vi: tiếng Việt hết (Đang chạy / Đang chờ / Rảnh / Lỗi / Xong / Đã huỷ / Đã đóng). en giữ nguyên.
- Monitor: bỏ banner WaitingQueue khi cột Session mở; khi cột đóng hiện 1 dòng mỏng "Cần chủ nhân · N" bấm mở cột.
- Workspace: tab chỉ 1 pane → ẩn header pane, thông tin chuyển lên phải thanh tab.
- Commit: không commit (rule global), message đề xuất ở `.planning/COMMITS.md`. Build app desktop + typecheck + unit + E2E: được (memory build-test-after-code).

## Gói việc
| WP | Tên | Phạm vi chính | Vòng |
|---|---|---|---|
| 1 | Settings cửa sổ sidebar | SettingsMenu.vue → components/settings/* | 1 |
| 2 | Monitor | MonitorView, SessionList, SessionCard*, WaitingQueue, AgentMap | 1 |
| 3 | Workspace rail | workspace/rail/*, WorkspaceSidebar, RailColumn | 1 |
| 4 | Workspace header pane + thanh tab | TermPane header, ViewPaneControls, WorkspaceView tab row | 2 |
| 5 | Thanh trên cùng + onboarding | AppHeader, PlanLimits, KeepAwakeBadge, DiskBadge, ResourcesButton, Tour/What's new | 2 |
| 6 | Màn phụ | history/, usage/, devices/DevicesView, extensions/ExtensionsView, log/LogRefsToolbar | 2 |
| 7 | Dọn | SessionBar.vue + barMin/barDock, nhãn trạng thái vi | 3 |
| 8 | QA | build app desktop, E2E đủ, ảnh từng màn | 3 |
| 9 | Trang trước/sau + ảnh release | web-design + stageshow, ảnh thật từ WP-8 | 4 |

Brief: `.planning/wp/WP-<n>.md`. Luật subagent: `.planning/AGENT-RULES-v79.md`.

## Hot file (main là chủ, WP ghi "Hot file cần thêm")
`apps/web/src/i18n/en.ts`, `vi.ts`, `index.ts` (WP tạo file `i18n/ui-v79-<wp>.ts`, main đăng ký) · `stores/ui.ts` (WP-1 sở hữu ở vòng 1, WP-7 ở vòng 3) ·
`stores/settings.ts` · `App.vue` (WP-5 sở hữu vòng 2) · `.code_index/*` (main / agent index cuối).

## Ảnh minh hoạ (chủ nhân 2026-11-03 "dùng cả đi")
- WP-9: trang HTML trước/sau v79 (skill web-design) dùng ảnh thật WP-8; màn chưa chụp được thì dựng faux UI bằng skill stageshow.
- Release 2.7.0: ảnh What's new / release notes / README dựng bằng stageshow (token màu khớp app).

## Lệch so với wireframe (đã chấp nhận, WP-8/9 soát theo)
- Settings › Thông báo: 2 công tắc kênh (toast, trong app) + bảng, thay 1 công tắc chính (2 store riêng).
- Workspace 1 pane: chỉ terminal agent ẩn header (Teleport lên thanh tab); viewer pane giữ toolbar đã bớt nút trùng.
- RunBar giữ Start/Stop/Reload hiện.
- Nút Hạn mức hiện "% còn lại" thấp nhất như header cũ.
- Sau WP-8: so ảnh thật với wireframe từng màn, lệch / chưa gọn → WP sửa trước WP-9.

## Release (chủ nhân 2026-11-03)
- Version 3.0.0. Sau WP-8 (+ WP sửa nếu có) và WP-9: viết lại README (ngắn, liệt kê), RELEASE-3.0.0.md (en + vi, liệt kê), changelog.ts mục 3.0.0,
  bump apps/desktop/package.json + package-lock, commit + push master, tag v3.0.0 → workflow desktop → `gh workflow run release`. Chủ nhân cho phép commit + push + release lần này.
