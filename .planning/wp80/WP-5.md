## WP-5: MCP tool preview_layout + list_servers / free_port
- Nền như WP-4 (đọc WP-1-report.md; `mcpTools/index.ts` là hot file của main, không sửa).
- Tool:
  1. `preview_layout(path, device?: phone|tablet, theme?: light|dark)`: XML layout Android trong project → PNG qua layout daemon (desktop layout/).
     Không bật JVM sẵn: lời gọi này CHÍNH là tín hiệu warm-up (memory no-always-on-jvm); daemon chưa sẵn → trả "đang khởi động, thử lại sau N giây"
     thay vì chặn lâu. Ảnh lưu thư mục chụp của project, trả đường dẫn.
  2. `list_servers()`: server / cổng LISTEN thuộc cây process của các session (dữ liệu Resources v76: resources event / desktop resources), kèm idle bao lâu.
  3. `free_port(port)`: dừng process giữ cổng đó CHỈ khi nó thuộc cây process của chính pane gọi hoặc dự án của pane; luôn qua confirm native
     (hành vi "Dừng" của Resources v76); trả kết quả đã dừng / chủ nhân từ chối.
- Bảo mật như AGENT-RULES-v80 "v80 extra"; rate limit; test vitest desktop; docs §11w + codex §8.
- Phạm vi: mcpTools/previewLayout.ts, listServers.ts, freePort.ts (mới), bridge cần thêm trong desktop layout/ / resources (ghi rõ), test, docs.
  Cấm: mcpTools/index.ts, các tool WP-1/WP-4, paths.ts (đề xuất).
- Model: opus. Build/e2e: `.planning/wp/build.lock`, CCM_E2E_DBG=9452 CCM_E2E_PORT=4391; KHÔNG đụng 4317.
- Báo cáo `.planning/wp80/WP-5-report.md`.

## Nhật ký
- 2026-11-03 WP-5 xong: 3 tool + kênh mcp-desk + agentRender + agentPorts, test 12 mới / 106 liên quan pass, report WP-5-report.md.
