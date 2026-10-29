# Tính năng đã có (catalog)

Rà trước khi đề xuất ý tưởng mới. Cập nhật khi thêm / bỏ tính năng. Ý tưởng đã đề xuất nhưng chưa làm / đã gạt: xem `.planning/IDEAS-*.md`.

Đường dẫn: `apps/web/src/` (web), `apps/collector/src/` (collector), `apps/desktop/src/` (Electron), tính từ repo root. vNN = plan `.planning/PLAN-vNN-*.md`.

## Monitor (theo dõi session)

- **Theo dõi session Claude Code realtime** (v1) — process, transcript, trạng thái, tên terminal; snapshot rồi chỉ gửi event tăng dần · `apps/collector/src/monitor.ts`
- **Session card** — tên tự đặt / đổi tên, ghi chú, ghim, context %, đếm token, hành động hover, Shift+F10 · `apps/web/src/components/SessionCard.vue`
- **Danh sách session** — sắp xếp (ghim trước, thứ tự đóng băng khi trỏ chuột), Xoá session đã kết thúc · `apps/web/src/components/SessionList.vue`
- **Hàng đợi chờ chủ nhân** (WaitingQueue) — session đang chờ duyệt / hỏi, nhảy tới ngay · `apps/web/src/components/WaitingQueue.vue`
- **Lọc theo project** (v66) — dải project, lọc danh sách session theo repo đang live · `apps/web/src/components/ProjectStrip.vue`
- **Yêu thích** — thêm / đổi tên / sắp xếp thư mục yêu thích, tối đa 50 · `apps/collector/src/favorites.ts`
- **Mở thư mục / nhảy tới terminal** — mở folder ở Explorer / Finder / VS Code; focus cửa sổ terminal chứa session · `apps/collector/src/opener.ts`, `apps/collector/src/focus.ts`
- **Khởi chạy Claude** — mở wt.exe tab hoặc Terminal / iTerm trên macOS tại thư mục đã chọn · `apps/collector/src/launcher.ts`
- **Job nền** — liệt kê, ẩn (job.dismiss), dừng bằng `claude stop` · `apps/collector/src/job-stop.ts`
- **Ghi nhận phản hồi** — thời gian chờ → busy trong ngày · `apps/collector/src/response.ts`
- **Cảnh báo kẹt / vòng lặp lỗi / cache nguội** — gắn cờ session stuck, lặp lỗi, cache hết hạn · `apps/web/src/lib/attention.ts`
- **Xung đột file giữa session** — cảnh báo hai session sửa cùng file · `apps/web/src/lib/conflicts.ts`
- **Tin nhắn giữa main agent** (v54) — hiệu ứng gửi / nhận giữa hai session, cạnh peer · `apps/collector/src/peers.ts`
- **Thanh tiến độ hạn mức (PlanLimits)** — còn bao nhiêu quota, dự báo, delta · `apps/web/src/components/PlanLimits.vue`
- **Thống kê nhanh (MetricsStrip)** — ô số liệu: thời gian phản hồi, chi phí hôm nay / ngân sách · `apps/web/src/components/MetricsStrip.vue`
- **Tóm tắt "đi vắng" (AwaySummary)** — việc đã xong khi chủ nhân không có mặt · `apps/web/src/components/AwaySummary.vue`
- **Ghi chú session** (v9) — `Monitor.setNote` · `apps/collector/src/store.ts`
- **Tên terminal / đổi tên alias** — alias lưu trong `aliases.json` · `apps/collector/src/aliases.ts`
- **Chế độ thu gọn (Compact view)** — cửa sổ nhỏ `?mode=compact`: đang chờ / đang làm · `apps/web/src/components/CompactView.vue`
- **Tự ẩn session đã kết thúc / ẩn tool call** — `settings.hideFinished`, "Hide tool calls" trong Activity · `apps/web/src/stores/settings.ts`
- **Bottom sheet Sessions trên màn hẹp** (< 768 px) — v-ngang điện thoại / cửa sổ nhỏ · `apps/web/src/components/MonitorView.vue`
- **Diagnostics** — poll `diagnostics.get`, lưu / copy log desktop · `apps/web/src/components/DiagnosticsDialog.vue`

