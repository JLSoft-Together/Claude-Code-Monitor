# v49 — API mở session vào Workspace (agent tự mở pane)

> Trạng thái: **đã code** (2026-10-16) — spike §5 đạt, test desktop/web pass; chờ chủ nhân typecheck + chạy thử thật.
> Lệch nhỏ so với draft: `isPaneName` bắt buộc ký tự đầu là chữ/số; deeplink Windows bắt buộc có ổ đĩa; prefill chỉ khi session `idle` (không `waiting`), fallback 20 s chỉ khi chưa link / status unknown.

## 1. Vấn đề

Trong một pane Claude của Workspace, bảo Claude "mở thêm session" → Claude tự chạy `wt.exe` / `powershell` / `start claude` qua Bash tool → session mới nằm ở cửa sổ terminal ngoài, Workspace không quản lý được. Hiện chỉ tạo được pane qua nút `+` / split / layout / resume.

Lý do không "attach" được:

- Process đã chạy trong cửa sổ khác thì **không đưa được vào ConPTY/node-pty** của mình. Chỉ có cách để chính PTY host spawn nó.
- Pane mới luôn do **renderer khởi tạo**: `workspace.open/split` → `addPane` (state `starting`) → `TermPane` mở WS tới PTY host → `{t:'spawn'}` (`apps/web/src/stores/workspace.ts`, `TermPane.vue`, `apps/desktop/src/pty/host.ts`). Không có lối vào nào từ bên ngoài app.
- Lỗi phụ: `claude` do một pane Claude tự spawn sẽ **kế thừa `CLAUDE_CODE_CHILD_SESSION`** → không ghi transcript, không vào registry → Monitor không thấy (`docs/claude-code-integration.md:430`). Đi qua PTY host thì env sạch (`childEnv`).

## 2. Hạ tầng sẵn có (tái dùng được)

| Thứ | Ở đâu | Dùng cho |
|---|---|---|
| PTY host: HTTP server loopback (port ngẫu nhiên), WS `/pty` token + Origin + Host check | `pty/host.ts` | thêm route HTTP mới |
| Biết session nào là của pane nào (`sessions` map, `ownersOf`) | `pty/host.ts`, `pty/owners.ts` | xác định **pane gọi** |
| Env riêng cho pane (`childEnv`, `spec.env`) | `pty/presets.ts` | bơm URL + token |
| main ↔ page IPC có reply + timeout (`paneHandles` / `ccm:focus-reply`) | `main.ts`, `preload.ts` | mẫu cho `ccm:pane-open` |
| `workspace.open(preset, cwd, resume, {tab})`, `split`, `projectTab`, `dockSpot` | `stores/workspace.ts` | đặt pane mới cạnh pane gọi |
| "Send to agent" dán vào ô nhập, không Enter (`insertInto` → `term.paste`) | `TermPane.vue` | prefill prompt |
| Deeplink `agent-monitor://` (chỉ Windows packaged, chỉ `focus`/`snooze`) | `main.ts` `openLink`, `registerLinks` | mở rộng cho caller ngoài app |
| Claude CLI 2.1.289: `--mcp-config <file>` (có `${VAR}` / `${VAR:-x}`), `--session-id <uuid>`, `-n/--name` | `claude --help`, docs mcp.md / cli-reference.md | surface cho agent |

## 3. Đề xuất kiến trúc

```
claude (pane A) ──tool call──▶ PTY host  POST /mcp   (Authorization: Bearer <token pane A>)
                                  │ token → session A, rate limit, validate preset/cwd
                                  ▼ parentPort {t:'open', id, from:A, preset, cwd, name?}
                              main (PtySupervisor) ──IPC ccm:pane-open──▶ page
                                  page: pane có sessionId=A → split cạnh A (hết chỗ → tab mới cùng project)
                                        → reply ccm:pane-open-reply {ok, paneKey}
                              TermPane mới ──WS spawn {openId}──▶ PTY host (lấy prompt/name từ pending map)
                                  ▼
                              HTTP 200 {ok, sessionId (claude uuid), cwd, preset}
```

Nguyên tắc:

