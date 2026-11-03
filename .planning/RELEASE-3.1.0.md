<!-- 3.1.0 (v80 agent MCP tools + links), release 2026-11-03. -->
# English

## Agents (MCP tools)
- Agents in a Workspace pane can now ask Orrery to notify you (notify_owner), open a file or diff beside them (open_in_workspace) and see who else is editing a file (who_is_editing).
- Run tools: run_app (start / reload / restart / stop), run_status, run_log and device_screenshot.
- Desk tools: preview_layout (render an Android XML layout), list_servers and free_port (stops only the pane's own servers, after a confirm).
- Codex panes now get the Orrery MCP tools too, same as Claude panes.

## Review and resume
- Changes remembers what you reviewed and lists unreviewed files first.
- History can continue an ended session.
- Run can reload when the agent finishes (off by default) and reselects a project's last device, reconnecting it over Wi-Fi.

## Limits and search
- Limits warn when they are forecast to run out: a time in the status popover, a dot on the button and a line when you open a new agent.
- Ctrl+K searches sessions, projects, files and settings in one box (prefix with > @ # : to narrow).
- A sub-agent's panel in the Agent Map lists its recent tool calls with time and result.

## Notices and speed
- Undo, break reminder and phone alerts share one toast stack in the bottom-right corner: up to three, paused on hover, closed with Esc.
- Faster start: rarely used dialogs (recap, diagnostics, resources, shortcuts, update) load in the background.
- Internal: Workspace and Agent Map code split into smaller modules.

# Tiếng Việt

## Agent (công cụ MCP)
- Agent trong pane Workspace giờ có thể nhờ Orrery báo cho chủ nhân (notify_owner), mở file hoặc diff cạnh pane (open_in_workspace) và xem ai đang sửa một file (who_is_editing).
- Công cụ Run: run_app (start / reload / restart / stop), run_status, run_log và device_screenshot.
- Công cụ desk: preview_layout (dựng layout XML Android), list_servers và free_port (chỉ dừng server của chính pane, sau khi xác nhận).
- Pane Codex giờ cũng dùng được các công cụ MCP Orrery, giống pane Claude.

## Duyệt và tiếp tục
- Changes nhớ file đã xem và đưa file chưa xem lên đầu.
- History có nút Tiếp tục cho session đã kết thúc.
- Run có thể tự reload khi agent xong (mặc định tắt) và chọn lại thiết bị dùng gần nhất của dự án, nối lại qua Wi-Fi.

## Hạn mức và tìm kiếm
- Hạn mức báo trước khi sắp cạn: giờ dự kiến trong popover trạng thái, chấm trên nút và một dòng khi mở agent mới.
- Ctrl+K tìm session, dự án, file và cài đặt trong một ô (gõ > @ # : để thu hẹp).
- Panel sub-agent trong Agent Map hiện các lệnh gọi tool gần đây kèm thời gian và kết quả.

## Thông báo và tốc độ
- Hoàn tác, nhắc nghỉ và cảnh báo điện thoại dùng chung một chồng toast ở góc phải dưới: tối đa ba cái, dừng đếm khi rê chuột, đóng bằng Esc.
- Khởi động nhanh hơn: các hộp thoại ít dùng (tóm tắt, chẩn đoán, tài nguyên, phím tắt, cập nhật) tải ngầm khi rảnh.
- Nội bộ: tách mã Workspace và Agent Map thành các module nhỏ hơn.
