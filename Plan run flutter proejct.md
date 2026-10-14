# Plan: Hỗ trợ project Flutter trong IDE

> **Mục tiêu:** Khi mở một folder trong Explorer, IDE tự nhận diện các project Flutter có trong đó. Nếu là Flutter app thì hiện UI Run, chạy được lên thiết bị với hot reload / hot restart, và cho phép tùy chỉnh lệnh run qua **Run Configuration** (tương tự Run/Debug Configurations của Android Studio).
>
> **Giả định kiến trúc:** giống `android-run-plan.md`. **Backend** (Node, ví dụ Electron main process) được phép chạy lệnh hệ thống, **UI** (renderer) giao tiếp với backend qua IPC.

---

## 1. Tổng quan kiến trúc

| Thành phần | Nằm ở | Nhiệm vụ |
|---|---|---|
| **FlutterDetector** | Backend | Tìm các project Flutter trong workspace, phân loại app / package / plugin, thu thập entrypoint, platform, flavor |
| **FlutterEnvironment** | Backend | Tìm Flutter SDK đúng phiên bản (kể cả FVM), lấy thông tin phiên bản |
| **FlutterDeviceService** | Backend | Theo dõi thiết bị và emulator qua `flutter daemon` |
| **RunConfigurationStore** | Backend | Đọc, ghi, nhập và tự tạo Run Configuration |
| **FlutterRunner** | Backend | Chạy `flutter run --machine`, xử lý sự kiện JSON-RPC, hot reload / restart / stop |
| **Flutter UI** | Renderer | Toolbar, hộp thoại Edit Configurations, panel Run |

**Luồng hoạt động:**

```
Mở folder (Explorer)
   → FlutterDetector chạy (trước Android detector)
   → FlutterEnvironment + RunConfigurationStore khởi tạo
   → UI hiện toolbar Flutter + dropdown cấu hình + dropdown thiết bị
   → người dùng bấm Run
   → FlutterRunner chạy, stream trạng thái + log về UI
```

---

## 2. Giai đoạn 1: Detector, nhận diện project Flutter

### Dấu hiệu nhận diện

| Mức | Dấu hiệu | Kết luận |
|---|---|---|
| Cần | Có `pubspec.yaml` | Project Dart hoặc Flutter |
| Đủ | Trong `dependencies` có `flutter:` với `sdk: flutter` | Project Flutter |
| Phân loại | File `.metadata` có `project_type: app \| package \| plugin` | Loại project (đáng tin nhất) |
| Phân loại (fallback) | Có `lib/main.dart` **và** ít nhất một thư mục platform | App |
| Phân loại (fallback) | Có mục `flutter: plugin:` trong `pubspec.yaml` | Plugin |

Chỉ project loại **app** mới Run được.

### Vị trí tìm kiếm

- Thư mục gốc và các thư mục con **1–2 cấp** (monorepo thường đặt app trong `mobile/`, `apps/<tên>/`).
- Bỏ qua `build/`, `.dart_tool/`, `node_modules/`, `.git/`, `ios/Pods/`.
- Mỗi `pubspec.yaml` là một project riêng, có cwd riêng.

### Thông tin thu thập cho mỗi project

| Thông tin | Nguồn |
|---|---|
| Tên project | `name` trong `pubspec.yaml` |
| Loại | `.metadata` hoặc fallback ở trên |
| Entrypoint | Tất cả file `lib/main*.dart` (vd `main.dart`, `main_dev.dart`, `main_prod.dart`) |
| Platform hỗ trợ | Các thư mục `android/`, `ios/`, `web/`, `windows/`, `macos/`, `linux/` đang có |
| Flavor | `productFlavors` trong `android/app/build.gradle(.kts)`; scheme trong `ios/Runner.xcodeproj` |
| Trạng thái `pub get` | Thiếu `.dart_tool/package_config.json`, hoặc `pubspec.yaml` mới hơn `pubspec.lock` → cần `flutter pub get` |
| Phiên bản SDK riêng | `.fvmrc` hoặc `.fvm/` |

### Trạng thái kết luận (theo từng project)

| Trạng thái | Ý nghĩa |
|---|---|
| `NOT_FLUTTER` | Không có project Flutter nào |
| `FLUTTER_APP` | Flutter app, Run được |
| `FLUTTER_PACKAGE` | Package hoặc plugin, không Run được (plugin có thể Run thư mục `example/` nếu có) |
| `DART_ONLY` | Project Dart thuần, ngoài phạm vi plan này |