- **Endpoint ở PTY host**, không ở collector: host đã có session map (biết pane nào gọi → đặt pane mới cạnh nó), port loopback sẵn; collector giữ đúng vai "observe", và app key collector không bao giờ lọt vào pane (`CCM_*` bị strip).
- **Renderer vẫn là chủ layout**: host không tự spawn rồi bắt page adopt (tránh session mồ côi khi page reload / chưa mount Workspace). Page không trả lời trong ~3 s → `503 unavailable`.
- **Client không bao giờ gửi chuỗi lệnh**: prompt / name nằm trong pending map của host (TTL 30 s), WS `spawn` chỉ mang `openId` → giữ invariant của `PtyClientMessage`.

### 3.1 Env bơm vào mọi pane (`spawn` trong `host.ts`)

- `GOLAIM_API=http://127.0.0.1:<port>`, `GOLAIM_TOKEN=<32 byte hex, riêng từng session>` (map token → session; hết hiệu lực khi session exit/kill).
- `childEnv` strip thêm `GOLAIM_*` kế thừa: GolAIm dev (`npm run desktop:dev`) chạy từ trong một pane của bản packaged sẽ không gọi nhầm về bản packaged.
- Token chỉ qua env, **không qua argv** (command line đọc được bởi mọi process cùng user, collector cũng đọc command line codex).

### 3.2 Bảo mật endpoint

- Host header phải `127.0.0.1:<port>` (chống DNS rebinding) — như WS hiện tại.
- Request có header `Origin` → 403 (trình duyệt luôn gửi Origin khi POST cross-origin; process trong pane thì không).
- Bearer token so `timingSafeEqual`; sai → 401, không phân biệt "không tồn tại".
- Preset whitelist (`claude|codex|shell`), `cwd` qua `resolveCwd` (tuyệt đối, tồn tại, không UNC); mặc định = `liveCwd ?? cwd` của pane gọi.
- Giới hạn: `MAX_LIVE` 16 sẵn có + rate limit theo token (vd 3 lần / 60 s) chống agent loop mở pane liên tục; body ≤ 16 KB.
- Không có tham số flag/lệnh tự do. `name` chỉ `[\p{L}\p{N} ._-]{1,40}` (đi vào argv PowerShell 5.1 — tránh bug quoting `"` của PS 5.1).
- Không tăng quyền cho process trong pane (nó vốn tự chạy được `claude`); chỉ chặn caller ngoài pane (web page, app khác).

### 3.3 Surface cho agent — MCP qua HTTP (khuyên)

- Route `POST /mcp` trên PTY host, JSON-RPC tự viết (~100 dòng, không thêm dependency): `initialize`, `notifications/initialized` (202), `tools/list`, `tools/call`; trả `application/json` (không SSE), `GET` → 405.
- Tool `open_session`: `{ agent: 'claude'|'codex'|'shell', cwd?, name?, prompt? }` → `{ ok, sessionId?, cwd, preset }` hoặc lỗi `limit|cwd|rate|unavailable`. Description ghi rõ "dùng tool này thay vì mở cửa sổ terminal".
- Preset `claude` thêm `--mcp-config <dataDir>/golaim-mcp.json` (file tĩnh, ghi lúc host start):
  `{"mcpServers":{"golaim":{"type":"http","url":"${GOLAIM_API}/mcp","headers":{"Authorization":"Bearer ${GOLAIM_TOKEN}"}}}}`
  → chỉ Claude trong pane có tool; không đụng `~/.claude.json`, không làm noise cho session ngoài app.
- Claude tự hỏi "Allow mcp__golaim__open_session?" lần đầu → đó chính là bước xác nhận của chủ nhân, không cần thêm dialog native.
- MCP tool được defer sau tool search → gần như không tốn context.
- Preset `claude` cũng thêm `--session-id <uuid do host sinh>` → API trả luôn id session mới; pane biết `agentSessionId` ngay (restore/resume không phải chờ Monitor link). `-n <name>` nếu có.

### 3.4 Prompt ban đầu — 3 lựa chọn (xem §7)

