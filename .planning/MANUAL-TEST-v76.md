# Thử tay v76 — checklist cho chủ nhân

Chạy bản dev (`npm run desktop`) hoặc bản packaged sau khi build. Đánh dấu [x] khi xong, ghi lỗi ngay dưới mục.

## 1. Tài nguyên (R1 / R1b / R2)
- [ ] Mở 1 session Claude, để nhàn rỗi. Settings → Thông báo → "Coi là bỏ quên sau" = 15 phút. Sau 15 phút: nút Tài nguyên ở header có badge, toast "… mục bỏ quên đang dùng … GB".
- [ ] Trong một session, bảo agent chạy `npm run dev` nền (vd ở repo web bất kỳ). Mở Tài nguyên → tab Server: thấy dòng dev server có cổng (vd 5173), RAM / CPU.
- [ ] Tab Cổng: bấm Mở → pane Browser mở `localhost:<cổng>`. Bấm Chép.
- [ ] Chạy lại `npm run dev` cùng cổng trong session khác cho đụng cổng → thanh "Cổng … đang bị … giữ" hiện đầu Monitor.
- [ ] Tắt dev server bằng nút Tắt → hộp xác nhận native có tên, RAM, command line đã che → đồng ý → process mất, dòng biến khỏi bảng.
- [ ] Build một project Android (`gradlew assembleDebug`) rồi để yên 15 phút: tab Daemon thấy GradleDaemon (version, RAM). Khi đang build bấm Dừng → bị từ chối "đang bận". Hết build + nhàn rỗi → Dừng được.
- [ ] Tắt hẳn 1 cửa sổ terminal Claude đang có dev server con → dev server hiện "Mồ côi".

## 2. Emulator (R1c)
- [ ] Devices → chạy 1 AVD, không thao tác gì 15 phút → dòng emulator vào danh sách bỏ quên. Bấm Tắt → confirm → emulator tắt.
- [ ] Chạy app lên emulator qua Run pane → mốc "dùng gần nhất" cập nhật, không bị coi là bỏ quên.

## 3. Giữ máy thức (R3)
- [ ] Laptop cắm sạc, giao agent việc dài: header hiện cốc cà phê "Đang giữ máy thức (1 agent)". Để quá thời gian sleep của Windows → máy không ngủ, màn hình vẫn được tắt.
- [ ] Rút sạc khi chế độ "Chỉ khi cắm sạc" → cốc cà phê tắt. Cắm lại → bật lại.
- [ ] Agent xong việc → sau ~2 phút cốc cà phê tắt, máy ngủ bình thường.

