<!-- 3.1.1 (v81 DeepSeek CLI groundwork, off by default), release 2026-11-03. -->
# English

## Monitor
- Monitor shows DeepSeek CLI (Codewhale) sessions, with working / idle state and sub-agents, when Codewhale's lifecycle outbox is turned on. It only reads that local file; nothing calls DeepSeek.

## DeepSeek CLI (off by default)
- Built in but turned off: Codewhale panes in the Workspace, Settings › DeepSeek (install, log in, update, copy rules / skills / MCP from Claude) and the MCP hand-back between agents and DeepSeek. Start the app with `CCM_DEEPSEEK_FEATURE=1` to try it.

## Internal
- The Codex process scan is shared with other agent CLIs.

# Tiếng Việt

## Monitor
- Monitor hiện session DeepSeek CLI (Codewhale) với trạng thái đang chạy / rảnh và sub-agent, khi Codewhale bật lifecycle outbox. App chỉ đọc file local đó, không gọi DeepSeek.

## DeepSeek CLI (mặc định tắt)
- Có sẵn nhưng tắt: pane Codewhale trong Workspace, Cài đặt › DeepSeek (cài, đăng nhập, cập nhật, chép rule / skill / MCP từ Claude) và MCP bàn giao qua lại giữa agent với DeepSeek. Chạy app với `CCM_DEEPSEEK_FEATURE=1` để thử.

## Nội bộ
- Quét process Codex dùng chung cho các CLI agent khác.
