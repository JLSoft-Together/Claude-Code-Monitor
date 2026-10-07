# PLAN v6 — Brainstorm tính năng (2026-10-08)

Skill: `pm-product-discovery:brainstorm-ideas-existing` (product trio). R5 tiếp tục bỏ.

## Bối cảnh

- Người dùng: một dev chạy nhiều session Claude Code CLI song song trên Windows.
- North-star: thời gian từ `waiting` tới lúc chủ nhân phản hồi (N2 đã đo).
- Giới hạn: observe-only, 0 token, 127.0.0.1, không forward nội dung.
- Nguồn dữ liệu đã có: registry (status, waitingFor), transcript (usage, tool, model, effort, compact, branch), subagent, jobs, status line (5h/7d %, cost), UsageIndex, process tree.
- Đã xong: Sprint D–G trừ R5.
- Backlog cũ còn lại: F6, F7, F8, F9+G1, G5, G6, G9, F10, N3, N5, N7, T7–T9.

## Ý tưởng theo 3 góc nhìn

### PM — giá trị / chi phí

| # | Ý tưởng | Mô tả |
|---|---|---|
| P1 | **Dự báo chạm limit** | Từ chuỗi `used_percentage` 5h/7d theo thời gian → tốc độ tiêu thụ → "chạm 100% lúc ~15:40, trước giờ reset 1h20" |
| P2 | Ngân sách ngày (F8) | Ngưỡng $/token → banner + thông báo 80/100 % |
| P3 | Recap cuối ngày | Số session, tổng thời gian chờ, cost, project top; xuất Markdown/CSV (gộp F10) |
| P4 | Lịch sử + timeline (F7 + N3) | Xem lại session đã đóng, làn working/waiting/idle trong ngày |
| P5 | Live theo project | Gom session đang chạy theo repo: số session, cost hôm nay, ai đang chờ |

### Designer — trải nghiệm

| # | Ý tưởng | Mô tả |
|---|---|---|
| D1 | **Nhảy tới terminal** | Nút trên card / hàng chờ → đưa cửa sổ terminal của session lên trước |
| D2 | **Tóm tắt "trong lúc vắng"** | Tab ẩn > X phút rồi quay lại → banner: 3 session xong, 1 chờ 12 phút, 1 compact, limit 5h +18 % |
| D3 | Ctrl+K + phím tắt (F9+G1) | Tìm session, J/K duyệt hàng chờ, Enter = nhảy tới (kết hợp D1) |
| D4 | Cài như app (N5) | Cửa sổ riêng, badge số session chờ trên icon taskbar |
| D5 | Chế độ gọn / màn phụ (G9) | Chỉ hàng chờ + limit, chữ to, đặt cạnh màn chính |

### Engineer — dữ liệu sẵn có

| # | Ý tưởng | Mô tả |
|---|---|---|
| E1 | **Cảnh báo đụng nhau** | ≥ 2 session đang làm việc cùng repo + cùng branch (cwd + `gitBranch` đã có) → badge "có thể sửa đè file" |
| E2 | **Phát hiện vòng lỗi** | Cùng tool `tool.failed` ≥ N lần trong M phút, hoặc subagent nở quá nhiều → badge "đang lặp lỗi" + thông báo |
| E3 | Hiệu quả cache theo session | Tỉ lệ `cache_read / (input + cache_creation)` → nêu session đang trả tiền cache lại nhiều |
| E4 | Diff chưa commit | `git diff --shortstat` read-only trên cwd khi session xong → "+340 / −12, 9 file" |
| E5 | Tối ưu T7 + T9 | Catch-up theo khối, usage store tính tăng dần — giữ UI mượt khi lịch sử dài |

## Top 5 (ưu tiên)

