# PLAN v5 — Nghiên cứu nguồn dữ liệu mới (2026-10-08)

Bổ sung cho `PLAN-v4-review.md`. Kiểm lại code: chưa mục nào của Sprint D / Sprint E được làm (T1 `decodeURIComponent` vẫn không try/catch, T2 Origin vẫn chỉ so hostname).

Nguồn mới tìm thấy trong `~/.claude` (Claude Code 2.1.289). Con chỉ xem tên trường, không đọc nội dung.

| Nguồn | Trường dùng được | Không được đọc/forward |
|---|---|---|
| `assistant.effort` / `perTurnEffort` trong transcript | `low…max`, `xhigh` | — |
| `cache/model-catalog/*.json` → `catalog.config.models[]` | `id`, `name` ("Opus 5.5"), `short_name` | `notice`, `description`, `catalog.state` |
| `jobs/<id>/state.json` (background job, `claude agents`) | `state`, `tempo`, `template`, `inFlight.tasks/queued`, `tokens` | `intent`, `output.result`, `detail`, `linkScanPath`, `respawnFlags` |
| `jobs/<id>/timeline.jsonl` | `at`, `state` (`working` / `blocked` / `done`) | `text`, `detail` |
| Status line JSON (opt-in, Claude đẩy vào stdin của script) | `rate_limits.five_hour/seven_day.{used_percentage, resets_at}`, `cost.total_cost_usd`, `context_window`, `prompt_cache` (hit ratio, warm/cold) | `transcript_path` nội dung |
| Hook (opt-in) | `PreCompact`, `Notification` (`agent_needs_input` / `agent_completed`), `Stop`, `PermissionDenied` | `prompt`, `tool_input` |
| `metrics/costs.jsonl` | Bỏ qua — do plugin bên thứ ba ghi, không phải Claude Code | — |

## Tính năng mới

| # | Tính năng | Giá trị | Công sức | Ghi chú |
|---|---|---|---|---|
| R1 | **Chip effort** cạnh chip model ("Opus 5.5 · medium"), cả card và Agent Map | TB | S | Lấy `effort` của assistant record mới nhất, đọc giống `model` |
| R2 | **Tên model chính thức** từ model-catalog; `modelLabel` thành fallback | Thấp | S | Catalog có thể cũ, chỉ dùng để map tên |
| R3 | **Background jobs** (`claude agents` / daemon): danh sách job + trạng thái; `blocked` vào hàng chờ như session `waiting` | Cao nếu dùng `claude agents` | M | Hiện monitor không thấy job nền. Watch `jobs/*/state.json` |
| R4 | **Giới hạn gói thuê bao** 5h / 7 ngày (% đã dùng + giờ reset) trên header, qua *status line bridge* opt-in: script nhỏ ghi JSON đã lọc vào `CCM_DATA_DIR`, in lại status line cũ của chủ nhân (bọc lệnh cũ, không thay thế) | **Rất cao** — hiện chỉ có $ ước tính, không biết sắp chạm limit | M | Thêm số cost do Claude tính (thay F4) và context chính xác. Chỉ hướng dẫn + nút copy, không tự sửa `settings.json` |
| R5 | **Hook bridge** (gộp N6): trạng thái live `compacting` (PreCompact), báo chờ / xong tức thì, đếm lần auto-mode từ chối | Cao | M | Chung trang "Tích hợp tuỳ chọn" với R4 |
| R6 | **Cảnh báo cache nguội**: session chờ quá TTL cache (5 phút / 1 giờ, lấy từ `ephemeral_5m/1h`) → card hiện "prompt kế tiếp sẽ cache lại ~X token ≈ $Y" | Cao, bám north-star (chờ lâu = tốn tiền) | S–M | Tính từ `usage` có sẵn + `statusSince`; nhãn "ước tính" |
| R7 | Launcher: shortcut ngoài Desktop + tự chạy khi đăng nhập (shortcut vào thư mục Startup), tuỳ chọn trên trang setup | TB | S | Không đụng registry |

## Thứ tự đề xuất (cập nhật)

1. **Sprint D** (giữ nguyên, bắt buộc): T1–T6.
2. **Sprint E'**: R1 effort, R6 cache nguội, N1 kẹt, N2 chỉ số phản hồi, N4 âm báo, G8 ghim.
3. **Sprint F — Tích hợp opt-in**: R4 status line bridge, R5 hook bridge (thay F4 / N6). Ghi vào `docs/claude-code-integration.md` §11e.
4. **Sprint G**: R3 background jobs, R2 tên catalog, R7 launcher.
5. Phần còn lại của PLAN-v4 (F6, F7 + N3, F8, F9 + G1…).

## Trạng thái (2026-10-08)

Đã làm: Sprint D T1–T6 + heartbeat WS (T10 một phần), R1, R2, R3, R4, R6, R7, N1, N2, N4, G8. Bỏ theo yêu cầu: R5. Còn lại: T7–T9, phần còn lại T10, các mục PLAN-v4 mục 2.
