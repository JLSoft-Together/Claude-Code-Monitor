# Audit v52 — UI + motion Workspace (2026-10-16)

Nguồn: ảnh E2E `%TEMP%\ccm-e2e\` (v49/v50/v51/rail/project-panes/split) + 4 agent đọc code (rail, tab+pane, overlay, motion) + con kiểm lại từng mục. Mục agent báo sai đã loại (cuối file).

## A. Lỗi thấy được (ưu tiên cao)

| # | Vấn đề | Chỗ | Hướng sửa |
|---|---|---|---|
| A1 | Pane hẹp: nút header (Running, ↻, ▷, ◫, ✕) tràn sang header pane bên cạnh ("✕Shell" dính nhau, ảnh `project-panes-5`) | `TermPane.vue:715-843` mọi nút `shrink-0`, không container query | `@container` trên `section`; bậc rộng: ẩn cwd + session title → nhánh chỉ còn icon → attach/scripts vào menu "…" → chip trạng thái chỉ icon. Áp cho FilePane / BrowserToolbar |
| A2 | Nhánh git cắt còn 1 chữ "⑂ r" | `TermPane.vue:737` `max-w-[16ch] truncate` | Hẹp thì chỉ icon (tooltip = tên nhánh) |
| A3 | 3 từ cho cùng trạng thái: header shell "Running", rail "Shell · Ready", chip Claude "Idle", tile Mission "Ready" | `TermPane.vue:110-121` (`workspace.state.running`) vs `i18n/workspace-rail.ts` | Header chỉ hiện trạng thái tiến trình khi khác thường (Starting / Exited / Error); trạng thái agent dùng chung bộ từ của rail ở cả header, rail, Mission |
| A4 | Pane đang focus chỉ có viền 1px `outline-focus` — khó thấy, nhất là dark | `TermPane.vue:847`, `WorkspaceView.vue:1779` | Header pane active: tên `text-ink` + chấm accent, pane khác header `text-ink-faint`; viền 2px fade; tuỳ chọn làm mờ nhẹ pane không active (kiểu iTerm) |
| A5 | Menu chuột phải mở ra đã tô xanh mục đầu (fill accent + ring) | `ui/ContextMenu.vue:147` focus item đầu khi mount + `ITEM` dùng `focus:bg-accent` | Focus vào khung menu (`tabindex=-1`), chỉ tô khi hover / phím mũi tên (giống macOS). SplitMenu cùng lỗi |
| A6 | Thanh tab thoáng hiện thanh cuộn + mũi tên dù chỉ 2 tab (ảnh `v51-01-menu`, `rail-03`) | `WorkspaceView.vue:1556` `overflow-x-auto` + `.ccm-tab-enter-active` scale `ease-spring` (vọt 1.32) làm tràn tạm | Ẩn scrollbar (`scrollbar-width: none`) + mờ mép khi tràn thật; scale vào dùng `ease-out-quint` |
| A7 | Mission Control 1920px: thẻ ~310px dồn góc trái trên, phần lớn trống; thumbnail terminal chỉ 1 dòng | `mission/MissionCard.vue:172` `h-40` cố định | Lưới tự co giãn lấp đầy màn (kiểu Exposé), cao thẻ theo chỗ trống, hiện N dòng cuối |
| A8 | Rail nhiều dòng trùng tên ("docs", "docs", "docs") không phân biệt được | `rail/RailRow.vue` dòng 1 = `titleOf` | Anh em trùng tên thì thêm hậu tố phân biệt (thư mục con / nhánh / số thứ tự `docs · 2`) |
| A9 | Chip trạng thái dài ("Waiting on 1 subagent") ép cwd còn ".../" | `TermPane.vue:724` cwd `shrink` trước chip | Gộp vào A1: chip rút gọn ("1 subagent") trước khi cwd mất |

## B. Motion

| # | Vấn đề | Chỗ | Hướng sửa |
|---|---|---|---|
| B1 | Tile Mission animate `left/top/width/height` (layout) | `MissionCard.vue:237-246` `.mc-tile` | FLIP bằng `transform` |
| B2 | Header nhóm rail animate `min-height` khi gập/mở (đổi 4px, reflow) | `RailGroupHead.vue:57-58` | Cao cố định, chỉ đổi nội dung bên trong |
| B3 | Overshoot spring (1.32) dùng cho cả scale tab, xoay chevron → nảy, không hợp chrome | `--ease-spring` ở `style.css` | Spring vọt chỉ cho "pop" phản hồi; chrome dùng `ease-out-quint` |
| B4 | Vài giá trị lẻ ngoài token: 240/320/340/480/520ms, `cubic-bezier(0.4,0,0.7,1)` (`dust.ts`), `(0.32,0.72,0,1)` (`MissionControl.vue:51`) | nhiều chỗ | Gom vào `--ccm-dur-*` / `--ease-*` |
| B5 | Trạng thái nhóm rail chỉ có chữ + animate khi gập; mở thì đổi trạng thái không có phản hồi ở header | `RailGroupHead.vue:100-104` | Chấm trạng thái nhỏ ở header cả khi mở |

Đã tốt: token `--ccm-dur-press/fast/base/slow` + `--ease-out-quint/spring/exit` dùng rộng; reduced-motion có guard toàn cục (`style.css:931+`, transition chỉ còn opacity/màu); mọi chỗ xoá đều có dust hoặc fade; View Transition pane + dust đã tách.

## C. A11y / tương tác

- C1 Rail không có `role="tree"/"treeitem"`, `aria-level`, `aria-expanded` cho cluster (chỉ roving `[data-side-item]`) — `WorkspaceSidebar.vue:538`.
- C2 Flyout `RailColumn.vue:115` `role="dialog"` thiếu `aria-modal` (cần kiểm focus trap).
- C3 Nút đóng row rail `opacity-0` + `size-5` — chỉ hiện khi hover / focus-visible.

## D. Tính năng đề xuất

| # | Tính năng | Giá trị | Công | Ghi chú |
|---|---|---|---|---|
| F1 | **Phóng to pane** (zoom/maximize): pane chiếm cả tab, pane khác ẩn; `Mod+Shift+Enter`; chip "Đang phóng · 3 ẩn" | Cao | Thấp | View Transition `ccm-pane-*` có sẵn → morph gần như miễn phí |
| F2 | **Hoàn tác đóng** + bụi ghép ngược: toast "Đã đóng 2 pane · Hoàn tác" 5 s, `Mod+Shift+T`; shell mở lại cùng cwd, Claude mở lại bằng `--resume` (đường v49) | Cao | Vừa | Bụi bay ngược về ghép lại = chữ ký motion. Shell mất history (chỉ khôi phục cwd) |
| F3 | **Dòng "đang làm gì"**: rail dòng 2 + header: "Edit · WorkspaceView.vue · 2:14", diff `+12 −3` | Cao | Thấp | Dữ liệu có sẵn: `Agent.currentTool`, `TerminalSession.lastActivityAt`, `diff`. Chỉ tên tool + basename, không args (hard rule) |
| F4 | **Gợi ý Compact theo ngữ cảnh**: ContextGauge ≥ 80% + agent rảnh → chip "Ngữ cảnh 82% · Compact…" mở luồng v51 | Vừa | Thấp | Chỉ gợi ý, chủ nhân bấm mới chạy |
| F5 | **Mission Control v2**: lưới lấp màn (A7), "Cần bạn" lên đầu, gõ để lọc, phím số chọn, thumbnail N dòng | Vừa | Vừa | |
| F6 | **Làm mờ pane không active** (tuỳ chọn Settings) | Vừa | Thấp | Đi kèm A4 |

## E. Agent báo sai (đã loại)

- `duration-(--ccm-dur-fast)` "sai cú pháp" — đúng cú pháp Tailwind v4 (`tailwindcss ^4.1.14`).
- Mission thiếu guard reduced-motion — guard toàn cục `style.css:931+` đã phủ mọi transition.
- `<Transition name="ccm-fade">` "mặc định 300ms" — thời lượng lấy từ class CSS.
