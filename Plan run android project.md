# Plan: Hỗ trợ project Android trong IDE

> **Mục tiêu:** Khi mở một folder trong Explorer, IDE tự nhận diện đó có phải project Android không. Nếu có thì hiện UI Run, và nút Run build rồi chạy app lên thiết bị Android mà không cần Android Studio.
>
> **Giả định kiến trúc:** IDE có 2 phần: **backend** (Node, ví dụ Electron main process) được phép chạy lệnh hệ thống, và **UI** (renderer) giao tiếp với backend qua IPC. Nếu kiến trúc khác, chỉ cần đổi tầng giao tiếp, các phần còn lại giữ nguyên.

---

## 1. Tổng quan kiến trúc

| Thành phần | Nằm ở | Nhiệm vụ |
|---|---|---|
| **AndroidDetector** | Backend | Đọc file trong workspace, kết luận có phải project Android không và gồm những module nào |
| **AndroidEnvironment** | Backend | Kiểm tra Android SDK, JDK, gradlew |
| **AndroidRunner** | Backend | Quản lý thiết bị; thực hiện build → install → launch → logcat |
| **Android UI** | Renderer | Toolbar Run, chọn module và thiết bị, panel Build và Logcat |

**Luồng hoạt động:**

```
Mở folder (Explorer)
   → Detector + Environment chạy
   → gửi kết quả lên UI
   → UI hiện/ẩn toolbar Android
   → người dùng bấm Run
   → Runner thực thi, stream trạng thái + log về UI
```

---

## 2. Giai đoạn 1: Detector, nhận diện project

**Đầu vào:** đường dẫn thư mục gốc đang mở trong Explorer.

### Các bước

1. **Tìm Gradle root**
   - Kiểm tra `settings.gradle` / `settings.gradle.kts` ở thư mục gốc.
   - Nếu không có, thử thư mục con `android/` (React Native, Flutter, Capacitor).
2. **Lấy danh sách module**
   - Parse các dòng `include(...)` trong settings, hỗ trợ cả Groovy và KTS, kể cả trường hợp nhiều module trên một dòng.
   - Đổi `:feature:login` thành thư mục `feature/login`.
3. **Xác định loại module**: đọc `build.gradle(.kts)` của từng module để tìm plugin id.
   - `com.android.application` thì là **app** (Run được).
   - `com.android.library` thì là **library**.
   - Alias kiểu `libs.plugins.android.application`: tra bảng `[plugins]` trong `gradle/libs.versions.toml` để ra id thật. Dấu `.` trong alias tương ứng với `-`, `_` hoặc `.` trong key.
   - Cú pháp cũ: `apply plugin: '...'`.
4. **Xác nhận bằng manifest**: `src/main/AndroidManifest.xml` hoặc `src/androidMain/AndroidManifest.xml` (KMP).
5. **Nhận diện framework** (để hiển thị cho người dùng): native, React Native (`package.json`), Flutter (`pubspec.yaml`), Capacitor, KMP.

### Kết quả trả về

- Gradle root
- Framework
- Danh sách module: tên, đường dẫn, loại (`application` | `library`), đường dẫn manifest

### Trạng thái kết luận

| Trạng thái | Ý nghĩa |
|---|---|
| `NOT_ANDROID` | Không phải project Android |
| `ANDROID_RUNNABLE` | Có ít nhất một module app |
| `ANDROID_NO_APP` | Chỉ có module library, không Run được |
| `ANDROID_UNKNOWN` | Có Gradle + manifest nhưng không xác định được plugin (ví dụ convention plugin trong `build-logic/`). Cho phép bấm "Phân tích sâu" để hỏi Gradle (làm sau) |

### Hiệu năng

- Chỉ đọc file ở các đường dẫn cố định, **không quét toàn bộ cây thư mục**.
- Bỏ qua `node_modules`, `build`, `.gradle`.
- Chạy bất đồng bộ, không chặn việc mở folder.

### Phát hiện lại khi project thay đổi

- File watcher trên `settings.gradle*`, `build.gradle*`, `libs.versions.toml`, `AndroidManifest.xml`.
- Debounce khoảng 500ms.
- Cache kết quả theo workspace.

---

## 3. Giai đoạn 2: Environment, kiểm tra môi trường

