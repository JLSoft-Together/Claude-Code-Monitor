# RESEARCH v54 — Main agent ↔ main agent: quan sát được gì, hiển thị thế nào (Monitor + Workspace)

Trạng thái: **nghiên cứu, chưa code** (2026-10-16). Chỉ đọc: bundle `claude.exe` 2.1.289, `sdk-tools.d.ts`, file thật dưới
`~/.claude` (không có `CLAUDE_CONFIG_DIR`), mã repo. Không gọi SendMessage / ListAgents, không mở `claude` / `codex`, không ghi
vào `~/.claude` / `~/.codex`. Trích record chỉ giữ tên field, dạng id, timestamp; mọi chuỗi nội dung thay bằng `"…"`.

Yêu cầu chủ nhân: main agent nói chuyện với nhau (A điều phối B và C, gửi / nhận) phải có hiệu ứng trên Monitor, **khác hẳn**
main → subagent; bổ sung: hiện cả ở **Workspace** (rail, header pane, thanh tab, Mission Control), **êm**, không loè loẹt, không
phá UI hiện tại.

Nhãn bằng chứng: **VERIFIED** (có đường dẫn / chuỗi / số đếm) · **UNVERIFIED** (suy ra, chưa thấy trên máy này).

---

## 0. Tóm tắt

| # | Cơ chế | Quan sát được? | Ghi chú ngắn |
|---|---|---|---|
| M1 | Nhắn tin giữa session cục bộ (`SendMessage` / `ListAgents`, named pipe) | **Có** (định dạng VERIFIED trong bundle; chưa có record thật trên máy này) | Bên nhận: `origin.from = "uds:<socket người gửi>"` → khớp `messagingSocketPath` trong registry → terminalId. Bên gửi: `toolUseResult.msg_id` ↔ `origin.msg_id` bên nhận để chống trùng |
| M2 | Agent teams / teammate | **Không** trên Windows; **một phần** trên macOS/Linux (tmux / iTerm2) | Teammate pane = process `claude --agent-id … --team-name … --parent-session-id <lead>`; hộp thư `teams/<team>/inboxes/<name>.json`. Không có thư mục `teams/` trên máy này, Agent tool không có tham số team |
| M3 | GolAIm `open_session` (v49) / `agent-monitor://open` | **Có** (dữ liệu sẵn trong page) | `PaneOpenRequest.from` = PTY session của pane gọi; hiện chưa lưu "ai mở ai" |
| M4 | Main chạy CLI khác qua Bash (`claude -p`, `codex exec`) | Codex: **có** (đã làm v16). `claude` lồng: **chỉ process** | `claude` con nhận `CLAUDE_CODE_CHILD_SESSION=1` → không transcript, không registry |
| M5 | Subagent (Agent/Task) — đối chứng | **Có** (đã hiện) | Dot xuống (giao) / lên (trả) trong `TreeEdge.vue`; thêm phát hiện: follow-up `SendMessage` tới subagent và hand-back `<agent-message>` chưa được animate |
| M6 | Remote Control / cloud / Desktop (`bridge:`, `did:`) | **Một phần** | Chỉ thấy một đầu (đầu ở máy này); để pha sau |

---

## 1. Nguồn bằng chứng