### Thứ tự ưu tiên với Android detector

- **Chạy Flutter detector trước.**
- Nếu thư mục `android/` thuộc một Flutter project, Android detector bỏ qua nó. Không hiện toolbar Run Android native cho cùng một app.

### Phát hiện lại khi project thay đổi

- File watcher trên `pubspec.yaml`, `pubspec.lock`, `.metadata`, `.fvmrc`, `lib/main*.dart`, `android/app/build.gradle*`.
- Debounce khoảng 500ms, cache kết quả theo workspace.
- `pubspec.yaml` thay đổi → hiện banner "Chạy `flutter pub get`?".

---

## 3. Giai đoạn 2: Environment, Flutter SDK

### Thứ tự tìm Flutter SDK

1. Đường dẫn cấu hình riêng cho project (Settings của IDE)
2. **FVM:** `.fvmrc` / `.fvm/flutter_sdk` trong project
3. Biến môi trường `FLUTTER_ROOT`
4. `flutter` trong PATH
5. Đường dẫn cài đặt phổ biến theo hệ điều hành

> Hỗ trợ FVM là bắt buộc: nhiều project khóa phiên bản Flutter riêng, IDE phải dùng đúng SDK đó thay vì bản global.

### Kiểm tra

| Kiểm tra | Cách làm | Thông báo khi lỗi |
|---|---|---|
| Có Flutter SDK | Một trong các nguồn trên tồn tại `bin/flutter` | "Không tìm thấy Flutter SDK" + nút **Chọn thư mục SDK** |
| Phiên bản | `flutter --version --machine` (JSON: phiên bản Flutter, Dart, channel) | Hiển thị trên status bar |
| Toolchain theo platform | Chỉ kiểm tra khi chọn thiết bị thuộc platform đó; có thể chạy `flutter doctor` và hiển thị trong panel | Hướng dẫn cài Android SDK / Xcode / Visual Studio tương ứng |

---

## 4. Giai đoạn 3: Quản lý thiết bị

- **Khởi động `flutter daemon`** một lần cho mỗi SDK, gửi lệnh `device.enable`.
  - Nhận sự kiện `device.added` / `device.removed` theo thời gian thực.
  - Mỗi thiết bị có: id, tên, platform, có phải emulator không.
- **Fallback:** `flutter devices --machine` (JSON) nếu daemon lỗi. Lệnh này mất vài giây nên phải cache.
- **Emulator:** `flutter emulators` để liệt kê, `flutter emulators --launch <id>` để bật.
- **Lọc thiết bị:** chỉ hiện thiết bị thuộc platform mà project hỗ trợ (không có `web/` thì ẩn Chrome).
- **Ghi nhớ** thiết bị đã chọn theo từng workspace.

---

## 5. Giai đoạn 4: Run Configuration

### Các trường cấu hình

| Trường | Ánh xạ sang lệnh / hành vi |
|---|---|
| Name | Tên hiển thị trong dropdown |
| Project (cwd) | Thư mục chứa `pubspec.yaml` |
| Dart entrypoint | `-t <file>` |
| Device | `-d <id>`, hoặc "dùng thiết bị đang chọn trên toolbar" (mặc định) |
| Build mode | `--debug` / `--profile` / `--release` |
| Build flavor | `--flavor <name>` |
| Additional run args | Nối vào cuối lệnh, vd `--dart-define-from-file=env.json` |
| Additional attach args | Dùng cho tính năng Attach (để sau) |
| Environment variables | Gộp với biến môi trường hệ thống |
| Before launch | Danh sách lệnh chạy tuần tự trước khi run, lỗi thì dừng |
| Hot reload on save | Bật / tắt tự hot reload khi lưu file `.dart` |
| Store as project file | Lưu vào repo (chia sẻ với team) hoặc chỉ lưu trên máy |

### Ví dụ một cấu hình

```json
{
  "name": "main.dart (dev)",
  "type": "flutter",
  "cwd": "mobile",
  "entrypoint": "lib/main.dart",
  "device": "selected",
  "mode": "debug",
  "flavor": "",
  "args": "--dart-define-from-file=env.json",
  "attachArgs": "",
  "env": { "API_URL": "http://localhost:8080" },
  "beforeLaunch": ["dart run build_runner build -d"],
  "hotReloadOnSave": true
}
```

### Loại cấu hình

