# PLAN v66 — Gom backlog cũ (2026-10-28)

Chủ nhân: "ok làm hết đi, nhưng ưu tiên là ide phải hoạt động mượt mà". Office tạm dừng (v65).

## Ràng buộc mượt (áp mọi mục)

- Không thêm polling / watcher mới chạy suốt; tính toán nặng chỉ khi màn đó đang mở (lazy, `defineAsyncComponent`).
- Không thêm việc vào Workspace / TermPane / store terminals đường nóng; không animation vô hạn.
- Gom dữ liệu tuần / heatmap trong collector theo yêu cầu (on demand), cache theo ngày; ngày cũ đã đóng không tính lại.

## Khảo sát (2026-10-28)

| Mục | Hiện trạng | Việc |
|---|---|---|
| R3 background jobs | Đã có (docs §11h) | Bỏ |
| R5 hook bridge | Chưa có; trước đây chủ nhân bỏ (`PLAN-v5-research.md:39`) | Hỏi lại |
| Báo cáo tuần (P8/G10) | Recap theo ngày có MD/CSV (`RecapDialog.vue`, `lib/recap.ts`) | Thêm kỳ 7 ngày + so kỳ trước (G6) + p90 phản hồi + tool lỗi nhiều nhất |
| Heatmap (G5) | Chưa có | Lưới giờ × thứ trong History |
| Live theo project (P7) | Chưa có | Monitor: nhóm session đang chạy theo repo (số session, số chờ, cost hôm nay) |
| Tour | Có, nội dung cũ (bước Activity đã bỏ) | Viết lại bước theo layout hiện tại |
| v14 auto-pan tránh panel nổi | Không còn panel nổi | Bỏ |
| v14 bottom sheet < 768 px | Chưa có; app desktop | Hỏi lại |

## Thứ tự

1. Tour (nhỏ, sửa chữ + bước).
2. Live theo project (Monitor, chỉ derive từ store sẵn có).
3. Báo cáo tuần.
4. Heatmap.
5. Hook bridge (chủ nhân 2026-10-28: "Làm, có công tắc"): Settings bật/tắt, mặc định tắt, cài hook vào
   settings.json của Claude Code chỉ sau confirm native; gỡ sạch khi tắt.
6. Bottom sheet < 768 px (chủ nhân: "Làm").
