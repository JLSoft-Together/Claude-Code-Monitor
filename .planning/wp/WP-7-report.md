# WP-7 report: dọn + nhãn trạng thái tiếng Việt

## Đã đổi
- Xoá `components/SessionBar.vue`, `components/workspace/DimToggle.vue` (không còn importer).
- `stores/ui.ts`: bỏ `BarDock`, `initialBar`, `barDock`, `barMin`, `toggleBar`, `toggleBarDock`, watch ghi `ccm.bar`. Key localStorage cũ `ccm.bar` bị bỏ qua (không ai đọc).
- `style.css`: xoá `.ccm-side-*` (không còn Transition `ccm-side`), `.ccm-bar-in-*`, `.ccm-bar-alert`, `::view-transition-group(ccm-bar)` (chỉ SessionBar dùng); giữ `.ccm-kbd-enter-active` trong reduced-motion.
- `lib/shortcuts.ts`: thêm `{ id: 'settings', keys: ['Mod', ','], group: 'help' }` (handler Ctrl+, đã có sẵn ở SettingsMenu.vue `onGlobalKey`).
- i18n: nhãn trạng thái vi, thêm `keys.item.settings`, dọn key chết (bên dưới).
- e2e `v52-polish.cjs`: bỏ 3 check F6 về tip Dim một lần (tip gắn vào nút DimToggle đã bỏ).

## Key đã đổi (vi.ts)
- `dashboard.working`: Working -> Đang chạy
- `dashboard.waiting`: Waiting -> Đang chờ
- `dashboard.errors`: Error -> Lỗi
- `status.working`: Working -> Đang chạy
- `status.waiting`: Waiting -> Đang chờ
- `status.idle`: Idle -> Rảnh
- `status.completed`: Completed -> Xong
- `status.error`: Error -> Lỗi
- `status.cancelled`: Cancelled -> Đã huỷ
- `status.unknown`: Unknown -> Không rõ
- `status.stale`: giữ Đã đóng
- Thêm (en + vi): `keys.item.settings` = Open Settings / Mở cài đặt
- Xoá (en + vi): `bar.label/collapse/expand/dockTop/dockBottom`, `keys.item.bar`, `keys.item.barDock` (giữ `bar.details`, SessionSummary dùng); `workspace.dim.tipTitle/tipBody/tipTry/tipLater` (workspace-v52.ts); `wsHelp.button` (workspace-v25.ts).
- Khối vi các file i18n khác: grep Working/Waiting/Idle/Error/Completed/Cancelled không còn nhãn trạng thái tiếng Anh (các match còn lại đều nằm trong khối en). `workspace-v52 activity.working` vi đã là "Đang làm".

## Tiêu chí
- [x] SessionBar + barMin/barDock hết, typecheck sạch
- [x] không còn nhãn trạng thái tiếng Anh trong vi
- [x] i18n parity test pass (nằm trong full vitest)
- [x] e2e/unit so chuỗi: unit không so chuỗi vi; e2e `p2.cjs` đã có alternation Đang|Chờ|Rảnh; `v52-polish.cjs` F6 sửa như trên; `v73.cjs` (Waiting for reset) là locale en, giữ.
- 2c: tip Dim lần đầu KHÔNG chuyển được (popover neo vào nút DimToggle, mục Dim trong menu ⋯ đóng ngay khi chọn) -> bỏ tip, key `localStorage ccm.workspace.dimTip` không còn dùng. Dim vẫn có: menu tab ⋯ (`data-dim-toggle`), Settings, command palette.
- 2d: `history.worked` = "làm {d}", `history.waited` = "chờ {d}" không đụng tới status.* nên vẫn đọc đúng.
- 3 (chữ tràn): nhãn mới dài hơn nhất là "Đang chạy"/"Đang chờ" (9 ký tự so với 7-8 của en), chưa đo trên UI; để WP-8 nhìn.

## Audit
Grep `barMin|barDock|toggleBar|SessionBar|DimToggle|ccm-side|ccm-bar` toàn apps: không còn tham chiếu. Không động tới file ngoài phạm vi (WP-1..6 giữ nguyên).

## Test
- `npm run typecheck -w @ccm/web`: sạch (exit 0).
- vitest toàn apps/web: 596 file, 1593 test, 1593 pass, 0 fail.
- Chưa chạy e2e (WP-8). CHƯA NHÌN: WP-8.

## Index (gợi ý cho .code_index)
- `stores/ui.ts`: bỏ state thanh session (barMin/barDock); `SessionBar.vue` + `DimToggle.vue` đã xoá.
- `lib/shortcuts.ts`: thêm `settings` (Mod+,) vào nhóm help.
- `i18n/vi.ts`: `status.*`, `dashboard.working|waiting|errors` tiếng Việt hoá.

## Changelog
- en: Status labels are now fully Vietnamese in the Vietnamese UI; the old session bar code was removed.
- vi: Nhãn trạng thái giờ hoàn toàn bằng tiếng Việt (Đang chạy, Đang chờ, Rảnh, Xong, Lỗi, Đã huỷ); dọn code thanh session cũ.

## Commit đề xuất
`🧹 v79 WP-7: nhãn trạng thái tiếng Việt, xoá SessionBar/DimToggle/CSS thừa, thêm phím tắt Mở cài đặt vào bảng`
