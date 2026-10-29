# English

## App
- In-app update: Orrery tells you when a new version is on GitHub; Download and install checks the file against GitHub's SHA-256, then Restart to update installs it (installer, portable or macOS) and opens the app again. Turn off the check or skip a version in Settings › Updates.
- Settings › Backup: export your setup (theme, fonts, settings, Workspace tabs, notes, prompt queue, names, remembered devices) to one file and import it on another machine, choosing sections in a preview; paths missing on the new machine are flagged. Tokens are never exported: add GitHub tokens again after the import. A copy is also kept before every update (last 3).

## Workspace & terminal
- Shell panes mark each command with its exit code and run time; Ctrl/⌘+↑↓ jumps between commands; copy a command or its output, fill the output into an agent, run it again. Turn it off in Settings.
- An agent stopped at the usage limit shows when the limit resets; schedule a continue text ("continue" by default) that is filled in at the reset — never sent for you.
- Extensions › Hooks: every Claude Code hook by event with matcher, command (secrets masked) and source — user settings, project, project local or plugin. Turn a settings hook off and back on after a diff confirm (a backup is kept), or Test run it with a sample input to see exit code, time and output. Plugin hooks are read-only; Orrery's own hooks are marked.

## Run & devices
- APK / AAB size: size by group (dex, res, assets, native libs per ABI, feature modules), the largest files, manifest summary, and a compare with the previous build or any other file. From the Explorer menu or Ctrl+K.
- Devices: browse a debug app's SQLite databases (tables, schema, pages, read-only queries) and SharedPreferences; edit a preference after a confirm, with Restore original.
- Devices › Emulators: list Android Virtual Devices (API, ABI, device); Start, Cold boot, Stop or Wipe data (asks first). A running emulator shows up in the device list with all device tools.
- Strings table: strings.xml / ARB / JSON translations as a key × locale grid; missing cells and placeholder mismatches stand out, a cell can be edited and saved after a diff (formatting and comments kept; files that cannot be rewritten safely are read-only), and Fill into agent lists the missing keys for the locales you tick.
- Check for updates on libs.versions.toml, build.gradle(.kts), pubspec.yaml or package.json from the Explorer menu: in use, latest stable, patch / minor / major, changelog links, and a prefilled "upgrade and build" prompt for an agent. The file is never changed.

## Monitor
- History shows the most used tools, skills, subagent types and MCP servers per project, tool error rates, and skills / MCP servers not used in 30 days.

## Notes
- 2.4.0 has no updater: download 2.5.0 manually this once; later versions update from inside the app.
- The first start after updating rescans session history once for the new stats.
- Claude Code 2.1.294 can continue on its own after the usage limit resets; the scheduled text is for when you cancelled that or want a different prompt.
- App data needs a debuggable build (`run-as`).
- Command marks need PowerShell with PSReadLine, bash 4.4+ or zsh.
- Windows: `Orrery-Setup-2.5.0.exe` (installer) or `Orrery-Portable-2.5.0.exe`. The exe is not code-signed: on the SmartScreen warning choose **More info → Run anyway**.
- macOS: `Orrery-2.5.0-arm64.dmg` (Apple Silicon) or `Orrery-2.5.0-x64.dmg` (Intel). The app is not notarized: open it once, then **System Settings → Privacy & Security → Open Anyway**.

---

# Tiếng Việt

## Ứng dụng
- Cập nhật trong app: Orrery báo khi có bản mới trên GitHub; Tải và cài kiểm file theo SHA-256 của GitHub, rồi Khởi động lại để cập nhật sẽ cài (bản cài đặt, portable hoặc macOS) và mở lại app. Tắt kiểm tra hoặc bỏ qua một bản trong Cài đặt › Cập nhật.
- Cài đặt › Sao lưu: xuất cấu hình (theme, font, cài đặt, tab Workspace, ghi chú, hàng đợi prompt, tên gọi, thiết bị đã nhớ) ra một file rồi nhập trên máy khác, chọn từng mục trong bản xem trước; đường dẫn không có trên máy mới được đánh dấu. Không bao giờ xuất token: thêm lại token GitHub sau khi nhập. App cũng giữ một bản trước mỗi lần cập nhật (3 bản gần nhất).

