## WP-8 — PARTIAL (QA xong, phát hiện 1 lỗi nặng + 1 lỗi chức năng, cần WP sửa)

- Typecheck: sạch cả 7 workspace (`npm run typecheck`).
  Unit: web 1593/1593 (596 file) · desktop 1057/1057 (385 file) · collector 372 pass / 373 (1 skip, 0 fail, 142 file) · shared: không có test (chỉ src).
- Build: `npm run build -w @ccm/web && npm run build -w @ccm/desktop` OK (chỉ cảnh báo chunk > 500 kB).
- E2E: chạy `run.cjs` (52 script) với CCM_E2E_DBG=9444 CCM_E2E_PORT=4399: lần đầu 1163 pass / 30 fail. Phân loại sau khi chạy lại riêng từng script:
  - Flaky (pass khi chạy lại): v74 (adb emu kill / refresh), v76b (agent data undo/rollback), v77b (lần đầu "shell reopens in folder"; sau rerun 25/25).
  - Do selector/hành vi v79 đổi (ĐÃ sửa e2e, rerun pass hết): p2, p5, p6, v25, extensions, log, flutter-preview, pane-drag, v69-ide, v77a, shell-agent.
  - HỒI QUY THẬT còn lại: **v70-tools "prompt queue"** (timeout `queue popover`): chọn "Hàng đợi prompt" trong menu ⋯ của pane agent không mở popover. Đã tái hiện riêng bằng script CDP: popover không xuất hiện. Nghi ngờ `TermPane.vue:334`: `queueButton.value?.open((more.value?.$el as HTMLElement)?.getBoundingClientRect())`; `PaneMore` có root fragment (button + ContextMenu v-if) nên `$el` là node text, không có getBoundingClientRect (hoặc rect sai), mà `PromptQueueButton` nằm trong `<span class="hidden">` nên rect dự phòng cũng bằng 0. Nên dùng `more.value?.button?.getBoundingClientRect()` (PaneMore đã expose `button`).
  - Chưa rõ: **v50-groups** "dust runs without long frames" fail 2/2 lần, luôn ở frame 2 (57-60ms, 1/189 khung, ngưỡng 50ms). Giống hitch lúc bắt đầu animation, chưa chứng minh do v79; cần chạy lại trên bản HEAD để so (không làm được ở đây vì không git stash).
  - Tổng sau sửa: chỉ còn 2 script fail (v70-tools 1 check, v50-groups 1 check); các script còn lại pass.
- E2E đã sửa (apps/desktop/e2e):
  - p2.cjs: nút Reconnect chuyển vào menu ⋯ (id `restart`); header đọc qua `[data-pane-of]` (header Teleport lên thanh tab).
  - p5.cjs: nút "Open in Orrery" nay là mục menu ⋯ của thẻ; cảnh báo hai writer là hint của mục con `reopen-confirm`, không còn alertdialog; huỷ bằng Escape.
  - p6.cjs: tên nhóm rail đọc từ `[data-rail-name]` (h3 có thêm nhánh); nút đóng pane là `[data-pane-head] [data-pane-close]`.
  - v25.cjs: nút Attach nằm trong menu ⋯, panel không tự mở khi thả file; mở qua store `attachments.toggle` trước khi kiểm.
  - extensions.cjs: tab Extensions không còn trên header, kiểm mục trong menu `[data-more-views]`.
  - log.cjs: mục `log` của menu ⋯ chỉ xuất hiện khi repoRoot đã xác định, nên mở lại menu tới khi có.
  - flutter-preview.cjs: `[data-kind=file] [data-pane-more]` giờ có nhiều pane, chọn nút hiển thị cuối; thêm sleep 300ms vì nút ⋯ bỏ qua click trong 250ms sau khi menu đóng.
  - pane-drag.cjs: header v79 nhiều control, tìm điểm trống thực sự để bắt đầu kéo thay vì x+30.
  - v69-ide.cjs: chip overlap tìm trong `[data-pane-of=...]` (header teleport).
  - v77a.cjs: Agent data nằm trang Settings "data", chuyển trang trước khi tìm.
  - shell-agent.cjs: header 1 pane không còn tên preset; nhận biết agent qua icon + nhãn ở hàng rail.
  - Thêm mới: v79-shots.cjs (chụp màn + kiểm tràn ngang / chữ < 11px / chip cắt). KHÔNG thêm vào run.cjs vì vẫn có check fail thật (Settings Thông báo) cho tới khi sửa xong.