## Agent Map (sơ đồ agent)

- **Bản đồ main agent → sub-agent** (v1, v14, v53) — node MainNode / SubPill / DoneTray, bố cục cây `pickLayout` · `apps/web/src/components/AgentMap.vue`
- **Node kéo, đổi cỡ, nhớ vị trí** — lưu `ccm.mapLayout.v53` · `apps/web/src/components/AgentMap.vue`
- **Điều hướng bằng phím, tìm trên bản đồ, menu node** (v47) — `apps/web/src/lib/mapNav.ts`, `apps/web/src/lib/mapMenu.ts`
- **Hiện đường chạy tool và cạnh peer** — TreeEdge, PeerEdge, mẫu đường cố định · `apps/web/src/components/TreeEdge.vue`
- **Toàn màn hình bản đồ** — phím Shift+F, `useFullscreen` · `apps/web/src/composables/useFullscreen.ts`
- **Bộ điều khiển cảnh (Map | Office)** — chuyển giữa bản đồ và Office · `apps/web/src/stores/ui.ts`
- **Đếm sub-agent đang chạy trong status** (v50) — `apps/web/src/lib/subagents.ts`

## Office (Habblaud, phòng pixel-art)

- **Office pixel-art** (v60) — mỗi project một phòng, mỗi agent một nhân vật, hành vi xã hội · `apps/web/src/components/office/OfficeView.vue`
- **Timelapse ngày** (v60) — chọn ngày, tốc độ 60–600x, thanh cuộn, phím L · `apps/web/src/components/office/OfficeTimelapse.vue`
- **Âm thanh báo hiệu + thanh âm lượng** (v60) — `apps/web/src/components/office/OfficeView.vue`
- **Bấm nhân vật đang hỏi để nhảy tới session** — `apps/web/src/components/office/OfficeView.vue` (`jumpIfAsking`)
- **Theme pack + tùy chọn theme mùa** (v62) — gói giao diện, cài theme trong `OfficeOptions` · `apps/web/src/lib/office/packs.ts`
- **Office toàn màn hình** (v62) — Shift+F · `apps/web/src/components/office/OfficeView.vue`
- **Kiểu 3D isometric** (v63, beta) — chuyển Pixel / 3D mượt, art 3D tải theo nhu cầu, giảm hiệu ứng khi fps thấp · `apps/web/src/lib/office/iso/IsoRenderer.ts`
- **Dữ liệu Office phía collector** (v60) — `OfficeModel` (phòng, nhân vật, tool), `OfficeHub` phát snapshot · `apps/collector/src/office/model.ts`, `apps/collector/src/office/hub.ts`
- **Lưu timeline ngày** — `<dataDir>/timeline/*.jsonl`, giữ 7 ngày · `apps/collector/src/timeline.ts`

## Usage & History (thống kê)

- **Trang Usage** (v2, v53) — tổng, biểu đồ theo ngày, hạn mức, xếp hạng project / model; chi phí ước tính · `apps/web/src/components/usage/UsageView.vue`
- **Chọn project cho Usage** — hộp chọn có resize, bảng project · `apps/web/src/components/usage/ProjectPickerDialog.vue`
- **Usage index bền vững** — quét mọi `projects/**/*.jsonl`, lưu `usage-index.json`, chỉ đếm số, không lưu nội dung · `apps/collector/src/usage.ts`
- **Dự báo hạn mức** — hồi quy bình phương tối thiểu, `limit-history.json` · `apps/collector/src/forecast.ts`
- **Tab History** — bảng tổng, timeline trạng thái theo giờ · `apps/web/src/components/history/HistoryView.vue`
- **Lịch sử session đã kết thúc** — tối đa 1000 session · `apps/collector/src/history.ts`
- **Heatmap giờ × ngày** (2026-10-29) — 28 ngày, `heatmap.get` · `apps/web/src/components/history/HeatmapChart.vue`
- **Thống kê tool / skill / MCP** (v73) — theo project, 7 / 30 ngày · `apps/web/src/components/history/ToolStatsCard.vue`
- **Tóm tắt (Recap) xuất được** — ngày hoặc 7 ngày, so với 7 ngày trước · `apps/web/src/components/RecapDialog.vue`
- **Ngân sách chi phí hằng ngày** — `settings.dailyBudget` · `apps/web/src/stores/settings.ts`
- **Đo thời gian tool (Tool timeline / spans)** — ghép tool_use với kết quả · `apps/collector/src/tool-spans.ts`
- **Ngữ cảnh nền của session** (v72) — token lượt đầu và kích thước CLAUDE.md, memory, skill · `apps/desktop/src/preview/contextSources.ts`