## Workspace & terminal
- Pane shell đánh dấu từng lệnh kèm mã thoát và thời gian chạy; Ctrl/⌘+↑↓ nhảy giữa các lệnh; chép lệnh hoặc output, điền output cho agent, chạy lại. Tắt được trong Settings.
- Agent dừng vì hạn mức hiện giờ reset; hẹn một câu tiếp tục ("tiếp tục" mặc định) được điền sẵn lúc reset — không tự gửi.
- Tiện ích › Hook: mọi hook Claude Code theo sự kiện kèm matcher, lệnh (che secret) và nguồn — cài đặt người dùng, project, project local hoặc plugin. Tắt rồi bật lại hook trong settings sau khi xem diff (có giữ backup), hoặc Chạy thử với input mẫu để xem mã thoát, thời gian và output. Hook của plugin chỉ xem; hook của Orrery được đánh dấu.

## Run & thiết bị
- Kích thước APK / AAB: theo nhóm (dex, res, assets, native lib theo ABI, module tính năng), file lớn nhất, tóm tắt manifest, so với bản build trước hoặc file khác. Mở từ menu Explorer hoặc Ctrl+K.
- Thiết bị: xem database SQLite (bảng, schema, phân trang, truy vấn chỉ đọc) và SharedPreferences của app debug; sửa prefs sau khi xác nhận, có Khôi phục bản gốc.
- Thiết bị › Emulator: liệt kê thiết bị ảo Android (API, ABI, máy); Chạy, Cold boot, Tắt hoặc Xoá dữ liệu (có hỏi trước). Emulator đang chạy hiện trong danh sách thiết bị với mọi công cụ.
- Bảng chuỗi: bản dịch strings.xml / ARB / JSON dạng bảng key × ngôn ngữ; ô thiếu và placeholder lệch được đánh dấu, sửa một ô và lưu sau khi xem diff (giữ format và comment; file không ghi lại an toàn được thì chỉ đọc), Điền vào agent liệt kê key thiếu của các ngôn ngữ đã tick.
- Kiểm bản mới trên libs.versions.toml, build.gradle(.kts), pubspec.yaml hoặc package.json từ menu Explorer: đang dùng, mới nhất ổn định, patch / minor / major, link changelog, và prompt "nâng cấp rồi build" điền sẵn cho agent. Không bao giờ sửa file.

## Monitor
- History hiện tool, skill, loại subagent và máy chủ MCP dùng nhiều nhất theo dự án, tỉ lệ lỗi theo tool, và skill / MCP không dùng trong 30 ngày.

## Ghi chú
- 2.4.0 chưa có trình cập nhật: lần này tải 2.5.0 bằng tay; các bản sau cập nhật ngay trong app.
- Lần mở đầu sau khi cập nhật, app quét lại lịch sử session một lần cho thống kê mới.
- Claude Code 2.1.294 có thể tự tiếp tục sau khi reset hạn mức; câu hẹn dành cho khi bạn đã huỷ việc đó hoặc muốn prompt khác.
- Dữ liệu app cần bản build debuggable (`run-as`).
- Đánh dấu lệnh cần PowerShell có PSReadLine, bash 4.4+ hoặc zsh.
- Windows: `Orrery-Setup-2.5.0.exe` (cài đặt) hoặc `Orrery-Portable-2.5.0.exe`. Exe chưa ký code: khi SmartScreen cảnh báo, chọn **More info → Run anyway**.
- macOS: `Orrery-2.5.0-arm64.dmg` (Apple Silicon) hoặc `Orrery-2.5.0-x64.dmg` (Intel). App chưa notarize: mở một lần, rồi vào **System Settings → Privacy & Security → Open Anyway**.