| Loại | Mô tả |
|---|---|
| `flutter` | Như trên, có đầy đủ hot reload / restart |
| `custom` | Người dùng nhập nguyên lệnh (vd `fvm flutter run …`, `melos run dev`). Chỉ stream output, không có hot reload trừ khi lệnh có `--machine` |
| `android` | Cấu hình Run Android native (theo `android-run-plan.md`) |

### Lưu trữ

- **Lưu chung với team:** mỗi cấu hình là một file JSON, đặt trong thư mục ẩn của IDE tại gốc repo.
- **Lưu cá nhân:** thư mục dữ liệu của IDE trên máy, theo từng workspace.
- **Template:** giá trị mặc định cho cấu hình mới (giống "Edit configuration templates…").

### Tự động tạo cấu hình

- Khi detect ra Flutter app mà chưa có cấu hình nào: tạo một cấu hình cho mỗi file `lib/main*.dart`.
- Nếu project có flavor: gợi ý tạo cấu hình theo từng flavor.

### Nhập cấu hình từ IDE khác

| Nguồn | File | Ánh xạ |
|---|---|---|
| Android Studio / IntelliJ | `.run/*.run.xml` | entrypoint, additional args, flavor, env |
| VS Code | `.vscode/launch.json` với `type: "dart"` | `program` → entrypoint, `args` / `toolArgs` → args, `deviceId`, `flutterMode` → mode |

Nhập một chiều, khi mở project lần đầu hoặc qua nút **Import**. Không ghi ngược lại file của IDE khác.

### Ghép lệnh

**Thứ tự tham số:**

```
flutter run --machine -d <device> -t <entrypoint> [--flavor <f>] [--<mode>] <additional args>
```

**Quy tắc:**
- Tách chuỗi "Additional args" thành mảng tham số, hỗ trợ dấu ngoặc kép.
- Spawn **không qua shell** để tránh lỗi đường dẫn có dấu cách và lỗi chèn lệnh.
- Biến thay thế: `${projectDir}`, `${workspaceDir}`, `${env:NAME}`.
- cwd luôn là thư mục chứa `pubspec.yaml`, để đường dẫn tương đối (vd `env.json`) đúng.
- Với FVM: dùng `flutter` trong `.fvm/flutter_sdk/bin`.
- Validate trước khi chạy: entrypoint tồn tại, file trong `--dart-define-from-file` tồn tại, flavor có trong danh sách đã detect.

**Command preview:** hiện lệnh cuối cùng ngay trong hộp thoại cấu hình, cập nhật khi người dùng sửa form.

---

## 6. Giai đoạn 5: Runner, logic Run

### Chọn cách chạy

| Cách | Ưu điểm | Nhược điểm |
|---|---|---|
| `flutter run` + gửi phím qua stdin (`r`, `R`, `q`) | Làm nhanh | Output là text tự do, khó biết chính xác trạng thái |
| **`flutter run --machine`** (JSON-RPC qua stdin/stdout) | Có sự kiện rõ ràng, cách VS Code và Android Studio dùng | Phải parse protocol |

**Chọn `flutter run --machine`.** Cách stdin chỉ dùng cho loại cấu hình `custom`.

### Protocol

**Sự kiện nhận về:**

| Sự kiện | Ý nghĩa | Xử lý |
|---|---|---|
| `daemon.connected` | Tiến trình sẵn sàng | Ghi log |
| `app.start` | Bắt đầu chạy, có `appId` | Lưu `appId` |
| `app.progress` | Đang build / cài / đồng bộ | Cập nhật thanh tiến trình |
| `app.debugPort` | Có URI VM Service | Lưu URI cho DevTools / debug |
| `app.started` | App đã chạy | Chuyển sang `RUNNING` |
| `app.log` | Log của app | Đẩy vào panel Run |
| `app.stop` | App đã dừng | Chuyển sang `IDLE` |

**Lệnh gửi đi:**

| Lệnh | Tác dụng |
|---|---|
| `app.restart` với `fullRestart: false` | Hot reload |
| `app.restart` với `fullRestart: true` | Hot restart |
| `app.stop` | Dừng app |

Mọi dòng stdout không phải JSON-RPC (vd output Gradle) vẫn đẩy vào panel Run dưới dạng log thường.

### Máy trạng thái

```
IDLE → BEFORE_LAUNCH → STARTING → RUNNING ⇄ RELOADING
  ↑                                  │
  └──────────── STOPPING ←───────────┘
Bất kỳ trạng thái nào → FAILED
```

### Các bước khi bấm Run