## 4. Thư mục chụp / quay (R4)
- [ ] Settings → Ảnh chụp và video quay → Chọn thư mục `L:\AI\cache`, bật "Gửi ảnh dạng file".
- [ ] Devices → chụp màn → Đính kèm vào pane Claude → file PNG nằm ở `L:\AI\cache\shots\`, prompt có sẵn `@L:\AI\cache\shots\…png`, **chưa gửi**. Gửi tay → Claude đọc được ảnh.
- [ ] Quay màn 10 s → Lưu → hộp lưu mở sẵn `L:\AI\cache\recordings\`.
- [ ] Rút ổ `L:` (nếu là USB) → quay màn → app báo 1 lần và lưu tạm vào thư mục temp.

## 5. Canh nhạy cảm (R5)
- [ ] Bảo agent sửa `.env` trong một project test → card session có badge khiên, toast. Bấm badge → danh sách, Mở file / Bỏ qua trong project hoạt động.
- [ ] Bảo agent chạy `git push --force` trên repo thử (remote giả) → cảnh báo lệnh.

## 6. Điện thoại (R6)
- [ ] Settings → Điện thoại → kênh ntfy → làm theo "Cách thiết lập": cài app ntfy, Tạo topic ngẫu nhiên, quét QR (Android) hoặc gõ topic (iPhone), Lưu, Gửi thử → điện thoại nhận tin.
- [ ] "Chỉ khi máy rảnh" = 5 phút. Giao agent việc cần hỏi quyền, rời máy 5 phút → điện thoại nhận "xin quyền …". Tin không có prompt / đường dẫn.
- [ ] (Tuỳ chọn) Kênh Discord: tạo webhook theo hướng dẫn → Gửi thử → tin vào kênh.

## 7. Dữ liệu agent (R7)
- [ ] Settings → Dữ liệu agent → Đo: `~/.claude` ~11 GB, nhóm Transcript (Lịch sử) lớn nhất; `~/.codex` có Ảnh đã tạo kèm biểu tượng liên kết (junction sẵn sang L:); app Claude desktop chỉ hiện dung lượng.
- [ ] Đánh dấu Log debug / Ảnh chụp shell → Dọn mục đã chọn → hộp xác nhận nêu số file; Ảnh chụp shell báo phải tắt Claude Code.
- [ ] Chuyển `~/.claude` sang L: (xem báo cáo): tắt mọi Claude Code (cả pane Workspace, app Claude desktop) → Chuyển sang ổ khác… → chọn `L:\AI` → xác nhận → chờ chép + kiểm → dòng "Đã chuyển tới L:\AI\.claude". Mở `claude --resume` thấy session cũ; Orrery vẫn liệt kê session.
- [ ] Dùng vài ngày ổn → Xoá bản gốc. Muốn quay lại → Chuyển về (chọn chép về file mới).

## 9. Mẫu prompt + khôi phục (R10 / R11)
- [ ] Workspace → Alt+Shift+P → nhóm "Mẫu" có 12 mẫu tiếng Việt; chọn "Review thay đổi của tôi" trong pane Claude của một repo có thay đổi → Điền → prompt có danh sách file, **chưa gửi**.
- [ ] Mẫu → Nhân bản để sửa → sửa tên → Lưu → thành prompt riêng; Ẩn một mẫu → "Hiện mẫu đã ẩn (1)"; Ẩn nhóm mẫu → còn nút "Hiện mẫu".
- [ ] Nút Xuất (biểu tượng file lên) → hộp lưu native mở `Documents\orrery-prompts.json` → Lưu. Nút Nhập → chọn lại file đó → "Đã nhập 0, … bỏ qua n" (trùng cả nội dung). Sửa một prompt trong file rồi nhập → thanh Ghi đè / Giữ cả hai / Bỏ qua.
- [ ] Cài đặt › Khởi động → "Khi mở app" = Hỏi. Mở 2 project, cd vào thư mục con ở một shell, có 1 pane Claude. Tắt app bằng Task Manager (End task) → mở lại → Workspace: thẻ khôi phục có dòng cam "Orrery đã đóng bất thường…", 2 project đã tích → Khôi phục: shell ở đúng thư mục con, Claude mở lại bằng `--resume` (không gửi gì).
- [ ] Thoát bình thường qua khay → mở lại → thẻ khôi phục **không** có dòng "đóng bất thường".
- [ ] Chọn "Tự mở lại" → thoát → mở lại: không cần bấm, pane tự chạy (tối đa 2 cái khởi động cùng lúc). Chọn "Không làm gì" → mở lại: không có thẻ khôi phục.
- [ ] Bản cài (không phải dev): tắt "Chạy cùng Windows" → thẻ khôi phục có gợi ý bật; bấm Bật → Cài đặt thấy đã bật; gợi ý không hiện lại.

Gặp lỗi: chụp màn + Settings → Chép log chẩn đoán, gửi con.

## 8. Ổ đĩa (R8 / R9)

- [ ] Cài đặt › Dữ liệu agent › "Đồ build của các project" › Dọn đồ build…: dialog liệt kê project đã biết, chưa đo gì; bấm Đo → node_modules / build / .gradle… hiện kèm nhãn Node / Gradle / Flutter…, dung lượng, "Sửa … trước", sắp theo dung lượng.
- [ ] Thư mục build đang được git track (không ignore) và link / junction KHÔNG xuất hiện; `src/` không bao giờ có.
- [ ] Chuột phải project trên rail Workspace → "Dọn đồ build…" chỉ mở đúng project đó.
- [ ] Đang chạy dev server / Run pane / shell trong project → Xoá bị chặn, báo tên thứ đang chạy, không mất gì.
- [ ] Chọn folder Gradle khi daemon Gradle đang chạy → báo daemon, nút "Dừng Gradle daemon" (dừng xong tự xoá tiếp) và "Vẫn xoá".
- [ ] Xoá: hộp xác nhận native nêu tổng dung lượng, số thư mục, "phải cài lại" với node_modules; Huỷ → không mất gì; Xoá → thư mục mất, dòng biến khỏi danh sách; build / npm install lại chạy bình thường.
- [ ] Bật "Chuyển vào Thùng rác" → thư mục nằm trong Thùng rác (chậm hơn với node_modules).
- [ ] Cài đặt › Thông báo › "Cảnh báo khi ổ sắp đầy": chọn 50 GB (hoặc mức lớn hơn chỗ trống thật) → badge ổ đĩa hiện trên thanh trên trong vài giây; bấm → popover từng ổ (thanh, còn / tổng, chứa gì), "Dọn đồ build…", "Dữ liệu agent…", nút mở thư mục.
- [ ] Thông báo hệ thống "Ổ C: sắp đầy" hiện 1 lần (khi app không ở trước mặt); đo lại không báo lặp; tắt kind "Ổ đĩa sắp đầy" trong danh sách thông báo → không báo.
- [ ] Đặt lại 10 GB / Tắt → badge biến mất. Không có file nào được ghi ngoài `disk.json` trong data dir.
