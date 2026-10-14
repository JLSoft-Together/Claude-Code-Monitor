# Kế hoạch triển khai XML Layout Preview cho IDE TypeScript

Oct 14, 2026 · @Titan Zentrixa

## Mục tiêu & phạm vi

Khi mở một file `res/layout/*.xml`, IDE hiện ảnh preview bên cạnh editor và cập nhật theo nội dung đang gõ. Ảnh được vẽ bằng **layoutlib** — cùng thư viện Android Studio dùng — chạy trong một tiến trình JVM riêng. IDE TypeScript chỉ lo giao diện và điều phối.

Quyết định và giả định:

- Render qua một **Render Daemon viết bằng Kotlin**, dựa trên phần khởi tạo layoutlib của Paparazzi.
- Không tự viết engine layout bằng TS: không khớp pixel và không chạy được custom view.
- Giả định IDE chạy trên Node hoặc Electron và spawn được tiến trình con, như nút Run cũng cần.

Trong phạm vi v1:

- Preview layout của module app; chọn device, density, theme, sáng/tối, locale.
- View của framework, AndroidX, Material và custom view của project (sau khi build).
- Click vào ảnh để chọn view và nhảy tới dòng XML tương ứng.
- Thuộc tính `tools:` cơ bản: `tools:text`, `tools:visibility`, `tools:context`.

Ngoài phạm vi v1, để giai đoạn sau:

- Kéo-thả và Attributes panel ghi ngược vào XML.
- Compose Preview (dùng lại cùng daemon).
- Chế độ xem nhanh bằng HTML/CSS khi máy chưa có JDK.

## Kiến trúc tổng thể

Hai tiến trình: IDE TypeScript gửi nội dung XML cùng cấu hình, Render Daemon giữ layoutlib nóng sẵn và trả về ảnh PNG kèm cây view.

&#91;embedded content: kiến trúc · IDE TypeScript + Render Daemon\]

Project Model chạy Gradle để biết classpath và resource, rồi nạp vào daemon một lần; mỗi lần gõ chỉ còn một lời gọi `render` qua stdio.

## Giao thức IDE ↔ Render Daemon

Dùng JSON-RPC 2.0 qua stdin/stdout, đóng khung bằng header `Content-Length` giống LSP. Nhờ vậy phía TS dùng lại được `vscode-jsonrpc`, phía Kotlin dùng `lsp4j-jsonrpc`.

| Method | Hướng | Payload chính | Kết quả |
| --- | --- | --- | --- |
| `initialize` | IDE → daemon | phiên bản giao thức, thư mục cache | phiên bản layoutlib, API level hỗ trợ |
| `project/load` | IDE → daemon | `resDirs[]`, `classpath[]`, `aarResDirs[]`, `packageName`, `rJar`, theme từ manifest | ok, hoặc lỗi thiếu output build |
| `project/changed` | IDE → daemon | danh sách file resource hoặc class đã đổi | ok (xóa cache liên quan) |
| `render` | IDE → daemon | `requestId`, `layoutPath`, `xmlContent`, device (width, height, density), theme, night, locale, apiLevel | đường dẫn PNG, `viewTree`, `diagnostics[]`, `renderMs` |
| `cancel` | IDE → daemon | `requestId` | — |
| `shutdown` | IDE → daemon | — | — |
| `log` | daemon → IDE | level, message | notification |

Mỗi node trong `viewTree` có dạng:

```json
{ "class": "com.google.android.material.button.MaterialButton",
  "xmlId": "@+id/btnSave", "line": 34, "column": 5,
  "bounds": [16, 480, 344, 528], "children": [] }
```

Quy ước:

- Gửi `xmlContent` thay vì đọc file từ đĩa, để preview theo buffer chưa lưu.
- Ảnh trả về qua file tạm (đường dẫn), không nhét base64 vào pipe.
- `line`/`column` lấy từ cookie của parser mà daemon tự cung cấp cho layoutlib (xem Giai đoạn 1).
- `bounds` tính theo pixel của ảnh; IDE tự nhân theo mức zoom.
- IDE debounce khoảng 300 ms và gửi `cancel` cho request cũ khi có request mới.

## Lộ trình theo giai đoạn

