# PLAN v40 — Flutter Widget Preview (mobile, `@Preview` only)

Nguồn: `Plan triển khai Flutter Widget Preview.md` (HoiCham, d776d99) + audit `.planning/AUDIT-2026-10-15-pending-plans.md` § Flutter + quyết định chủ nhân 2026-10-15. Thay hẳn hướng "Flutter web + Dart indexer tự sinh tham số" của plan gốc.

## Quyết định
- Chạy trên **mobile** (Android / iOS — device đang có trong danh sách device của Run pane), **không web**, không webview.
- Danh sách widget **chỉ từ hàm `@Preview`** (`package:flutter/widget_previews.dart`, Flutter ≥ 3.35), quét bằng TS, **không Dart indexer**, không tự sinh tham số.
- App sinh host `<project>/.dart_tool/ccm_preview/main.dart`, chạy `flutter run --machine -t <host> -d <device>` (debug) trong thư mục project.
- Panel trong app chỉ là danh sách + điều khiển; chọn widget → `app.callServiceExtension` `ext.ccm.show` (không build lại).
- Lưu file `.dart` trong `lib/` khi preview đang chạy → quét lại, sinh lại host nếu đổi, hot reload (chỉ preview host; Run pane giữ quy tắc v31 reload bấm tay).
- **Không tự chạy khi mở file**: chỉ chạy khi bấm Start.
- Service riêng ngoài `RunManager` (không hiện trong Run pane / RunBadge / confirmQuit), vòng đời như `LayoutDaemon`: 1 session toàn app, kill khi quit.

## Quét `@Preview` (`apps/desktop/src/flutterPreview/scan.ts`)
- Chỉ file `lib/**/*.dart`, bỏ `*.g.dart`, `*.freezed.dart`, thư mục ẩn / `build`; giới hạn 3000 file, 1 MB/file.
- Bỏ comment + string khi đếm ngoặc; theo dõi độ sâu `{}` để biết top-level vs trong `class X`.
- Nhận: `@Preview(...)` (ngoặc cân bằng, có thể nhiều dòng; cũng nhận `@Preview()` có prefix import `@wp.Preview(`), sau đó (bỏ qua annotation khác) là:
  - hàm top-level không tham số bắt buộc → gọi `p.fn()`;
  - `static` method trong class → `p.X.fn()`;
  - constructor (`const X(...)`, `X(...)`, `X.named(...)`) không tham số bắt buộc (chỉ `{super.key}` / named không `required`) → `p.X()` / `p.X.named()`.
- `name: '...'` trong annotation (literal đơn giản) → nhãn; không có thì tên hàm/class.
- Bỏ, kèm lý do: tên private (`_x`, class `_X`) → `private`; có tham số bắt buộc → `params`; không nhận ra khai báo → `unknown`.
- Kết quả: `{ id: '<relPath>#<symbol>', file, line, symbol, label, call, skipped?: reason }`, sắp theo file rồi dòng.

## Host (`flutterPreview/host.ts`)
- `packageName` từ `pubspec.yaml` (`name:`); không có `flutter:` → không phải Flutter.
- Sinh `main.dart`: import `package:flutter/material.dart`, `dart:convert`, `dart:developer`, mỗi file một alias `p0…`; registry là **getter** (`Map<String, Widget Function()> get _previews => {...}`) để hot reload thấy entry mới; `ValueNotifier<String?>` widget hiện tại; `registerExtension('ext.ccm.show', …)` trả `{"ok": bool}`; `MaterialApp(debugShowCheckedModeBanner: false)` → `Scaffold(body: SafeArea(Center(child: builder())))`; chưa chọn → chữ "Select a widget in Agent Monitor". Hàm thuần, test snapshot.
- Ghi file chỉ khi nội dung đổi (tránh reload thừa). Không ghi gì ngoài `.dart_tool/ccm_preview/`.

## Machine client dùng chung (`run/flutter/machine.ts`)
- Tách từ `runner.ts`: `createMachineClient(child, { onEvent, onText })` → `{ request(method, params), dispose() }` (pending map, `lineSplitter`, `parseMachineLine`). `runner.ts` dùng lại, hành vi giữ nguyên (test runner hiện có phải pass nguyên).

## Service (`flutterPreview/service.ts`)
- `FlutterPreviewService`: state `idle | starting | running | reloading | failed | stopped`, `{ root, deviceId, appId, current, error, log[] (ring 300) }`; emit cho renderer qua `ccm:fwp-state`.
- `start(root, deviceId, flavor?)`: dừng session cũ; `findFlutterSdk` (setting `flutterSdk`, FVM; issue `fvm-local-unverified` → failed giống Run pane); scan + ghi host; spawn `flutterSpawn(sdk, ['run','--machine','-t',host,'-d',id,'--debug', ...flavor])`, cwd = root; sau `app.started` gọi lại `show(current)` nếu đã chọn.
- `show(id)`: nhớ `current`; running → `app.callServiceExtension { appId, methodName: 'ext.ccm.show', params: { id } }`.
- Watch `<root>/lib` (fs.watch recursive) khi đang chạy: `.dart` đổi → debounce 400 ms → rescan → ghi host nếu đổi → `app.restart { fullRestart: false, pause: false, reason: 'save' }`; gửi list mới cho renderer.
- `stop()`: `app.stop` → timeout 5 s → `killTree`; app quit → kill đồng bộ.
- Lỗi build: `parseBuildError` → `error` hiển thị trong panel.

