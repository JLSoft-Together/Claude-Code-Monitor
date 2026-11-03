# WP-5 report — MCP preview_layout, list_servers, free_port

## Đã đổi
- **Tool mới** (`apps/desktop/src/pty/mcpTools/`): `previewLayout.ts`, `listServers.ts`, `freePort.ts` (schema + kiểm arg + rate + text). Chưa đăng ký: main thêm vào `index.ts` (dưới).
- **types.ts** (WP-1): `ToolHost.desk?` (tùy chọn, host thiếu → `unavailable`) + type `DeskAsk`.
- **Kênh mới main tự trả lời** (không qua page, vì cần layout daemon / resReport / confirm native và timeout dài):
  host `askDesk` → `{t:'mcp-desk', call}` → `supervisor.relayDesk` → `opts.onDesk` → main `desk` (`src/mcpDesk.ts` `createDesk`) → `{t:'mcp-reply'}` (dùng chung `mcpWaiters`) → host `parseMcpDeskResult`.
  Timeout host: free_port 10 phút (chờ chủ nhân bấm), còn lại 40 s. WP-4 có thể dùng chung kênh này (main quyết; hiện WP-4 đi qua `pageMcp`).
- `packages/shared/src/mcpDesk.ts` (mới, import tương đối, không export ở index): `McpDeskCall/Result`, `DESK_ERRORS`, `parseMcpDeskResult` (lọc control/bidi, giới hạn độ dài, cmd chỉ giữ khi `mine`).
- `pty/host.ts`: `askDesk`, `deskReplyMs`, `toolHost.desk` (gửi pid shell của pane + tên folder).
- `pty/supervisor.ts`: `onDesk`, `relayDesk`.
- `layout/ipc.ts`: `LayoutIpc.agentRender` + type `AgentRenderOutcome` (warm-up chỉ khi được gọi; peek 1.5 s rồi trả `starting` + `retryInSec` theo stage; không tải kit, không autoCompile/Gradle; slot `agent:<pane>`).
- `resources/agentPorts.ts` (mới): `paneScope`, `mineOf`, `serversFor`, `planFreePort`, `readProcRows`, `freePortText` (en/vi).
- `src/mcpDesk.ts` (mới): `createDesk` (preview: kiểm lại path trong cwd, lưu PNG vào capture `shots/` hoặc `%TEMP%/orrery-layout` giữ 20; list; free_port 1 confirm 1 lúc).
- `main.ts`: `resKill(sender, targets, ask?)` (câu confirm riêng cho agent, đường ccm:res-kill không đổi), `const desk = createDesk({...})`, `onDesk` trong `new PtySupervisor`.
- Docs: §11w đoạn "Main-side tools (v80 WP-5)"; codex-integration §8 thêm 1 dòng.

## Tool + schema
- `preview_layout {path (required), device?: phone|tablet = phone, theme?: light|dark = light}` → `{png, width, height, renderMs, frameworkOnly, diagnostics≤12}`; lỗi `starting` (+`retryInSec`), `not-layout`, `bundle-missing`, `jdk-missing|jdk-old`, `crash-loop`, `render-failed`, `too-large`… 10/phút/pane. readOnly.
- `list_servers {}` → `{at, servers[{pid,name,kind,ports,mine,cmd?(mine),idleSec,orphan}], outside[{port,name}]}`. 20/phút/pane. readOnly.
- `free_port {port: 1–65535 (required)}` → `{port, stopped[{pid,name}]}` hoặc `cancelled` (chủ nhân từ chối), `not-mine`, `outside`, `emulator`, `self`, `busy`, `gone`, `not-found`, `no-report`, `confirm-open`. 3/phút/pane. destructiveHint.

## Bảo mật
- Token per-pane + gate cũ; mọi arg kiểm ở host (port nguyên, enum device/theme, `resolveInside` realpath + đuôi .xml) và kiểm lại ở main (path trong cwd pane, `isLayoutTarget`, ≤1 MB).
- free_port: "mine" = pid trong cây process shell pane (bảng process đọc lúc gọi) | server của session agent có pid trong cây đó | cwd server trong folder pane (tắt luật này khi pane ở gốc ổ / home / cha của home). Một holder lạ → từ chối cả (không dừng một phần). Emulator, process session agent, shell pane, chính Orrery → từ chối. Chỉ server có trong report Resources (outside không bao giờ). Sau đó đi đúng `resKill` v76: kiểm pid + creation time (chống pid tái dùng), daemon bận 2 phút từ chối, confirm native **bắt buộc** (cửa sổ được show nếu đang ẩn), 1 confirm agent một lúc. E2E auto-yes chỉ khi `CCM_RES_FIXTURE` + `CCM_E2E_RES_CONFIRM=1` như cũ.
- list_servers: cmd (đã mask bởi collector) chỉ trả cho `mine`; server khác chỉ tên/kind/cổng; outside chỉ cổng + tên. Không env, không nội dung file.
- preview_layout: không bật JVM sẵn (lời gọi = tín hiệu), không tải 170 MB, không chạy Gradle; diagnostics 1 dòng ≤300 ký tự; PNG chỉ là file Orrery tự ghi.
- Không tool nào gửi/gõ prompt.

