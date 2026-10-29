# SPEC v75 — 8 ý IDEAS-2026-10-29h (chủ nhân chốt 2026-10-29: "làm hết")

Nguồn: `.planning/IDEAS-2026-10-29h.md`. Rule subagent: `.planning/AGENT-RULES-v75.md`. Tính năng đã có: `.code_index/features.md`.

Chủ nhân chốt:
- Làm cả 8 ý. **Không commit** (chưa cho phép) — để nguyên working tree, ghi commit message đề xuất trong PROGRESS.
- Ý 7: đồng ý đọc prompt cũ khi tìm (che secret, chỉ hiện lúc tìm, không lưu index nội dung).
- Ý 5: danh sách kiểm mặc định trong IDEAS + thêm kiểm nhẹ UMP / IAP / Firebase nếu project dùng (chỉ cảnh báo, không chặn).
- Ra ở bản sau (2.6.0): dòng changelog vào `## Changelog chờ` dưới đây + `.planning/RELEASE-2.6.0.md`.

Thứ tự (subagent tuần tự, cùng working tree):
1. Agent A: ý 6 OSV (mở rộng `libs/` v74) → ý 8 bác sĩ CLAUDE.md / memory (nối dialog ngữ cảnh nền v72).
2. Agent B: ý 1 accessibility → ý 3 quay màn (cùng dialog chụp màn thiết bị, `devices/uiDump.ts`).
3. Agent C: ý 2 hiệu năng app → ý 4 trình duyệt file thiết bị.
4. Agent D: ý 5 kiểm trước khi phát hành.
5. Agent E: ý 7 tìm lịch sử session + Resume.
6. Agent F: build app desktop, E2E mới `apps/desktop/e2e/v75.cjs` + hồi quy v74 / v73 / devices, gom báo cáo.

Ràng buộc thêm:
- Ý 6: chỉ gửi tên + version lib tới `api.osv.dev`, chỉ khi bấm, cache chung 1 h; env loopback cho E2E như `CCM_LIBS_REGISTRY`.
- Ý 8: chỉ đọc; không sửa file tự động; đường dẫn ngoài project / home `.claude` không mở.
- Ý 1: thuần parser có test; tương phản chỉ là ước lượng từ pixel ảnh chụp, ghi rõ trong UI.
- Ý 2: `am start -W -S` kill app → confirm native; không polling, đo khi bấm; lưu ≤ 10 lần / package.
- Ý 3: tối đa 30 s; dọn file tạm trên máy; khung hình bằng `screencap` (không ffmpeg).
- Ý 4: path thiết bị shell-quote, chặn `..`; xoá confirm native; push / pull có tiến độ, huỷ được.
- Ý 5: đọc tĩnh, không build; ngưỡng targetSdk là hằng có ngày; `apksigner` từ build-tools đã tìm; SHA chứng chỉ nhớ theo project trong data dir.
- Ý 7: quét khi bấm, huỷ được, ≤ 200 kết quả, chỉ record prompt người dùng, snippet ≤ 200 ký tự qua mask secret; Resume dùng đường `--resume` sẵn có (không gửi prompt).
- E2E: dùng adb giả (`fixtures/run-fakes/adb.js`), không đụng máy thật RFCTB05YJWJ, không đụng app ở cổng 4317.

## Changelog chờ