| Kiểm tra | Cách làm | Thông báo khi lỗi |
|---|---|---|
| Android SDK | Thứ tự: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `sdk.dir` trong `local.properties`, đường dẫn mặc định theo hệ điều hành. Phải có `platform-tools/adb` | "Không tìm thấy Android SDK" + nút **Chọn thư mục SDK** |
| JDK | Thứ tự: `JAVA_HOME`, `java` trong PATH, JBR đi kèm Android Studio nếu có. Phiên bản ≥ 17 (yêu cầu của AGP 8) | "Cần JDK 17+" |
| Gradle wrapper | Có `gradlew` / `gradlew.bat`. Trên macOS/Linux cần có quyền thực thi | "Project thiếu gradlew" |

Kết quả gộp với kết quả Detector thành **một object duy nhất** gửi lên UI.

---

## 4. Giai đoạn 3: Quản lý thiết bị

- **Danh sách thiết bị:** dùng `adb track-devices` để nhận cập nhật realtime. Fallback: poll `adb devices -l` mỗi 2–3 giây.
  - Trạng thái: `device` / `unauthorized` / `offline`, kèm tên model.
  - `unauthorized` hiển thị gợi ý: "Hãy xác nhận cho phép USB debugging trên điện thoại".
- **Emulator:** liệt kê AVD, khởi động AVD được chọn, chờ đến khi `sys.boot_completed = 1`.
- **Ghi nhớ** thiết bị đã chọn theo từng workspace.

---

## 5. Giai đoạn 4: Action cho nút Run

### Máy trạng thái (state machine)

```
IDLE → BUILDING → INSTALLING → LAUNCHING → RUNNING
          │            │            │          │
          └────────────┴────────────┴──────────┴──→ FAILED / CANCELLED
```

### Các bước khi bấm Run

1. **Kiểm tra điều kiện**
   - Đã chọn module app và thiết bị. Nếu chưa có thiết bị, mở hộp chọn thiết bị hoặc đề nghị bật emulator.
   - Tự động lưu các file đang mở.
2. **Build**
   - Chạy `gradlew :<module>:assemble<Variant> --console=plain`.
   - Stream output vào panel Build.
   - Parse lỗi Kotlin / Java / AAPT thành `file:dòng:cột`, hiển thị thành link click được để mở đúng vị trí trong editor.
   - Exit code khác 0 thì chuyển sang `FAILED`.
3. **Tìm APK**
   - Đọc `output-metadata.json` trong thư mục output để lấy đường dẫn APK và `applicationId`.
