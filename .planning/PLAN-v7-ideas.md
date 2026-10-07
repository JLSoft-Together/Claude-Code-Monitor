# PLAN v7 — Audit tính năng (2026-10-08)

Skill: `pm-product-discovery:brainstorm-ideas-existing` (product trio). R5 vẫn bỏ.

## Hiện trạng

- Đã xong tới v6: dự báo limit, tóm tắt lúc vắng, đụng branch, vòng lỗi, nhảy tới terminal (đúng cửa sổ qua console owner), Ctrl+K, PWA, ngân sách ngày, Lịch sử + timeline, recap.
- North-star giữ nguyên: thời gian từ `waiting` tới lúc chủ nhân phản hồi.
- Backlog cũ chưa làm: F6 năng suất, G5 heatmap, G6 so kỳ trước, G9 màn phụ, G10 báo cáo tuần, N7 mở thư mục, E3 cache, E4 diff chưa commit, P5 live theo project, T7–T9 hiệu năng.
- Nợ từ review v6: `history.data` / `timeline.data` đang broadcast mọi tab; `useNotifications` xoá cả Set khi > 200; mất `costUsd` khi file status line hết hạn trước lúc session kết thúc.
- Kiểm nguồn: `turn_duration` có trong transcript (đã dùng cho N2). Lỗi API / rate limit: 200 transcript gần nhất không có marker nào → chưa đủ căn cứ, không đưa vào top.

## Ý tưởng

### PM

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| P6 | So kỳ trước (G6) | KPI Thống kê kèm % đổi so với kỳ liền trước cùng độ dài | S |
| P7 | Live theo project (P5) | Gom session đang chạy theo repo: số session, đang chờ, cost hôm nay | S |
| P8 | Báo cáo tuần (G10) | Recap 7 ngày: cost, token, project top, giờ làm / chờ; Markdown | S |

### Designer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| D6 | Thao tác nhanh trên card (N7) | Mở thư mục trong Explorer / VS Code; collector spawn như launcher, chỉ path của session | S |
| D7 | Màn phụ (G9) | `?mode=compact`: chỉ hàng chờ + limit + chữ to, hợp cửa sổ PWA nhỏ cạnh màn chính | S |
| D8 | Hoãn nhắc theo session | "Nhắc lại sau 15 phút" trên session đang chờ: tắt badge + thông báo tạm thời | S |
| D9 | Nhớ kích thước node Agent Map | Lưu theo tên session (localStorage), giữ qua reload | S |

### Engineer

| # | Ý tưởng | Mô tả | Công sức |
|---|---|---|---|
| E3 | Hiệu quả cache | `cache_read / (input + cache_write)` theo session và model; nêu session ghi cache nhiều mà ít đọc | S |
| E4 | Diff chưa commit | `git diff --shortstat` read-only khi session chuyển xong / chờ → "+340 −12, 9 file" trên card | M |
| E6 | Chẩn đoán nguồn dữ liệu | Panel trong Cài đặt: status line bridge báo lần cuối, usage scan, process verify, số file theo dõi, thư mục dữ liệu | S |
| E7 | Năng suất (F6) | Thời gian turn trung vị / p90 theo session và ngày, top tool + tỉ lệ lỗi (chỉ tên tool) | M |
| E5 | Hiệu năng T7–T9 | Catch-up theo khối, sync tracker im lặng, usage store tăng dần | M |

## Top 5

| Hạng | Ý tưởng | Vì sao | Giả định cần kiểm |
|---|---|---|---|
| 1 | **D6 Mở thư mục / VS Code** | Bước kế tiếp tự nhiên sau "session xong"; dùng lại launcher đã gia cố | `code` có trong PATH; chỉ mở path session đang theo dõi, không nhận path từ client |
| 2 | **E4 Diff chưa commit** | Biết session vừa sửa bao nhiêu mà không cần mở terminal; đi cặp E1 đụng branch | `git` có sẵn; chạy khi đổi trạng thái, có debounce + timeout; repo lớn vẫn nhanh với `--shortstat` |
| 3 | **E6 Chẩn đoán nguồn** | Lần cài đặt status line vừa rồi cho thấy khó biết nguồn nào đang chạy | Mọi trạng thái đã có trong collector, chỉ cần gửi ra |
| 4 | **D8 Hoãn nhắc** | Giảm thông báo thừa khi cố ý để session chờ; hợp north-star (nhắc đúng lúc) | Chủ nhân hay để session chờ có chủ đích |
| 5 | **P6 So kỳ trước** | Rẻ, dữ liệu sẵn, thấy xu hướng ngay trên KPI | Kỳ trước đủ dữ liệu trong UsageIndex |

Kế tiếp: E3, D7, D9, P7, P8, E7; E5 khi lịch sử dài làm UI chậm.

## Thứ tự đề xuất

1. **Sprint I** (S hết): D6, E6, D8, P6 + trả nợ review v6.
2. **Sprint J**: E4 diff, E3 cache, D9.
3. Tuỳ chọn: D7, P7, P8, E7, E5.

## Trạng thái (2026-10-08)

Sprint I + J đã làm (chủ nhân duyệt "làm 2 phase I J"):
- D6 mở thư mục / VS Code, E6 chẩn đoán, D8 hoãn nhắc, P6 so kỳ trước.
- Nợ v6: trả lời riêng từng tab (direct reply), prune thông báo theo episode, giữ costUsd khi tracker còn sống.
- E4 diff chưa commit, E3 tỉ lệ đọc cache (KPI + cột model), D9 nhớ kích thước / vị trí node.

Chưa build / chưa xem UI thật. Cần thử: mở VS Code (Code.exe tìm thấy không), diff trên repo lớn, hoãn nhắc qua reload.
- D7 màn phụ / chế độ gọn: đã làm (nút ở header + Ctrl+K, URL `?mode=compact`). Chưa xem UI thật.
