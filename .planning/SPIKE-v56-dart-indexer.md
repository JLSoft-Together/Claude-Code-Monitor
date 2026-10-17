# SPIKE v56 — Dart indexer cho Flutter Widget Preview

Bước 2 trong đánh giá `Plan triển khai Flutter Widget Preview.md` (sau v55). Mục tiêu: chọn cách phân phối indexer, đo trên project thật, xem indexer thật sự mở khoá được bao nhiêu widget. Mã prototype: `.planning/spike-v56-dart-indexer/` (không build, không vào app).

## Môi trường đo (2026-10-17)
- Windows 11, Flutter 3.47.6 / Dart **3.13.5**. Pub cache có `analyzer` 10.1.0 / **10.2.0** (language mới nhất **3.12**).
- 3 project Flutter cục bộ (chỉ đọc, đã có `.dart_tool/package_config.json`; không chạy `pub get` trong đó):
  - P1: Riverpod, 78 file `lib/`, 72 widget class.
  - P2: Riverpod, 107 file, 81 widget class.
  - P3: Bloc + get_it + go_router + provider, 134 file, 86 widget class.
- `flutter/examples/api` bỏ qua: không có `package_config.json`, `pub get` sẽ ghi vào SDK.

## Ba cách đã thử
| | A. `package:analyzer`, AOT exe đóng gói | B. Cùng mã, chạy bằng `dart run` (SDK người dùng) | C. Analysis server của SDK (`dart language-server --protocol=analyzer`) |
|---|---|---|---|
| Khớp phiên bản SDK | Không (analyzer đóng gói lúc build) | Theo bản `analyzer` có trong pub cache, không đảm bảo | **Luôn khớp** |
| Đóng gói | 15,5 MB / OS, `dart compile exe` 14 s; build trên từng OS (như node-pty) | Không; `pub get --offline` 1,3 s khi đã có trong cache, không có thì cần mạng | Không |
| Khởi động lạnh tới khi có danh sách | 4,6–9,7 s (P3 25 s lần đầu khi đĩa nguội) | ~15 s (P2) | Phân tích 2,3–3,3 s (cache `~/.dartServer`) + **~20 s** cho `search.getTypeHierarchy(Widget)` |
| RAM | 0,5 / 0,57 / 1,0 GB | 1,1 GB (P2) | 0,96 / 1,4 GB |
| Mỗi lần lưu (process sống lâu) | 3–5 ms (`changeFile` + resolve lại) | ~ như A | chưa đo |
| Kiểu tham số constructor | Đầy đủ (`DartType`) | Đầy đủ | Outline chỉ có chuỗi; **~75 %** constructor dùng `this.x` → không có kiểu, phải hover từng tham số |

Ghi chú:
- A/B: chế độ chỉ đọc element (`getUnitElement`, không resolve thân hàm) **không nhanh hơn**: thời gian nằm ở dựng element model của Flutter + package (library đầu tiên 3,5–4,9 s).
- Byte store trên đĩa (`AnalysisContextCollectionImpl(byteStore: EvictingFileByteStore)`, API nội bộ `src/`) **không giảm** thời gian lần 2.
- `analysis_options.yaml` `exclude:` → phải duyệt `contextRoot.analyzedFiles()`, không liệt kê thư mục (`contextFor` ném lỗi).
- Lệch phiên bản: analyzer 10.2 (language 3.12) đọc 3 project khai báo `sdk: ^3.13.x` **không thêm lỗi nào**; 14 lỗi của P3 trùng đúng với `dart analyze` của SDK (thiếu file sinh: `URI_DOES_NOT_EXIST`, `UNDEFINED_GETTER`). Rủi ro chỉ lộ ra khi Dart thêm cú pháp mới mà analyzer đóng gói chưa biết.
- Class modifier Dart 3: `isSealed` / `isFinal` / `isBase` / `isInterface` đọc được; 1 widget ở P3 bị chặn vì tham số kiểu `final class` (không `implements` được ngoài library).

