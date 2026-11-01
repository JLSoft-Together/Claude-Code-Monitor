# SPEC v77 — dọn đồ build, cảnh báo ổ đầy, mẫu prompt, khôi phục workspace (2026-11-01)

Chủ nhân: "Cả 4 phần làm luôn" (4 đề xuất cuối HANDOFF-v76). Rule agent: `AGENT-RULES-v76.md` + mục "v77" cuối file này.

Khảo sát (haiku, 2026-11-01): thư viện prompt (v69, `apps/web/src/lib/promptLibrary.ts`, `stores/prompts.ts`, localStorage `ccm.prompts`) không có mẫu sẵn, không import/export. Khôi phục workspace (v64, `ccm.workspace.last` ghi liên tục, `RestorePicker`) chỉ hiện khi workspace rỗng, phải bấm; shell lưu `p.cwd` thay vì thư mục hiện tại (`workCwd` / `liveCwd`). Chưa có đo dung lượng trống ngoài `agentData/move.ts` `fs.statfs`; chưa có dọn đồ build.

## R8 Dọn đồ build của project
- Settings › Dữ liệu agent thêm mục "Đồ build của project" (hoặc dialog riêng mở từ đó) + menu chuột phải project ở rail "Dọn đồ build…".
- Danh sách project: các project đã biết (rail / layouts / session cwd). Bấm **Đo** mới quét (không quét nền).
- Thư mục nhận: `node_modules`, `build`, `.gradle` (trong project, KHÔNG phải `~/.gradle`), `app/build` và `*/build` của module Gradle, `.dart_tool`, `dist`, `out`, `target` (Cargo/Maven), `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `__pycache__`, `.pytest_cache`, `.venv` (đánh dấu "cần cài lại"). Chỉ nhận khi thư mục bị git ignore (`git check-ignore`) hoặc project không phải git repo và tên khớp chính xác; không bao giờ đi theo junction/symlink; độ sâu giới hạn (≤ 4), bỏ qua `.git`.
- Mỗi dòng: đường dẫn tương đối, dung lượng, lần sửa cuối, nhãn loại (Node / Gradle / Flutter / Rust / Python / web build). Sắp theo dung lượng, tổng cộng theo project và toàn bộ.
- Dọn: chọn dòng → confirm native (nêu tổng GB, số thư mục, "cài lại / build lại sẽ mất thời gian"). Xoá thật (không thùng rác — node_modules vào thùng rác rất chậm), ngoài trừ khi chủ nhân bật "Chuyển vào thùng rác".
- Chặn khi project đang có process chạy trong đó (dev server, Gradle daemon cwd, pane agent / shell có cwd trong project, Run pane đang chạy): báo tên, không xoá. Dùng bảng process sẵn có của R1 / `resources`.
- Gradle: trước khi xoá `.gradle` / `build` của project Android, gợi ý "Dừng Gradle daemon" (nút sẵn có R1) nếu daemon đang giữ file.
- Lỗi file bị khoá: bỏ qua file đó, báo số file không xoá được.

## R9 Cảnh báo ổ sắp đầy
- Đo `fs.statfs` các ổ chứa: `~/.claude`, `~/.codex`, data dir, Thư mục chụp (R4), thư mục project đang mở, Android SDK / AVD home nếu có. Gộp theo ổ (Windows: ký tự ổ; macOS: mount).
- Tần suất: lúc mở app, rồi mỗi 10 phút trong main process desktop (không phải polling cao tần; 1 lời gọi statfs mỗi ổ). Thêm đo ngay sau khi Run/build xong, sau khi chụp/quay lưu file.
- Ngưỡng mặc định: còn < 10 GB hoặc < 5 %. Mức nguy hiểm: < 2 GB. Chỉnh trong Settings › Thông báo (ngưỡng GB), có thể tắt.
- Báo: toast `disk` 1 lần mỗi ổ mỗi lần vượt ngưỡng (hết lại khi lên trên ngưỡng + 1 GB, chống nhấp nháy); badge ổ đĩa trên header (icon + text + màu), bấm mở popover: từng ổ (dung lượng trống / tổng, thanh), nút "Dọn đồ build…" (R8), "Dữ liệu agent…" (R7), "Mở thư mục".
- Gửi điện thoại (R6) theo luật sẵn có nếu kênh bật và mức nguy hiểm.
- Không ghi file nào, chỉ đọc.

## R10 Mẫu prompt + nhập / xuất thư viện
- Bộ mẫu dựng sẵn (khoảng 10–14, en + vi theo ngôn ngữ app) dùng biến có sẵn `{file} {selection} {branch} {diffstat} {checks} {wt}`: review diff, viết test cho file, giải thích file, sửa lỗi Checks, viết commit message từ diffstat, refactor đoạn chọn, tìm bug, viết docs/README, tối ưu hiệu năng, kiểm bảo mật, dịch chuỗi i18n, tóm tắt thay đổi nhánh.
- Mẫu nằm trong code (không ghi vào `ccm.prompts`), hiện nhóm "Mẫu" trong PromptPicker; "Nhân bản để sửa" tạo bản riêng; ẩn từng mẫu / ẩn cả nhóm (lưu localStorage).
- Xuất JSON (hộp lưu native, mặc định `orrery-prompts.json`) và Nhập JSON (hộp mở native, validate bằng `cleanPrompts` sẵn có, giới hạn 200 / 8 KB, gộp: trùng tên thì hỏi Ghi đè / Giữ cả hai / Bỏ qua). Không tự đọc file trong project.
- Chỉ điền vào pane, không bao giờ gửi (giữ nguyên `insertInto`).

## R11 Khôi phục workspace sau khởi động lại
- Snapshot lưu thư mục hiện tại của shell (`liveCwd` ?? `workCwd` ?? `cwd`) — thống nhất với `closedPane`; thư mục không còn tồn tại → về `cwd` gốc.
- Settings › Workspace: "Khi mở app": Hỏi (hiện RestorePicker, như hiện nay — mặc định) / Tự mở lại workspace lần trước / Không làm gì. Tự mở lại: pane agent có session id → `--resume`, đi qua `spawnQueue` (tối đa 2); project không mở lần trước bị parked như hiện tại.
- Phát hiện lần trước thoát không sạch (crash / tắt máy / Windows Update): cờ "clean quit" trong data dir; nếu không sạch và chế độ là Hỏi → RestorePicker có dòng "Orrery đã đóng bất thường lúc …" và mặc định chọn tất cả.
- Gợi ý "Khởi động cùng Windows / macOS" một lần trong RestorePicker nếu login item đang tắt (nút Bật + "Không hỏi lại"); dùng toggle sẵn có (`SettingsMenu.vue`, `main.ts` login item).
- Không gửi prompt nào; `--resume` chỉ mở session như cách bấm Restore hiện nay.

## v77 — bổ sung rule agent
- Đọc `AGENT-RULES-v76.md`, thay: spec = file này; i18n block mới `apps/web/src/i18n/<area>-v77.ts`; PROGRESS dưới heading `## Phiên v77` cuối `.planning/PROGRESS-2026-11-01.md`; `.code_index` mục `## v77 (2026-11-01)`; changelog chờ = mục dưới đây; RELEASE note vẫn `RELEASE-2.6.0.md`.
- Working tree đang có đợt 2 v76 chưa commit (agentData, denyRules, secretMask…): dùng lại, không revert, không commit.
- Được chạy E2E của mình ở cuối (viết `apps/desktop/e2e/v77.cjs`, thêm vào `run.cjs`), cần build web + desktop trước (`npm run build -w @ccm/web`, `npm run build -w @ccm/desktop` — xem package.json). Không đụng app cổng 4317; E2E dùng `CCM_DATA_DIR` / `CLAUDE_CONFIG_DIR` / HOME tạm, project giả trong scratchpad. Không bao giờ xoá thư mục thật của chủ nhân khi test.

