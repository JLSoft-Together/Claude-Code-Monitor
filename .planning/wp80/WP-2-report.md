# WP-2 report: Codex pane dùng MCP orrery

## Kiểm Codex (0.162.1)
- `codex mcp add --help`: có `--url` (streamable HTTP) và `--bearer-token-env-var <ENV_VAR>`.
- `codex -c "mcp_servers.orrery.url=$ORRERY_API/mcp" -c mcp_servers.orrery.bearer_token_env_var=ORRERY_TOKEN mcp get orrery`
  -> `enabled: true, transport: streamable_http, url: .../mcp, bearer_token_env_var: ORRERY_TOKEN`.
- `-c` giá trị không phải TOML hợp lệ (URL) được hiểu là chuỗi thô, nên không cần quote trong. URL phải literal (config không expand ${VAR}) nên shell expand ORRERY_API.
- Không sửa ~/.codex, không chạy phiên codex thật.

## Đã đổi
- apps/desktop/src/pty/presets.ts: `agentCommand` preset codex thêm 2 cờ `-c` khi `opts.mcp` (cả new lẫn `codex resume`, đặt trước subcommand). Windows dùng `$env:ORRERY_API`, POSIX dùng `$ORRERY_API`. Token không nằm trên command line.
- apps/desktop/test/pty.test.ts: cập nhật assert codex win32 + thêm case POSIX resume.
- docs/codex-integration.md: mục 8 mới.

## Test
- vitest pty.test.ts: 24 passed, 0 failed. `npm run typecheck` (desktop) sạch.

## Hot file cần thêm
- Không. (docs/claude-code-integration.md §11w: có thể thêm 1 dòng "Codex pane: xem codex-integration.md §8" nếu WP-1 sửa mục đó.)

## Changelog
- en: Codex panes now get the Orrery MCP tools too (open_session and the rest), same as Claude panes.
- vi: Pane Codex giờ cũng dùng được các công cụ MCP Orrery (open_session và các lệnh khác), giống pane Claude.

## Index
- desktop.md: pty/presets.ts `agentCommand` codex preset passes `-c mcp_servers.orrery.url/bearer_token_env_var` when mcp ready.

## Commit đề xuất
🔌 Codex panes get the Orrery MCP server via -c overrides (url + bearer env var)
