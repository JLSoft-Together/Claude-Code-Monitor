# English

## Workspace & editor
- What's new dialog after each update; open it again from Settings or Ctrl+K.
- Explorer gets Search, TODO and Checks views; Replace in files with a per-line preview you tick.
- Editor: Outline, Go to Symbol, bookmarks, recent files and edits, back / forward.
- Local History for files saved in the app, and Format on demand with a diff before applying.
- JSON / YAML tree view, a log viewer (levels, filter, follow) for large `.log` files.
- Send requests from `.http` / `.rest` files, with environments and a response view.
- Split preview beside the Markdown editor that follows its scroll; inline colour swatches with a picker.
- Drop-down shell terminal on `` Ctrl+` ``.
- Project notes (Ctrl+Alt+N) kept outside the repo, and a Plan board for `.planning` checklists.
- Errors from a shell terminal go to Problems.
- Ctrl+K developer tools: JWT, Base64, URL, timestamp, count, UUID.
- Compare any two files, or a file with the clipboard; `.env` check against `.env.example`; scan for missing, extra and untranslated i18n keys (Android, Flutter ARB, JSON locales).

## Git
- Stage, commit and blame in the app.
- Merge conflicts solved block by block.
- Changed images compare against HEAD in Changes.
- Checkpoints per agent turn, and Turn review to keep or drop each hunk.
- Compare and merge worktrees.

## Run & devices
- Device screenshot from the Devices tab or the Run pane, attached to an agent pane.
- Inspect views on the screenshot: id, text, bounds; Find in files or fill into an agent.
- Test UI on a device: dark mode, font size, display size, app language, animations off, then Restore all.
- Open the project's deep links and exported activities on a device, or type a URI.
- The Run pane catches Android and Flutter crashes and ANRs; frames in your project open the file.
- Fill a crash into the agent: exception, project frames and the log before it, with secrets masked.

## Agents
- Prompt library, and a prompt queue per agent pane that fills the input when a turn ends.
- An inbox of what needs you.
- A warning when several agents edit the same file.
- Permission prompts per project: repeated asks grouped into allow rules you tick.
- Ticked rules are written to `settings.local.json` only after a confirm that shows the exact diff.
- Background context of a session: first-reply tokens and the size of CLAUDE.md, memory and skills.

## Monitor
- New optional hook bridge: session cards and the map show when an agent is compacting and how many tools were denied.
- History has an activity heatmap by day and hour.
- In a narrow window the Sessions panel opens as a bottom sheet.

## Notes
- The hook bridge is off until you turn it on in **Quick setup**; the permission prompts advisor, compacting and denied-tool signals need it. If you turned it on in a pre-release build, turn it off and on again so it also records permission prompts.
- Windows: `Orrery-Setup-2.4.0.exe` (installer) or `Orrery-Portable-2.4.0.exe`. The exe is not code-signed: on the SmartScreen warning choose **More info → Run anyway**.
- macOS: `Orrery-2.4.0-arm64.dmg` (Apple Silicon) or `Orrery-2.4.0-x64.dmg` (Intel). The app is not notarized: open it once, then **System Settings → Privacy & Security → Open Anyway**.

---

# Tiếng Việt

## Workspace & editor
- Hộp "Có gì mới" sau mỗi lần cập nhật; mở lại trong Settings hoặc Ctrl+K.
- Explorer có thêm Tìm kiếm, TODO và Checks; Thay thế trên nhiều file, xem trước từng dòng và tick chọn.
- Editor: Outline, Go to Symbol, bookmark, file và chỗ vừa sửa gần đây, lùi / tiến.
- Local History cho file lưu trong app, và Format theo yêu cầu với diff xem trước khi áp.
- Xem JSON / YAML dạng cây, trình xem log (mức, lọc, theo dõi) cho file `.log` lớn.
- Gửi request từ file `.http` / `.rest`, có môi trường và khung xem phản hồi.
- Markdown xem trước song song, cuộn theo editor; ô màu ngay trong code, bấm để chọn màu.
- Terminal thả xuống bằng `` Ctrl+` ``.
- Ghi chú dự án (Ctrl+Alt+N) lưu ngoài repo, và bảng kế hoạch cho checklist trong `.planning`.
- Lỗi trong terminal shell được đưa vào Problems.
- Công cụ dev trong Ctrl+K: JWT, Base64, URL, timestamp, đếm ký tự, UUID.
- So hai file bất kỳ hoặc so với clipboard; kiểm `.env` với `.env.example`; tìm key i18n thiếu, thừa, chưa dịch (Android, Flutter ARB, JSON).

## Git
- Stage, commit và blame ngay trong app.
- Giải xung đột merge theo từng khối.
- So ảnh đã đổi với HEAD trong Changes.
- Checkpoint theo từng lượt agent, và Xem lại lượt để giữ hoặc bỏ từng đoạn.
- So sánh và gộp worktree.

## Run & thiết bị
- Chụp màn hình thiết bị từ tab Thiết bị hoặc Run pane, đính kèm vào pane agent.
- Soi view trên ảnh chụp: id, chữ, khung; tìm trong file hoặc điền vào agent.
- Thử giao diện trên máy: tối, cỡ chữ, cỡ hiển thị, ngôn ngữ app, tắt animation, rồi Trả về như cũ.
- Mở deep link và activity exported của dự án trên máy, hoặc tự nhập URI.
- Run pane bắt crash Android, Flutter và ANR; frame trong dự án mở thẳng file.
- Điền crash vào agent: exception, frame của dự án và log phía trước, đã che dữ liệu nhạy cảm.

## Agent
- Thư viện prompt, và hàng đợi prompt mỗi pane agent, tự điền vào ô nhập khi hết lượt.
- Hộp "cần chủ nhân" gom những việc đang chờ bạn.
- Cảnh báo khi nhiều agent cùng sửa một file.
- Hỏi quyền theo dự án: các lần hỏi lặp lại gom thành luật allow để tick chọn.
- Luật đã tick chỉ ghi vào `settings.local.json` sau hộp xác nhận hiện đúng phần thay đổi.
- Ngữ cảnh nền của session: token lượt trả lời đầu và dung lượng CLAUDE.md, memory, skill.

## Monitor
- Hook bridge tuỳ chọn mới: thẻ session và sơ đồ cho biết agent đang compact và số tool bị từ chối.
- History có heatmap hoạt động theo ngày và giờ.
- Cửa sổ hẹp thì panel Sessions mở dạng bottom sheet.

## Ghi chú
- Hook bridge tắt cho tới khi bạn bật trong **Quick setup**; gợi ý quyền, tín hiệu compact và tool bị từ chối cần nó. Nếu đã bật ở bản dev, hãy tắt rồi bật lại để nó ghi cả các lần hỏi quyền.
- Windows: `Orrery-Setup-2.4.0.exe` (cài đặt) hoặc `Orrery-Portable-2.4.0.exe`. Exe chưa ký code: khi SmartScreen cảnh báo, chọn **More info → Run anyway**.
- macOS: `Orrery-2.4.0-arm64.dmg` (Apple Silicon) hoặc `Orrery-2.4.0-x64.dmg` (Intel). App chưa notarize: mở một lần, rồi vào **System Settings → Privacy & Security → Open Anyway**.
