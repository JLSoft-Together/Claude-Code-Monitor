# DECISIONS

- 2026-11-04 · MCP `telegram_receive on` phải qua hộp xác nhận native trên máy (agent không tự bật nhận lệnh từ xa được); `off` / `status` và `telegram_notify` không cần · lý do: review WP-1 (prompt injection có thể tự bật nhận lệnh). Main quyết, báo chủ nhân.
- 2026-11-04 · Chủ nhân cho phép tự test Telegram bằng bản dev (`npm run build` web + desktop, electron stage với user-data-dir / CCM_DATA_DIR tạm, cổng 4319, CDP 9333) · lý do: chủ nhân nói 'con tự test đi nhé'.
