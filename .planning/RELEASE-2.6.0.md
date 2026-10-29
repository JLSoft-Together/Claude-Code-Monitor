<!-- Bản nháp 2.6.0 (v75), chưa release; thêm mục khi làm tiếp. -->
# English

## Devices
- **Accessibility check**: in the device screenshot dialog, Accessibility lists views without a label, touch targets under 48 dp, low text contrast (estimated from the screenshot) and duplicate descriptions, frames them on the image, finds each in the project and fills a fix prompt with the files into the agent.
- **Screen recording**: Record in the screenshot dialog (up to 30 s, Stop any time), then Save as MP4 or attach evenly spaced frames to the agent; the file on the device is always removed.
- **App performance**: Performance on a device row measures one app when you click: janky frames, frame percentiles, memory and cold start time; keeps the last 10 measurements, shows better / worse against an earlier one and fills the numbers into the agent.
- **Device files**: Files browses shared storage and debuggable app folders; pull to a folder or the project, push by picking or dropping files, with progress and Cancel; new folder and delete (asks first).

## Tools
- **Library vulnerabilities**: in Check for updates, the Security button asks osv.dev (only library names and versions) and shows known vulnerabilities: count, worst severity, fixed version, advisory links, a "Vulnerable only" filter; Fill into agent lists vulnerable libraries first.
- **Release check**: Run pane or Ctrl+K checks an Android / Flutter app before publishing: versionCode raised since the last release, release build settings, targetSdk against Google Play's requirement, manifest risks, AdMob test ids, consent / billing / Firebase hints, and the signing certificate of the APK / AAB against the remembered release key. Each item opens at its line; Fill into agent lists the problems. Nothing is built.

## Claude Code
- **CLAUDE.md / memory check**: in the background context dialog, Check lists broken memory links, index lines to missing files, unlisted memories, incomplete frontmatter, duplicate names, stale paths and oversized files; open each at its line or fill a cleanup prompt into the agent. Read-only.
- **Find a past session**: History (or Ctrl+K) searches what you asked Claude Code in earlier sessions, by project and range (7 / 30 / 90 days / all); each session shows its folder, start date, branch and up to 3 matching prompts with secrets masked. Resume in pane, Open folder or Copy session id. Scans only when you search; nothing is stored.

# Tiếng Việt

## Thiết bị
- **Kiểm trợ năng**: trong dialog chụp màn thiết bị, Trợ năng liệt kê view thiếu nhãn, vùng chạm dưới 48 dp, chữ tương phản thấp (ước lượng từ ảnh chụp) và mô tả trùng, khoanh trên ảnh, tìm trong dự án và điền prompt sửa kèm file vào agent.
- **Quay màn hình**: nút Quay trong dialog chụp màn (tối đa 30 s, Dừng bất cứ lúc nào), rồi Lưu thành MP4 hoặc đính kèm các khung hình rải đều cho agent; file trên máy luôn được xoá.
- **Hiệu năng app**: nút Hiệu năng trên hàng thiết bị đo một app khi bấm: khung hình giật, phân vị thời gian khung, bộ nhớ và thời gian mở nguội; giữ 10 lần đo, hiện tốt hơn / kém hơn so với lần trước và điền số liệu vào agent.
- **File trên thiết bị**: nút File duyệt bộ nhớ dùng chung và thư mục app debug; kéo về thư mục hoặc dự án, đẩy bằng cách chọn hoặc thả file, có tiến độ và Huỷ; tạo thư mục và xoá (hỏi trước).

## Công cụ
- **Lỗ hổng thư viện**: trong Kiểm bản mới, nút Bảo mật hỏi osv.dev (chỉ tên và phiên bản thư viện) và hiện lỗ hổng đã biết: số lượng, mức cao nhất, bản đã vá, link cảnh báo, lọc "Chỉ lib có lỗ hổng"; Điền vào agent đưa lib có lỗ hổng lên đầu.
- **Kiểm phát hành**: Run pane hoặc Ctrl+K kiểm app Android / Flutter trước khi đăng: versionCode đã tăng so với lần phát hành trước, cấu hình bản release, targetSdk so với mức Google Play yêu cầu, rủi ro trong manifest, ID test AdMob, gợi ý consent / thanh toán / Firebase, và chứng chỉ ký của APK / AAB so với khoá phát hành đã nhớ. Mỗi mục mở đúng dòng; Điền vào agent liệt kê các lỗi. Không build gì.

## Claude Code
- **Kiểm CLAUDE.md / memory**: trong dialog ngữ cảnh nền, Kiểm tra liệt kê link memory gãy, dòng index trỏ file không có, memory chưa vào index, frontmatter thiếu, trùng tên, đường dẫn cũ và file quá lớn; mở đúng dòng hoặc điền prompt dọn dẹp vào agent. Chỉ đọc.
- **Tìm session cũ**: History (hoặc Ctrl+K) tìm theo những gì bạn đã hỏi Claude Code ở các session trước, lọc dự án và khoảng (7 / 30 / 90 ngày / tất cả); mỗi session hiện thư mục, ngày bắt đầu, nhánh và tối đa 3 prompt khớp đã che secret. Tiếp tục trong pane, Mở thư mục hoặc Chép id session. Chỉ quét khi bạn tìm, không lưu lại gì.
