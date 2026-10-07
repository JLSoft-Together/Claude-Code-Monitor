# R5 — Hook bridge: phân tích (2026-10-08)

Trạng thái: chưa làm, chờ chủ nhân chọn phương án.

## Hiện monitor đã có gì (không cần hook)

| Nhu cầu trong R5 | Nguồn hiện tại | Độ trễ |
|---|---|---|
| Báo "chờ" | registry `status = waiting` + `waitingFor`, Claude ghi mỗi lần đổi trạng thái | gần tức thì (file watcher) |
| Báo "xong" | registry `busy → idle` + thông báo N4 | gần tức thì |
| Compact xong | transcript `compact_boundary` (trigger, pre/post tokens) | sau khi compact xong |
| Kẹt | N1 (`statusSince` quá ngưỡng) | — |

→ `Notification` / `Stop` gần như trùng registry.

## Hook thật sự thêm được

1. `PreCompact` → trạng thái **đang compact** từ lúc bắt đầu (hiện chỉ thấy `busy`). Kết thúc = `compact_boundary` đã parse sẵn; có timeout dự phòng.
2. `PermissionDenied` (auto mode) → **đếm lần bị từ chối** + tên tool. Hiện không có nguồn nào.

## Chi phí / rủi ro

- Hook chạy đồng bộ: Claude chờ lệnh hook xong. `node` khởi động trên Windows ~100 ms. `Stop` chạy mỗi lượt → chậm mỗi lượt. `PreCompact` / `PermissionDenied` hiếm → không đáng kể.
- Payload stdin có dữ liệu nhạy cảm, script phải bỏ trước khi ghi: `custom_instructions` (PreCompact), `message` (Notification), `tool_input` (PermissionDenied), `last_assistant_message` (Stop, nếu có), `transcript_path`, `cwd`.
- Phải sửa `settings.json` của chủ nhân → chỉ hướng dẫn + nút copy (như R4). Gộp được với hook sẵn có.
- Hook chỉ nạp khi session mới start → session đang chạy không có.

## Thiết kế đề xuất (R5-lite)

- `scripts/hook-bridge.mjs`: đọc stdin, giữ `session_id`, `hook_event_name`, `trigger`, `tool_name`; ghi `<dataDir>/hooks/<session_id>.json` (atomic rename, ≤4 KB). Collector chưa chạy vẫn không lỗi. Luôn exit 0, không in gì ra stdout (tránh ảnh hưởng quyết định của Claude).
- Collector: `HookReader` cùng khuôn `StatusLineReader` (regex UUID, giới hạn size, dọn file cũ).
- Protocol: `TerminalSession.compactingSince?`, `deniedCount?`, `deniedTools?` (tối đa vài tên); activity `terminal.compacting`, `tool.denied`.
- Web: card + Agent Map hiện "Đang compact" (icon + text + màu), chip "Auto từ chối: N"; trang Tích hợp tuỳ chọn thêm khối hook + nút copy.
- Docs: `docs/claude-code-integration.md` §11e.

## Cần kiểm trước khi code

Đọc tĩnh `claude.exe` 2.1.289: tên trường payload `PreCompact` / `PermissionDenied`, có `async` cho hook không (nếu có thì hết lo độ trễ), matcher của `PermissionDenied`.

## Công sức

Lite: S–M (~1 sprint nhỏ). Bản đủ (thêm Notification/Stop): M, giá trị thêm thấp.
