## WP-3: `claude` / `codex` gõ tay trong pane Shell = mở qua cổng chung (shim)
- Mục tiêu: trong pane Shell, gõ `claude …` hoặc `codex …` chạy CLI thật kèm MCP `orrery` của pane (claude: `--mcp-config $ORRERY_MCP_CONFIG`; codex: `-c mcp_servers.orrery.*` như presets.ts) và claude kèm `--session-id <uuid mới>` khi user không tự truyền `--resume/-r/--continue/-c/--session-id`. Pane shell có agent gõ tay được đối xử như pane agent: đóng xong mở lại được bằng resume (closedPane), restore/restart mở lại `claude --resume <id>` khi agent còn đang chạy lúc đóng. Settings có công tắc tắt (mặc định bật).
- Cách làm: PTY host tạo 1 thư mục shim (cạnh INIT_DIR) chứa `claude.cmd`/`codex.cmd` (Windows PowerShell gọi được) + `claude`/`codex` (POSIX sh, chmod +x); prepend vào PATH chỉ cho pane preset `shell` khi bật. Shim tìm CLI thật bằng PATH đã bỏ thư mục shim; không thấy thì báo lỗi rõ. Không ghi gì ra ngoài thư mục dữ liệu app.
- Phạm vi: apps/desktop/src/pty/{host.ts,presets.ts,shellInit.ts,shim.ts(mới)}, packages/shared/src/pty.ts (cờ spawn `shim`), apps/web/src/stores/workspace.ts (closedPane/LAST snapshot/restore cho pane shell có `agent`), apps/web/src/components/workspace/TermPane.vue (gửi cờ), settings store + Settings UI chỗ Terminal (công tắc) + i18n key mới, tests.
- Cấm đụng: main.ts, preload.ts, mcpTools/**, useMcpCalls, App.vue, orreryApi.ts (WP-1/2).
- Phụ thuộc: không | Song song: WP-1 | Model: opus (shell đa nền tảng, PATH, quoting dễ vỡ)
- Tiêu chí: 1) shim Windows + POSIX, có test unit nội dung/args (resume flags không thêm --session-id); 2) PATH chỉ prepend cho shell khi bật; 3) công tắc Settings (vi/en) tắt được; 4) closedPane/restore cho shell+agent dùng resume; 5) typecheck + test pass; 6) e2e/shell-agent.cjs vẫn chạy (nếu được).
- Lệnh test: `npm run typecheck`; `npm test -w @ccm/desktop`; `npm test -w @ccm/web`
- Nhìn thấy được: có (công tắc Settings) — chụp nếu chạy được bản dev (CDP 9333, xem HANDOFF-2026-11-06-1144 §3), không thì CHƯA NHÌN.
- Báo cáo: `.planning/wp/gw/WP-3-report.md`
## Nhật ký
- 13:40 audit: shell PATH dựng ở presets.ts (env PATH key theo env sẵn có), zsh/bash init (path_helper macOS đẩy PATH ra sau → cần đặt lại sau rc), PS -EncodedCommand chạy sau profile. PS ưu tiên theo thứ tự PATH (.cmd thư mục đầu thắng .ps1 thư mục sau — đã thử).
- 13:50 shim.ts + test chạy thật (.cmd qua cmd.exe, sh qua Git sh): 16/16. host.ts SHIM_DIR = <data>/shell-shim; cờ spawn `shim`.
- 13:58 web: settings.agentShim + toggle + i18n; workspace.reopenAs dùng cho closedPane + LAST snapshot.
- 14:05 typecheck 0 lỗi; desktop 1299/1299, web 1732/1732; e2e shell-agent 5/5 PASS; QA CDP: claude.exe nhận --session-id + --mcp-config, pane.agentSessionId khớp, reopen → preset claude + resume.
