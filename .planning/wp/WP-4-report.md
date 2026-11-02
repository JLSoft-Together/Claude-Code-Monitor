## WP-4 — PARTIAL
(Term + tab bar + File/Changes/Browser/Run header trims done; viewer panes keep their own toolbar when alone, Run bar keeps its run-state buttons.)

- Đã đổi:
  - `apps/web/src/lib/paneHead.ts` — thêm `headMode(multi, zoomed)` ('bar' | 'thin') và `statusWordShown(state)` (chữ trạng thái chỉ khi asked/failed/ended); `paneHead.test.ts` thêm test.
  - `workspace/TermPane.vue` — header viết lại: tên preset (tooltip = cwd + activity + title), nút nhánh ⑂ + diff +/−, ContextGauge, chip chỉ khi active (compact-suggest, compact step, session/process, peer, Overlap, LimitResume), ⋯ luôn hiện, +N, zoom (multi/zoomed), chia, đóng. Khi 1 pane không zoom: cả `<header>` được `<Teleport>` vào slot trên thanh tab (inject `ccm-pane-bar`), bỏ icon + tên; multi/zoom: header thin h-7 trong pane như cũ. Chữ trạng thái của chip chỉ hiện khi `statusWordShown` (còn lại sr-only + tooltip). Header gắn `data-pane-of="<key>"`.
  - `workspace/WorkspaceView.vue` — bỏ ResourcesButton + store (WP-5 lo popover), bỏ DimToggle khỏi thanh tab; nút "?" thành "⋯" (menu: Dim inactive panes [chỉ multi, `data-dim-toggle`, role menuitemcheckbox] + Shortcuts + Tour; `data-tour="ws-help"` giữ); X đóng tab chỉ hiện khi hover / focus / tab active; thêm slot `<div ref="paneBar" data-pane-bar>` + `provide('ccm-pane-bar')`.
  - `workspace/FilePane.vue` — bỏ nút hiện: fwp, http, mdSplit, md preview, tree, wrap, find, copy path, reveal, open in editor (tất cả đã có trong ⋯ `headMore`, phím tắt giữ). Còn hiện: chip diff (khi có thay đổi), layout mode XML, Save (dirty), Edit/Done, ⋯ + ViewPaneControls.
  - `workspace/ChangesPane.vue` — bỏ nút tree / log / refresh (vào ⋯); còn layout inline|split, nút Options, ⋯ (luôn hiện) + controls.
  - `workspace/BrowserToolbar.vue` — bỏ nút device, live reload, open file, open external, devtools (vào ⋯); còn back/forward/reload + ô địa chỉ + Handoff (chỉ khi có console count / đang picking) + ⋯ (luôn hiện).
  - `workspace/RunPane.vue` — bỏ nút Release check trùng (đã có trong menu config của RunBar).
  - e2e: `split, tabs-cwd, v51-compact, v52-polish, shell-agent, v69-ide, browser, tier2, v70-tools, flutter-preview, diff, split-diff, log .cjs` — selector chuyển sang `:is([data-pane="K"], [data-pane-of="K"]) …` hoặc đi qua ⋯ (`[data-pane-more]` → `[data-context-menu] [data-menu-id=…]`); dim toggle mở menu "⋯" tab trước, đọc `aria-checked`.
  - Không đụng: rail/**, WorkspaceSidebar, en.ts/vi.ts/index.ts, stores/ui.ts, LogRefsToolbar, LogPane (header đã tối giản: tên + slot end), ViewPaneControls.vue/PaneMore.vue (đủ dùng, không đổi).

- Nút/chip cũ → chỗ mới:
  | Pane | Cũ | Mới |
  |---|---|---|
  | Term | cwd text | tooltip tên (multi) / tooltip nhánh (bar) |
  | Term | activity tool+time | tooltip tên / tooltip header (bar); rail đã có |
  | Term | DevServerChip, attach, scripts, scan, queue (PromptQueueButton), restart/reconnect | ⋯ (entry dev/attach/scripts/scan/queue/restart; PromptQueueButton vẫn mount ẩn để mở popover) |
  | Term | compact-suggest, compact step, session chip, proc chip, peer, Overlap, LimitResume | giữ chỉ khi active; session/proc chip chỉ ghi chữ khi chờ/lỗi/kết thúc, còn lại icon + tooltip |
  | Term | branch, diff, gauge | giữ; khi 1 pane nằm bên phải thanh tab |
  | Term | zoom / chia / đóng | giữ (zoom chỉ khi multi/zoomed) |
  | File | fwp, http, mdSplit, md, tree, wrap, find, copy, reveal, openEditor | ⋯ |
  | File | Save (dirty), Edit/Done, diff chip, layout XML | giữ (ngoại lệ), dedupe `data-more` khi hẹp |
  | Changes | tree, log, refresh | ⋯ |
  | Browser | device, live, openFile, external, devtools; handoff (khi không có console count) | ⋯ |
  | Run | release check (nút trùng trong hàng trạng thái) | menu config của RunBar (đã có `data-run-release-check-open`) |
  | Tab bar | ResourcesButton | WP-5 (popover Hạn mức) |
  | Tab bar | DimToggle, "?" | menu "⋯" cuối thanh tab (Dim, Shortcuts, Tour) |
  | Tab bar | X đóng tab | hover/focus/active |

- Tiêu chí: 4/5 đạt theo code, 1 chưa nhìn.
  - [x] TermPane ≥420px: ⋯, zoom (multi), chia, đóng = ≤4 nút icon (+ nút nhánh là thông tin có menu worktree); mọi hành động cũ còn.
  - [x] Không trùng nút hiện / ⋯: chip điều kiện (compact) và các nút còn lại dùng `data-more` + `overflowEntries` có sẵn; các nút khác đã bỏ khỏi header nên chỉ ở ⋯.
  - [~] 1 pane: Term đạt (header lên thanh tab, h-7 thin khi split, zoom như cũ). Pane viewer (File/Changes/Browser/Run/Log) khi đứng một mình vẫn giữ toolbar riêng (là toolbar chức năng, không có header chung) — CHƯA làm theo "ẩn header".
  - [x] Container query collapse `@max-[…]` giữ nguyên ở header thin; trong thanh tab (không có ancestor `@container`) chỉ gauge ẩn bằng `max-lg`. CHƯA KIỂM bằng mắt: tràn ngang khi tab strip dài + slot rộng.
  - [x] typecheck web sạch; vitest paneHead + workspace + i18n pass; e2e selector đã sửa.
  - Chưa đạt: Run bar vẫn hiện Start/Stop/Reload/Restart/DevTools/refresh (e2e run-pane phụ thuộc, brief cho phép Start/Stop; Reload/Restart/DevTools để lại, ghi lại ở đây).

- Audit / Review:
  - Edge: pane hẹp → ⋯ vẫn luôn hiện, `@max-[300px]` giữ; zoom → `headMode` = thin (header ở lại pane, có +N); split rồi về 1 pane → header Teleport trở lại slot (reactive `inBar`); tab khác/ẩn (`visible=false`) → không teleport nên không có 2 header trong thanh tab; shell vs agent: shell không có queue/limit/overlap chip, vẫn có scan trong ⋯; pane ended/error: proc chip giữ chữ (exited/error), restart/reconnect ở ⋯; Run custom config và Browser không URL không đổi logic; Handoff vẫn mở được từ ⋯ (anchor truyền từ ⋯).
  - Mất: DimToggle onboarding tip (popover "thử dim") không còn vì nút đã vào menu; DevServerChip (chip link nhanh) chỉ còn qua ⋯; số badge hàng đợi prompt không hiện ở header (nhãn trong ⋯ có số).
  - Giả định: tab 1 pane → `multi=false` và `zoomed=false` (zoom chỉ có khi ≥2 pane), nên `headMode` đúng.
  - Tooltip activity trong bar lấy từ `headTip` (header title).
- Test:
  - `npm run typecheck -w @ccm/web` → exit 0, sạch.
  - `npx vitest run src/lib/paneHead.test.ts src/i18n src/components/workspace` → files 18, tests 30, pass 30, fail 0 (gồm 2 test mới `headMode`, `statusWordShown`).
  - E2E KHÔNG chạy (WP-8).
- Nhìn: CHƯA NHÌN: WP-8 chụp (cần xem: header teleport trên thanh tab, header thin khi split/zoom, pane hẹp, menu ⋯ tab bar, X tab hover).
- Hot file cần thêm: không — không có chuỗi i18n mới (dùng lại `workspace.paneHead.more`, `workspace.dim.*`, `wsHelp.*`); không có `ui-v79-pane.ts`.
- Ngoài phạm vi cần main xử lý:
  - e2e v76 dùng `[data-resources-button]` trong `[data-status-popover]` (WP-5) — nhớ khớp.
  - `DimToggle.vue` và `ResourcesButton` không còn được WorkspaceView dùng (DimToggle chưa xoá file, test nếu có vẫn chạy; cân nhắc xoá).
  - `wsHelp.button` key không còn dùng trong WorkspaceView (giữ để tránh test i18n lỗi).
  - Hạn chế "viewer pane khi 1 pane": nếu muốn ẩn toolbar viewer, cần tách toolbar chức năng khỏi controls — gói riêng.
  - Run bar (Reload/Restart/DevTools) chưa vào ⋯; nếu muốn, cần sửa e2e run-pane.
- Index:
  - `components/workspace/TermPane.vue` — header duy nhất; `inBar` (headMode) Teleport tới slot `ccm-pane-bar` (WorkspaceView `[data-pane-bar]`), `data-pane-of`.
  - `lib/paneHead.ts` — `headMode`, `statusWordShown`.
  - `components/workspace/WorkspaceView.vue` — tab row: slot pane bar, menu ⋯ (dim/shortcuts/tour), X tab hover.
- Changelog: en: "Pane headers are quieter: one pane lends its header to the tab bar, extra actions live in the ⋯ menu, and tab close buttons show on hover." / vi: "Header pane gọn hơn: pane đứng một mình đưa thông tin lên thanh tab, các thao tác phụ nằm trong menu ⋯, nút đóng tab chỉ hiện khi rê chuột."
- Commit message đề xuất: 🧹 Simplify workspace pane headers: tab bar hosts the lone pane header, extra actions move to the more menu
