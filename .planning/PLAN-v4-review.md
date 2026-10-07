# PLAN v4 — Rà soát và đề xuất (2026-10-07)

Nguồn: PLAN-v3 (phần còn lại) + audit hiệu năng/độ bền code (đã đọc lại code để xác nhận các mục cao) + ý tưởng mới theo north-star "thời gian từ `waiting` tới lúc chủ nhân phản hồi".

Ưu tiên chấm theo: Giá trị × Tần suất dùng / Công sức (S ≈ ½ ngày, M ≈ 1–2 ngày, L > 2 ngày).

## 1. Sửa ngay — độ bền và bảo mật (Sprint D)

| # | Vấn đề | Bằng chứng | Sửa | Công sức |
|---|---|---|---|---|
| T1 | **Trang web bất kỳ làm sập collector**: `decodeURIComponent` không try/catch trong `serveStatic` (async, `void`), không có handler `unhandledRejection`. `<img src="http://127.0.0.1:4317/%E0">` không có Origin nên lọt qua `isLocalRequest`. Stream file không có `'error'` handler. | `server.ts:35,43,65,85` | try/catch → 400; `.on('error')`; `.catch()` ở `serveStatic`; log `unhandledRejection` | S |
| T2 | **Origin WebSocket chỉ so hostname**: app khác chạy trên localhost (dev server, Jupyter…) mở được `/ws`, đọc cwd/tên session và gửi `favorite.open` (mở terminal). | `server.ts:31-38` | Origin phải đúng `http://127.0.0.1:<port>` / `localhost:<port>` + cho phép cổng Vite dev qua env | S |
| T3 | **Usage cache phình mãi + ghi lại cả file mỗi 15 s** khi có session chạy (giữ mọi `message.id` từ trước tới nay, `JSON.stringify` đồng bộ). Sau vài tháng: vài MB ghi mỗi 15 s, chặn event loop. | `usage.ts:15,302,344,372-380` | Bỏ `ids` của file cũ > 30 ngày; lưu khi quét xong / tắt / mỗi vài phút; retry khi rename lỗi (EPERM do antivirus) | S–M |
| T4 | **Quét usage `stat` mọi transcript mỗi 60 s** (kể cả `subagents/*.jsonl`) — hàng nghìn stat/phút khi lịch sử dài. | `usage.ts:149,208-214` | Dựa vào watcher, sweep 10–15 phút, bỏ qua file mtime/size không đổi, stat song song theo lô | S |
| T5 | **Card session nhảy liên tục** với sort mặc định "Hoạt động gần nhất" (`lastActivityAt` đổi theo từng dòng transcript) → khó bấm/đổi tên. | `sessionSort.ts:19` | Làm tròn theo phút + đóng băng thứ tự khi chuột/focus đang trong danh sách | S |
| T6 | **Activity feed bị `tool.started` đẩy trôi** sự kiện quan trọng (chờ, xong, compact) khỏi ring 300; mỗi batch render lại 300 dòng có FLIP. | `tracker.ts:267`, `ActivityFeed.vue` | Tách ring riêng cho `tool.*` (hoặc bộ lọc "ẩn tool"), tính text dòng một lần | S |
| T7 | Catch-up đọc **cả transcript vào 1 Buffer** (có thể > 100 MB), parse mọi dòng; session mới catch-up tuần tự trong reconcile. | `tailer.ts:34-40` | Đọc theo khối 4–8 MB + lọc dòng trước khi parse + song song có giới hạn | M |
| T8 | Reconcile 5 s re-sync mọi tracker kể cả khi watcher đã báo; poll cả subagent đã xong. | `monitor.ts:138-141` | Chỉ sync tracker im lặng > 30 s; không poll subagent đã resolved | S |
| T9 | Web usage store tính lại toàn bộ (filter/totals/daily/byModel/projects) mỗi update ~1 s khi đang mở tab Thống kê; snapshot gửi mọi bucket. | `stores/usage.ts:113-278` | Bucket `markRaw` + version ref, tính sẵn cost/token mỗi bucket, throttle 1 s | M |
| T10 | Nhỏ: WS không ping/heartbeat (socket chết sau sleep), client nhận delta trước snapshot, "hôm nay" không đổi sau nửa đêm, Set `rejected` không prune, watcher lỗi không đóng. | `server.ts:99-131`, `usage.ts:125`, `monitor.ts:27,307` | Gom 1 PR dọn dẹp | S |

Đã kiểm và ổn: tail theo offset, debounce watcher, batch 50 ms, Agent Map cập nhật tăng dần, bảng project có phân trang, `favorite.open` chỉ mở thư mục đã ★.

## 2. Tính năng — còn lại từ PLAN-v3 (đã sắp lại)