- CLI: `C:\Users\dauph\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\` — `package.json` `"version": "2.1.289"`,
  `bin/claude.exe` (Bun bundle, đọc chuỗi bằng `rg -a -o`), `sdk-tools.d.ts` (không có `SendMessageInput` / `ListAgentsInput`:
  hai tool này không thuộc bộ tool SDK công khai).
- Registry: `~/.claude/sessions/<pid>.json` (1 file sống lúc nghiên cứu; file `.key` cạnh nó **không đọc**).
- Transcript: quét toàn bộ `~/.claude/projects/**/*.jsonl` bằng script chỉ in tên field / độ dài / dạng id (`%TEMP%`-style
  `/tmp/ccm-research/*.cjs`, ngoài repo).

Số đếm thật (2026-10-16, mọi transcript còn giữ):

| Record | Số | Ý nghĩa |
|---|---|---|
| `origin.kind = "human"` | 2260 | prompt gõ tay |
| `origin.kind = "peer"` (`from` = id subagent 17 ký tự, `handback: true`) | 259 | **subagent → main** hand-back (`SubagentHandback`) |
| `origin.kind = "coordinator"` (trong `subagents/agent-*.jsonl`) | 42 | **main → subagent** (SendMessage tới subagent) |
| `origin.kind = "task-notification"` | 527 | thông báo task nền |
| `queue-operation` `enqueue` với `<agent-message …>` | 256 | hàng đợi hand-back |
| `tool_use` `SendMessage` | 43 | 42 `to` = id subagent, 1 `to = "main"` (subagent → main) |
| `tool_use` `ListAgents` | 1 | `D--work-android-WeJoy-SkyBeatFullModMusic/174aad95-….jsonl` (2026-09-28), kết quả liệt kê "Peer sessions (3)" |
| `<cross-session-message …>` thật | **0** | chuỗi này chỉ xuất hiện trong mô tả tool (deferred tools record) |

→ Máy này **chưa từng** có tin nhắn session ↔ session thật. Mọi định dạng M1 bên dưới lấy từ bundle; cần **P0 spike** (§10)
để xác minh trước khi code collector.

---

## 2. Bảng cơ chế

| # | Quan sát | Nguồn + field | Độ trễ | Khớp về terminalId GolAIm | Riêng tư | Công |
|---|---|---|---|---|---|---|
| M1 | Có | Bên gửi: transcript (main hoặc subagent) `tool_use` `SendMessage` + `toolUseResult {success, msg_id}`. Bên nhận: `queue-operation enqueue` (đầu thẻ `<cross-session-message from="…">`) + `user` record `origin {kind:'peer', from, msg_id?}`. Registry `messagingSocketPath` | Watcher `projects/` (debounce 150 ms, `monitor.ts:794`) → ~0,2–0,5 s | `origin.from` (bỏ `uds:`, decode `%XX`) = `messagingSocketPath` của 1 registry record → `pid:procStart`. `msg_id` gộp 2 đầu. Không dùng `to` (tên có thể trùng) | Thân tin: `origin.body`, `message.content`, input `message`/`summary`/`content` — **không bao giờ** đọc ra ngoài hàm parse. Socket path chỉ giữ dạng hash trong RAM | M (collector) + M (UI) |
| M2 | Win: không. mac/Linux tmux: một phần | `teams/<team>/config.json` (`leadSessionId`, `members[] {agentId, name, backendType, tmuxPaneId, cwd}`), `teams/<team>/inboxes/<name>.json` (`from`, `timestamp`, `read`, `msg_id`, `text`), cmdline `--parent-session-id` | fs.watch | `leadSessionId` = `claudeSessionId` của lead; teammate qua `--agent-id` trên cmdline (process table) | Inbox chứa `text` → chỉ đọc `from/timestamp/read/msg_id` | L, để sau |
| M3 | Có | `PaneOpenRequest.from` (PTY session pane gọi) → `openFromAgent` (`stores/workspace.ts:651`) | Tức thì (trong page) | Pane gọi + pane mới đều link terminal qua `useWorkspaceLinks` | Prompt mở pane không bao giờ lưu | S |
| M4 | Codex có; `claude` lồng chỉ process | Codex: `docs/codex-integration.md` §4. `claude` lồng: process table (`claude.exe` có tổ tiên là pid Claude đang theo dõi, không có registry) | Quét process 5 s | Tổ tiên pid | Chỉ tên exe / cờ `-p` | M, để sau |
| M5 | Có | `subagents/*.meta.json` + notification (đã có) | như cũ | như cũ | như cũ | — |

---

## 3. Chi tiết

### 3.1 M1 — nhắn tin giữa session cục bộ

**Bật hay không trên máy này — VERIFIED.**
- Registry session sống có `peerProtocol: 1`, `peerFeatures: ["notify_idle","artifact_yield"]`, `messagingSocketPath:
  "\\.\pipe\LOCAL\cc-msg-…"` (đã ghi ở docs §2, xác nhận lại hôm nay).
- `SendMessage` có trong `deferred_tools_record` của các session (input schema: `to`, `message`, `summary`, `notify_when_idle`;
  required `to`, `message`).
- `ListAgents` (alias cũ `ListPeers`) — bundle: *"Lists agents you can SendMessage to — in-process subagents you spawned, the
  teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud …"*. Lần gọi
  thật duy nhất trả về dạng:
  ```
  <name> [<ref>] — the name other sessions use to message it …
  Subagents (1):
    a<16 hex>  ·  general-purpose  ·  completed  ·  started <t> ago
  Peer sessions (3):
    <name> [<ref>]  ·  interactive  ·  shell|idle  ·  started <t> ago
  ```
  → danh sách peer cục bộ = registry (`kind`, `status`). Hàm `listLivePeerSessions` (`$Wr`) đọc registry, lọc record có
  `sock` (= `messagingSocketPath`), bỏ chính mình, bỏ `spare` / `parkedJobId`.

**Địa chỉ — VERIFIED (bundle).** Tên session là địa chỉ (`to: "<name>"`, thêm `" [ref]"` khi trùng tên). `ref` = tiền tố hash
`R("session", <stableId>)`; không cần tái tạo (UNVERIFIED hàm hash `on`). Địa chỉ thô: `uds:<socket>`, `bridge:<id>`, `did:…`
(regex `^(?:uds|bridge|did):[A-Za-z0-9%:_/.\\-]{1,200}$`). `fz(sock) = "uds:" + percent-encode(ký tự ngoài [A-Za-z0-9:_/.\\-])`
→ trên Windows `from` ≈ `uds:\\.\pipe\LOCAL\cc-msg-…` nguyên văn.

**Bên gửi (transcript của người gửi).**
```jsonc
// assistant — VERIFIED dạng (main và subagent đều gọi được)
{"type":"assistant","timestamp":"…","message":{"content":[{"type":"tool_use","id":"toolu_…","name":"SendMessage",
  "input":{"to":"…","summary":"…","message":"…","type":"message","recipient":"…","content":"…"}}]}}
// `type/recipient/content` do Claude Code tự thêm (backfillObservableInput: content = 50 ký tự đầu của message) — KHÔNG đọc.

// user (tool_result) — tới subagent của mình: VERIFIED thật (35 lần)
{"type":"user","toolUseResult":{"success":true,"message":"…","pin":{"id":"a…","name":"…","ref":"…"}}}
{"type":"user","toolUseResult":{"success":true,"message":"…","resumedAgentId":"a…","pin":{…}}}
// tới session cục bộ: VERIFIED bundle (nhánh `scheme==="uds"` và nhánh tên → `kind:"local-session"`)
{"type":"user","toolUseResult":{"success":true,"message":"…","display":"…","msg_id":"…"}}
{"type":"user","toolUseResult":{"success":false,"message":"…"}}            // gửi lỗi (session đã thoát, bận…)
```
Phân loại ở collector: kết quả có `pin` / `resumedAgentId` → subagent (M5); có `msg_id` → peer; `to` khớp `^a[0-9a-f]{16}$`
hoặc `to === "main"` → nội bộ session.

Subagent gửi: *"if you are a subagent, your send goes out under your parent session's address"* (bundle) → bên nhận chỉ biết
session; bên gửi biết đúng agent (tool_use nằm trong `subagents/agent-<id>.jsonl`) → glyph có thể xuất phát từ pill.

**Vận chuyển — VERIFIED bundle.** `sendToUdsSocket` (`DBt`): payload `{msg_id, type:"user", message:{role:"user", content:
<phong bì>}, priority:"next", from:"uds:<socket mình>", from_plugin?, file_attachments?}` ghi vào named pipe / unix socket của
người nhận; trả `{msgId}` → `toolUseResult.msg_id`. Có giới hạn nhịp (`paced`), biên nhận (`held` / `dropped` / `coalesced` /
`expired` / `refused`).

Phong bì (hàm `X`/`tet`):
```
<cross-session-message from="uds:…" [from-session="…"] [hop-chain="<hex24>,…"] [from-name="…"] [from-mode="bypass|prompting"] [from-plugin="…"]>
…
</cross-session-message>
```

**Bên nhận — VERIFIED bundle, UNVERIFIED trên đĩa.** Tin vào hàng đợi với `origin = {kind:"peer", from, verifiedPeerPid?,
verifiedPeerProcStart?, selfSent?, msg_id?, plugin?, name?, fromSession?, hopChain?, fromMode?, body}`, `isMeta: true`,
`skipSlashCommands`. Theo mẫu hand-back thật (cùng đường `origin.kind:"peer"`), transcript sẽ có:
```jsonc
{"type":"queue-operation","operation":"enqueue","timestamp":"…","content":"<cross-session-message from=\"uds:…\" …>…"}
{"type":"user","isMeta":true,"turnOrigin":"peer","promptSource":"system","timestamp":"…",
 "origin":{"kind":"peer","from":"uds:…","msg_id":"…","name":"…","body":"…"},"message":{"content":"<cross-session-message …>…"}}
// nhận giữa lượt (receiver đang bận): `queue-operation remove` (reason absorbed_mid_turn) + `attachment` `queued_command`
// {prompt, source_uuid, delivery_id, commandMode:"prompt", origin:{…}, isMeta:true}
```
- `verifiedPeerPid` / `verifiedPeerProcStart`: *"Absent when unverifiable (Windows, non-UDS ingress)"* → **trên Windows không
  có**; trên mac/Linux có thì khớp thẳng `pid:procStart` (định danh terminal của GolAIm).
- `from` do người gửi tự khai (*"a label, not an identity proof"*) → đủ cho hiển thị, ghi rõ trong docs.
- Tin bị giữ (khác permission mode, `crossSessionInbound` setting): bên gửi nhận `[Cross-session delivery notice] … held /
  denied / expired / delivered / refused / dropped …` (VERIFIED chuỗi). Bên nhận có SDK event `system/peer_message_hold`
  (`@internal`, stream-JSON) — ghi gì vào transcript: UNVERIFIED.
- `notify_when_idle`: người nhận báo lại khi rảnh (`[peer-idle]`, `orig_msg_id`, `state`) — hình dạng trong transcript người
  gửi: UNVERIFIED.

**Phân biệt với giao tiếp trong session (đều VERIFIED thật):**

| Record | `origin.from` | Khác |
|---|---|---|
| Hand-back subagent → main | id subagent `a<16 hex>` | có `senderTaskId`, `handback: true`; thẻ `<agent-message from="a…">` |
| Main → subagent | — | `origin.kind: "coordinator"`, nằm trong `subagents/agent-*.jsonl` |
| Session ↔ session | `uds:…` / `bridge:…` / `did:…` / `unknown` | thẻ `<cross-session-message>` |

**Khớp terminal.** Collector đã đọc registry (whitelist trong `registry.ts`). Thêm: đọc `messagingSocketPath`, giữ
`sockKey = sha256(lowercase(path)).slice(0,16)` trên tracker, không lưu path, không gửi đi. `from` → bỏ `uds:` → decode →
`sockKey` → tracker → `terminalId`. Session đã `/clear` vẫn cùng process → cùng socket → cùng terminal (tốt). Không khớp
(session ngoài máy, đã thoát, `unknown`) → chỉ hiện một đầu: "Tin từ một session khác".

**Độ trễ.** Bên gửi ghi tool_result ngay sau khi ghi pipe; bên nhận ghi `enqueue` lúc tin tới. Cả hai qua watcher 150 ms +
batch store 50 ms → thường tới UI trong cùng 1–2 batch (< 1 s).

### 3.2 M2 — Agent teams / teammate

- VERIFIED bundle: file team `<claudeRoot>/teams/<team>/config.json` = `{name, createdAt, leadAgentId, leadSessionId, members:
  [{agentId, name, agentType, joinedAt, tmuxPaneId, cwd, subscriptions, backendType}]}`; hộp thư
  `teams/<team>/inboxes/<agent>.json` (`TeammateMailbox`, phần tử `{from, text, timestamp, color, summary?, msg_id, type:
  "message", read}`); tin tới agent dạng `<teammate-message teammate_id="…" …>`.
- `backendType`: `in-process` (teammate chạy **trong** process lead — giống subagent, không phải main ↔ main) hoặc pane
  (`zBt`: chỉ `tmux` / `iterm2`) → process riêng `claude --agent-id <id> --agent-name <n> --team-name <t> --parent-session-id
  <uuid lead>`.
- Trên máy này: không có `~/.claude/teams` / `~/.claude/tasks`; `TeamCreate` / `TeamDelete` nằm trong danh sách tool cũ
  (`s_e`); `prompt_snapshot` cho thấy Agent tool chỉ có `description, prompt, subagent_type, model, isolation` (không có
  tham số team). → **Không dùng được trên Windows bản này**. Ghi để làm sau cho macOS (tmux / iTerm2): link lead ↔ teammate
  qua `leadSessionId` + `--parent-session-id`, tin qua mtime/`read` của inbox.

### 3.3 M3 — GolAIm `open_session` / `agent-monitor://open`

- VERIFIED code: `apps/desktop/src/pty/host.ts:445` `askPage({ id, from: s.id, preset, cwd, prompt, resume })` (`s` = pane gọi,
  theo bearer token của pane); `apps/web/src/stores/workspace.ts:668` tìm pane gọi bằng `sessionId === req.from` rồi split cạnh
  nó. Deeplink không có `from` (người gọi ngoài app).
- Chưa lưu quan hệ. Đề xuất: `Pane.openedBy?: string` (key pane gọi; runtime + sessionStorage như `resume`), không gửi
  collector. Khi cả hai pane đã link terminal → link `opened` (A mở B). Cùng với M1, đây là dữ liệu tốt nhất để suy ra
  "A điều phối B, C" (kịch bản chủ nhân: A mở B, C bằng `open_session` rồi `SendMessage` cho chúng).
- Prompt mở pane chỉ được dán sẵn, không gửi — không coi là "tin nhắn"; hiện như quan hệ "được mở bởi".

### 3.4 M4 — CLI lồng qua Bash

- Codex: đã có (`apps/collector/src/codex/link.ts`, docs codex §4) → hiện như **agent con** trong cây Claude (pill + cạnh
  `agent-codex`). Giữ nguyên: đó là quan hệ giao việc, không phải hai main ngang hàng.
- `claude` lồng: VERIFIED bundle — env cho tool Bash (`QUe`): `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID=<session cha>`,
  `CLAUDE_CODE_CHILD_SESSION=1`, `CLAUDE_PID=<pid cha>`. `claude` con thấy marker (không TTY / `-p`, không phải teammate) thì
  tắt lưu session ("Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker", docs §11o mục 2) → không registry,
  không transcript. Chỉ thấy qua process table (`claude.exe` có tổ tiên là pid Claude đang theo dõi). Có thể hiện "đang chạy
  `claude` con" + thời gian, không trạng thái / token. Để pha sau, tái dùng khung `codex/processes.ts`.

### 3.5 M5 — Subagent (đối chứng) + phát hiện phụ

- Hiện có (v53): cạnh "lược" xám đặc, dot tròn chạy **xuống** (màu `st-working`, khi sub mới) và **lên** (`st-done`, khi sub
  xong), pill co thành chấm bay vào khay (`TreeEdge.vue`, `AgentMap.vue`).
- Phát hiện: main gửi tiếp cho subagent (`SendMessage to: a…` → `origin.kind:"coordinator"` trong transcript sub, 42 lần) và
  hand-back giữa chừng (`<agent-message>`, 259 lần) hiện **không** có dot. Cùng bộ parse v54 có thể bắn dot xuống / lên có sẵn
  cho hai sự kiện này — tăng tương phản "trong cây = dot tròn dọc" vs "giữa session = phong thư theo cung".

### 3.6 M6 — Khác

- Remote Control / cloud / Claude Desktop: địa chỉ `bridge:` / `did:` / `from-session="local_<uuid>"`. Một đầu ngoài máy → chỉ
  hiện ở đầu cục bộ ("gửi ra ngoài máy" / "tin từ ngoài máy"). Để pha sau.
- Job nền (`jobs/<id>/state.json`): có key `children` (chưa đọc, nội dung UNVERIFIED) — không thuộc v54.

---

## 4. Protocol đề xuất (`packages/shared`)

Theo kiểu hiện có: snapshot + `created/updated/removed`, field lạ bị bỏ qua, **không bao giờ** có nội dung tin.

```ts
export type PeerLinkKind = 'message' | 'opened'          // 'opened' chỉ sinh ở web (M3), collector chỉ phát 'message'
export interface PeerLink {
  id: string                 // `${a}>${b}` theo thứ tự terminalId nhỏ → lớn (một link cho cả hai chiều)
  kind: PeerLinkKind
  a: string                  // terminalId
  b: string                  // terminalId
  ab: number                 // số tin a → b
  ba: number                 // số tin b → a
  firstAt: string
  lastAt: string
  lastDir: 'ab' | 'ba'
  lastAgentId?: string       // agent gửi tin cuối (main hoặc subagent) — để glyph xuất phát từ pill
  held?: number              // pha sau: tin đang bị giữ chờ duyệt
}
// MonitorEvent
| { type: 'link.created'; payload: PeerLink }
| { type: 'link.updated'; payload: Patch<PeerLink> }
| { type: 'link.removed'; payload: { id: string } }
// MonitorSnapshot.peerLinks?: PeerLink[]
// ActivityKind + 'peer.message'  (terminalId = người gửi, data.title = tên người gửi, data.to = tên người nhận)
```

- Hiệu ứng suy ra từ **tăng số đếm** (`ab`/`ba` tăng ở `link.updated`) — giống `TokenCount` bắt số tăng; snapshot / resync
  không animate. Tăng nhiều trong một batch = một glyph "×N".
- Một đầu không khớp terminal (ngoài máy / đã thoát): không tạo link; chỉ activity `peer.message` với `data.to`/`data.title`
  là nhãn (`from-name` đã sanitize ≤ 80 ký tự, giống alias) — terminalId thiếu.
- `store.ts` `coalesce` áp như terminal/agent; `removed` khi một đầu bị `forget` hoặc hết TTL.

---

## 5. Collector

| Việc | File | Ghi chú |
|---|---|---|
| `sockKey` | `registry.ts` | Đọc `messagingSocketPath` (string ≤ 300), trả `sockKey` hash; `RegistryRecord` **không** có path |
| Signal mới | `transcript.ts` `extractSignals` | `peer_out {toolUseId, at}` (tool_use `SendMessage`, **không** đọc input ngoài kiểm `to` khớp id agent / `"main"` → bỏ), `peer_sent {toolUseId, msgId?, ok}` (tool_result của id đó; `toolUseResult.msg_id` regex `^[A-Za-z0-9_-]{8,64}$`, có `pin`/`resumedAgentId` → bỏ), `peer_in {fromKey?, msgId?, at, via}` (`queue-operation enqueue` đầu chuỗi `<cross-session-message ` → regex thuộc tính `from="…"` trong 400 ký tự đầu; `user` có `origin.kind==='peer'` và `from` bắt đầu `uds:` → `origin.msg_id`). Chỉ tính hash của địa chỉ, không giữ chuỗi |
| Thu thập | `tracker.ts` | `peer_out/peer_sent` từ main **và** mọi transcript subagent (gắn `agentId`); `peer_in` chỉ ở main transcript (tin tới session) |
| `PeerLinkStore` mới | `peers.ts` | Chống trùng: `msg_id` (gửi ↔ nhận); không `msg_id` → `(fromKey, receiver)` trong 10 s gộp enqueue + user record. Tin chỉ có đầu gửi (`peer_sent ok` có `msg_id`) chờ 5 s đầu nhận rồi phát activity một đầu. TTL: link bỏ sau 60 phút không có tin (`CCM_PEER_TTL_MIN`) hoặc khi một terminal bị gỡ |
| Catch-up | `monitor.ts` | Đọc lại transcript lúc khởi động → dựng link có `lastAt` trong TTL, **không** activity, không animate (giống tool spans) |
| Wiring | `monitor.ts`, `store.ts`, `index.ts` | `sockKey → terminalId` từ tracker live; `store.upsertLink/removeLink`, snapshot `peerLinks` |
| Demo | `scripts/demo-fixture.mjs` `--peers=N` | Ghi record giả (nội dung rỗng) để test UI không tốn token |

Riêng tư: thân tin nằm trong `origin.body`, `message.content`, input `message/summary/content`, `toolUseResult.message/display`
— parse JSON dòng là bắt buộc (như hôm nay với `user`), nhưng không field nào trong số đó rời hàm `extractSignals`. Docs §9
thêm `messagingSocketPath` (hash trong RAM), `origin.body`, `from-name` (nhãn, sanitize).

Hiệu năng: không đọc thêm file; chỉ thêm kiểm chuỗi trên dòng `user` / `queue-operation` đã được parse.

Test: `test/peers.test.ts` (dedupe msg_id, gộp 10 s, TTL, một đầu), `test/units.test.ts` (signal từ record giả cả 3 loại
`origin.from`: id agent / `uds:` / `unknown`), `test/monitor.test.ts` (2 registry giả có `messagingSocketPath`, transcript giả).

---

## 6. UI Monitor (Agent Map)

### 6.1 Ngôn ngữ hình ảnh — khác main → sub ở mọi chiều

| Chiều | Main → sub (v53, giữ nguyên) | Session ↔ session (v54) |
|---|---|---|
| Đường | Cạnh "lược" vuông góc, xám đặc, **trong** một cây | **Cung cong** nối mép **trên** hai card main, nét đứt 1px `ink-faint` (quan hệ), đi **trên** hàng card, nằm dưới node |
| Vật chạy | Dot tròn 3,5px, màu lifecycle | **Phong thư** 10×7 (rect bo 1.5 + nét chữ V), màu role mới `peer` |
| Hướng | Dọc: xuống = giao, lên = trả | Theo cung: người gửi → người nhận, chạy cả hai chiều |
| Phản ứng đầu cuối | Pill bật ra / bay vào khay | Card nhận: **một** vòng sáng `peer` (2px, nở 0→4px, mờ dần, 600 ms); dòng 3 crossfade "✉ Tin từ A" 8 s. Card gửi: dòng 3 "→ Đã gửi cho B" 4 s |
| Tồn tại | Theo vòng đời sub | Cung xám còn khi link "ấm" (≤ 15 phút từ tin cuối), sau đó mờ đi (fade, không phải xoá); session bị gỡ → cung tan cùng bụi Thanos của card |
| Màu | Status (lifecycle) | `peer` chỉ trên glyph + vòng + cung **lúc tin đang chạy** (stroke chuyển `peer` rồi về `ink-faint` sau 1,2 s); quan hệ tĩnh luôn xám |

Dấu ấn duy nhất của v54: **phong thư bay theo cung giữa hai card**. Mọi thứ khác im.

### 6.2 Phác hoạ

```
            ╭──────────── ✉ ──────────────╮            ← cung đứt xám; phong thư `peer` đang bay A → B
            ╎                              ╎
 ┌──────────┴────────────┐       ┌─────────┴────────────┐       ┌──────────────────────┐
 │ ✳ A coordinator  Work…│       │ ✳ B api        Working│       │ ✳ C web          Idle│
 │ Opus · ◔12% · 80K ✉ 2 │       │ Opus · ◔30% · 41K    │       │ Opus · ◔8%  · 12K    │
 │ → Đã gửi cho B · 2s   │       │ ✉ Tin từ A            │◜◝     │ Edit · 14s           │
 └──────────┬────────────┘       └──────────┬───────────┘ vòng  └──────────┬───────────┘
            │ (cây sub như v53)             │              1 lần           │
     (✳ Explore · Grep)              (✳ Plan · Read)                 (✳ general · Bash)
            ╰───────────────────────────────────── ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ╯   ← A↔C: chỉ còn sợi xám (ấm)
```
- `✉ 2` ở dòng 2 card A: chip "Điều phối 2" (glyph `Network` + số, `ink-muted`) khi A gửi tới ≥ 2 session trong cửa sổ ấm;
  1 peer → "✉ B" (tên rút gọn). Tooltip: "Gửi cho B, C · nhận từ B". Không có chip cho người nhận (dòng 3 tạm thời đủ).
- Cung: điểm neo trên card (người gửi dùng 1/3 phải, người nhận 1/3 trái → hai chiều không chồng), chiều cao vòm
  `clamp(24, 0.15·dx, 72)` px trên đỉnh card cao hơn; khác hàng → bezier từ đỉnh A tới đỉnh B (cắt qua hàng trên là chấp nhận
  được vì cung nằm dưới node). Edge type mới `peer` (`PeerEdge.vue`), handle ẩn ở mép trên `MainNode` (khung tĩnh như handle
  v53), đường tính bằng hàm thuần `peerPath` trong `lib/layout.ts` (test được).
- Nhiều tin: mỗi link mỗi chiều tối đa 1 phong thư đang bay; tin tới trong lúc bay gộp thành nhãn "×N" ở phong thư kế; toàn map
  ≤ 6 vật chạy cùng lúc (chung hạn mức với dot giao/trả); quá thì chỉ tăng số.
- Hover / focus cung: hiện badge giữa cung "A → B 3 · B → A 1 · 2 phút trước" (`tabular-nums`).

### 6.3 Trường hợp khó

| Tình huống | Hành vi |
|---|---|
| Card nhận ngoài viewport | Capsule nhỏ ở mép canvas theo hướng card: "✉ Tin từ A ↗" 6 s; bấm = `flyTo` card. Cả hai ngoài màn → chỉ activity + live region |
| Tab một session (`AgentMap` có `terminalId`) | Không vẽ peer khác; card main có chip "✉ B, C" (bấm = mở tab session đó); vòng sáng + dòng 3 vẫn có |
| Người gửi là subagent | Phong thư xuất phát từ pill (`lastAgentId`), chạy lên trunk rồi theo cung |
| Người nhận đang `waiting` (cần chủ nhân) | Dòng 3 giữ lý do chờ (ưu tiên cao hơn); vẫn 1 vòng `peer` + tooltip |
| Một đầu ngoài máy / đã thoát | Không cung; dòng 3 "→ Đã gửi ra ngoài máy" / "✉ Tin từ một session khác" |
| Tin bị giữ (pha sau) | Phong thư dừng giữa cung, glyph đồng hồ nhỏ, nhãn "Chờ duyệt bên B" |
| Reduced motion | Không phong thư, không vòng, không nở cung; chỉ đổi màu/opacity (cung `peer` → xám) + dòng 3 crossfade; chip giữ |
| Bàn phím / screen reader | Live region polite (một cho map): "B nhận tin từ A" — gộp theo cặp mỗi 10 s ("…3 tin"); menu chuột phải card có "Đi tới B" / "Đi tới A"; cung không nhận focus (chip trên card là đường bàn phím) |
| Activity feed | Kind `peer.message`: glyph `Mail` `peer` + "A → B" |

### 6.4 Nhóm điều phối (tuỳ chọn)

Có thể xếp B, C ngay phải A (theo thành phần liên thông, người gửi nhiều nhất đứng đầu) để cung ngắn. Nhưng làm card **nhảy chỗ
khi có tin** — trái nguyên tắc êm. Đề xuất mặc định **không** tự xếp; thêm nút toolbar "Gom session đang trao đổi" (tắt sẵn).
→ Câu hỏi Q2.

---

## 7. UI Workspace

Nguyên tắc (chủ nhân): **êm**. Không tô nền, không nhấp nháy lặp. Chỉ: glyph `Mail` 12px màu `peer` + chữ ngắn màu ink trong
**ô chữ có sẵn**, cộng **một** vạch sáng 2px ở mép trái hàng / mép trên header, chạy một lần (900 ms = `--ccm-dur-signal`).
Status colours giữ cho lifecycle.

### 7.1 Chữ trạng thái (dùng chung Monitor + Workspace)

| Trường hợp | en | vi | Thời gian |
|---|---|---|---|
| Gửi | Sent to {name} | Đã gửi cho {name} | 4 s |
| Gửi nhiều | Sent to {n} sessions | Đã gửi cho {n} phiên | 4 s |
| Nhận | Message from {name} | Tin từ {name} | 8 s |
| Hai chiều trong 30 s | Talking with {name} | Đang trao đổi với {name} | 8 s |
| Ngoài máy / không rõ | Sent outside this machine · Message from another session | Đã gửi ra ngoài máy · Tin từ một session khác | như trên |
| Chip điều phối | Coordinating {n} | Điều phối {n} | khi link ấm |
| Mở bởi (M3) | Opened by {name} | Được mở bởi {name} | 8 s sau khi mở + tooltip khi ấm |
| Live region | {to} got a message from {from} | {to} nhận tin từ {from} | — |

Rút gọn khi hẹp: "→ {name}" / "← {name}" / "⇄ {name}" (glyph luôn có, `aria-label` giữ câu đầy đủ). Glyph: `Mail` (nhận /
chung), `Send` (gửi), `ArrowRightLeft` (hai chiều), `Network` (điều phối) — lucide 0.544 có đủ.

### 7.2 Thứ tự ưu tiên trong một ô (rail dòng 2, header chip, dòng 3 card)

`failed` / `asked` (cần chủ nhân) **>** tin peer (trong cửa sổ) **>** tool đang chạy · thời gian **>** chữ trạng thái.
Khi cần-chủ-nhân thắng: tin peer xuống thành **badge glyph** 8px góc trên-phải icon hàng (cạnh badge status góc dưới-trái
đang có), tooltip có câu đầy đủ. Không latch: hết thời gian là thôi (khác `Pane.attention` waiting/done).

### 7.3 Rail

```
Người gửi                                      Người nhận                                   Cả hai
┃ ✳  A coordinator                  ✕          ┃ ✳  B api                                   ┃ ✳  B api
┃ ●  ➚ Đã gửi cho B, C · 3s                    ┃ ●  ✉ Tin từ A                               ┃ ●  ⇄ Đang trao đổi với A
↑ vạch 2px `peer`, chạy 1 lần rồi tắt          (dòng 2 trở về "Edit · 14s" sau 8 s)

Cần chủ nhân + có tin                          Group gập (RailGroupHead)                    Cụm project gập
   ✳  B api                                    ▦  claude-code-monitor   3 ⌄                 ▸ [dir] claude-code-monitor  ✉
 ⚠✉ Needs approval: Bash                         ✉ Tin từ A  (lead line)                    (glyph trong 8 s, tooltip)
 (✉ = badge 8px góc icon)
```
- `lib/rail/railModel.ts`: `RailRow.peer?: {dir: 'out'|'in'|'both', name: string, n: number, until: number}` từ store
  `peers` (theo `pane.terminalId`); `RailGroup.lead` chọn tin peer của member nếu không member nào cần chủ nhân; cụm project gập
  có cờ `peer` để vẽ glyph.
- `RailRow.vue`: dòng 2 dùng `Transition ccm-rail-word` sẵn có; vạch = `::before` inset-y 6px, `opacity` 0→1→0 (cho phép dưới
  reduced motion: chỉ opacity, giữ tĩnh trong cửa sổ thay vì chạy).

### 7.4 Header pane (TermPane, container query v52)

```
≥ 480px  │ ✳ Working  ✉ Tin từ A  │ main · +12 −3 │ …/repo        [⊞][⤢][✕]
< 480px  │ ✳ Working  ✉           │ …                               (chữ ẩn, aria-label giữ)
< 300px  │ ✳  ✉                    (glyph; trước khi thu chip status-label)
```
- Chip là `button`: bấm → focus pane bên kia nếu đang mở trong Workspace, không thì mở Monitor tại session đó
  (`ui.focusTerminal`). Một vạch 2px `peer` ở mép trên header chạy một lần.
- Thứ tự thu (thêm vào chuỗi v52): nhãn chip peer ẩn trước nhãn chip status; glyph peer ẩn sau cùng cùng nhóm split/close.
- Dim inactive (v52): lớp phủ chỉ trên thân terminal → header + chip không bị mờ. Không đổi.

### 7.5 Thanh tab, zoom, Mission Control

- Tab (`WorkspaceView` strip): pane trong tab **không** đang hiện nhận tin → glyph `Mail` 10px sau nhãn tab 8 s; tooltip tab
  thêm "Tin từ A · 1 phút trước" khi link ấm. Tab đang mở thì không cần (header đã có).
- Zoom: pane ẩn trong tab đang zoom nhận tin → chip "+N pane" có glyph `Mail` 8 s.
- Capsule project (`[data-strip-project]`, project khác): glyph nhỏ cạnh số "need you" 8 s, không cộng vào số need-you.
- Mission Control tile (`mission/MissionCard.vue`): cùng chip như header (đầu tile) + vạch mép trên một lần. **Không** vẽ đường
  nối giữa tile (Exposé dày đặc, sẽ rối). Bộ lọc Mission thêm khớp "đang trao đổi"? — không, giữ v52.

```
┌ 2  api ───────────────── ✉ Tin từ A ┐   ← tile: chip góc phải đầu tile, vạch `peer` mép trên chạy 1 lần
│ $ npm test                           │
│ …                                    │
└──────────────────────────────────────┘
```

### 7.6 Pane không mở trong Workspace

Session ở Windows Terminal / IDE (không có pane): rail không có hàng cho nó; hàng của đầu còn lại ghi tên theo `displayTitle`,
tooltip thêm "(ngoài Workspace)", bấm chip → Monitor. Cả hai đầu ngoài Workspace → chỉ Monitor.

### 7.7 Dữ liệu Workspace cần

- Từ collector: `PeerLink` (a, b, ab, ba, lastAt, lastDir, lastAgentId) — giống Monitor. Store web `stores/peers.ts`:
  `links`, `pulses` (từ số tăng), `recentOf(terminalId) → {dir, other[], n, until}` (cửa sổ 4 / 8 s), `warm(link)` (≤ 15 phút).
- Từ Workspace: `Pane.openedBy` → link `opened` (kind riêng, nét chấm, không đếm tin).
- Map terminal → pane: `workspace.panes.find(p => p.terminalId === id)` (đã có qua `useWorkspaceLinks`).
- `usePaneInfo` thêm `peerOf(pane)` để rail / header / Mission đọc cùng một nguồn (đúng tinh thần "một từ vựng trạng thái" v52).

---

## 8. Màu: role mới `peer`

Lý do cần màu riêng: status (cam / vàng / xanh lá / đỏ / xám) chỉ cho lifecycle; accent cho chọn / focus / hành động chính;
`agent-*` cho danh tính agent; `diff-*` cho thay đổi. "Có tin giữa hai session" không thuộc nhóm nào.

| Token | Light | Dark | Dùng cho | Không dùng cho |
|---|---|---|---|---|
| `peer` | `#a83279` | `#ff7ac6` | glyph `Mail`/`Send`, phong thư, vòng sáng card nhận, vạch 2px, cung **lúc tin đang chạy** | chữ dài, nền lớn, quan hệ tĩnh (dùng `ink-faint`) |
| `peer-soft` | `rgb(168 50 121 / .12)` | `rgb(255 122 198 / .18)` | nền badge nhỏ nếu cần (đi với chữ ink) | — |

Đo (WCAG): light `peer` trên surface 6.18 · raised 5.68 · canvas 5.24; dark 6.37 · 5.63 · 7.03 (≥ 4.5 nên cả chữ ngắn cũng
được); trên `peer-soft`: light 5.14 (trên nền surface) nhưng **4.41 trên canvas** → trên soft dùng chữ `ink` (13.98 / 10.11),
`peer` chỉ cho glyph. Trên well (#111113): dark 7.95, light 3.05 (đủ cho glyph ≥ 3:1).
Khoảng cách màu (ΔE Lab) tới role gần nhất: light 47 (agent-codex), dark 45 (agent-codex) / 50 (st-error) — không lẫn với Codex
(indigo), lỗi (đỏ) hay Claude (cam đất). Ứng viên khác đã loại: purple (ΔE 18 với codex), teal / mint (gần agent-browser /
done), pink chuẩn (ΔE 20–27 với st-error).
Theme v25 (`themes.css`): mỗi theme cần giá trị `peer` riêng; `lib/themes.test.ts` thêm kiểm glyph ≥ 3:1, chữ ≥ 4.5:1.
`COLOR-SYSTEM.md` thêm một hàng. Phương án không thêm màu: mọi chỗ `peer` → `ink-muted` + glyph (khác biệt chỉ còn ở hình) — Q1.

---

## 9. Motion (tóm tắt, theo token sẵn có)

| Sự kiện | Chuyển động | Thời lượng |
|---|---|---|
| Tin tới | cung xám → `peer` (stroke 150 ms) · phong thư chạy theo cung (rAF + `getPointAtLength`, như `TreeEdge`) · card nhận vòng 1 lần · dòng 3 crossfade | 700 ms bay (`ease` in-out cubic như dot), vòng 600 ms, crossfade `--ccm-dur-fast` |
| Hết cửa sổ chữ | crossfade về chữ cũ | `--ccm-dur-fast` |
| Link nguội (> 15 phút) | cung mờ dần rồi bỏ | `--ccm-dur-slow` |
| Session gỡ | cung tan theo bụi Thanos của card (`lib/dust.ts`) | sẵn có |
| Rail / header / tile | vạch 2px opacity 0→1→0 một lần · dòng chữ `ccm-rail-word` | `--ccm-dur-signal` |
| Reduced motion | không bay / vòng / vạch chạy; chỉ opacity + màu; chữ + glyph giữ đủ thời gian | — |

Không có vòng lặp nào (vòng thở vẫn chỉ dành cho "cần chủ nhân").

---

## 10. Phân pha

| Pha | Nội dung | File | Test |
|---|---|---|---|
| **P0 spike** (chủ nhân, ~5 phút) | Mở 2 pane Claude A, B trong GolAIm; ở A nhờ Claude gửi B một câu ngắn và B trả lời (chủ nhân tự gõ — GolAIm không gửi gì). Thêm 1 lần A ở mode khác B để thấy tin bị giữ. Sau đó con đọc **chỉ cấu trúc**: `enqueue` đầu thẻ, `origin` keys (`from` có tiền tố `uds:`? có `msg_id`?), `toolUseResult` keys bên A, `from` == `messagingSocketPath` của A, record khi bị giữ | không file code; ghi kết quả vào docs §11y | — |
| P1 protocol + collector | §4, §5 | `packages/shared/src/types.ts`, `packages/shared/src/peer.ts` (mới: `peerAddressKey`, `parseEnvelopeFrom`, `isAgentAddress`), `apps/collector/src/{registry,transcript,tracker,peers(mới),monitor,store,index}.ts`, `scripts/demo-fixture.mjs` `--peers` | `test/peers.test.ts`, `test/units.test.ts`, `test/monitor.test.ts`, shared `peer.test.ts` |
| P2 Monitor | §6 | `stores/peers.ts` (mới) + `connection.ts` apply, `components/PeerEdge.vue` (mới), `lib/layout.ts` `peerPath`, `MainNode.vue` (handle trên, vòng, dòng 3, chip), `AgentMap.vue` (edge incremental, hạn mức, chỉ báo ngoài viewport), `ActivityFeed.vue`, `lib/mapMenu.ts`, `style.css` + `themes.css` (`--ccm-peer*`, `.ccm-peer-ring`), `i18n/peer-v54.ts` en/vi | `lib/layout.test.ts` (`peerPath`), `stores/peers.test.ts` (pulse từ số tăng, cửa sổ, snapshot không pulse), `lib/themes.test.ts`, E2E `agent-map.cjs` thêm ca peer (fixture) |
| P3 Workspace | §7 | `lib/rail/railModel.ts` (`RailRow.peer`, ưu tiên, group lead), `rail/RailRow.vue`, `rail/RailGroupHead.vue`, `rail/RailClusterView.vue`, `composables/usePaneInfo.ts` (`peerOf`), `TermPane.vue` (chip + vạch), `ViewPaneControls`/header viewer không đổi, `WorkspaceView.vue` (glyph tab, chip zoom, capsule project, live region), `mission/MissionCard.vue` | `lib/rail/rail.test.ts`, `lib/rail/mission.test.ts`, `stores/workspace.test.ts` (i18n parity), E2E mới `v54-peers.cjs` (fixture: chữ đúng, hết hạn, ưu tiên cần-chủ-nhân, 220px không tràn) + chạy lại `v50-groups`, `v52-polish`, `rail` |
| P4 "Mở bởi" + điều phối | §3.3, chip "Điều phối N" | `stores/workspace.ts` (`Pane.openedBy`, `openFromAgent`, sessionStorage), `stores/peers.ts` (link `opened`), `lib/peerRoles.ts` (mới, thuần) | `stores/workspace.test.ts`, `lib/peerRoles.test.ts` |
| P5 sau | tin bị giữ / từ chối (delivery notice), `notify_when_idle`, `claude` lồng qua process, teams macOS, peer ngoài máy | `transcript.ts`, `codex/processes.ts`-style, `teams` reader | theo từng mục |

Mỗi pha: i18n en + vi, màu qua token, không comment trong code, cập nhật `.code_index/{protocol,collector,web}.md` + `_meta.md`,
docs §9 (riêng tư) + §11y (nguồn mới). Không commit khi chưa được bảo.

---

## 11. Rủi ro

- **Định dạng M1 chưa thấy trên đĩa** (0 record thật) → P0 bắt buộc trước P1; nếu `origin` bên nhận không được ghi cho làn
  socket, rơi về đầu thẻ `enqueue` (vẫn có `from`), mất `msg_id` → chống trùng bằng cửa sổ 10 s.
- `from` do người gửi tự khai (Windows không có `verifiedPeerPid`) → chỉ là nhãn hiển thị; ghi rõ docs.
- Trùng tên session → không dùng `to`; chỉ dùng địa chỉ socket.
- Session `/clear` đổi `sessionId` nhưng giữ process / socket → link theo terminal vẫn đúng. Session khởi động lại (process
  mới) → socket mới → link mới (đúng ý: terminal mới).
- Thân tin nằm cạnh field cần đọc → mọi parser chỉ trả field whitelist; test khẳng định output không chứa chuỗi `body`.
- Map dày: hạn mức 6 vật chạy, cung tĩnh xám, không tự xếp lại.
- Theme v25: thêm `peer` cho 8 theme, test contrast có thể đỏ ở theme ít màu (Solarized / Monokai) → chỉnh giá trị theo test.
- `open_session` mở pane trong tab khác khi không đủ chỗ → link `opened` vẫn đúng (theo terminal), chỉ khác nơi hiện.

---

## 12. Câu hỏi cho chủ nhân

1. **Màu**: dùng role mới `peer` (magenta, `#a83279` / `#ff7ac6`, chỉ trên glyph + phong thư + vạch 1 lần) hay **không thêm
   màu** (glyph `ink-muted`, khác biệt chỉ bằng hình + chữ)?
2. **Bố cục Monitor**: giữ chỗ card như hiện tại (mặc định đề xuất) hay tự gom A cạnh B, C khi chúng trao đổi (card sẽ dời chỗ
   có animation)?
3. **P0**: chủ nhân chạy giúp một lần trao đổi thật giữa 2 pane (tốn vài token phía chủ nhân; GolAIm không gửi gì) để con xác
   minh định dạng trước khi code collector?
