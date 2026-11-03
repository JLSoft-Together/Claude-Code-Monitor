## WP-2: Codex pane dùng được MCP orrery
- Kiểm Codex CLI cài trên máy (`codex --version` = 0.162.1; `codex mcp --help`, `codex --help`, docs trong ~/.codex nếu có) xem có hỗ trợ MCP HTTP
  (streamable) với header Bearer / biến môi trường token không, cấu hình qua `-c mcp_servers.<name>...` khi khởi động (KHÔNG sửa ~/.codex/config.toml
  của chủ nhân). Ghi kết quả đã kiểm (lệnh + output ngắn) vào docs/codex-integration.md mục mới.
- Hỗ trợ → preset codex trong apps/desktop/src/pty/presets.ts truyền MCP orrery cho pane codex giống claude (`--mcp-config`), test presets.
  Không hỗ trợ / chỉ stdio → đề xuất cách (vd stdio shim gọi HTTP) trong report, KHÔNG làm nếu cần cài thêm gì; chỉ ghi docs.
- Phạm vi: pty/presets.ts (+ test), docs/codex-integration.md. Cấm: pty/mcp.ts, mcpTools (WP-1), App.vue. strings.ts cần → "Hot file cần thêm".
- Model: sonnet. Không gửi prompt vào codex; có thể chạy `codex` ở chế độ chỉ in help / config, không chạy phiên thật tốn token.
- Báo cáo `.planning/wp80/WP-2-report.md`.

## Nhật ký