- (a) Không nhận prompt.
- (b) **Điền sẵn, chủ nhân tự Enter**: chờ pane được Monitor link (claude đã lên, status idle) → `term.paste(prompt)` như "Send to agent". Không đi qua argv → không dính quoting PS 5.1, không dính prompt bắt đầu bằng `-`, không giới hạn 32 K command line.
- (c) Tự gửi (paste + Enter): tiện orchestration nhưng GolAIm trực tiếp đẩy prompt vào agent → tốn token ngay và lệch nguyên tắc "GolAIm không tự gửi prompt".
- Không dùng `claude "<prompt>"` qua argv: PowerShell 5.1 (preset dùng `System32\WindowsPowerShell`) không escape `"` khi truyền biến sang exe native → prompt chứa `"` có thể tách thành flag (vd `--dangerously-skip-permissions`).

### 3.5 Page (`stores/workspace.ts` + listener)

- `openFromAgent({ from, preset, cwd, openId, name })`: pane có `sessionId === from` → `dockSpot` trong tab của nó → split; không có chỗ → tab mới cùng project (`open(..., {tab:true})`); không thấy pane gọi → `open()` theo `projectTab(cwd)`.
- Mặc định **không cướp focus** (chủ nhân có thể đang gõ ở pane gọi); pane mới hiện ngay vì nằm trong tab đang xem. Workspace chưa mount (`workspaceOpened`) → bật view.
- Badge nhỏ "mở bởi <tên pane gọi>" trên header pane (tuỳ chọn).

### 3.6 Deeplink cho caller ngoài app (làm trong v49)

- `agent-monitor://open?agent=claude|codex|shell&cwd=<abs>` (`name` tuỳ chọn, cùng regex §3.2): **không** nhận prompt / resume (web page tạo được link), **luôn** `confirmBox` native "Mở Claude Code trong …?" (nút đầu = Mở, mặc định Huỷ). Không có pane gọi → page dùng `open()` theo `projectTab(cwd)`, bật Workspace, hiện cửa sổ.
- `openLink` hiện chỉ nhận `focus`/`snooze`: thêm nhánh `open` (không cần `k`, vì luôn confirm). Validate `cwd` ở main (`resolveDir`-like: tuyệt đối, tồn tại, không UNC) trước khi hỏi.
- Đăng ký scheme: Windows packaged đã có (`registerLinks`); macOS thêm `protocols: [{name, schemes: [agent-monitor]}]` trong `apps/desktop/electron-builder.yml` + `app.on('open-url')` (đăng ký **trước** `ready`, link lúc app chưa chạy đến qua sự kiện này chứ không qua argv); bỏ điều kiện `IS_MAC` trong `registerLinks`. Dev không đăng ký (giữ nguyên).
- Rate limit chung cho deeplink (vd 1 confirm đang mở tại một thời điểm, link tới khi đang confirm → bỏ) để web page không spam dialog.
- Agent trong Git Bash gọi kiểu `cmd //c start "" "agent-monitor://…"`, macOS `open "agent-monitor://…"` → ghi cách gọi vào docs.

### 3.7 Pha sau (không làm trong v49 trừ khi chủ nhân muốn)

- Codex pane: `codex -c mcp_servers.golaim.url=…` + `bearer_token_env_var=GOLAIM_TOKEN` (cần spike Codex 0.162).
- CLI `golaim open …` cho shell pane / script (cần runtime: `.cmd`+`.ps1` / sh, hoặc exe Electron với `ELECTRON_RUN_AS_NODE`).
- Claude gõ tay trong shell pane (không qua preset) không có `--mcp-config` → không có tool; giải bằng CLI ở trên hoặc đăng ký user-scope (đổi lại: session ngoài app báo MCP failed).

## 4. File dự kiến đụng

