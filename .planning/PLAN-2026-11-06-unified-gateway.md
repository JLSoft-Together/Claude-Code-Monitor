# PLAN — Một cổng gọi chung cho thao tác session/pane (2026-11-06, NHÁP, chờ chủ nhân ok)

Yêu cầu (chủ nhân, Telegram): móc nối context menu, ORRERY_API, tool MCP `orrery`, bot Telegram vào **một cổng tương tác chung**;
không còn phân biệt session mở bằng `/new` của bot với session tự gõ `claude` trong pane (ví dụ, không phải phạm vi duy nhất).

## Hiện trạng (khảo sát 2026-11-06)
4 đường mở / điều khiển pane, mỗi đường tự làm một kiểu, cuối cùng mới gặp nhau ở `addPane`:
| Thao tác | Menu | MCP `orrery` | `agent-monitor://` | Bot Telegram |
|---|---|---|---|---|
| Mở pane agent | `workspace.launch` | `openFromAgent` + ticket | `openFromAgent` | `workspace.open` |
| Mint session id trước (`--session-id`) | không | **có** | không | không |
| Prompt | — | điền sẵn | bỏ qua | điền + **gửi** |
| Resume / kiểm "đang mở chỗ khác" | `open(…resume)` | cách 1 | cách 1 | **cách 2** (riêng) |
| Giới hạn | không | 20/phút/pane + tối đa 16 | 10/phút + hàng đợi | 20/phút/chat (không giới hạn số pane) |
| Compact / ✈ Telegram / đổi tên | 2–3 switch trùng nhau | — | — | — |

Lệch thật đang gây lỗi:
1. Gõ `claude` trong pane Shell: **không có tool MCP orrery** (không `--mcp-config`), không mint session id, đóng xong không resume được, restart/split/layout mở lại thành shell trống.
2. Pane mở bằng menu, URL hoặc `/new`: session id chỉ biết sau vài giây (watcher) → trong khoảng đó không nối Telegram được, không có mục ✈.
3. Logic tìm pane, tên pane, "session đã mở chưa", mã lỗi bị chép ở `useMcpCalls`, `useTelegramInbound`, `workspace.telegram*`.
4. Không có "orrery_api" bên ngoài: `ORRERY_API` chỉ là URL loopback của MCP `/mcp` (token theo pane).

## Thiết kế (cập nhật 2026-11-06 sau khi chủ nhân làm rõ: "API" = 1 cổng gọi chung cho mọi chỗ gọi, kể cả agent Claude/Codex)
- **Orrery API = 1 bảng action duy nhất** trong `packages/shared/src/orreryApi.ts`: tên action, schema tham số (sanitize), kết quả, mã lỗi chung `OrreryError`.
  Action: `session.open` (preset, cwd, resume, prompt, submit, name), `session.close`, `session.focus`, `session.rename`, `session.send` (chữ), `session.keys`, `session.compact`,
  `session.list`, `pane.split`, `workspace.show` (file/diff), `telegram.link`, `owner.notify`, `run.*`, `device.screenshot`, `layout.preview`, `port.*`…
- **1 dispatcher ở main** `apps/desktop/src/orreryApi.ts`: `call(action, args, caller)`; `caller = {source: menu|palette|mcp|url|telegram|shim, pane?, session?}`.
  Một chỗ quyết định: quyền theo nguồn (action nào nguồn nào được gọi), giới hạn tần suất + tối đa 16 pane, hộp xác nhận, cổng DeepSeek, mint session id, dock cạnh pane gọi, prompt gửi hay chỉ điền.
  Action cần trạng thái giao diện → chuyển sang **1 executor ở web** `composables/useOrreryApi.ts` qua 1 kênh IPC `ccm:orrery` (thay `ccm:pane-open`, `ccm:mcp-call`, phần page của `ccm:telegram-inbound`).
- **Mọi nguồn chỉ là adapter mỏng gọi `call`**:
  - Agent Claude / Codex (và DeepSeek khi bật): tool MCP `orrery` **sinh từ bảng action** (mỗi tool = 1 action, cùng tên/tham số) → thêm action mới là agent có tool ngay.
  - Bot Telegram: `/new`, `/resume`, `/send`, phím, `/tail`… → action tương ứng.
  - `agent-monitor://<action>?…` → action (giữ `open`, `focus`, `snooze`).
  - Menu chuột phải / palette ở web: `orrery.call(...)` qua IPC → cùng dispatcher, gộp 3 switch trùng.
- **Luôn mint session id trước** cho mọi lần mở Claude (ticket + `--session-id`): pane có id ngay, nối Telegram và ✈ dùng được ngay.
- **Gõ `claude` / `codex` trong Shell = gọi `session.open` nguồn `shim`**: thư mục shim đứng đầu `PATH` của pane shell, chạy CLI thật kèm config MCP orrery của pane + `--session-id`, báo dispatcher.
  → có đủ tool orrery, có session id, đóng xong resume được, restart mở lại `claude --resume`.
- Tìm pane / tên pane / "session đang mở?" / mã lỗi: 1 hàm dùng chung, adapter chỉ map lỗi sang toast, hộp thoại hoặc HTML Telegram.

## Giai đoạn
1. Bảng action + dispatcher main + executor web + kênh `ccm:orrery`; chuyển `session.open` / resume của 4 nguồn sang; mint id cho mọi lần mở. Test đơn vị dispatcher (quyền, giới hạn, lỗi) + e2e mở từ menu / MCP / URL / bot.
2. Tool MCP sinh từ bảng action (giữ tên tool cũ làm alias để skill/agent cũ không gãy); chuyển các tool page/desk/main hiện có sang dispatcher.
3. Shim `claude` / `codex` cho pane Shell.
4. Gộp switch context menu + Telegram `send`/`keys`/`tail`/`stop` sang action; tài liệu docs §11 mới + `.code_index`.

## Câu hỏi cho chủ nhân (đang giữ mặc định)
- (a) Shim `claude` trong pane Shell (gõ tay vẫn có tool orrery + resume) — mặc định: **làm**. Có tắt được trong Settings.
- (b) Prompt: bot `/new` vẫn **tự gửi**, MCP / URL vẫn **chỉ điền sẵn** (giữ ngoại lệ đã chốt docs §11x) — mặc định: giữ.
- (c) ĐÃ CHỐT: API = cổng chung, mọi nguồn (menu, bot, link, agent Claude/Codex qua MCP) gọi qua 1 dispatcher. Chưa mở HTTP/CLI riêng cho tool ngoài app — mặc định: để sau (thêm adapter là xong).
- (d) Sau khi gộp, có mở thêm thao tác cho bot / MCP (vd MCP `send_to_session`, `close_session`; bot `/compact`, `/close`) — mặc định: **để đợt sau**, đợt này chỉ chuẩn hoá.
- (e) Giới hạn chung (số pane tối đa 16 cho mọi đường, kể cả menu và bot) — mặc định: áp cho bot + MCP + URL, **không** chặn menu.
