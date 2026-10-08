# PLAN v10 — Audit tính năng sau v9 toast (2026-10-08)

Không có skill PM trên máy (`pm-skill`, `pm-product-discovery:*` không tìm thấy) → audit tay theo khung product trio của v6/v7.

## Hiện trạng

- Đã xong tới v9: Windows toast khi session chờ (presence, click → focus terminal), click Map → cuộn Sessions.
- North-star giữ nguyên: thời gian từ `waiting` tới lúc chủ nhân phản hồi.
- Backlog cũ chưa làm: P7 live theo project, P8 báo cáo tuần, E7 năng suất (F6), G5 heatmap, E5 hiệu năng T7–T9, v8 Linux/macOS (mới có plan bước 1).
- Đã có, không đề xuất lại: cảnh báo version Claude Code lệch (`SessionCard`), diagnostics, snooze, compact view.

## Khoảng trống phát hiện khi audit

- **Snooze không tới được toast**: snooze nằm ở web (`stores/snooze.ts`, localStorage), `Toaster` ở collector không biết → session đã hoãn nhắc vẫn show toast.
- Toast chỉ báo lần đầu chuyển sang `waiting`. User bấm "Bỏ qua" rồi quên → không nhắc lại (web có reminder 5 phút, toast thì không).
- Bấm toast mà focus terminal ra `notFound` / `ambiguous` (Windows Terminal nhiều cửa sổ) → không có gì xảy ra, trang `/focus` tự đóng.
- Browser đóng hẳn thì các loại khác (xong việc, limit sắp chạm, job blocked, vòng lỗi) không báo, vì chỉ `waiting` đi qua toast.

## Ý tưởng

### PM

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| P7 | Live theo project | Gom session đang chạy theo repo: số session, đang chờ, cost hôm nay | S |
| P8 | Báo cáo tuần | Recap 7 ngày: cost, token, project top, giờ làm / chờ; Markdown | S |
| P9 | Giờ yên lặng | Khung giờ (vd 22:00–08:00) không toast / không âm báo; badge vẫn đếm | S |

### Designer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| D10 | Lọc activity theo session | Chọn session (card / Map) → Activity chỉ hiện event của session đó, chip "Đang lọc: X ✕" | S |
| D11 | Toast fallback | Focus terminal fail → trang `/focus` không tự đóng mà chuyển sang dashboard, mở đúng session | S |
| D12 | Toast nhiều loại | Toggle từng loại: chờ (mặc định bật), xong việc, limit sắp chạm, job blocked, vòng lỗi | S |

### Engineer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| E8 | Snooze sync collector | ClientMessage `terminal.snooze {terminalId, until}` → collector giữ theo `statusSince`, broadcast; Toaster bỏ qua; web đọc từ snapshot thay localStorage | S |
| E9 | Toast nhắc lại | Vẫn `waiting` sau 5 phút và không có tab attentive → show lại toast, max 3 lần / episode (giống web reminder) | S |
| E7 | Năng suất (F6) | Thời gian turn trung vị / p90, top tool + tỉ lệ lỗi (chỉ tên tool) | M |
| E5 | Hiệu năng T7–T9 | Catch-up theo khối, usage store tăng dần | M |

## Top 5

| Hạng | Ý tưởng | Vì sao | Giả định cần kiểm |
|---|---|---|---|
| 1 | **E8 Snooze sync** | Khoảng trống thật do v9 tạo ra: hoãn nhắc mà toast vẫn show | Snooze theo `statusSince` chuyển sang collector không đổi hành vi web |
| 2 | **E9 Toast nhắc lại** | Bám north-star: session chờ lâu là case tốn nhất; toast bị "Bỏ qua" thì mất | 5 phút / 3 lần đủ, không gây phiền |
| 3 | **D11 Toast fallback** | Bấm toast mà không có gì xảy ra = `không phản hồi` | WT nhiều cửa sổ hay gặp `ambiguous` |
| 4 | **D10 Lọc activity theo session** | Nhiều session song song thì Activity lẫn lộn; đi cặp với click Map vừa làm | Lọc chỉ ở web, không đổi protocol |
| 5 | **D12 Toast nhiều loại** | Đóng browser vẫn biết session xong / limit sắp chạm | Toast "xong" có thể nhiều → mặc định tắt |