Sáu giai đoạn, tổng khoảng 5–7 tuần cho một người. Ước lượng là thô; Giai đoạn 0 quyết định có đi tiếp hướng này không.

### Giai đoạn 0 — Spike (2–3 ngày)

Mục tiêu: chứng minh layoutlib chạy được trên máy của bạn, ngoài JUnit.

- [ ] Tạo project Kotlin/Gradle nhỏ, khai báo dependency Paparazzi để kéo layoutlib và runtime native
- [ ] Đọc mã khởi tạo của Paparazzi (Bridge, SessionParams, LayoutlibCallback) và viết một `main()` tương tự
- [ ] Render một file XML chỉ có view framework (`LinearLayout`, `TextView`, `Button`) ra PNG
- [ ] Đo thời gian khởi động và thời gian mỗi lần render

Kết quả: một file PNG đúng và hai con số thời gian. Không ra được ảnh thì dừng lại xem xét lại hướng.

### Giai đoạn 1 — Render Daemon (khoảng 1 tuần)

- [ ] JSON-RPC server qua stdio với `initialize`, `render`, `cancel`, `shutdown`
- [ ] Tự cài `ILayoutPullParser` đọc `xmlContent` từ RAM, gắn cookie là dòng/cột cho từng thẻ
- [ ] Giữ một Bridge đã khởi tạo, tạo `RenderSession` mới cho mỗi request rồi `dispose()`
- [ ] Duyệt cây View sau khi render → `viewTree` với bounds và dòng XML
- [ ] Bắt lỗi inflate/render thành `diagnostics[]`, không để daemon sập
- [ ] Đóng gói thành một fat jar

### Giai đoạn 2 — Tích hợp vào IDE (khoảng 1 tuần)

- [ ] `DaemonManager` (TS): tìm JDK, spawn, health check, tự khởi động lại khi chết
- [ ] Chỉ khởi động daemon khi IDE nhận ra project Android (dùng lại phần nhận diện project)
- [ ] `PreviewPanel`: ảnh, zoom, thanh chọn device / theme / sáng-tối / locale
- [ ] Debounce khi gõ, hủy request cũ, hiện trạng thái đang render
- [ ] Hiện `diagnostics` dưới ảnh và gạch chân trong editor

### Giai đoạn 3 — Project model (1–1,5 tuần)

- [ ] Gradle init script (truyền bằng `--init-script`, không sửa project người dùng) xuất JSON: classpath runtime, thư mục `res` của các AAR, class đã compile, `R.jar`
- [ ] Đọc theme của app/activity từ `AndroidManifest.xml`; `tools:context` ưu tiên hơn
- [ ] Daemon dựng resource repository từ `res/` nguồn + AAR, ánh xạ ID theo `R.jar`
- [ ] ClassLoader riêng cho class của project, tạo lại sau mỗi lần build
- [ ] Theo dõi thay đổi trong `res/` → `project/changed`; thay đổi code → nhắc build lại
- [ ] Chưa build: vẫn render view framework, báo rõ cần build để hiện AndroidX/custom view

### Giai đoạn 4 — Tương tác (khoảng 1 tuần)

- [ ] Overlay vẽ khung của view khi hover
- [ ] Click vào view → nhảy tới dòng XML
- [ ] Đặt con trỏ trong XML → tô sáng view tương ứng
- [ ] Chế độ blueprint: chỉ vẽ khung từ `viewTree`, không cần ảnh

### Giai đoạn 5 — Hoàn thiện (tuỳ nhu cầu)

- [ ] `<include>`, `<merge>`, `tools:listitem` cho `RecyclerView`
- [ ] Nhiều cấu hình cùng lúc (điện thoại, tablet, dark) cạnh nhau
- [ ] Cache ảnh theo hash của nội dung + cấu hình
- [ ] Compose Preview qua cùng daemon

## Môi trường & phụ thuộc

Máy người dùng cần JDK và Android SDK — hai thứ nút Run vốn đã cần. Phần còn lại đóng gói cùng IDE.