| # | Tính năng | Giá trị | Công sức | Ghi chú |
|---|---|---|---|---|
| F4 | Chi phí do Claude ghi (`cost-state`) cạnh ước tính | Trung bình–cao | M | Tin số liệu hơn; làm chung lần nâng cache với F6 |
| F6 | Năng suất: thời gian turn (trung vị/p90), dòng +/−, top tool + tỉ lệ lỗi | Trung bình | M | Cùng `UsageIndex` |
| F7 | Lịch sử session đã đóng (1000 session) | Trung bình | M–L | Bây giờ có "Xoá session đã kết thúc" → càng cần nơi xem lại |
| F8 | Ngân sách ngày (token/$) → banner + thông báo 80/100 % | Trung bình | S | Dùng lại F1 |
| F9 + G1 | Tìm session + phím tắt + command palette `Ctrl+K` | Trung bình | S–M | Gộp làm một |
| G5 | Heatmap giờ × thứ | Thấp–TB | M | Cần bucket theo giờ (đổi cache) |
| G6 | So sánh kỳ trước trên KPI (% thay đổi) | TB | S | Dữ liệu có sẵn |
| G8 | Ghim session lên đầu | TB | S | Kết hợp T5 |
| G9 | Chế độ TV / màn phụ | Thấp–TB | S | |
| F10/G10 | Xuất CSV / báo cáo tuần | Thấp | S | |

## 3. Ý tưởng mới

| # | Tính năng | Vì sao | Công sức | Rủi ro |
|---|---|---|---|---|
| N1 | **Phát hiện session "kẹt"**: `working` mà không có dòng transcript mới > N phút (tool treo, mạng lỗi) → badge + thông báo | Đúng north-star; hiện chỉ biết "chờ", không biết "treo" | S | Không |
| N2 | **Chỉ số north-star trên dashboard**: thời gian phản hồi trung bình hôm nay (`waiting → working`), số lần chờ > 5 phút | Biết mình đang làm session chờ bao lâu; đo tại máy | S | Không |
| N3 | **Dòng thời gian trong ngày** (Gantt): mỗi session là một làn working/waiting/idle | Thấy chỗ bị nghẽn, session nào chờ lâu | M | Cần lưu lịch sử trạng thái (gộp với F7) |
| N4 | **Âm báo tuỳ chọn** khi có session chờ (Web Audio, âm ngắn, bật/tắt trong Cài đặt) | Notification hệ thống hay bị Focus Assist tắt | S | Không |
| N5 | **Cài như app (PWA)**: cửa sổ riêng, icon taskbar, badge số session chờ trên icon (`navigator.setAppBadge`) | Không lẫn trong tab trình duyệt; badge thấy ngay trên taskbar | S–M | Service worker chỉ cache UI |
| N6 | **Hook chính thức của Claude Code** (`Notification`, `Stop`, `SessionStart`) đẩy sự kiện tới collector (opt-in, chủ nhân tự thêm vào `settings.json`) | Báo "chờ / xong" tức thì và chính xác hơn đọc file; vẫn 0 token | M | Phải sửa settings người dùng → chỉ hướng dẫn + nút copy, không tự sửa |
| N7 | **Thao tác nhanh trên card**: mở thư mục cwd trong Explorer / VS Code | Hay dùng khi session báo xong | S | Spawn tiến trình như launcher (cùng mức an toàn, sau T2) |
| N8 | **Gửi prompt tới session** | Chủ nhân hỏi | L | Đi ngược nguyên tắc observe-only + rủi ro bảo mật → **hoãn** theo yêu cầu chủ nhân |

## 4. Thứ tự đề xuất

1. **Sprint D — Gia cố (bắt buộc trước khi thêm tính năng):** T1, T2, T3, T4, T5, T6 (≈ 1,5–2 ngày). T7–T10 làm tiếp nếu còn thời gian.
2. **Sprint E — Canh chừng tốt hơn (bám north-star):** N1 kẹt, N2 chỉ số phản hồi, N4 âm báo, G8 ghim, F9+G1 phím tắt/Ctrl+K.
3. **Sprint B — Số liệu thật:** F4 cost-state + F6 năng suất (một lần nâng cache), G6 so kỳ trước.
4. **Sprint C — Lịch sử:** F7 + N3 timeline, F8 ngân sách, F10 CSV.
5. Tuỳ chọn: N5 PWA, N6 hook, N7 mở thư mục, G5 heatmap, G9 TV.

UI mới áp dụng skill `frontend-design` + `ui-ux-pro-max`; mỗi mục: test collector khi đổi parser, i18n en/vi, cập nhật `.code_index/` và `docs/claude-code-integration.md`.
