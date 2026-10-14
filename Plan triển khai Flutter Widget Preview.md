# Kế hoạch triển khai Flutter Widget Preview cho IDE TypeScript

Oct 15, 2026 · @Titan Zentrixa

## Mục tiêu & phạm vi

Khi mở một file `.dart`, IDE liệt kê mọi class kế thừa `Widget` trong file và hiện preview sống của class được chọn. Người dùng không phải viết annotation hay code mẫu: tham số constructor và dependency lấy qua `context` được IDE tự sinh.

Hướng chọn:

- Tự xây **Preview Host** — một app Flutter web ẩn được sinh trong `.dart_tool/` — chạy bằng `flutter run -d web-server --machine`, nhúng vào webview của IDE.
- Không dùng thẳng [Flutter Widget Previewer](https://docs.flutter.dev/tools/widget-previewer) chính thức: nó cần annotation `@Preview` trong code người dùng và chỉ nhận constructor không có tham số bắt buộc — ngược với yêu cầu 2.
- Vẫn học theo cách nó làm (Flutter web + project scaffold) và tương thích ngược: hàm `@Preview` có sẵn trong project cũng được liệt kê.
- Phân tích code bằng một CLI Dart dùng `package:analyzer`, không tự parse Dart trong TS.

Trong phạm vi v1:

- Class public trong `lib/` kế thừa `Widget`, kể cả gián tiếp qua `StatelessWidget`, `StatefulWidget`, `ConsumerWidget`, `HookWidget`…
- Tự sinh tham số constructor và dependency (`Provider`, `Bloc`, Riverpod, `Theme`, `MediaQuery`).
- Preview tương tác được (bấm, cuộn), hot reload khi lưu file.
- Chọn kích thước thiết bị, sáng/tối, text scale, locale; click vào preview → nhảy tới dòng code.
- Người dùng sửa được giá trị đã sinh và lưu lại.

Ngoài phạm vi v1:

- Class private (`_Foo`): file sinh ra không import được; chỉ liệt kê kèm lý do.
- Widget cần `dart:io` hoặc plugin native (camera, sqflite…) — bị giới hạn trên web; sẽ có chế độ ảnh tĩnh ở Giai đoạn 6.
- Sửa code ngược từ preview (kéo-thả, panel thuộc tính ghi vào code).

## Kiến trúc tổng thể

Ba phần: IDE TypeScript điều phối, Dart Indexer hiểu code và sinh code, Preview Host là app Flutter web thật vẽ widget.

&#91;embedded content: kiến trúc · IDE TypeScript, Dart Indexer, Preview Host\]

Lưu file kích hoạt indexer, indexer sinh lại `registry.g.dart`, rồi FlutterSession hot reload; chọn widget khác trong panel chỉ là một lời gọi `ext.idea.show`, không build lại.

## Phát hiện class Widget

Một class được preview khi analyzer xác nhận nó là lớp con cụ thể của `Widget` và có constructor public gọi được. Dựa vào kiểu đã resolve, không dựa vào tên hay regex.

Quy tắc chấp nhận:

1. `ClassElement.allSupertypes` chứa `Widget` khai báo trong `package:flutter/src/widgets/framework.dart`.
2. Class không `abstract`, không phải `sealed`/`mixin`.
3. Class public và nằm trong `lib/` của project (không tính package phụ thuộc).
4. Có ít nhất một constructor hoặc factory public; ưu tiên constructor mặc định, sau đó constructor ít tham số bắt buộc nhất.

Bị bỏ qua, kèm lý do hiện trong panel:

| Trường hợp | Lý do | Xử lý |
| --- | --- | --- |
| Class private `_Foo` | File sinh ra không import được | Liệt kê mờ, gợi ý đổi thành public nếu muốn xem |
| Chỉ có constructor private | Không tạo được instance | Bỏ qua |
| File sinh tự động (`*.g.dart`, `*.freezed.dart`) | Không phải UI người dùng viết | Bỏ qua |
| `State<T>`, `CustomPainter`, `RenderObject` | Không phải `Widget` | Tự loại theo quy tắc 1 |
| Widget generic `Foo<T>` | Cần chọn kiểu cho `T` | Dùng bound của `T`, không có bound thì `Object` |
| `InheritedWidget`, `ProxyWidget` | Cần `child` | Vẫn preview, `child` là `Placeholder` |

Kết quả cho mỗi class là một mục JSON: tên, file, dòng khai báo, constructor đã chọn, danh sách tham số (tên, kiểu, required, named, default), dependency tìm thấy qua `context`, và trạng thái `ok` / `skipped` kèm lý do.

## Tự sinh tham số và state

Generator đi qua từng tham số constructor và sinh một biểu thức Dart theo kiểu của nó. Giá trị luôn cố định (không ngẫu nhiên) để preview giống nhau giữa các lần reload.

### Quy tắc theo kiểu

Thứ tự áp dụng: giá trị người dùng đã ghi đè → bỏ qua nếu có default hoặc nullable mà không `required` → bảng dưới.

| Kiểu tham số | Giá trị sinh ra |
| --- | --- |
| `String` | Chuỗi theo tên tham số, ví dụ `title` → `'Title'`, `email` → `'user@example.com'` |
| `int`, `double`, `num` | `1` / `1.0`; theo tên: `count` → `3`, `index` → `0`, `progress`/`opacity` → `0.5` |
| `bool` | `false` |
| `enum` | Giá trị đầu tiên |
| `DateTime`, `Duration` | `DateTime(2026, 1, 1)`, `Duration(seconds: 1)` |
| `Color`, `IconData` | `Colors.blue`, `Icons.star` |
| `Widget` | `Placeholder` nhỏ có nhãn tên tham số |
| `List<T>`, `Set<T>`, `Map<K, V>` | 3 phần tử, mỗi phần tử sinh đệ quy theo `T` |
| Kiểu hàm (`VoidCallback`, `ValueChanged<T>`…) | Closure đúng số tham số, không làm gì ngoài ghi log vào IDE; trả về giá trị sinh theo kiểu trả về |
| `Future<T>`, `Stream<T>` | `Future.value(…)`, `Stream.value(…)` với giá trị sinh theo `T` |
| Class cụ thể của project (model) | Gọi constructor public, sinh đệ quy, sâu tối đa 3 tầng |
| Class abstract / interface (repository, service) | Dùng lớp con cụ thể duy nhất trong project; không có thì sinh class fake `implements` với mọi method trả về giá trị sinh theo kiểu |
| Controller (`TextEditingController`, `ScrollController`, `AnimationController`) | Tạo trong một `StatefulWidget` bọc ngoài, có `vsync` và `dispose` đúng |
| Kiểu không sinh được (`BuildContext`, class của package không có constructor public) | Đánh dấu `needsInput`, preview hiện ô yêu cầu người dùng nhập |

Tham số có `assert` trong constructor (ví dụ `value` phải nằm trong `min`..`max`): v1 chỉ bắt lỗi assert lúc chạy và gợi ý ghi đè, không phân tích assert.

### State và dependency qua context

`StatefulWidget` tự tạo `State` của nó qua `createState()`, nên phần "state" cần sinh là những gì widget đọc từ cây bên trên. Analyzer quét thân class (kể cả class `State` đi kèm) để tìm các mẫu sau rồi bọc wrapper tương ứng:

| Mẫu tìm thấy | Wrapper sinh ra |
| --- | --- |
| `Theme.of`, `MediaQuery.of`, `Navigator`, `Scaffold.of` | `MaterialApp` (hoặc `CupertinoApp` nếu chỉ dùng Cupertino) + `Scaffold` khi cần |
| `AppLocalizations.of`, delegate localization của project | Delegate và locale lấy từ cấu hình preview |
| `context.read<T>()`, `context.watch<T>()`, `Provider.of<T>` | `Provider<T>` / `ChangeNotifierProvider<T>` với instance sinh theo bảng trên |
| `BlocBuilder<B, S>`, `context.read<B>()` với `B` là Bloc/Cubit | `BlocProvider<B>` với Bloc sinh ra; state ban đầu chọn được trong panel |
| `ConsumerWidget`, `ref.watch(x)` (Riverpod) | `ProviderScope` kèm `overrides` cho provider có giá trị người dùng đã ghi đè |
| `InheritedWidget` của project (`Foo.of(context)`) | Bọc chính `InheritedWidget` đó với tham số sinh theo bảng trên |

Theme mặc định lấy từ `MaterialApp(theme: …)` trong `main.dart` nếu analyzer đọc được biểu thức; không thì dùng `ThemeData()` và cho chọn trong cấu hình.

### Người dùng ghi đè

- **Giá trị đơn giản** (chuỗi, số, bool, enum, màu): sửa trong panel, lưu vào `.idea-preview/overrides.json` ở gốc project.
- **Giá trị phức tạp**: file Dart `preview_overrides/<widget>.dart` do người dùng sở hữu, khai báo hàm trả về tham số hoặc cả widget; generator ưu tiên file này.
- **Nhiều biến thể**: mỗi widget có thể có nhiều bộ giá trị ("rỗng", "đang tải", "lỗi"), hiện cạnh nhau.
- Tên thư mục `.idea-preview/` là tạm; đổi theo tên IDE của bạn.

## Preview Host và giao thức

Preview Host là một app Flutter sinh sẵn, phụ thuộc vào project người dùng qua `path:`, chạy một lần và giữ sống; đổi widget hoặc cấu hình không cần build lại.

### Cấu trúc Preview Host

Nằm ở `.dart_tool/idea_preview_host/` của project (không commit, không sửa code người dùng):

- `pubspec.yaml` — `path` tới project; khai báo lại các package mà code sinh ra import (`provider`, `flutter_bloc`, `flutter_riverpod`…) với version khớp `pubspec.lock`; chép phần `assets`/`fonts`.
- `lib/main.dart` — cố định: đăng ký service extension, dựng khung preview (kích thước, theme, bắt lỗi).
- `lib/registry.g.dart` — sinh ra: map `previewId → WidgetBuilder` cho mọi widget hợp lệ, kèm từng biến thể.
- `lib/fakes.g.dart`, `lib/wrappers.g.dart` — sinh ra: class fake và wrapper ngữ cảnh.

### Chạy và điều khiển

IDE chạy `flutter run -d web-server --machine` trong thư mục host. Lệnh này nói [giao thức daemon của Flutter](https://flutter.googlesource.com/mirrors/flutter/+/HEAD/packages/flutter_tools/doc/daemon.md): JSON-RPC qua stdin/stdout, giống cách VS Code điều khiển Flutter.

| Việc | Cách làm |
| --- | --- |
| Lấy URL để nhúng | Bắt sự kiện `app.webLaunchUrl`, mở URL trong webview/iframe của Preview Panel |
| Đổi widget, biến thể, kích thước, theme | `app.callServiceExtension` → `ext.idea.show` với `previewId`, `variant`, `size`, `brightness`, `textScale`, `locale` |
| Code người dùng thay đổi | Sinh lại file `.g.dart` nếu cần, rồi `app.restart` với `fullRestart: false` (hot reload) |
| Thêm/xoá dependency, đổi `pubspec` | `flutter pub get` trong host rồi chạy lại tiến trình |
| Click vào preview → dòng code | `ext.idea.locate` với toạ độ → `{file, line, column}` |
| Lỗi build, lỗi layout, overflow, log callback | Host in ra stdout với tiền tố `[idea]`, IDE đọc qua sự kiện `app.log` |

Ghi chú kỹ thuật:

- **Click → dòng code**: hit test tại toạ độ, đi từ `RenderObject` lên `Element`, lấy creation location (có sẵn vì debug bật track-widget-creation) qua `WidgetInspectorService` giống DevTools. Dừng ở widget đầu tiên có location nằm trong project. Cách gọi API cụ thể cần xác minh ở Giai đoạn 0.
- **Hot reload trên web**: hỗ trợ phụ thuộc phiên bản Flutter; nếu bản của người dùng chưa có, dùng hot restart (`fullRestart: true`). Kiểm tra ở Giai đoạn 0.
- **Widget không bị ràng buộc kích thước**: khung preview ép `ConstrainedBox` theo kích thước đã chọn, tránh lỗi unbounded.
- **Mỗi preview bọc trong vùng bắt lỗi** (`ErrorWidget.builder`, `FlutterError.onError`) để một widget hỏng không làm sập host.

### Giao thức IDE ↔ Dart Indexer

CLI Dart sống lâu, JSON-RPC qua stdio, giữ `AnalysisContextCollection` để phân tích tăng dần:

| Method | Payload | Kết quả |
| --- | --- | --- |
| `index/project` | đường dẫn project | danh sách widget (mục JSON ở phần Phát hiện) |
| `index/fileChanged` | file đã lưu | widget thêm / đổi / xoá trong file đó |
| `generate` | danh sách widget + overrides | nội dung các file `.g.dart` và cờ `changed` |

## Lộ trình theo giai đoạn

Bảy giai đoạn, khoảng 6–8 tuần cho một người; ước lượng thô. Giai đoạn 0 kiểm chứng ba điểm rủi ro còn mở trước khi làm thật.

### Giai đoạn 0 — Spike (3 ngày)

- [ ] Tạo tay một host `path:` tới một project mẫu, hiển thị một widget có tham số viết tay
- [ ] Chạy `flutter run -d web-server --machine` từ Node, bắt `app.webLaunchUrl`, nhúng vào webview
- [ ] Thử hot reload và hot restart trên web, đo thời gian
- [ ] Thử `ext.idea.locate`: click → lấy được file và dòng
- [ ] Kiểm tra asset (ảnh, font) của project hiện đúng trong host

### Giai đoạn 1 — Dart Indexer (khoảng 1 tuần)

- [ ] CLI Dart JSON-RPC qua stdio với `index/project`, `index/fileChanged`
- [ ] Áp dụng quy tắc chấp nhận / bỏ qua, xuất tham số constructor đầy đủ kiểu
- [ ] Phát hiện hàm `@Preview` có sẵn trong project
- [ ] Biên dịch AOT thành file thực thi (`dart compile exe`) cho từng OS

### Giai đoạn 2 — Generator cơ bản (khoảng 1 tuần)

- [ ] Sinh giá trị cho kiểu cơ bản, `Widget`, collection, callback, `Future`/`Stream`
- [ ] Sinh model của project đệ quy, giới hạn độ sâu
- [ ] Sinh `registry.g.dart` và `main.dart` của host; chạy `dart format` trên file sinh ra
- [ ] Test sinh code bằng snapshot cho từng quy tắc

### Giai đoạn 3 — Tích hợp vào IDE (khoảng 1 tuần)

- [ ] Nhận diện project Flutter (`pubspec.yaml` có `flutter:`), dùng chung phần nhận diện project đã có
- [ ] `FlutterSession` (TS): tạo host, `pub get`, spawn, khởi động lại khi chết
- [ ] Widget Panel: danh sách widget của file đang mở, lý do bị bỏ qua
- [ ] Preview Panel: webview, thanh chọn thiết bị / sáng-tối / text scale / locale
- [ ] Lưu file → indexer → generator → hot reload; hiện lỗi dưới preview

### Giai đoạn 4 — State và dependency (1–1,5 tuần)

- [ ] Phát hiện mẫu dùng `context` và sinh wrapper `MaterialApp`, localization
- [ ] Hỗ trợ Provider, Bloc/Cubit, Riverpod (chỉ bật khi project có package đó)
- [ ] Sinh class fake cho interface/abstract
- [ ] Controller trong `StatefulWidget` bọc ngoài

### Giai đoạn 5 — Ghi đè và tương tác (khoảng 1 tuần)

- [ ] Sửa giá trị đơn giản trong panel, lưu `overrides.json`
- [ ] Hỗ trợ file `preview_overrides/<widget>.dart`
- [ ] Nhiều biến thể hiện cạnh nhau
- [ ] Click → nhảy tới dòng code; log khi callback được gọi

### Giai đoạn 6 — Mở rộng (tuỳ nhu cầu)

- [ ] Chế độ ảnh tĩnh qua `flutter test` (chạy VM, không phải web) cho widget dùng `dart:io`, plugin được thay bằng fake
- [ ] Preview class private bằng cách sao chép thư viện sang host
- [ ] Cache kết quả indexer theo hash file

## Rủi ro & cách giảm thiểu

Rủi ro lớn nhất là giá trị tự sinh làm widget chạy sai hoặc crash; thiết kế phải coi "không preview được, kèm lý do rõ" là kết quả bình thường.

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Giá trị sinh ra vi phạm `assert` hoặc logic nghiệp vụ | Preview lỗi hoặc trống | Bắt lỗi từng preview, chỉ ra tham số nghi vấn, mở ô ghi đè |
| Widget gọi mạng, DB, plugin native trong `initState` | Lỗi trên web hoặc treo | Fake cho interface; widget gọi trực tiếp thì đánh dấu và chuyển chế độ ảnh tĩnh (Giai đoạn 6) |
| Flutter web không truy cập API native | Một số widget không chạy được | Đây cũng là giới hạn của previewer chính thức; ghi rõ lý do trong panel |
| Hot reload trên web không có ở bản Flutter cũ | Mỗi lần lưu mất trạng thái | Tự chuyển sang hot restart; ghi phiên bản tối thiểu |
| Asset/font khai báo theo đường dẫn của app, host là package khác | Ảnh, font không hiện | Chép khai báo vào host, symlink hoặc copy thư mục asset; kiểm chứng ở Giai đoạn 0 |
| Generator sinh code không biên dịch được | Cả host hỏng, mọi preview tắt | Chạy analyzer trên file sinh ra trước khi reload; widget gây lỗi bị loại khỏi registry |
| Project lớn, indexer chậm | Danh sách widget cập nhật trễ | Phân tích tăng dần theo file; chỉ sinh lại phần registry liên quan |
| Phiên bản package trong host lệch với project | Lỗi resolve hoặc hành vi khác | Lấy version từ `pubspec.lock` của project |

## Tiêu chí hoàn thành & kiểm thử

v1 coi là xong khi mở một project Flutter thật, mọi widget public trong `lib/` hoặc hiện preview, hoặc hiện lý do cụ thể — không phải viết dòng code nào.

- [ ] Widget không tham số, widget có tham số bắt buộc, widget generic đều hiện
- [ ] Widget dùng Provider / Bloc / Riverpod hiện được mà không sửa code
- [ ] Bấm nút trong preview → callback ghi log trong IDE
- [ ] Sửa giá trị trong panel → preview đổi ngay, giá trị còn sau khi mở lại IDE
- [ ] Lưu file → preview cập nhật; thêm widget mới → xuất hiện trong danh sách
- [ ] Click vào preview → nhảy đúng dòng code
- [ ] Một widget crash không làm hỏng preview của widget khác

Kiểm thử:

- **Indexer**: project mẫu chứa từng trường hợp trong bảng chấp nhận / bỏ qua; so JSON với kết quả mong đợi.
- **Generator**: snapshot test cho từng quy tắc kiểu; file sinh ra phải qua `dart analyze` không lỗi.
- **End-to-end**: test TS khởi động host thật, gọi `ext.idea.show` cho từng widget mẫu, kiểm tra không có lỗi trong log.
- **Project thật**: chạy trên 2–3 project mã nguồn mở với state management khác nhau, đếm tỉ lệ widget preview được để biết nên cải tiến quy tắc nào trước.

## Nguồn tham khảo

- [Flutter Widget Previewer — docs.flutter.dev](https://docs.flutter.dev/tools/widget-previewer): chạy trên Flutter Web, dùng `@Preview`, giới hạn API native.
- [Flutter Daemon protocol — flutter\_tools/doc/daemon.md](https://flutter.googlesource.com/mirrors/flutter/+/HEAD/packages/flutter_tools/doc/daemon.md): `flutter run --machine`, hot reload, `callServiceExtension`, thiết bị `web-server`.
