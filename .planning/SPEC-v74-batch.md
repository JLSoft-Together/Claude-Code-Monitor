# SPEC v74 — cập nhật trong app + 5 ý tưởng (chủ nhân chốt 2026-10-29)

Nguồn: `.planning/PLAN-v74-in-app-update.md` (update), `.planning/IDEAS-2026-10-29g.md` (5 ý). Rule subagent: `.planning/AGENT-RULES-v74.md`. Tính năng đã có: `.code_index/features.md`.

Chủ nhân chốt:
- Update: **chỉ báo**, chủ nhân bấm mới tải; không tự tải nền. Ra kèm **2.5.0**.
- Làm luôn cả 5 ý trong IDEAS-2026-10-29g.
- **Không commit** (chưa cho phép đợt này) — để nguyên working tree, ghi commit message đề xuất trong PROGRESS.
- Cập nhật: chủ nhân cho phép **commit từng tính năng sau khi xong hết** (sau Agent E build + E2E). Main agent tự tách commit (6 commit: update, emulator, sao lưu, chuỗi, thư viện, hooks + 1 commit E2E), không push, không trailer.

Thứ tự (subagent tuần tự, cùng working tree):
1. Agent A: v74 cập nhật trong app (PLAN-v74, toàn bộ: main `src/update/`, IPC, preload, store, Settings section, dialog, banner, env `CCM_UPDATE_FEED` cho E2E).
2. Agent B: ý 4 emulator (AVD) → ý 1 sao lưu / chuyển cấu hình (thêm mục "tự sao lưu trước khi cài update" nối với `src/update/`).
3. Agent C: ý 2 bảng chuỗi đa ngữ → ý 3 kiểm phiên bản thư viện.
4. Agent D: ý 5 quản lý hook Claude Code.
5. Agent E: build app desktop, E2E mới `apps/desktop/e2e/v74.cjs` + hồi quy v73, gom báo cáo.

Ràng buộc thêm:
- Update: chỉ host `api.github.com` (feed), `github.com` + `*.githubusercontent.com` (tải); kiểm SHA-256 với `digest` asset; dev (`!app.isPackaged`) chỉ check + mở trang release. Check 30 s sau khởi động + 12 h/lần (setTimeout), tắt được. Không cài khi đang tải dở / digest sai.
- Ý 1: không xuất token / secret (GitHub PAT, khoá keychain, env). Nhập phải xem trước + confirm, ghi đè có backup.
- Ý 2: ghi file chuỗi chỉ sau confirm diff, giữ format / comment / thứ tự; file phức tạp không parse chắc chắn → chỉ đọc.
- Ý 3: chỉ gọi mạng khi bấm (Maven Central, Google Maven, pub.dev, npm registry), timeout, cache 1 h trong data dir; không sửa file.
- Ý 4: đường dẫn SDK dùng chung với adb hiện có; Wipe data phải confirm; không polling.
- Ý 5: kiểm định dạng hook trên Claude Code đang cài (không đoán), ghi vào `docs/claude-code-integration.md`; ghi settings có `.ccm-backup` + tmp/rename + confirm diff; không cho tắt hook bridge của Orrery; chạy thử timeout 10 s, payload giả, không lộ env.

## Changelog chờ

- [A] en: Orrery tells you when a new version is on GitHub: Download and install, then Restart to update (installer, portable or macOS). Checks 30 s after start and every 12 h; turn it off or skip a version in Settings › Updates.
- [A] vi: Orrery báo khi có bản mới trên GitHub: Tải và cài, rồi Khởi động lại để cập nhật (bản cài đặt, portable hoặc macOS). Kiểm tra 30 giây sau khi mở app và 12 giờ một lần; tắt hoặc bỏ qua một bản trong Cài đặt › Cập nhật.
- [B] en: Devices › Emulators lists your Android Virtual Devices (API, ABI, device) and starts, cold boots, stops or wipes them (wipe asks first); a running emulator joins the device list like a phone.
- [B] vi: Thiết bị › Emulator liệt kê thiết bị ảo Android (API, ABI, máy) và chạy, cold boot, tắt hoặc xoá dữ liệu (xoá có hỏi trước); emulator đang chạy vào danh sách thiết bị như máy thật.
- [B] en: Settings › Backup exports your setup (theme, fonts, settings, Workspace tabs, notes, prompt queue, names, remembered devices) to one file and imports it on another machine with a per-section preview; tokens are never exported. Orrery also keeps a copy before every update.
- [B] vi: Cài đặt › Sao lưu xuất cấu hình (theme, font, cài đặt, tab Workspace, ghi chú, hàng đợi prompt, tên gọi, thiết bị đã nhớ) ra một file và nhập trên máy khác, có xem trước từng mục; không bao giờ xuất token. Orrery cũng giữ một bản trước mỗi lần cập nhật.
- [C] en: Strings table: translations of strings.xml, ARB and JSON files as a key × locale grid with missing cells and placeholder warnings; edit a cell and save it after a diff (files Orrery cannot rewrite safely stay read-only), or fill the missing keys into an agent. From the Explorer menu or Ctrl+K.
- [C] vi: Bảng chuỗi: bản dịch strings.xml, ARB và JSON dạng bảng key × ngôn ngữ, đánh dấu ô thiếu và placeholder lệch; sửa một ô rồi lưu sau khi xem diff (file Orrery không ghi lại an toàn được thì chỉ đọc), hoặc điền các key thiếu vào agent. Mở từ menu Explorer hoặc Ctrl+K.
- [C] en: Check for updates on libs.versions.toml, build.gradle, pubspec.yaml or package.json (Explorer menu): version in use, latest stable and patch / minor / major (major in amber), a link to each changelog, and Fill into agent to upgrade and build. Asks the registries only then, keeps answers 1 hour, never edits the file.
- [C] vi: Kiểm bản mới trên libs.versions.toml, build.gradle, pubspec.yaml hoặc package.json (menu Explorer): bản đang dùng, bản ổn định mới nhất và patch / minor / major (major tô vàng), link changelog từng thư viện, và Điền vào agent để nâng cấp rồi build. Chỉ hỏi registry lúc đó, giữ kết quả 1 giờ, không sửa file.
- [D] en: Extensions › Hooks lists every Claude Code hook by event (user settings, project, project local, plugins) with matcher, command (secrets masked) and source. Turn a settings hook off and on again after a diff confirm (Orrery keeps it meanwhile; a backup is written), and Test run one with a sample input to see exit code, time and output. Plugin hooks are read-only; Orrery's own bridge hooks are marked.
- [D] vi: Tiện ích › Hook liệt kê mọi hook Claude Code theo sự kiện (cài đặt người dùng, project, project local, plugin) kèm matcher, lệnh (che secret) và nguồn. Tắt rồi bật lại hook trong settings sau khi xem diff (Orrery cất giữ trong lúc tắt, có file backup), và Chạy thử với input mẫu để xem mã thoát, thời gian và output. Hook của plugin chỉ xem; hook bridge của Orrery được đánh dấu.