- [A] en: Library updates: a Security button asks osv.dev (library names and versions only) and shows known vulnerabilities per library: count, worst severity, fixed version and advisory links, with a "Vulnerable only" filter; Fill into agent puts vulnerable libraries first.
- [A] vi: Kiểm bản mới của thư viện: nút Bảo mật hỏi osv.dev (chỉ tên và phiên bản thư viện) và hiện lỗ hổng đã biết của từng lib: số lượng, mức cao nhất, bản đã vá, link cảnh báo, lọc "Chỉ lib có lỗ hổng"; Điền vào agent đưa lib có lỗ hổng lên đầu.
- [A] en: Background context: a Check button lists problems in CLAUDE.md and memory (links to no memory, index lines to missing files, memories missing from MEMORY.md, incomplete frontmatter, duplicate names, paths that no longer exist, oversized files); click a problem to open the file at the line, or fill a cleanup prompt into the agent. Nothing is edited.
- [A] vi: Ngữ cảnh nền: nút Kiểm tra liệt kê vấn đề trong CLAUDE.md và memory (link không có đích, dòng index trỏ file không có, memory chưa vào MEMORY.md, frontmatter thiếu, trùng tên, đường dẫn không còn, file quá lớn); bấm để mở đúng dòng, hoặc điền prompt dọn dẹp vào agent. Không sửa file nào.
- [B] en: Device screenshot: an Accessibility check lists clickable views without a label, touch targets under 48 dp and low text contrast (estimated from the screenshot), frames them on the image, finds each in the project and fills a fix prompt with the matching files into the agent.
- [B] vi: Ảnh chụp thiết bị: Kiểm trợ năng liệt kê view bấm được mà thiếu nhãn, vùng chạm dưới 48 dp, chữ tương phản thấp (ước lượng từ ảnh chụp), khoanh trên ảnh, tìm trong dự án và điền prompt sửa kèm file liên quan vào agent.
- [B] en: Device screen recording: record up to 30 seconds from the screenshot dialog, save the MP4, or attach evenly spaced frames to the agent (Claude cannot watch video). The file on the device is always removed.
- [B] vi: Quay màn hình thiết bị: quay tối đa 30 giây ngay trong dialog chụp màn, lưu MP4, hoặc đính kèm các khung hình rải đều cho agent (Claude không xem được video). File trên máy luôn được xoá.
- [C] en: Devices: Performance measures one app when you click: janky frames, frame time percentiles (p50 to p99), memory (total PSS, Java and native heap, graphics) and a cold start time (asks first, it restarts the app); the last 10 measurements per app are kept, compared with an earlier one (better / worse) and can be filled into the agent.
- [C] vi: Thiết bị: Hiệu năng đo một app khi bấm: khung hình giật, phân vị thời gian khung (p50 tới p99), bộ nhớ (tổng PSS, Java / native heap, đồ hoạ) và thời gian mở nguội (hỏi trước vì app bị mở lại); giữ 10 lần đo gần nhất mỗi app, so với lần trước (tốt hơn / kém hơn) và điền số liệu vào agent.
- [C] en: Devices: a Files browser for shared storage and the private folder of debuggable apps: open folders, pull to a folder or into the project, push files by picking or dropping them, with byte progress and Cancel, create folders and delete (asks first).
- [C] vi: Thiết bị: trình duyệt File cho bộ nhớ dùng chung và thư mục riêng của app debug: mở thư mục, kéo về thư mục hoặc vào dự án, đẩy file bằng cách chọn hoặc kéo thả, có tiến độ theo byte và Huỷ, tạo thư mục và xoá (hỏi trước).
- [D] en: Release check for Android and Flutter apps (Run pane, Ctrl+K): versionCode against the version marked released, release build (minify, shrink, debuggable, signing), targetSdk against Google Play's requirement, manifest (cleartext, debuggable, exported components, sensitive permissions), AdMob test ids, and consent / purchase acknowledgement / Firebase hints; each item opens its file at the line. Verify reads the APK / AAB signing certificate and compares it with the remembered release key. Fill into agent lists the problems. Nothing is built.
- [D] vi: Kiểm phát hành cho app Android và Flutter (Run pane, Ctrl+K): versionCode so với bản đã đánh dấu phát hành, bản release (minify, shrink, debuggable, ký), targetSdk so với mức Google Play yêu cầu, manifest (cleartext, debuggable, thành phần exported, quyền nhạy cảm), ID test AdMob, gợi ý consent / xác nhận giao dịch / Firebase; mỗi mục mở đúng file và dòng. Kiểm APK / AAB đọc chứng chỉ ký và so với khoá phát hành đã nhớ. Điền vào agent liệt kê các lỗi. Không build gì.
- [E] en: History: Find a past session searches what you asked Claude Code in earlier sessions (every word must match; project and 7 / 30 / 90 days / all), shows each session's folder, start date, branch, title and up to 3 matching prompts with secrets masked, and resumes it in a Workspace pane, opens its folder or copies its id. Only your own prompts are read, only while you search, and nothing is stored. Also in Ctrl+K.
- [E] vi: History: Tìm session cũ tìm theo những gì bạn đã hỏi Claude Code ở các session trước (phải khớp mọi từ; lọc dự án và 7 / 30 / 90 ngày / tất cả), hiện thư mục, ngày bắt đầu, nhánh, tiêu đề và tối đa 3 prompt khớp đã che secret, rồi tiếp tục trong pane Workspace, mở thư mục hoặc chép id. Chỉ đọc prompt của bạn, chỉ lúc đang tìm, không lưu lại gì. Có cả trong Ctrl+K.
