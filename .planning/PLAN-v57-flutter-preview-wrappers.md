# PLAN v57 — Flutter Widget Preview: `ProviderScope` + `AppLocalizations` wrappers

Nguồn: `.planning/SPIKE-v56-dart-indexer.md` (kết luận 2): đa số class v55 cho chọn crash vì thiếu `ProviderScope` / localization. Không cần Dart indexer. Giữ mọi quyết định v40 / v55.

## Host (`apps/desktop/src/flutterPreview/host.ts`)
- `hostContext(root, pubspec, exists?, readText?)` → `HostContext { riverpod?, l10n? }`:
  - **Riverpod**: `dependencies.hooks_riverpod` → `package:hooks_riverpod/hooks_riverpod.dart`, không thì `dependencies.flutter_riverpod` → `package:flutter_riverpod/flutter_riverpod.dart`. Không tính `dev_dependencies`, không tính `riverpod` thuần Dart (không có widget).
  - **gen-l10n**: đọc `l10n.yaml` (mặc định của `flutter gen-l10n`: `arb-dir` `lib/l10n`, `output-localization-file` `app_localizations.dart`, `output-class` `AppLocalizations`, `output-dir` = `arb-dir`). Nhận khi file sinh **đã có** hoặc `pubspec.yaml` có `flutter: generate: true` (`flutter run` sinh trước khi build). `synthetic-package: true` (Flutter < 3.32) → `package:flutter_gen/gen_l10n/<file>` (cần file trong `.dart_tool/flutter_gen/gen_l10n/` hoặc `generate: true`). Thư mục ngoài `lib/`, tên file / class lạ → bỏ.
- `hostSource(pkg, entries, ctx = {})`: `ctx` rỗng → **giống hệt từng byte** host v55 (snapshot cũ không đổi).
  - Import có prefix `ccm_riverpod` / `ccm_l10n`, đặt trước import của project.
  - Mỗi preview: `ccm_riverpod.ProviderScope(key: ValueKey<String?>(id), child: build())` — đổi widget là scope mới (state sạch), hot reload giữ state (cùng key).
  - `MaterialApp(localizationsDelegates: ccm_l10n.X.localizationsDelegates, supportedLocales: ccm_l10n.X.supportedLocales)`.

## Service (`service.ts`)
- `start()` đọc `hostContext` một lần (dep `hostContext?` để test), lưu `live.host`, dùng cho mọi lần ghi host khi lưu file. `pubspec.yaml` đổi → session khởi động lại (v40) → đọc lại. `l10n.yaml` đổi khi đang chạy: chỉ có hiệu lực ở lần Start sau.
- Log `> preview wrappers: ProviderScope, AppLocalizations` trước dòng `> flutter run …`.

## Không làm
- `overrides` của `ProviderScope` (provider ném lỗi vì `main()` mới override, ví dụ `SharedPreferences`), theme / `ThemeExtension` của app, get_it / go_router / bloc: cần code khởi tạo của từng app → hướng tiếp theo là một file wrapper do người dùng viết (giống `@Preview(wrapper:)` của Flutter), chưa lên kế hoạch.
- UI: không đổi (wrapper đọc được trong Output).

## Test
- `fwp-host.test.ts`: `hostContext` (Riverpod / hooks_riverpod / dev_dependencies / riverpod thuần, l10n theo `output-dir` + `output-class`, mặc định + `generate: true`, synthetic package, ngoài `lib/`, tên lạ), host có wrapper (import, `ProviderScope` theo id, delegates) + snapshot.
- `fwp-service.test.ts`: wrapper vào host lúc start và lúc lưu, dòng log.

## Status (2026-10-17)
- Đã làm như trên. `npm run typecheck`, `npm test` (754 / 604 / 254) pass; E2E `flutter-preview.cjs` 21/21.
- `dart analyze` host có wrapper trên bản sao 3 project thật (P1, P2 Riverpod + gen-l10n; P3 chỉ gen-l10n): **0 lỗi** trong host.
- **Render thật** (`flutter test` trên VM, bản sao project, render từng entry v55 qua host không / có wrapper):
  - P1: 1 / 20 → **6 / 20**; P2: 1 / 19 → **9 / 19** (tổng 2 / 39 → 15 / 39).
  - Còn lỗi: provider cần override ở `main()` (`prefsProvider must be overridden` ×10, provider error state ×8), `ThemeExtension` của app (`Theme.of(context).extension<…>()!` ×6).
  - VM không có plugin native: provider dựa trên plugin có thể chạy được trên device → con số trên là cận dưới.
  - P3 không compile ngay cả không có preview: file gen-l10n cũ thiếu key (lỗi sẵn có của project, `dart analyze` của SDK cũng báo) — đúng rủi ro "một file hỏng làm hỏng host" ở v55.
- Chưa chạy trên device thật (không có AVD / điện thoại).