## Độ chính xác của heuristic TS v55
`compare.mts`: `scanProject` (v55) so với analyzer (A), không tính class abstract.
- Danh sách widget class: **239 / 239 khớp**, không thiếu, không thừa.
- Class preview được không tham số: **60 / 60 khớp**.
- TS 38–83 ms / project, analyzer 4,6–9,7 s.
→ **Không cần indexer để liệt kê.** Indexer chỉ có giá trị cho kiểu tham số và dependency qua `context`.

## Indexer mở khoá được bao nhiêu (164 widget public, 3 project)
Dependency = dùng trong thân class / `State` của nó hoặc của widget con trong project (bắc cầu), bỏ lệnh nằm trong closure (`onTap: () => …`). Vẫn là **cận trên**: lệnh trong method private chỉ gọi từ callback vẫn bị tính.

| Cần gì để render | Widget | Luỹ kế |
|---|---|---|
| Không tham số, không scope (v55 hiện tại) | 10 | 6 % |
| + wrapper rẻ: `ProviderScope` (riverpod), delegate `AppLocalizations` của project — **không cần indexer** | +31 | 41 (25 %) |
| + sinh tham số kiểu đơn giản (String, số, bool, enum, Color, Widget, callback, List…) | +62 | 103 (63 %) |
| + sinh model của project (đệ quy ≤ 3 tầng) | +27 | 130 (79 %) |
| Cần khởi tạo của app: get_it (23), go_router lúc build (18), provider / bloc (15), theme extension của project (6), hoặc bị chặn | 34 | 21 % |

Phát hiện phụ về v55: **50 / 60** class v55 cho chọn sẽ crash lúc render (chủ yếu `ConsumerWidget` thiếu `ProviderScope`, sau đó `AppLocalizations.of` trả null). Lỗi hiện rõ trong banner, không làm sập host, nhưng trải nghiệm kém.

## Kết luận
1. **Liệt kê: giữ TS** (v55). Analyzer không thêm gì, chậm hơn ~100 lần.
2. **Việc nên làm tiếp, không cần indexer (v57):** host tự bọc `ProviderScope` khi `pubspec.yaml` có `flutter_riverpod` / `hooks_riverpod`, và bọc delegate + `supportedLocales` của `AppLocalizations` khi project có `l10n.yaml` / file sinh của gen-l10n. Ước 6 % → 25 % widget render được. Lưu ý: provider chạy implementation thật (mạng, storage chưa khởi tạo) — preview có thể lỗi lúc chạy, banner `widget` của v40 đã bắt.
3. **Sinh tham số: chọn A (AOT exe đóng gói)** nếu làm. Lý do: nhanh nhất và ít RAM nhất trong 3 cách, có đủ kiểu tham số, không cần mạng; B chậm gấp 3, RAM gấp 2, phụ thuộc pub cache; C khớp SDK nhưng không có kiểu tham số và tốn 1–1,4 GB. Ràng buộc khi làm:
   - Chạy lười như `LayoutDaemon`: chỉ khởi động khi panel đang mở và người dùng chọn một class có tham số; tắt khi rảnh 10 phút. RAM 0,5–1 GB là cái giá chính.
   - Truyền `sdkPath` = `<flutter>/bin/cache/dart-sdk` của project (`findFlutterSdk`), chuẩn hoá đường dẫn.
   - CI: thêm `dart compile exe` vào `desktop.yml` cho win + mac (build trên từng runner); `test.yml` cần `setup-dart`.
   - Báo rõ khi language version của project > analyzer đóng gói (chế độ "có thể thiếu" thay vì im lặng).
   - Đáng làm hay không do chủ nhân quyết: +62 widget (38 %) với một binary 15,5 MB / OS và một process 0,5–1 GB.
4. **Không làm:** fake `implements`, khởi tạo get_it / go_router / bloc tự động (21 % còn lại cần chạy code khởi tạo của app — không làm chung được).

## Chưa đo
- Thời gian một lần lưu **có đổi nội dung** (đo trên `changeFile` không đổi nội dung: 3–5 ms).
- macOS (Apple Silicon / Intel).
- Project lớn (> 1000 file `lib/`).
- Render thật trên device: các con số ở trên là phân tích tĩnh, chưa chạy widget nào.
