# SPEC v73 — 5 tính năng (chủ nhân chốt "làm hết", 2026-10-29)

Nguồn: `.planning/IDEAS-2026-10-29f.md` (chi tiết từng ý). Rule subagent: `.planning/AGENT-RULES-v73.md`.

Chủ nhân chốt:
- Làm cả 5 ý.
- Ý 3 (dữ liệu app trên thiết bị): dùng **sql.js** (WASM), không native module.
- Ý 5 (hẹn tiếp tục lúc reset): chữ điền sẵn mặc định **"tiếp tục"** (sửa được khi hẹn). Chỉ prefill, không submit.
- Chủ nhân (sau đó) cho phép **commit từng tính năng**, không push. Ý 2, 5, 4, 3 tách commit sau khi agent B xong; agent C, D tự commit.

Thứ tự (subagent tuần tự):
1. Agent A: ý 2 thống kê tool / skill / subagent / MCP → ý 5 hẹn tiếp tục lúc reset.
2. Agent B: ý 4 kích thước APK / AAB + so bản trước → ý 3 dữ liệu app (SQLite / SharedPreferences, sql.js).
3. Agent C: ý 1 shell integration (OSC 133: zsh, bash, PowerShell) cho pane terminal.
4. Agent D: build app desktop, E2E mới `e2e/v73.cjs` + hồi quy.

Thêm:
- Changelog: 2.4.0 đã release. Ghi dòng en + vi vào mục mới đầu `apps/web/src/lib/changelog.ts` version `2.5.0` (không bump `package.json`). Nếu test changelog bắt buộc mục đầu = version app thì không sửa changelog, ghi dòng vào cuối file này mục "Changelog chờ".
- Ý 5: kiểm thật Claude Code đang cài (2.1.294) ghi thông báo chạm limit thế nào trong transcript / status trước khi nhận diện; không đoán. Ghi lệch vào `docs/claude-code-integration.md`.
- Ý 2: chỉ đếm tên tool / skill / subagent type / MCP server, không lấy input.
- Ý 3: chỉ app debuggable (`run-as`); sửa SharedPreferences sau native confirm, giữ bản gốc trong data dir + nút khôi phục; SQL chỉ read-only (SELECT / PRAGMA / WITH…SELECT).
- Ý 1: profile người dùng (oh-my-posh, starship) phải vẫn chạy; hỏng thì tắt êm, không phá prompt.

## Changelog chờ
- (Agent A, ý 2) en: `History: top tools, skills, subagent types and MCP servers per project, with unused ones` · vi: `History: tool, skill, loại subagent, máy chủ MCP dùng nhiều nhất theo dự án, kèm mục không dùng`
- (Agent A, ý 5) en: `Agent stopped at the usage limit: schedule a continue text filled in at the reset` · vi: `Agent dừng vì hạn mức: hẹn điền sẵn chữ tiếp tục lúc reset`
- (Agent B, ý 4) en: `APK / AAB size: groups, largest files, manifest, compare with the previous build` · vi: `Kích thước APK / AAB: nhóm, file lớn nhất, manifest, so với bản build trước`
- (Agent B, ý 3) en: `Devices: browse a debug app's SQLite and SharedPreferences, edit prefs with restore` · vi: `Thiết bị: xem SQLite và SharedPreferences của app debug, sửa prefs có nút khôi phục`
- (Agent C, ý 1) en: `Shell panes: command marks with exit code and time, ⌘/Ctrl+↑↓ jumps, copy / fill output to agent` · vi: `Pane shell: đánh dấu lệnh kèm mã thoát, thời gian, ⌘/Ctrl+↑↓ nhảy lệnh, điền output cho agent`