Kế tiếp: P9 giờ yên lặng, P7, P8, E7, G5, E5; v8 Linux/macOS khi cần.

## Thứ tự đề xuất

1. **Sprint K** (gia cố toast, đều S): E8, E9, D11.
2. **Sprint L**: D10, D12, P9.
3. Tuỳ chọn: P7, P8, E7, G5, E5.

## Trạng thái (2026-10-08)

Chủ nhân duyệt "làm hết". Đã làm Sprint K + L:
- [x] E8 snooze lên collector: `snooze.ts`, `terminal.snooze`, `snooze.updated`; web store bỏ localStorage.
- [x] E9 toast nhắc lại 5 phút / max 3 lần; session đã chờ từ trước lúc start không nhắc bù.
- [x] D11 bấm toast: page gọi `POST /focus`, focus fail → `/?focus=<id>` mở dashboard đúng session.
- [x] D10 lọc Activity theo session (chip trên panel, đi theo session đang chọn).
- [x] D12 toast nhiều loại: waiting, done (mặc định tắt), job, loop, limit; browser bỏ loại đã gửi qua Windows.
- [x] P9 giờ yên lặng (collector giữ, áp cho toast + browser + âm báo).
- [x] Test (collector 91, web 36), typecheck, smoke toast không persistent trên máy.
- [ ] Chủ nhân verify: restart collector, thử bấm toast khi Windows Terminal nhiều cửa sổ, giờ yên lặng, lọc Activity.

Lưu ý: snooze cũ trong localStorage không chuyển sang (chỉ sống 15–60 phút). Trong `npm run dev`, link dashboard từ toast trỏ `127.0.0.1:4317` → cần đã build web.

# Audit v11 — ý tưởng bổ sung (sau Sprint K + L)

## PM

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| P10 | Báo qua điện thoại | Opt-in ntfy / Discord webhook: chỉ gửi tên session + loại (chờ, xong, limit), không gửi nội dung | M |
| P11 | Tóm tắt đầu ngày | Lần mở đầu tiên trong ngày: recap hôm qua (session, giờ chờ, cost, top project) | S |
| P7 | Live theo project | Gom session đang chạy theo repo | S |
| P8 | Báo cáo tuần | Recap 7 ngày, Markdown | S |

## Designer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| D13 | Nút "Hoãn 15 phút" trên toast | Thêm action thứ 3: protocol `/snooze?t&k&m=15`, tab tự đóng ngay | S |
| D14 | Gửi thử + kiểm tra Windows | Nút "Gửi thử" trong Settings; báo khi Windows đang tắt thông báo cho PowerShell / Do Not Disturb | S |
| D15 | Ghi chú cho session | Ghi 1 dòng ("đang refactor auth") trên card, lưu ở collector theo terminalId | S |
| D16 | Tìm trong Activity | Ô tìm theo tên session / tool / loại event | S |

## Engineer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| E10 | Toast cho context ≥ 95 % và session kẹt | Đưa 2 loại còn lại lên collector; ngưỡng kẹt chuyển từ settings web sang notify.json | S |
| E11 | Token tăng bất thường | Session tiêu token/phút cao gấp N lần trung vị của chính nó → badge + thông báo | M |
| E7 | Năng suất (F6) | Thời gian turn trung vị / p90, top tool + tỉ lệ lỗi | M |
| E5 | Hiệu năng T7–T9 | Catch-up theo khối, usage store tăng dần | M |

## Top 5 (v11)