## Test số thật
- typecheck: desktop sạch, shared sạch. Web: lỗi ở `src/lib/mcpRun.ts` / `mcpRun.test.ts` (file WP-4 đang làm, không phải WP-5).
- vitest mới `apps/desktop/test/mcp-desk.test.ts` 12/12 (arg/rate/outside, starting text, parse lọc, scope tree/session/cwd + luật home/gốc ổ, planFreePort từ chối từng loại + không dừng một phần, createDesk confirm-open + chữ vi + cancelled + lưu capture/fallback, agentRender: starting khi JVM đang boot, không ensure khi không phải layout / thiếu kit, crash-loop).
- Liên quan (mcp-desk, mcp, mcp-tools, pty, layout, drawable, resources-kill, proc-table): 106/106.
- Toàn bộ desktop: 1105/1106; 1 fail `release-check.test.ts` timeout 5 s khi chạy cả bộ, chạy riêng 16/16 pass (flaky do tải, không liên quan).
- Không build / e2e (theo AGENT-RULES-v80).

## Hot file cần thêm
- `apps/desktop/src/pty/mcpTools/index.ts`:
  ```ts
  import { freePort } from './freePort'
  import { listServers } from './listServers'
  import { previewLayout } from './previewLayout'
  // thêm vào cuối MCP_TOOLS: ..., previewLayout, listServers, freePort
  ```
- (Tùy chọn) chuyển `freePortText` (`resources/agentPorts.ts`) vào `apps/desktop/src/strings.ts` (`agentFreePortTitle(pane, port)`, `agentFreePortDetail(lines)`, `agentFreePortConfirm`) nếu main muốn gom chuỗi native.
- Không có chuỗi web / i18n mới.

## Index (1–3 dòng)
- desktop.md: kênh `mcp-desk` (host `askDesk` → supervisor `relayDesk`/`onDesk` → main `desk` = `mcpDesk.ts` `createDesk`); tools `pty/mcpTools/{previewLayout,listServers,freePort}.ts`; `LayoutIpc.agentRender` (warm-up theo lời gọi); `resources/agentPorts.ts` (`paneScope`, `planFreePort`, `serversFor`); `resKill(…, ask)`.
- protocol.md: `packages/shared/src/mcpDesk.ts` (`McpDeskCall/Result`, `parseMcpDeskResult`).

## Changelog
- en: Agents in Workspace panes can render an Android layout to a PNG (preview_layout; the renderer starts only when asked), list the servers and ports agents started (list_servers), and free a port their own session or project holds (free_port, always after your confirm).
- vi: Agent trong pane Workspace có thể render layout Android ra PNG (preview_layout; trình render chỉ khởi động khi được gọi), xem server và cổng các agent đã mở (list_servers), và giải phóng cổng do chính session hoặc dự án của nó giữ (free_port, luôn hỏi chủ nhân trước).

## Ghi chú / mặc định đã chọn
- "Thư mục chụp của project": capture folder v76 là toàn cục (không theo project) → dùng `shots/` của nó; không có thì `%TEMP%/orrery-layout` (giữ 20 file mới nhất), không ghi vào cây project.
- Theme style: không nhận tên theme tự do (chỉ light/dark → night); theme lấy theo manifest như preview UI mặc định.
- Report Resources trễ tối đa 30 s: server vừa mở có thể chưa có (`not-found` nói rõ).
- Host timeout 10 phút cho free_port: nếu chủ nhân trả lời sau đó, process vẫn bị dừng nhưng agent đã nhận `unavailable`.

## Commit đề xuất
`🔌 v80 MCP tools preview_layout (layout daemon warmed by the call, PNG to the capture folder), list_servers and free_port (pane process tree / session / project only, one native confirm), main-side mcp-desk relay`
