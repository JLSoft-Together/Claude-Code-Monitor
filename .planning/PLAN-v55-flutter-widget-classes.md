# PLAN v55 — Flutter Widget Preview: widget classes without `@Preview`

Nguồn: đánh giá khả thi `Plan triển khai Flutter Widget Preview.md` (2026-10-17), bước 1 của hướng "xây tiếp trên v40". Giữ nguyên mọi quyết định v40 (mobile, không web, không Dart indexer, không tự sinh tham số, chỉ chạy khi bấm Start).

## Phạm vi
- Panel liệt kê thêm **class widget của file đang mở**, không cần annotation; `@Preview` vẫn liệt kê như cũ (file này + chỗ khác trong project).
- Không sinh tham số: class chỉ preview được khi có constructor public không tham số bắt buộc.

## Quét (`apps/desktop/src/flutterPreview/scan.ts`)
- `scanDartClasses(src, masked?)`: class top-level → `{ name, line, superName (bỏ prefix import + type args), abstract (abstract / sealed), ctors[{ name, required }] }`. Constructor = member có header tên `X` / `X.named` (kể cả `factory`, `const factory … = _X`), tách member theo `;` cấp 0 và sau thân `{}`.
- `widgetNames(decls)`: theo chuỗi `extends` **theo tên** trên toàn `lib/` tới `WIDGET_BASES` (Stateless/Stateful/Inherited*/RenderObject*/AnimatedWidget/Riverpod `Consumer*`/flutter_hooks `*Hook*`). Không resolve kiểu: trùng tên class giữa các file thì coi như một.
- `classHit(decl, {part, web}, previews)`:
  - `abstract` / `sealed` → không liệt kê.
  - Đã có `@Preview` trên constructor / static method của class → không liệt kê thêm (id trùng `file#X`).
  - `part of` → `part`; tên private → `private`; file import thư viện chỉ có trên web (`dart:html`, `dart:js*`, `dart:ui_web`, `package:web/`…, không tính import điều kiện) → `web` (import vào host mobile làm hỏng compile cả host).
  - Không khai báo constructor → `X()`; chỉ constructor private → `ctor`; ưu tiên constructor không tên, rồi constructor public đầu tiên không tham số bắt buộc → `X.named()`; còn lại → `params`.
- Entry class có `kind: 'class'`, `symbol = label = X`, `call` = constructor đã chọn; trộn với `@Preview` của cùng file, sắp theo dòng.
- `scanProject` giờ đọc **mọi** file trong `lib/` (chuỗi `extends` đi qua file khác) → cache theo `mtimeMs + size` mỗi file (`fileCache`, xoá hết khi vượt 2 × `MAX_FILES`).

## Host / service
- Không đổi: registry nhận mọi entry không bị bỏ, kể cả class của file khác (đổi file đang mở không cần build lại). Hệ quả: host import mọi file `lib/` có class widget dùng được → một file hỏng compile (kể cả file app không dùng) làm hỏng host; banner lỗi build chỉ đúng file:line, panel đánh dấu entry của file đó (như v40).

## UI (web)
- `groupEntries`: entry `kind: 'class'` chỉ vào nhóm "File này"; nhóm "Chỗ khác trong project" chỉ có `@Preview`.
- Trạng thái rỗng tính theo hai nhóm đang hiện (không theo tổng số entry).
- Dòng phụ: ẩn symbol khi trùng nhãn; class dựng bằng constructor có tên thì hiện `X.named()`.
- i18n: `fwp.skipped.ctor`, `fwp.skipped.web`; `fwp.empty` / `emptyHint` / `scanning` nói về widget chung.

## Test
- `fwp-scan.test.ts`: extends trực tiếp / có prefix / qua class project (khác file), generic lồng `<T extends List<int>>`, `State<…>` và class thường không nhận, chọn constructor (không tên, có tên, factory), `params` / `ctor` / `private` / `part` / `web`, abstract bị bỏ, trùng `@Preview`, rescan khi file đổi.
- `lib/flutterPreview.test.ts`: class chỉ ở nhóm file của nó.
- E2E `flutter-preview.cjs`: fixture thêm `Banner2` (file đang mở, chọn được) và `Tag` (file khác, không hiện).

## Status (2026-10-17)
- Đã làm như trên. `npm run typecheck`, `npm test` (754 / 595 / 254) pass; E2E `flutter-preview.cjs` 21/21 PASS.
- Kiểm chứng compile: project `flutter create --offline` + file widget mẫu → `scanProject` + `hostSource` → `dart analyze` host không lỗi (`p1.Titled.empty()`, `p1.Box()` generic, class không constructor).
- **Chưa** chạy trên device thật: máy lúc làm không có AVD / điện thoại.