- `packages/shared/src/pty.ts`: `spawn` thêm `openId?`; type `PtyOpenRequest`/`PtyOpenResult`.
- `apps/desktop/src/pty/host.ts`: token map, route `/mcp` (+ `/v1/open` nếu làm CLI), pending map, rate limit, parentPort `open` ↔ `open-reply`.
- `apps/desktop/src/pty/mcp.ts` (mới): JSON-RPC handler thuần (test được).
- `apps/desktop/src/pty/presets.ts`: env `GOLAIM_*`, strip kế thừa, `--mcp-config` / `--session-id` / `-n` cho claude.
- `apps/desktop/src/pty/supervisor.ts`: relay `open` → main, ghi `golaim-mcp.json`.
- `apps/desktop/src/main.ts` + `preload.ts`: IPC `ccm:pane-open` / `ccm:pane-open-reply` (frame check như `paneHandles`); `openLink` nhánh `open` + `confirmBox`, `registerLinks` cả macOS, `app.on('open-url')`; chuỗi dialog trong `strings.ts`.
- `apps/desktop/electron-builder.yml`: `protocols` (scheme `agent-monitor`) cho bản mac.
- `apps/web/src/lib/desktop.ts`, `stores/workspace.ts` (`openFromAgent`), `App.vue` (listener), `TermPane.vue` (spawn với `openId`, prefill khi linked), i18n `en`/`vi`.
- Docs: `docs/claude-code-integration.md` mục mới (`--mcp-config`, env, MCP endpoint); `.code_index/desktop.md`, `web.md`, `protocol.md`, `_meta.md`.

## 5. Spike (đã chạy 2026-10-16, Claude 2.1.289, Windows 11)

1. ✅ `--mcp-config` file có `${GOLAIM_API}` / `${GOLAIM_TOKEN}` được expand (url + header đúng). Server JSON thuần (không SSE, không `Mcp-Session-Id`) → `/mcp` báo `✔ golaim 1 tool` (mục "Built-in MCPs").
   Trình tự client gửi: `server/discover` (probe, trả `-32601` vẫn OK) → `initialize` (`2025-11-25`) → `notifications/initialized` → `GET /mcp` (405 OK) → `tools/list`.
2. ⏭ Prompt "Allow mcp__golaim__open_session?" không spike (cần model gọi tool = tốn token); theo docs có. Lưu ý: máy chủ nhân đang `permissionMode: auto` → Claude có thể tự cho phép, chỉ còn rate limit chặn.
3. ✅ `--session-id` + `-n 'Spike Pane'` qua `-EncodedCommand` PowerShell 5.1: transcript `<uuid>.jsonl`, tên hiện ở viền ô prompt.

## 6. Test

- Unit desktop: `mcp.ts` (initialize / list / call / lỗi), token map + rate limit + Origin/Host reject, `presetCommand` có flag mới, `childEnv` strip `GOLAIM_*`.
- Unit web: `openFromAgent` (split cạnh pane gọi, hết chỗ → tab mới, không thấy pane gọi → projectTab, không đổi focus).
- Thủ công: trong pane Claude bảo "mở session Claude mới ở thư mục này" → pane mới cạnh pane gọi, Monitor thấy session.

## 7. Quyết định của chủ nhân (2026-10-16)

1. Surface cho agent: **MCP tool** `open_session` (§3.3). CLI để pha sau.
2. Prompt ban đầu: **(b) điền sẵn, chủ nhân tự Enter** (§3.4) — chỉ qua MCP, deeplink không nhận prompt.
3. Deeplink `agent-monitor://open`: **làm luôn** trong v49, Windows + macOS. Ban đầu luôn confirm native (§3.6); **2026-10-16 chủ nhân chọn tắt hẳn dialog** (đã được báo rủi ro: web page nào cũng gọi được link) → thay bằng hàng đợi 1-lúc-1 + giới hạn link/phút (`takeLinkSlot`). **Nới thêm (chủ nhân, 2026-10-16):** 10 link/phút; nhận `resume=<uuid>` (claude/codex) cả deeplink lẫn MCP để mở lại session dở: pane đang chạy session đó → focus; session còn sống ở terminal ngoài → từ chối `live`; vẫn không nhận prompt/name qua deeplink.
4. Xác nhận khi agent mở: **dựa vào prompt permission của Claude**, GolAIm không thêm dialog (chỉ rate limit).

## 8. Kiểm tra (2026-10-16)

- `npm run typecheck` sạch; vitest desktop / web / collector pass.
- E2E `apps/desktop/e2e/v49-open.cjs` (dev build, 31/31 PASS): shell pane gọi MCP bằng env của chính nó → pane Claude mới split cạnh, focus giữ nguyên, `--session-id` = id Monitor link, prefill dán vào ô nhập và agent vẫn `idle` (không gửi); gate 401/403/405/404; rate 3/phút; deeplink qua second instance mở pane không hỏi, bỏ qua `prompt`/`resume`, rate 3/phút; đóng pane kill hết process.
