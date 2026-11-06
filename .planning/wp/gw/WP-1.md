## WP-1: Orrery API — bảng action + dispatcher ở main + 1 kênh ccm:orrery
- Mục tiêu: mọi lời gọi thao tác workspace từ ngoài page (MCP tool phía page/desk, agent-monitor://open, bot Telegram phía page) đi qua 1 dispatcher `apps/desktop/src/orreryApi.ts` `call(action, args, caller)`; page có 1 executor `apps/web/src/composables/useOrreryApi.ts` nhận 1 kênh IPC `ccm:orrery` và gọi các hàm đã gom (`workspace.openSession`, `useSessionActions`, `workspace.showForAgent`, `workspace.handBack`, run calls của `lib/mcpRun`, who_is_editing…). Hành vi người dùng không đổi.
- Spec: `.planning/PLAN-2026-11-06-unified-gateway.md` mục "Thiết kế (cập nhật…)" + GĐ1/GĐ Telegram+Workspace đã làm (chưa commit, đừng revert).
- Bảng action: `packages/shared/src/orreryApi.ts` thêm `ORRERY_ACTIONS` (tên action, nơi chạy `page|desk|main`, nguồn được phép, sanitize args → typed hoặc lỗi), `OrreryCaller {source, pane?, token?}`, `OrreryResult`/`OrreryError`.
  Nguồn được phép giữ đúng hiện tại (vd hand_back chỉ mcp từ pane deepseek; free_port có confirm; telegram_receive bật cần confirm).
- Kênh: thay `ccm:pane-open` + `ccm:mcp-call` (main→page) bằng `ccm:orrery` (giữ tên preload cũ làm wrapper nếu tiện; test cũ phải chạy). Phần Telegram inbound có thể giữ kênh `ccm:telegram-inbound` nhưng phía page phải đi qua cùng executor (`useOrreryApi.run(action,args,caller)`).
- Phạm vi file: apps/desktop/src/{orreryApi.ts(mới),main.ts,preload.ts,mcpDesk.ts}, apps/desktop/src/pty/{supervisor.ts,mcp.ts}, apps/web/src/{App.vue,composables/useMcpCalls.ts,composables/useOrreryApi.ts(mới),composables/useTelegramInbound.ts,lib/desktop.ts}, packages/shared/src/{orreryApi.ts,mcpCall.ts,index.ts}, tests tương ứng.
- Cấm đụng: apps/desktop/src/pty/{host.ts,presets.ts,shellInit.ts}, packages/shared/src/pty.ts, apps/desktop/src/pty/mcpTools/** (WP-2), stores/workspace.ts chỉ được thêm export nhỏ nếu bắt buộc (ghi báo cáo).
- Phụ thuộc: không | Song song: WP-3 | Worktree: không
- Model: opus (kiến trúc, IPC bảo mật, nhiều tầng)
- Tiêu chí:
  1. 1 dispatcher main + 1 executor page; không còn switch thao tác workspace thứ 2 ở main/page cho các action đã chuyển.
  2. Mỗi action có sanitize args + kiểm nguồn; nguồn sai → lỗi `source`.
  3. URL open, MCP open_session / notify_owner / open_in_workspace / who_is_editing / hand_back / run_* , Telegram new/resume/send/keys/tail/status chạy qua dispatcher/executor, hành vi + kết quả trả về giống cũ.
  4. typecheck sạch; test web/desktop pass (baseline web 1726, desktop 1273) + test mới cho dispatcher (nguồn, sanitize, route page/desk/main, lỗi timeout page).
- Lệnh test: `npm run typecheck`; `npm test -w @ccm/web`; `npm test -w @ccm/desktop`
- Nhìn thấy được: không
- Báo cáo: `.planning/wp/gw/WP-1-report.md`
## Nhật ký
- 2026-11-06 WP-1: shared ORRERY_ACTIONS + parsers (orreryApi.ts) → main dispatcher createOrrery/createPageAsker (desktop/src/orreryApi.ts) → main.ts/supervisor/preload sang `ccm:orrery` → web useOrreryApi + App/useMcpCalls/useTelegramInbound đăng ký handler → test mới; typecheck sạch, web 1729, desktop 1299.