## Thông báo, toast, nhắc nghỉ

- **Toast Windows** (v9–v11) — chờ input, kẹt, đầy context, job, hạn mức; hoãn (snooze), giờ yên lặng, test · `apps/collector/src/toast.ts`
- **Toast trên macOS** — badge dock và nảy icon · `apps/desktop/src/attention.ts`
- **Thông báo trình duyệt / tiếng chuông / tiêu đề tab nhấp nháy** — chỉ khi cửa sổ ẩn · `apps/web/src/composables/useNotifications.ts`
- **Nhắc nghỉ giải lao** — toast nhắc sau một khoảng thời gian · `apps/web/src/composables/useBreakReminder.ts`
- **Link từ toast** — hoãn (snooze), focus session, mở pane · `apps/desktop/src/main.ts`
- **Cài đặt thông báo** — từng loại, âm thanh, giờ yên lặng · `apps/web/src/components/SettingsMenu.vue`

## Workspace & terminal (lõi)

- **Terminal nhúng (PTY)** (v18) — xterm, nhiều pane, chia tab, lưu / khôi phục bố cục · `apps/desktop/src/pty/host.ts`
- **PTY host cách ly** — utilityProcess riêng, token mới mỗi lần fork · `apps/desktop/src/pty/supervisor.ts`
- **Chia pane, tab, đổi tên tab, nhóm tab** (v18, v50) — cây chia nhị phân · `apps/web/src/lib/splitLayout.ts`
- **Kéo thả pane / tab** (v48) — vùng thả trên pane · `apps/web/src/composables/usePaneDrag.ts`
- **Phóng to pane, hoàn tác đóng pane** (v52) — `Tab.zoom`, `closedStack`, UndoToast · `apps/web/src/components/workspace/UndoToast.vue`
- **Làm mờ pane không hoạt động** (v52) — DimToggle · `apps/web/src/components/workspace/DimToggle.vue`
- **Dust hiệu ứng khi đóng pane** (v50, tùy chọn) — `apps/web/src/lib/dust.ts`
- **Khôi phục workspace, chọn project để chạy** (v64) — pane ngủ "parked" · `apps/web/src/components/workspace/RestorePicker.vue`
- **Hàng đợi spawn** — tối đa 2 pane khởi động cùng lúc, ưu tiên pane đang nhìn thấy · `apps/web/src/lib/spawnQueue.ts`
- **Thả xuống terminal (Ctrl+`)** — terminal kéo từ trên xuống · `apps/web/src/components/workspace/DropTerminal.vue`
- **Nhận diện agent trong shell** — pane shell đang chạy `claude` / `codex` được coi là agent · `apps/web/src/composables/useWorkspaceLinks.ts`
- **Agent thoát về shell** — Ctrl+C ×2 hoặc `/exit` · `apps/web/src/stores/workspace.ts`
- **Thẻ chú thích shell (shell marks)** (v73) — đánh dấu lệnh, nhảy giữa lệnh, copy output · `apps/web/src/lib/shellMarks.ts`
- **Link trong terminal** — OSC 8, URL bị xuống dòng, copy đúng · `apps/web/src/components/workspace/TermPane.vue`
- **Cảnh báo lỗi terminal → Problems** (2026-10-29) — quét lỗi trong buffer shell · `apps/web/src/lib/terminalProblems.ts`
- **Nerd Font fallback cho terminal** (2.2.0) — `apps/web/src/lib/fonts.ts`
- **Phím tắt Workspace** — WT / macOS chords, bảng phím · `apps/web/src/lib/workspaceKeys.ts`
- **Hộp thoại xác nhận đóng pane** (close confirm) — `apps/web/src/components/workspace/WorkspaceView.vue`
- **Hộp đính kèm (attachments)** — kéo thả file, ảnh vào prompt; xoá bằng Backspace · `apps/web/src/stores/attachments.ts`
- **Compact… cho agent** (v51, v52) — handoff rồi /compact rồi resume; prompt do chủ nhân duyệt · `apps/web/src/lib/compactHandoff.ts`
- **Mở pane qua API / deep link** (v49) — agent tự mở pane, prefill, không tự gửi · `apps/desktop/src/pty/mcp.ts`
- **Ghi log khi PTY thoát sớm** (< 15 s) vào `pty.log` · `apps/desktop/src/pty/host.ts`

## Rail, dự án & Mission Control

- **Rail nhóm dự án** (v38) — cụm, checkout, hàng pane, nhãn trạng thái · `apps/web/src/lib/rail/railModel.ts`
- **Sắp xếp và kéo rail** — kéo nhóm dự án, Alt+↑/↓ · `apps/web/src/composables/useRailDrag.ts`
- **Menu rail** (v43) — mở, đóng, menu project · `apps/web/src/lib/rail/railMenu.ts`
- **Bố cục đã lưu theo project** (v24) — tối đa 20 mỗi project, một bố cục tự mở khi khởi động · `apps/desktop/src/layouts.ts`
- **Menu script theo project** (v24) — chạy script từ package.json / Makefile / Cargo / pyproject · `apps/desktop/src/preview/scripts.ts`
- **Worktree** — tạo worktree, sao chép file cấu hình, so sánh, gộp (ff / squash) · `apps/web/src/components/workspace/WorktreeMenu.vue`
- **Mission Control** (v38, v52) — lưới thẻ theo project, lọc, phím 1–9 · `apps/web/src/components/workspace/MissionControl.vue`
- **Cần chủ nhân (Attention)** — popover liệt kê pane cần xử lý · `apps/web/src/components/workspace/AttentionPopover.vue`
- **Nút + mở chọn loại pane** (kiểu trình duyệt) — `apps/web/src/components/workspace/LaunchPicker.vue`

## Viewer & editor file

- **Trình xem file** (v21, v42) — xem / sửa / lưu, cảnh báo xung đột trên đĩa, markdown · `apps/web/src/components/workspace/FilePane.vue`
- **Editor CodeMirror 6** (v42) — tìm, thay, gấp dòng, ngôn ngữ, đọc file lớn theo cửa sổ · `apps/web/src/components/workspace/CodeEditor.vue`
- **Tự lưu như VS Code** (v62, tắt mặc định) — sau delay / đổi focus / đổi cửa sổ · `apps/web/src/lib/autoSave.ts`
- **Xem trước Markdown, chia đôi cuộn đồng bộ** (v70) — `apps/web/src/lib/markdownSync.ts`
- **HTML hiển thị được** (2.3.0) — webview riêng, partition `persist:ccm-preview` · `apps/desktop/src/preview/ipc.ts`
- **Outline, đi tới ký hiệu, F12 / Shift+F12** (v69) — `apps/web/src/lib/editor/outline.ts`
- **Bookmark, file gần đây, Quick open** (v70) — `apps/web/src/lib/fuzzy.ts`
- **Local History** (v70) — lưu bản cũ mỗi lần ghi, so sánh, khôi phục · `apps/desktop/src/preview/localHistory.ts`
- **Format file** (v70) — prettier, dart, ktlint theo ngôn ngữ · `apps/desktop/src/preview/format.ts`
- **Cây JSON / YAML** (v70) — gấp, lọc, copy đường dẫn · `apps/web/src/lib/jsonTree.ts`
- **Xem file log** (v70) — `*.log`, `logcat*.txt`, đọc từng đoạn tới 200 MB · `apps/desktop/src/preview/logRead.ts`
- **Ô màu** (v70) — swatch trong code CSS · `apps/web/src/lib/editor/colorSwatches.ts`
- **So sánh hai file** (v70) — chọn trong Explorer rồi so sánh · `apps/web/src/components/workspace/TextCompareDialog.vue`
- **Bản đồ thu nhỏ code (minimap)** — `settings.minimap` · `apps/web/src/components/workspace/CodeMinimap.vue`
- **Chỉnh sửa khối (edit block) và xung đột** — `apps/web/src/lib/fileEditor.ts`

## Explorer (cây file)

- **Explorer có panel riêng bên phải** (v53, 2.1.0) — `apps/web/src/components/workspace/ExplorerPanel.vue`
- **Cây file có icon Atom Material** (v59) — chọn Atom / Simple trong Cài đặt · `apps/web/src/lib/explorer/fileIcons.ts`
- **Kéo file vào terminal (@mention)** (v2.0.0) — `apps/web/src/lib/explorer/dragPath.ts`
- **Tạo, đổi tên, chuyển vào thùng rác** (v35) — menu chuột phải · `apps/desktop/src/preview/explorer.ts`
- **Tìm trong file** (v67) — git grep, huỷ được, hơn 2000 kết quả bị cắt · `apps/desktop/src/preview/search.ts`
- **Thay thế trong nhiều file** (v70) — xem trước từng dòng, bỏ qua từng dòng · `apps/desktop/src/preview/replaceFiles.ts`
- **TODO / FIXME** (v70) — quét qua `ccm:search` · `apps/web/src/components/workspace/ExplorerTodo.vue`
- **Checks** (v67) — chạy script kiểm tra, parse lỗi, gửi cho agent · `apps/web/src/components/workspace/ExplorerChecks.vue`
- **Ghi chú dự án** (v70, Ctrl+Alt+N) — `apps/desktop/src/preview/notes.ts`

## Git (Changes, diff, Log, commit)

- **Diff kiểu Android Studio** (v29, v33, v34) — inline và split, minimap, ←/→ đổi file, F7 nhảy đoạn · `apps/web/src/components/workspace/ChangesPane.vue`
- **Diff theo đoạn (hunk)** — đổi, bỏ đoạn; popup từng đoạn · `apps/desktop/src/preview/changes.ts`
- **Blame** (v68) — gutter và hover · `apps/desktop/src/preview/blame.ts`
- **Stage / unstage file và đoạn, commit trong app** (v67) — `apps/web/src/components/workspace/CommitBox.vue`
- **Sửa commit (amend)** — chỉ khi commit chưa đẩy · `apps/desktop/src/preview/commit.ts`
- **Xem so sánh ảnh** (v70) — ảnh bản HEAD và bản đang sửa · `apps/web/src/components/workspace/ImageCompare.vue`
- **Turn review + checkpoint theo lượt** (v68, 2.4.0) — giữ hoặc bỏ từng đoạn của lượt · `apps/desktop/src/preview/checkpoints.ts`
- **Xử lý xung đột gộp từng khối** (v69) — ours / theirs / both / edit · `apps/web/src/components/workspace/ConflictView.vue`
- **Git Log có đồ thị commit** (v30, v36) — nhánh, tag, tìm, diff · `apps/web/src/components/workspace/log/LogPane.vue`
- **Thanh Branches của Log** (v36) — tạo, fast-forward, fetch, xoá nhánh (xoá có xác nhận) · `apps/desktop/src/preview/branches.ts`
- **Push trong app** (v54) — xem trước, ahead / behind, chọn tài khoản · `apps/web/src/components/workspace/log/PushDialog.vue`
- **Bảo vệ git bằng xác nhận gốc** — xoá nhánh, merge, restore cần xác nhận · `apps/desktop/src/main.ts`
- **Overlap** (v69) — cảnh báo hai agent cùng sửa một file · `apps/desktop/src/preview/overlap.ts`

## GitHub

- **Nhiều tài khoản GitHub bằng token** (v58) — lưu bằng safeStorage của OS, không gửi lại cho trang · `apps/desktop/src/github/accounts.ts`
- **Chọn tài khoản theo repo** — tự động theo quyền truy cập · `apps/web/src/components/GitHubAccountsSettings.vue`
- **Phát hiện repo private không có quyền** — báo lỗi auth rõ ràng · `apps/desktop/src/preview/branches.ts`

## Problems, Inbox, Prompt & Plan

- **Problems trong editor** (v68) — lỗi Checks hiện như chẩn đoán, F8 / Shift+F8 · `apps/web/src/components/workspace/ProblemBar.vue`
- **Inbox việc cần chủ nhân** (v69) — J/K, Enter, E, badge trên header · `apps/web/src/components/inbox/InboxPanel.vue`
- **Thư viện prompt** (v69) — biến, chèn vào pane (chỉ điền, không gửi) · `apps/desktop/src/preview/commands.ts`
- **Hàng đợi prompt theo pane** (v70) — điền khi agent chuyển sang idle · `apps/web/src/lib/promptQueue.ts`
- **Plan board** (v70) — đọc checklist `- [ ]` trong Markdown, đi tới dòng · `apps/web/src/components/workspace/PlanBoard.vue`
- **Gợi ý luật allow từ hỏi quyền lặp** (v72) — gợi ý luật allow từ các lần hỏi lặp, ghi `settings.local.json` sau xác nhận · `apps/desktop/src/preview/permRules.ts`
- **Hook bridge: PreCompact / PostCompact / PermissionDenied** (2026-10-29) — hiện trạng thái compacting / bị từ chối · `apps/desktop/src/hooks.ts`

## Extensions (MCP / plugin)

- **Cài MCP server, plugin, skill qua claude CLI** (v28) — toàn cục hoặc theo project, có xác nhận gốc · `apps/web/src/components/extensions/ExtensionsView.vue`
- **Danh mục curated** — `packages/shared/src/extensions.ts` (`CATALOG`)
- **Đăng nhập MCP** — chạy `claude mcp login` trong shell workspace · `apps/web/src/stores/extensions.ts`
- **Thêm nguồn (marketplace) tuỳ ý** — `apps/desktop/src/extensions/ipc.ts`
- **Quản lý hook Claude Code** (v74) — bảng hook theo event (user / project / local / plugin), tắt / bật hook settings (cất vào `<DATA_DIR>/hooks-disabled.json`, confirm diff, `.ccm-backup`), hook Orrery khoá, chạy thử 10 s payload giả · `apps/desktop/src/claudeHooks/manager.ts`, `apps/web/src/components/extensions/HooksPanel.vue`

## Devices (Android / adb)

- **Kết nối thiết bị USB và Wi-Fi** (v61) — mã ghép, QR, mDNS, nhớ thiết bị, tự kết nối · `apps/web/src/components/devices/DevicesView.vue`
- **Chuyển USB sang Wi-Fi** — `apps/desktop/src/devices/manager.ts`
- **Chụp màn hình thiết bị** (2.4.0, v72) — gửi vào agent đính kèm · `apps/web/src/components/devices/DeviceCaptureDialog.vue`
- **Soi view tree** — id, chữ, khung trên ảnh chụp, tìm trong file · `apps/desktop/src/devices/uiDump.ts`
- **Thử UI trên máy** (v72) — tối / sáng, cỡ chữ, cỡ hiển thị, ngôn ngữ app, tắt animation, Trả về như cũ · `apps/desktop/src/devices/uiTester.ts`
- **Mở deep link và activity exported** (v72) — `apps/desktop/src/devices/manifest.ts`
- **Xem dữ liệu app debug** (v73) — database, SharedPreferences, chỉ đọc có chặn SQL · `apps/desktop/src/devices/appData.ts`
- **Phân tích dung lượng APK / AAB** (v73) — so với bản trước, top 20 · `apps/desktop/src/apk/analyze.ts`
- **Emulator (AVD)** (v74) — danh sách AVD (API, ABI, máy), Chạy / Cold boot / Tắt / Xoá dữ liệu (xác nhận), đánh dấu AVD đang chạy · `apps/desktop/src/devices/emulators.ts`, `apps/web/src/components/devices/DeviceEmulators.vue`

## Preview (XML layout / drawable / Flutter / web)

- **XML Layout Preview** (v32, v44, v46) — render layout Android qua daemon layoutlib, không cần Gradle model · `apps/web/src/components/workspace/LayoutPreview.vue`
- **Chọn thiết bị, chế độ tối, cỡ chữ cho preview layout** — `apps/web/src/lib/layoutPreview.ts`
- **Drawable Preview** (v41) — xem drawable / vector · `apps/web/src/components/workspace/DrawablePreview.vue`
- **Flutter Widget Preview** (v40, v55, v57) — `@Preview`, và danh sách class widget không có `@Preview` · `apps/web/src/components/workspace/FlutterPreviewPanel.vue`
- **Wrapper ProviderScope / AppLocalizations** (v57) — `apps/desktop/src/flutterPreview/host.ts`
- **Trình duyệt trong workspace** (v21) — webview, thiết bị giả lập, chụp màn gửi cho agent · `apps/web/src/components/workspace/BrowserPane.vue`
- **Cấp quyền đường dẫn cho trình duyệt** — `apps/desktop/src/preview/grants.ts`
- **Chế độ toàn quyền truy cập (full access)** — bật một lần, cảnh báo rõ · `apps/desktop/src/preview/grants.ts`

## Run pane (Android / Flutter)

- **Chạy app Android / Flutter** (v31) — cấu hình, thiết bị, log, dừng · `apps/web/src/components/workspace/RunPane.vue`
- **Đọc crash và ANR** (2.4.0, v72) — gom stack, mở frame trong dự án, gửi cho agent (đã che bí mật) · `apps/web/src/lib/runCrash.ts`
- **Chọn JDK / Flutter SDK theo dự án** — `apps/desktop/src/run/android/jdkPick.ts`
- **Tự biên dịch layout khi cần** — `apps/desktop/src/run/sessions.ts`

## Công cụ tiện ích

- **HTTP client cho file .http / .rest** (2026-10-29) — gửi request, huỷ, xác nhận host · `apps/web/src/components/workspace/HttpPanel.vue`
- **Kiểm tra .env** (2026-10-29) — so khoá, che / hiện giá trị · `apps/web/src/components/workspace/EnvCheckDialog.vue`
- **Quét khoá i18n còn thiếu** (2026-10-29) — Android strings, ARB, JSON · `apps/web/src/components/workspace/I18nScanDialog.vue`
- **Bảng chuỗi đa ngữ** (v74) — key × ngôn ngữ cho strings.xml / ARB / JSON, ô thiếu, placeholder lệch, sửa ô ghi file sau khi xem diff (file không chắc chắn → chỉ đọc), Điền vào agent các key thiếu · `apps/web/src/components/workspace/StringsDialog.vue`, `apps/web/src/lib/strings/`
- **Kiểm bản mới của thư viện** (v74) — libs.versions.toml, build.gradle(.kts), pubspec.yaml, package.json: đang dùng · mới nhất ổn định · patch / minor / major, link changelog, cache 1 giờ, không sửa file, Điền vào agent · `apps/desktop/src/libs/checker.ts`, `apps/web/src/components/workspace/LibUpdatesDialog.vue`
- **Công cụ dev (Ctrl+K)** — giải mã JWT, v.v., không kiểm chữ ký · `apps/web/src/components/DevToolsDialog.vue`

## Codex CLI

- **Theo dõi lượt chạy Codex** (v16) — hiện dưới agent Claude đã gọi nó · `apps/collector/src/codex/monitor.ts`
- **Liên kết Codex với Claude** — `apps/collector/src/codex/link.ts`
- **Hạn mức Codex** — hiện trong chip PlanLimits · `apps/collector/src/codex/monitor.ts`

## Desktop shell (tray, deep link, MCP orrery)

- **Tray và đóng về tray** — thoát chỉ qua tray, có xác nhận khi còn pane chạy · `apps/desktop/src/main.ts`
- **Header nằm trên thanh tiêu đề cửa sổ** (2.3.0) — `apps/desktop/src/main.ts` (`titleBarOverlay`)
- **Deep link `agent-monitor://`** — mở session, focus, snooze; `open` không hỏi, giới hạn 10 lượt / phút · `apps/desktop/src/openLink.ts`
- **MCP server `orrery`** (v49) — tool `open_session`, token theo pane · `apps/desktop/src/pty/mcp.ts`
- **Khởi động cùng Windows** (login item) — `ccm:login-item` · `apps/desktop/src/main.ts`
- **Status line bridge** — cài script, sao lưu `settings.json` trước khi ghi · `apps/desktop/src/statusline.ts`
- **Chép / lưu log chẩn đoán** — gom log đã che bí mật · `apps/desktop/src/main.ts` (`logReport`)
- **Nhật ký đã che bí mật** — `apps/desktop/src/log-mask.ts`
- **Lưu giao diện desktop** (nền, look, zoom) — `apps/desktop/src/appearance.ts`
- **Thiết lập menu macOS, Dock** — `apps/desktop/src/mac.ts`
- **Màn hình khởi động và giới thiệu** — `apps/desktop/src/pages.ts`
- **Cập nhật trong app** (v74, 2.5.0) — báo bản mới từ GitHub Releases, bấm mới tải, kiểm SHA-256, cài NSIS / portable / macOS rồi mở lại; Cài đặt › Cập nhật, chip ở header · `apps/desktop/src/update/manager.ts`, `apps/web/src/components/UpdateDialog.vue`

## Cài đặt, giao diện & hướng dẫn

- **Chủ đề màu** (v25) — Apple (mặc định), Xcode, GitHub, Solarized, Monokai, Dracula, Material, One Dark, JetBrains Islands · `apps/web/src/lib/themes.ts`
- **Font giao diện và font code** (v27) — font đi kèm sẵn, không tải từ mạng · `apps/web/src/components/ui/FontPicker.vue`
- **Phóng to / thu nhỏ bằng Ctrl+cuộn** (v27) — `apps/web/src/composables/useWheelZoom.ts`
- **Hướng dẫn làm quen (tour)** (v25) — `apps/web/src/components/OnboardingTour.vue`
- **Mẹo (tips)** (v25) — `apps/web/src/stores/tips.ts`
- **Thiết lập nhanh lần đầu** (v27) — `apps/web/src/components/QuickSetup.vue`
- **"Có gì mới" dialog** (v71, 2.4.0) — mở lại trong Cài đặt và Ctrl+K · `apps/web/src/components/WhatsNewDialog.vue`
- **Bảng phím tắt (?)** (v1.2.0) — `apps/web/src/components/ShortcutsDialog.vue`
- **Bảng lệnh Ctrl+K** — tìm session, lệnh, công cụ · `apps/web/src/components/CommandPalette.vue`
- **Ngôn ngữ giao diện en / vi** — `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/vi.ts`
- **Chế độ sáng / tối** — nhớ lựa chọn, tuỳ chọn trong Cài đặt · `apps/web/src/stores/settings.ts`
- **Bộ nút điều khiển chung** (ToggleSwitch, SegmentedControl, ContextMenu) — `apps/web/src/components/ui/SegmentedControl.vue`
- **Chuyển động có thể tắt** (reduced motion) — `apps/web/src/lib/motion.ts`
- **Thanh bên Cài đặt (sheet phải)** — `apps/web/src/components/SettingsMenu.vue`
- **Sao lưu / chuyển cấu hình** (v74) — xuất một file JSON (ccm.* localStorage + file cấu hình trong data dir, không token), nhập có xem trước theo mục, cờ đường dẫn không có, tự sao lưu trước khi cài update (giữ 3) · `apps/desktop/src/backup/service.ts`, `apps/web/src/components/BackupSettings.vue`