| Hạng | Ý tưởng | Vì sao | Giả định cần kiểm |
|---|---|---|---|
| 1 | **D14 Gửi thử + kiểm tra Windows** | Toast là kênh chính giờ; Windows chặn mà không biết thì mất hết | Đọc được `NOC_GLOBAL_SETTING_TOASTS_ENABLED` / setting riêng của PowerShell trong HKCU |
| 2 | **D13 Hoãn trên toast** | Hoãn ngay từ toast, không cần mở dashboard | Tab mở bởi protocol vẫn `window.close()` được |
| 3 | **E10 Toast context + kẹt** | Phủ nốt 2 loại web còn báo một mình | Ngưỡng kẹt dời lên collector không phá setting cũ |
| 4 | **P10 Báo qua điện thoại** | Rời máy hẳn vẫn biết; chủ nhân đã dùng Discord | Gửi ra ngoài → opt-in, chỉ tên + loại; cần chủ nhân chọn kênh |
| 5 | **D15 Ghi chú session** | Nhiều session song song dễ quên mỗi cái đang làm gì | Ghi chú nội bộ, không gửi đi đâu |

Kế tiếp: D16, P11, E11, P7, P8, E7, E5; v8 Linux/macOS khi cần.

P10 (Discord) bỏ — chủ nhân quyết 2026-10-08 (ngại tốn token).

## Thứ tự đề xuất (v11)

1. **Sprint M** (S hết): D14, D13, E10, D15.
2. **Sprint N**: D16, P11.
3. Tuỳ chọn: E11, P7, P8, E7, E5.

## Trạng thái Sprint M (2026-10-08)

Chủ nhân chọn "chỉ sprint tiếp" (bỏ Discord).
- [x] D14 Gửi thử + kiểm registry (Windows tắt thông báo / chặn PowerShell); DND không đọc được → ghi trong hint.
- [x] D13 nút "Hoãn 15 phút" trên toast chờ (`/snooze`).
- [x] E10 toast session kẹt + context ≥ 95 %; ngưỡng kẹt lưu ở collector.
- [x] D15 ghi chú 1 dòng cho session (≤ 140 ký tự, `notes.json`).
- [x] Test collector 96, web 36, typecheck, smoke toast có nút hoãn + health = ok trên máy.

## Layout (chủ nhân báo giữa sprint)

Vấn đề: trang khoá `100dvh` → hàng chờ + metrics ăn chỗ, Agent Map và vùng cuộn Sessions nhỏ; 5 session đã khó nhìn.
- [x] Bỏ khoá chiều cao trang; grid Sessions/Map/Activity cao `100dvh - header - 2rem` (min 560px), panel vẫn cuộn bên trong.
- [x] Bấm session (hàng chờ, Ctrl+K) mà grid bị cắt → cuộn grid lên đầu.
- [x] Map tự fit giữ zoom ≥ 0.6, neo góc trên trái; nút Fit vẫn xem toàn bộ.
- [x] Chụp headless Edge 1440×900 / 1440×1700 xác nhận.
- [ ] Chủ nhân xem trên màn thật; nếu vẫn chật có thể thêm: chế độ "Map toàn màn" hoặc thu gọn hàng metrics.

## Session tab kiểu trình duyệt (chủ nhân chọn "Tab thay cả màn", 2026-10-08)

- [x] Thanh tab sticky dưới header: "Tất cả" (số live + số đang chờ) + 1 tab / session (icon trạng thái, tên, thời gian chờ; session đã kết thúc mờ + ✕ xoá).
- [x] Tab session = màn riêng: card chi tiết | Agent Map chỉ cây của session | Activity chỉ của session.
- [x] Phím ←/→/Home/End trên thanh tab; Ctrl+K chọn session khi đang ở tab session thì chuyển tab.
- [x] Bấm toast mà không tìm thấy cửa sổ → dashboard mở thẳng tab session đó.
- [x] Typecheck, test (collector 96, web 36), chụp headless 1440×900 cả 2 màn.
- [ ] Chủ nhân dùng thử với 5 session thật.