## IPC + preload
- `ccm:fwp-scan(root)` → `{ flutter: boolean, entries }`; `ccm:fwp-start(root, deviceId, flavor?)`; `ccm:fwp-show(id)`; `ccm:fwp-stop()`; `ccm:fwp-get()`; event `ccm:fwp-state`.
- `root` qua `PreviewIpc.resolveDir` (allow-list như Run/Layout); chỉ app frame (`isAppFrame`).
- Device list: dùng lại `ccm:run-devices`, web lọc `platform` bắt đầu `android` / `ios`.
- Flavor: tuỳ chọn, gợi ý từ các Flutter run config của project (`ccm:run-configs`).

## UI (web)
- FilePane: file `.dart` trong project có `pubspec.yaml` → nút toolbar "Widget preview" (icon `Smartphone`), bật panel `FlutterPreviewPanel.vue` cạnh code (stacked khi hẹp, như Layout Preview); trạng thái bật lưu `localStorage`.
- Panel: chọn device (android/ios), flavor (nếu có), Start / Stop, trạng thái (icon + text + màu token), lỗi build / log cuối; danh sách: "File này" trước, "Khác trong project" sau; entry bị bỏ hiện mờ + lý do; click → show; entry đang hiện được đánh dấu. Không có `@Preview` → hướng dẫn ngắn (`@Preview()` + Flutter ≥ 3.35).
- Không device mobile → nút mở Run pane / emulator (dùng lại `ccm:run-emulators` launch nếu dễ, không thì chỉ thông báo).
- i18n `i18n/flutter-preview-v40.ts` (en/vi), mọi màu theme token.

## Test
- `scan.test.ts`: top-level, static, constructor, named ctor, multi-line annotation, prefix, comment/string chứa `@Preview`, private, tham số bắt buộc, `name:`.
- `host.test.ts`: snapshot nội dung, getter registry, alias, ghi-khi-đổi.
- `service.test.ts`: fake spawn + machine lines: start → started → show gọi `ext.ccm.show`; save → restart; stop; build error → failed; SDK thiếu.
- Runner test hiện có pass nguyên sau khi tách `machine.ts`.
- Web: helper nhóm/lọc device. E2E `e2e/flutter-preview.cjs`: fixture project có `pubspec.yaml` + `lib/a.dart` có 2 `@Preview` → mở file → bật panel → danh sách đúng (không chạy flutter thật).

## Ngoài phạm vi v1
Web/desktop device, tự sinh tham số, `Preview(theme/wrapper/size/brightness)`, `MultiPreview`, preview class private, click → dòng code.

## Status / deviations (2026-10-15)
- Đã làm: machine client tách (`run/flutter/machine.ts`, runner test pass nguyên), scan/host/service/ipc/wire, preload, panel + toggle FilePane, i18n en/vi, unit test (`test/fwp-*.test.ts`, `lib/flutterPreview.test.ts`), E2E `e2e/flutter-preview.cjs` (chưa chạy). Chưa test với flutter thật trên device.
- `ccm:fwp-scan(path, withEntries)` nhận file/thư mục bất kỳ trong project, tự đi lên tìm `pubspec.yaml` (≤ 8 cấp, chỉ trong folder được phép) và trả `root`; `withEntries=false` chỉ dò project (nút toolbar không phải quét cả `lib/`).
- Types dùng chung đặt ở `packages/shared/src/flutterPreview.ts` (`Fwp*`). `call` lưu không alias (`fn()`); host thêm `pN.`.
- File trong `lib/` có ký tự ngoài `[\w-./]` bị bỏ qua (đường dẫn đi thẳng vào `import 'package:…'`).
- SDK nằm trong project (không phải setting) → `fvm-local-unverified` như plan; FVM symlink ra cache global vẫn chạy (so theo realpath).
- Stop: panel đổi `stopped` ngay, process kill sau 5 s nếu `app.stop` không thoát.
- Entry bị bỏ không rõ khai báo có symbol `?<line>`.
- Review fix (2026-10-15): `stop()` / `killNow()` luôn tăng `gen` → `start()` đang chờ (trước spawn) trả `cancelled`, không spawn sau Stop / quit; panel đổi `stopped`. File `part of` → mọi entry `skipped: 'part'` (import vào host là lỗi compile). Hàm / static method chỉ nhận kiểu trả về `Widget` hoặc tên class (có thể có prefix) hoặc bỏ trống; `Widget?`, generic, `Function`, `…Builder` (typedef như `WidgetBuilder`) → `skipped: 'type'` (constructor luôn nhận; class widget tên `…Builder` bị bỏ nhầm, chấp nhận). `name:` chỉ đọc ở cấp ngoài của `@Preview(...)`. Nhiều `@Preview` chồng trên một symbol: giữ cái đầu (không hỗ trợ `MultiPreview` kiểu nhiều biến thể).
- Lỗi sau khi chạy: hot reload lỗi → `error` = `build` (dòng lỗi compile đầu tiên lúc reload) hoặc `reload-failed {detail}`, state vẫn `running`, xoá ở lần reload thành công. App/thiết bị chết khi không bấm Stop → `stopped` + `error` `device-lost` (log "Lost connection to device") hoặc `exited {code}`. Panel hiện `snap.error` ở mọi state.
- Thoát app: `main.ts` giữ `flutterPreview` tới khi `stop()` xong để `before-quit` vẫn gọi được `killNow()` (kill sync + xoá timer).