## Changelog chờ
[R10] en: Prompt samples: the prompt picker (Alt+Shift+P) has 12 ready-made prompts (review my changes, write tests, explain a file, fix Checks errors, commit message, refactor the selection, find bugs, docs, speed, security, translate strings, summarise a branch); duplicate one to make it yours or hide the ones you do not use. Export and import your library as a JSON file.
[R10] vi: Mẫu prompt: bảng prompt (Alt+Shift+P) có 12 prompt dựng sẵn (review thay đổi, viết test, giải thích file, sửa lỗi Checks, commit message, refactor đoạn chọn, tìm bug, docs, hiệu năng, bảo mật, dịch chuỗi, tóm tắt nhánh); nhân bản để sửa thành của mình hoặc ẩn mẫu không dùng. Xuất và nhập thư viện bằng file JSON.
[R11] en: Reopen after a restart: Settings › Startup › When the app opens: Ask, Reopen (terminals and agents come back on their own, agents with their conversation) or Do nothing. After a crash or a forced restart the restore card says so and ticks every project; shells come back in the folder you had moved to.
[R11] vi: Mở lại sau khi khởi động lại: Cài đặt › Khởi động › Khi mở app: Hỏi, Tự mở lại (terminal và agent tự quay lại, agent kèm cuộc hội thoại) hoặc Không làm gì. Sau khi app bị tắt bất thường hay máy khởi động lại, thẻ khôi phục báo rõ và tích sẵn mọi project; shell mở lại đúng thư mục đã cd tới.
[R8] en: Clean build output: Settings › Agent data, a project's rail menu or the low disk badge open a list of node_modules, build, .gradle, dist, target and similar folders of your projects. Measure first, pick rows, confirm; only folders git ignores count, links are never followed, and nothing is deleted while something runs in that project.
[R8] vi: Dọn đồ build: Cài đặt › Dữ liệu agent, menu project trên rail hoặc badge ổ đầy mở danh sách node_modules, build, .gradle, dist, target… của các project. Bấm Đo, chọn dòng, xác nhận; chỉ nhận thư mục git đang ignore, không đi theo link, không xoá khi đang có thứ chạy trong project.
[R9] en: Low disk warning: a badge in the top bar and one alert per drive when a drive holding ~/.claude, ~/.codex, Orrery data, captures, open projects or the Android SDK drops below 10 GB or 5 % (checked at start and every 10 minutes; threshold in Settings › Notifications). Under 2 GB it can reach your phone.
[R9] vi: Cảnh báo ổ sắp đầy: badge trên thanh trên và một thông báo mỗi ổ khi ổ chứa ~/.claude, ~/.codex, dữ liệu Orrery, thư mục chụp, project đang mở hoặc Android SDK còn dưới 10 GB hoặc 5 % (kiểm lúc mở app và mỗi 10 phút; chỉnh ngưỡng ở Cài đặt › Thông báo). Dưới 2 GB có thể báo ra điện thoại.