1. **Kiểm tra điều kiện:** có cấu hình, có thiết bị, có Flutter SDK. Tự động lưu các file đang mở.
2. **pub get nếu cần:** nếu detector báo thiếu, chạy `flutter pub get` trước.
3. **Before launch:** chạy tuần tự các lệnh, lỗi thì chuyển sang `FAILED`.
4. **Ghép lệnh** theo mục 5 và spawn tiến trình.
5. **Xử lý sự kiện** theo bảng protocol.
6. **Hot reload khi lưu file `.dart`** nếu cấu hình bật. Chỉ ở chế độ debug. Debounce để không reload liên tục khi lưu nhiều file.

### Nút trên toolbar

| Nút | Hành vi | Khi nào bật |
|---|---|---|
| Run ▶ | Chạy mới; đang chạy thì dừng rồi chạy lại | Luôn bật khi đủ điều kiện |
| Hot Reload ⚡ | `app.restart` `fullRestart: false` | `RUNNING` + debug |
| Hot Restart ↻ | `app.restart` `fullRestart: true` | `RUNNING` + debug |
| Stop ■ | Gửi `app.stop`; sau vài giây không thoát thì kill cả cây tiến trình | `STARTING` / `RUNNING` |
| DevTools | Mở theo URI từ `app.debugPort` | Có URI |

### Xử lý lỗi thường gặp

| Tình huống | Xử lý |
|---|---|
| Lỗi biên dịch Dart | Parse `file:dòng:cột`, hiện link click được trong panel |
| Hot reload thất bại (vd đổi kiểu dữ liệu) | Thông báo, gợi ý Hot Restart |
| Thiết bị ngắt kết nối khi đang chạy | Chuyển sang `IDLE`, thông báo |
| Lỗi Gradle / Xcode | Hiện nguyên log, highlight dòng lỗi |
| Thiếu file trong `--dart-define-from-file` | Chặn từ bước validate, chỉ rõ file thiếu |

---

## 7. Giai đoạn 6: UI

### Hiển thị theo trạng thái Detector

| Trạng thái | Hiển thị |
|---|---|
| `NOT_FLUTTER` | Ẩn toolbar Flutter |
| `FLUTTER_APP` + SDK OK | Toolbar đầy đủ |
| `FLUTTER_APP` + thiếu SDK | Toolbar có cảnh báo, Run tắt, banner hướng dẫn |
| `FLUTTER_PACKAGE` | Badge Flutter trên Explorer, không có Run (trừ khi có `example/`) |

### Thành phần UI

- **Explorer:** badge Flutter trên thư mục chứa `pubspec.yaml`.
- **Toolbar:** dropdown Run Configuration (có mục **Edit Configurations…**) · dropdown Thiết bị · Run ▶ · Hot Reload ⚡ · Hot Restart ↻ · Stop ■ · DevTools.
- **Hộp thoại Edit Configurations:**
  - Bên trái: danh sách cấu hình nhóm theo loại (Flutter, Android, Custom); nút thêm, xóa, nhân bản; link "Edit configuration templates…".
  - Bên phải: form các trường ở mục 5, **Command preview**, danh sách Before launch có thể sắp xếp.
  - Dưới cùng: Run · OK · Cancel · Apply.
- **Panel Run:** log app, thanh tiến trình từ `app.progress`, ô lọc log, nút xóa.
- **Status bar:** phiên bản Flutter đang dùng (kèm chữ "FVM" nếu dùng phiên bản riêng).

---

## 8. Hợp đồng IPC giữa backend và UI

**UI gọi backend (request/response):**

| Kênh | Tham số | Trả về |
|---|---|---|
| `flutter:detect` | đường dẫn workspace | danh sách project + thông tin môi trường |
| `flutter:getDevices` | – | danh sách thiết bị |
| `flutter:launchEmulator` | id emulator | – |
| `runConfig:list` | workspace | danh sách cấu hình |
| `runConfig:save` | cấu hình | cấu hình đã lưu |
| `runConfig:delete` | id | – |
| `runConfig:import` | nguồn (`.run` / `launch.json`) | các cấu hình đã nhập |
| `runConfig:preview` | cấu hình | lệnh cuối cùng (chuỗi) + lỗi validate |
| `flutter:run` | id cấu hình, id thiết bị | – |
| `flutter:hotReload` | – | – |
| `flutter:hotRestart` | – | – |
| `flutter:stop` | – | – |
| `flutter:pubGet` | id project | – |

**Backend đẩy sự kiện lên UI:**