| Hạng | Ý tưởng | Công sức | Vì sao chọn | Giả định cần kiểm |
|---|---|---|---|---|
| 1 | **P1 Dự báo chạm limit** | S | Giá trị cao nhất mà R4 mới mở ra; biết trước để đổi model / dừng session phụ | Status line cập nhật đủ dày để ra tốc độ; reset_at đúng; dự báo tuyến tính đủ dùng (nhãn "ước tính") |
| 2 | **D1 Nhảy tới terminal** | M (spike S trước) | Tác động trực tiếp north-star: bớt bước đi tìm cửa sổ | Từ pid tìm được cửa sổ chủ (conhost / WT / VS Code); WT chỉ focus được cửa sổ, không chọn tab; Windows chặn focus-steal → cần `AllowSetForegroundWindow` hoặc mẹo Alt; không gửi phím vào terminal |
| 3 | **D2 Tóm tắt "trong lúc vắng"** | S | Rẻ, dùng activity sẵn có, đúng lúc chủ nhân quay lại | `visibilitychange` đủ tin; activity ring 1000 đủ cho một lần vắng dài |
| 4 | **E1 Cảnh báo đụng nhau** | S | Lỗi đắt (2 agent sửa cùng file) mà hiện không ai báo | `gitBranch` cập nhật kịp khi đổi branch; worktree khác thư mục → không báo nhầm; chủ nhân có chạy song song cùng repo |
| 5 | **E2 Phát hiện vòng lỗi** | S | Bổ sung N1: không treo nhưng đốt token vô ích | Ngưỡng N/M hợp lý; `tool.failed` phủ đủ loại lỗi; chỉ dùng tên tool, không đọc nội dung |

Kế tiếp: D3 Ctrl+K (đi cặp với D1), D4 PWA badge, P4 lịch sử.

## Thứ tự đề xuất

1. **Sprint H**: P1, D2, E1, E2 (đều S, không đụng nguồn mới).
2. **Spike D1** (½ ngày): thử focus cửa sổ theo pid trên conhost / Windows Terminal / VS Code → quyết làm hay bỏ; nếu làm thì gộp D3.
3. Sau đó: D4, P4 + N3, P2/P3.

## Triển khai (chủ nhân duyệt "làm toàn bộ", 2026-10-08)

1. Sprint H
   - P1: collector `forecast.ts` giữ mẫu `usedPct` theo cửa sổ (reset khi `resetsAt` đổi / % giảm), hồi quy ≥ 10 phút → `LimitWindow.forecast {pctPerHour, fullAt?}`; web PlanLimits + thông báo khi sẽ chạm trước reset.
   - D2: web `useAway` (hidden hoặc mất focus ≥ 2 phút) ghi chuyển trạng thái → `AwaySummary.vue` đầu MonitorView.
   - E1: web `lib/conflicts.ts` gom session live theo repo root (`usage.roots[cwd] ?? cwd`) + branch → badge card.
   - E2: web `lib/attention.ts` vòng lỗi từ `tool.failed` (≥ 5 lỗi / 5 phút và ≥ 50 % tool) → badge + thông báo.
2. D1 + D3: ClientMessage `terminal.focus` → `focus.ts` (PowerShell, pid qua env, đi ngược cây process tới cửa sổ) → event `terminal.focusResult`; `CommandPalette.vue` Ctrl+K.
3. D4 PWA (manifest + sw.js + `setAppBadge`), P2 ngân sách ngày (settings).
4. P4 + N3: collector `history.ts` (session đã kết thúc ≤ 1000) + timeline trạng thái theo ngày; P3 recap + xuất Markdown/CSV.

## Trạng thái (2026-10-08)

Đã làm: P1, D2, E1, E2 (Sprint H), D1 + D3, D4, P2, P3, P4 + N3. Chưa kiểm trên UI thật / chưa build. D1 cần thử thực tế với Windows Terminal, conhost, VS Code (WT chỉ focus được cửa sổ, không chọn tab).

Review (agent) đã sửa: WT nhiều cửa sổ → `ambiguous`, palette giữ dòng đang chọn, lịch sử tải lại sau reconnect, nhãn trục timeline, segment mở khi restart đóng tại lần lưu cuối, endedAt hỏng bị loại, CSV chặn thêm 	  và mọi cột chữ, kết quả focus trễ không huỷ guard, ghi JSON tuần tự, SW không cache index.html dưới URL asset.
Để sau: gửi `history.data` / `timeline.data` riêng cho socket hỏi (hiện broadcast); prune từng episode thay vì xoá cả Set ở useNotifications; giữ costUsd khi file status line hết hạn trước lúc session kết thúc.