- Ảnh: 33 ảnh trong docs/qa/v79 + RESULT.md (ĐẠT/LỖI từng mục). Tóm tắt:
  - ĐẠT: Monitor mở/đóng (thẻ 3 dòng 92px, không tràn, không chữ < 11px), menu ⋯ thẻ, sheet hẹp (bottom sheet 461/700), cụm zoom không đè gì khi không có AgentDetails, theme sáng, History/Usage/Devices/Extensions, Workspace 1 pane (header lên thanh tab) và split 2 pane (header mỏng), rail 7 dự án, Git Log toolbar.
  - LỖI NẶNG: **Settings xếp dọc** (10 trang, cả sáng/tối): `SettingsMenu.vue:232` đặt `@container` và `@[720px]:flex-row` trên cùng một phần tử, container query không áp cho chính container; sidebar 10 mục chiếm ~450px, vùng nội dung chỉ cao 121px (thấy được ~1,5 dòng). Unit test không bắt được. Cách sửa: bọc `@container` ra phần tử cha (vd. div ngoài / `ccm-sheet`) hoặc dùng breakpoint viewport `min-[...]:`.
  - LỖI: trang Thông báo cao 1527px khi ép layout 2 cột (~1,7 màn 900px, ~2,7 lần vùng nhìn dialog); mục tiêu <= ~1,3 màn chưa đạt. Tìm kiếm Settings hoạt động (focus nằm trong dialog) nhưng bỏ dấu nên "âm" khớp cả "Làm mờ", "Mẹo phím tắt" (nhiễu). Khung nháy dòng sau khi chọn chưa chụp được.
  - Chưa kiểm được: PlanLimits có số liệu (fixture không có dữ liệu hạn mức), AgentDetails vs cụm zoom (click thẻ không mở panel trong script), menu ⋮ của toolbar nhánh (ảnh 23 trùng 22), nhãn trạng thái tiếng Việt tràn chip trong trạng thái khác "Đang chạy" (fixture chỉ có busy).
  - Lưu ý nhỏ: sau Esc đóng popover Hạn mức, focus ring xanh dính ở nút "Hạn mức" khi đổi tab (ảnh 09, 14, 16) — hành vi trả focus, không phải lỗi.
- So wireframe: Monitor, thẻ, menu ⋯, sheet, Workspace 1 pane / split khớp. Lệch: Settings (vỡ layout, trang Thông báo còn dài); rail chưa gọn rõ (dự án 1 pane vẫn tốn 2 dòng: đầu nhóm + hàng, 24 dòng cho 8 dự án); thanh tab của Workspace 1 pane có 2 nút ⋯ cạnh nhau (pane và panel phải), dễ nhầm.
- Đề xuất WP sửa:
  1. Sửa layout dialog Settings (`SettingsMenu.vue:232`), chạy lại v79-shots (ảnh 10, 13) và thêm e2e/vitest kiểm sidebar nằm cạnh nội dung (rect.left của nội dung > rect.right của sidebar).
  2. Sửa `TermPane.vue:334` mở popover hàng đợi prompt từ menu ⋯ (dùng `more.value?.button`); chạy lại v70-tools.
  3. Rút gọn trang Thông báo (≤ ~1,3 màn): gộp / thu gọn nhóm Âm thanh + giờ yên lặng, hoặc ẩn bớt phần phụ vào "Nâng cao".
  4. Cân nhắc gộp nhóm rail 1 pane thành 1 dòng; bỏ trùng nút ⋯ trên thanh tab Workspace.
  5. Điều tra v50-groups dust frame 2 (so với HEAD).
  6. Khi tìm Settings: không bỏ dấu tiếng Việt khi từ khoá có dấu (hoặc xếp hạng khớp chính xác lên đầu).
- Gợi ý cập nhật `.code_index` (main làm): `apps/desktop/e2e/v79-shots.cjs` (QA ảnh v79) · pane header Teleport: e2e dùng `[data-pane-of]`, không dùng `[data-pane] header` cho pane đơn.