| Sự kiện | Nội dung |
|---|---|
| `flutter:projectsChanged` | kết quả detect mới |
| `flutter:devicesChanged` | danh sách thiết bị mới |
| `flutter:runStateChanged` | trạng thái Runner |
| `flutter:progress` | tiến trình build / cài |
| `flutter:log` | một dòng log |
| `flutter:error` | lỗi đã parse (file, dòng, cột, message) |
| `flutter:debugUri` | URI VM Service |

Chốt hợp đồng này **trước tiên** để UI và backend làm song song.

---

## 9. Giai đoạn 7: Kiểm thử

### Fixtures cho Detector

| Fixture | Kỳ vọng |
|---|---|
| Flutter app chuẩn (`flutter create`) | `FLUTTER_APP` |
| App không có `.metadata` | `FLUTTER_APP` (qua fallback) |
| App nhiều entrypoint (`main_dev`, `main_prod`) | Đủ các entrypoint |
| App có flavor Android | Đúng danh sách flavor |
| Monorepo, app trong `mobile/` | Tìm thấy, cwd = `mobile` |
| Monorepo nhiều app | Tìm thấy tất cả |
| Package | `FLUTTER_PACKAGE` |
| Plugin có `example/` | `FLUTTER_PACKAGE` + `example` là `FLUTTER_APP` |
| Project Dart thuần | `DART_ONLY` |
| Project dùng FVM | Dùng đúng SDK trong `.fvm` |
| Project TS / Android native | `NOT_FLUTTER`; Android native vẫn được Android detector nhận |

### Run Configuration

- Ghép lệnh: các tổ hợp mode, flavor, args có dấu ngoặc kép, đường dẫn có dấu cách, biến thay thế.
- Nhập cấu hình: file `.run/*.run.xml` mẫu và `.vscode/launch.json` mẫu.

### Runner

- Test tự động bằng `flutter` giả (script trả các dòng JSON-RPC mẫu) để kiểm tra state machine và xử lý lỗi.
- Test thủ công: máy Android thật, emulator, Chrome, desktop (Windows/macOS/Linux), iOS simulator (macOS).
- Chú ý Windows: `flutter.bat`, đường dẫn có dấu cách.

---

## 10. Thứ tự triển khai (milestone)

| Milestone | Nội dung | Kết quả nghiệm thu |
|---|---|---|
| **M1** | FlutterDetector + badge Explorer + ưu tiên với Android detector + fixtures | Mở folder là thấy đúng các project Flutter |
| **M2** | FlutterEnvironment (kể cả FVM) + FlutterDeviceService qua daemon | Status bar hiện phiên bản; dropdown thiết bị cập nhật realtime |
| **M3** | RunConfigurationStore + tự tạo cấu hình mặc định + dropdown cấu hình | Có sẵn cấu hình `main.dart` khi mở project |
| **M4** | FlutterRunner với `--machine`: Run, Stop, Hot Reload, Hot Restart, panel Run | Chạy app lên máy, hot reload được |
| **M5** | Hộp thoại Edit Configurations + Command preview + Before launch + loại `custom` | Tùy chỉnh được lệnh run như Android Studio |
| **M6** | Nhập cấu hình từ `.run/` và `launch.json`, hot reload on save, link lỗi, DevTools | Mở project cũ là có sẵn cấu hình, trải nghiệm hoàn chỉnh |

---

## 11. Thiết kế chung để mở rộng

Dùng một interface chung cho mọi loại project:

| Thành phần | Nhiệm vụ |
|---|---|
| **Detector** | Trả về danh sách project tìm được |
| **Config type** | Định nghĩa các trường form và cách ghép lệnh |
| **Runner** | `start`, `stop`, và các hành động riêng (hot reload, …) |

Android native và Flutter là hai bộ cài đặt của interface này. Toolbar, dropdown cấu hình và hộp thoại Edit Configurations dùng chung. Thêm React Native, Node, Go sau này chỉ cần thêm một bộ.

---

## 12. Ngoài phạm vi đợt này

- Debug (breakpoint, xem biến) qua Dart Debug Adapter (`flutter debug_adapter`)
- Attach vào app đang chạy (`flutter attach`)
- Chạy cùng lúc trên nhiều thiết bị
- Chạy và hiển thị test (`flutter test --machine`)
- Build bản phát hành (`flutter build apk/appbundle/ipa`) từ IDE
- Tích hợp DevTools ngay trong IDE (thay vì mở trình duyệt)