4. **Cài đặt**: `adb install -r -t`, xử lý riêng các lỗi thường gặp:
   - `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (sai chữ ký): hộp thoại "Gỡ bản cũ và cài lại?".
   - `INSUFFICIENT_STORAGE`, `NO_MATCHING_ABIS`: thông báo dễ hiểu.
5. **Mở app**
   - Hỏi PackageManager activity LAUNCHER của app, rồi `am start -n`.
   - Máy cũ không hỗ trợ thì fallback sang `monkey`.
   - App không có activity LAUNCHER thì báo lỗi rõ ràng.
6. **Logcat**
   - Lấy PID (`pidof`), stream logcat lọc theo PID.
   - App khởi động lại thì PID đổi, cần tự gắn lại.

### Nút Stop

- Đang build: kill cả cây tiến trình Gradle (Windows phải dùng `taskkill /T`).
- Đang chạy: `am force-stop <package>` và dừng logcat.

### Bấm Run khi đang chạy

Làm giống Android Studio: **hủy phiên hiện tại rồi chạy lại từ đầu**. Không chạy song song hai phiên trên cùng một thiết bị.

---

## 6. Giai đoạn 5: UI

### Hiển thị theo trạng thái Detector

| Trạng thái | Hiển thị |
|---|---|
| `NOT_ANDROID` | Ẩn hoàn toàn toolbar Android |
| `ANDROID_RUNNABLE` + môi trường OK | Toolbar đầy đủ, nút Run bật |
| `ANDROID_RUNNABLE` + môi trường lỗi | Toolbar có icon cảnh báo, nút Run tắt, banner hướng dẫn sửa |
| `ANDROID_NO_APP` | Badge Android trên Explorer, nút Run tắt, tooltip "Project chỉ có module library" |
| `ANDROID_UNKNOWN` | Badge Android có dấu "?", nút **Phân tích sâu** |

### Thành phần UI

- **Explorer:** badge / icon Android trên thư mục gốc; module app được đánh dấu riêng trong cây.
- **Toolbar Run:**
  - Dropdown **Module** (chỉ module app)
  - Dropdown **Variant** (mặc định `debug`)
  - Dropdown **Thiết bị** (kèm trạng thái, mục "Bật emulator…", nút refresh)
  - Nút **Run ▶ / Stop ■**
  - Dòng trạng thái: Building… / Installing… / Running
- **Panel dưới:**
  - Tab **Build**: output kèm link lỗi.
  - Tab **Logcat**: lọc theo level, ô tìm kiếm, nút xóa.
- **Settings:** đường dẫn SDK, đường dẫn JDK, tham số Gradle bổ sung.

### Trạng thái nút Run

| Trạng thái Runner | Nút chính | Dropdown |
|---|---|---|
| `IDLE` | Run ▶ (bật nếu đủ điều kiện) | Cho phép đổi |
| `BUILDING` / `INSTALLING` / `LAUNCHING` | Stop ■ | Khóa |
| `RUNNING` | Run ▶ (chạy lại) + Stop ■ | Cho phép đổi |
| `FAILED` | Run ▶ + thông báo lỗi trong panel | Cho phép đổi |

---

## 7. Hợp đồng IPC giữa backend và UI

**UI gọi backend (request/response):**

| Kênh | Tham số | Trả về |
|---|---|---|
| `android:detect` | đường dẫn workspace | thông tin project + môi trường |
| `android:getDevices` | – | danh sách thiết bị |
| `android:startEmulator` | tên AVD | serial |
| `android:run` | module, variant, serial | – |
| `android:stop` | – | – |
| `android:setSdkPath` | đường dẫn | thông tin môi trường mới |

**Backend đẩy sự kiện lên UI:**

| Sự kiện | Nội dung |
|---|---|
| `android:projectInfoChanged` | kết quả detect mới |
| `android:devicesChanged` | danh sách thiết bị mới |
| `android:runStateChanged` | trạng thái Runner |
| `android:buildLog` | một dòng output build |
| `android:buildError` | lỗi đã parse (file, dòng, cột, message) |
| `android:logcatLine` | một dòng logcat |

Chốt hợp đồng này **trước tiên** để phần UI và phần backend có thể làm song song.

---

## 8. Giai đoạn 6: Kiểm thử

### Fixtures cho Detector

| Fixture | Kỳ vọng |
|---|---|
| Native, Groovy DSL | `ANDROID_RUNNABLE` |
| Native, KTS + version catalog alias | `ANDROID_RUNNABLE` |
| Đa module (app + library) | `ANDROID_RUNNABLE`, đúng loại từng module |
| KMP (manifest ở `androidMain`) | `ANDROID_RUNNABLE` |
| React Native (`android/`) | `ANDROID_RUNNABLE`, framework = RN |
| Flutter | `ANDROID_RUNNABLE`, framework = Flutter |
| Chỉ có library | `ANDROID_NO_APP` |
| Java/Kotlin Gradle thuần | `NOT_ANDROID` |
| Project TS thuần | `NOT_ANDROID` |
| Convention plugin trong `build-logic/` | `ANDROID_UNKNOWN` |

### Runner

- Test tự động bằng `adb` và `gradlew` giả (script trả output mẫu) để kiểm tra state machine và xử lý lỗi.
- Test thủ công trên máy thật (USB và Wi‑Fi) và emulator.
- Chạy trên cả Windows, macOS, Linux. Chú ý Windows: `gradlew.bat` và đường dẫn có dấu cách.

---

## 9. Thứ tự triển khai (milestone)

| Milestone | Nội dung | Kết quả nghiệm thu |
|---|---|---|
| **M1** | Detector + badge trên Explorer + fixtures test | Mở folder là biết có phải project Android không |
| **M2** | Environment check + toolbar (chưa có action) + chọn module và thiết bị | Toolbar hiện đúng theo trạng thái, liệt kê được thiết bị |
| **M3** | Run: build → install → launch + panel Build | Bấm Run, app mở được trên máy thật |
| **M4** | Logcat, Stop, link lỗi click được, xử lý lỗi install | Xem log app, dừng được, click lỗi nhảy vào code |
| **M5** | Emulator, settings SDK/JDK, hoàn thiện UX | Chạy được trên emulator, cấu hình được đường dẫn |

---

## 10. Ngoài phạm vi đợt này

- Product flavor (nhiều variant phức tạp)
- Split APK theo ABI, Android App Bundle
- Chế độ "Phân tích sâu" qua Gradle
- Debug qua JDWP (breakpoint, xem biến)
- Apply Changes / hot reload
- Ghép đôi thiết bị qua Wi‑Fi ngay trong IDE