| Thành phần | Dùng để | Lấy từ đâu |
| --- | --- | --- |
| JDK 17+ | Chạy Render Daemon | `JAVA_HOME` của máy, hoặc đóng gói JRE rút gọn bằng `jlink` |
| layoutlib + runtime native (font, ICU, Skia) theo từng OS | Vẽ layout | Maven: `com.android.tools.layoutlib:layoutlib`, `layoutlib-api`, kéo theo qua [Paparazzi](https://central.sonatype.com/artifact/app.cash.paparazzi/paparazzi) |
| Paparazzi | Tham khảo / tái dùng code khởi tạo Bridge | [github.com/cashapp/paparazzi](https://github.com/cashapp/paparazzi/) (Apache 2.0) |
| `sdk-common` / `layoutlib-api` | Resource repository, interface `LayoutlibCallback`, `ILayoutPullParser` | Maven `com.android.tools` |
| `lsp4j-jsonrpc` / `vscode-jsonrpc` | Giao thức hai phía | Maven / npm |
| Android SDK + Gradle wrapper của project | Build ra class, `R.jar`, AAR đã giải nén | Máy người dùng |
| `chokidar` | Theo dõi thay đổi trong `res/` | npm |

Ghim cứng phiên bản layoutlib theo phiên bản Paparazzi đã thử; nâng cấp là một việc có chủ đích, không tự động.

## Rủi ro & cách giảm thiểu

Rủi ro lớn nhất là layoutlib và Paparazzi không có API công khai ổn định cho việc chạy dạng daemon.

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| API layoutlib là nội bộ, đổi theo phiên bản Android Studio | Nâng cấp làm hỏng daemon | Ghim phiên bản; gói mọi lời gọi layoutlib sau một lớp adapter |
| Paparazzi thiết kế cho JUnit, không cho tiến trình sống lâu | Phải tách code khởi tạo ra khỏi test rule | Chỉ mượn phần khởi tạo; fork nếu cần |
| Rò bộ nhớ khi nạp lại ClassLoader sau mỗi build | Daemon phình dần rồi chậm | Giới hạn heap; tự khởi động lại daemon sau một số lần build |
| Khởi động JVM + layoutlib chậm | Lần preview đầu phải chờ | Spawn ngay khi mở project Android; render khởi động (warm-up) một layout rỗng |
| Đường dẫn output Gradle đổi giữa các bản AGP | Không tìm thấy `R.jar`, class | Lấy qua init script / API của Gradle, không hardcode đường dẫn |
| Custom view gọi API chỉ có trên thiết bị | Crash khi render | Bắt exception từng view, vẽ placeholder + diagnostic; hướng dẫn dùng `isInEditMode()` |
| Runtime native khác nhau theo OS và kiến trúc CPU | Chạy được trên máy này, lỗi trên máy khác | Test trên macOS, Windows, Linux ngay từ Giai đoạn 0 |
| Gói cài đặt nặng thêm (JRE, runtime native, font) | IDE tăng dung lượng | Tải phần preview lần đầu khi cần, không đóng gói sẵn |

## Tiêu chí hoàn thành & kiểm thử

v1 coi là xong khi một project thật dùng Material + ConstraintLayout preview đúng mà không cần mở Android Studio.

- [ ] Layout chỉ có view framework hiện trong vòng 1 giây sau khi ngừng gõ (daemon đã warm-up)
- [ ] Layout dùng Material, ConstraintLayout của project render đúng sau khi build
- [ ] Custom view render được, hoặc hiện placeholder kèm lỗi mà daemon không sập
- [ ] Sửa XML chưa lưu → preview cập nhật
- [ ] Đổi device, sáng/tối, locale → ảnh đổi theo
- [ ] Click vào view → nhảy đúng dòng XML
- [ ] Kill daemon bằng tay → IDE tự khởi động lại, lần render kế tiếp vẫn ra ảnh

Kiểm thử:

- **Golden image**: một bộ 15–20 layout mẫu; so ảnh daemon với ảnh chụp từ Android Studio theo ngưỡng lệch pixel.
- **Daemon**: test Kotlin gọi trực tiếp các method RPC, gồm XML hỏng và class thiếu.
- **Tích hợp**: test TS spawn daemon thật, gửi `render`, kiểm tra `viewTree` và xử lý `cancel`.
- **Ma trận**: 2–3 phiên bản AGP × 3 hệ điều hành trên CI.
