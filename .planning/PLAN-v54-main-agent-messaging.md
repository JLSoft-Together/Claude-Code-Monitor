# PLAN v54 — Main agent ↔ main agent: hiệu ứng gửi / nhận trên Monitor + Workspace

Trạng thái: **đã code P0–P4 (2026-10-16), chờ chủ nhân build + xem**. Nghiên cứu: `.planning/RESEARCH-v54-main-agent-messaging.md` (gọi tắt R,
số mục `R§n`). Plan này chỉ ghi quyết định + chia việc; chi tiết định dạng / phác hoạ xem R.

## 0. Quyết định chủ nhân (2026-10-16)

| # | Câu hỏi | Chốt |
|---|---|---|
| Q1 | Màu | Thêm role `peer` (magenta `#a83279` / `#ff7ac6`), chỉ trên glyph ✉, phong thư, vòng sáng một lần, vạch 2px một lần, cung **lúc tin đang chạy**. Quan hệ tĩnh xám `ink-faint`, chữ màu ink |
| Q2 | Bố cục Monitor | Giữ chỗ card. Không tự gom, không nút gom |
| Q3 | P0 | Chủ nhân tự chạy một lần trao đổi thật giữa 2 pane; con chỉ đọc cấu trúc record. Collector phần peer chờ P0; UI làm trước bằng store + event giả |
| Q4 | Phạm vi thêm | (a) dot ↓/↑ cho tin main → subagent giữa chừng + hand-back · (b) "Được mở bởi" (`open_session`) · (c) chip "Điều phối N" |

Ngoài phạm vi (R§10 P5): tin bị giữ / từ chối, `notify_when_idle`, `claude` lồng qua process, agent teams macOS, peer ngoài máy
(chỉ hiện chữ một đầu, không cung).

## 1. Ngôn ngữ hình ảnh (tóm R§6.1, R§7)

- Main → sub (v53, giữ): cạnh lược trong cây, dot tròn dọc, màu lifecycle.
- Main ↔ main (v54): **cung cong nét đứt** nối mép trên hai card main, **phong thư** `peer` bay theo chiều gửi, card nhận **một**
  vòng sáng `peer`, dòng 3 card đổi chữ tạm ("✉ Tin từ A" 8 s / "→ Đã gửi cho B" 4 s / "⇄ Đang trao đổi với A" 8 s).
- "Được mở bởi" (M3): cung **chấm** xám, không phong thư; chữ "Được mở bởi A" 8 s sau khi mở.
- Workspace: chỉ glyph 12px + chữ ngắn trong ô chữ có sẵn + một vạch 2px chạy một lần. Không tô nền, không lặp.
- Ưu tiên trong một ô: cần chủ nhân (`failed`/`asked`/waiting) > tin peer > tool · thời gian > chữ trạng thái. Khi bị lấn:
  badge glyph 8px góc icon, tooltip đủ câu.
- Reduced motion: không bay / vòng / vạch chạy; chỉ màu + opacity; chữ + glyph giữ đủ thời gian.

## 2. Hợp đồng dữ liệu

`packages/shared/src/types.ts` (R§4):

```ts
export type PeerLinkKind = 'message' | 'opened'
export interface PeerLink { id; kind; a; b; ab; ba; firstAt; lastAt; lastDir: 'ab' | 'ba'; lastAgentId? }
MonitorEvent += link.created | link.updated (Patch) | link.removed {id}
MonitorSnapshot.peerLinks?: PeerLink[]
ActivityKind += 'peer.message'
Agent += msgIn?: number  (tin main gửi tiếp cho subagent, đếm)  · msgOut?: number (hand-back / SendMessage to "main", đếm)
```

- Hiệu ứng chỉ sinh từ **số tăng** (`ab`/`ba`, `msgIn`/`msgOut`) qua `*.updated`; snapshot / resync không animate.
- `opened` chỉ sinh ở web (`Pane.openedBy`), không qua collector.
- Không field nào chứa nội dung tin; tên hiển thị lấy từ terminal sẵn có, không từ envelope.

## 3. Pha + chia luồng

| Pha | Ai | Nội dung | Phụ thuộc |
|---|---|---|---|
| P0 | chủ nhân | Spike: 2 pane Claude trong GolAIm, A `SendMessage` cho B, B trả lời A (hướng dẫn §5). Con đọc cấu trúc, ghi docs §11y | — |
| P1 base | con | Shared types (§2) · web `stores/peers.ts` (links, pulses, `recentOf`, `warm`, `roleOf`) + apply ở `connection.ts` · token `--ccm-peer`/`--ccm-peer-soft` 2 theme gốc + 12 block `themes.css` + test contrast · class chung `.ccm-peer-sweep`/`.ccm-peer-ring` · i18n `i18n/peer-v54.ts` (chữ R§7.1) · `COLOR-SYSTEM.md` một hàng | — |
| P2 Monitor | subagent A | `PeerEdge.vue` (mới), `lib/layout.ts` `peerPath` + test, `MainNode.vue` (handle trên ẩn trong khung tĩnh, vòng, dòng 3, chip Điều phối / ✉ peer), `AgentMap.vue` (edge peer incremental, hạn mức 6 vật chạy chung dot, capsule ngoài viewport, tab một session = chip, live region), dot ↓/↑ từ `msgIn`/`msgOut` (`TreeEdge` có sẵn), `ActivityFeed.vue` (`peer.message`), `lib/mapMenu.ts` ("Đi tới A/B") | P1 base |
| P3 Workspace | subagent B | `lib/rail/railModel.ts` (`RailRow.peer`, ưu tiên, group lead, cụm gập), `rail/RailRow.vue`, `RailGroupHead.vue`, `RailClusterView.vue`, `composables/usePaneInfo.ts` (`peerOf`), `TermPane.vue` (chip + vạch, thứ tự thu v52), `WorkspaceView.vue` (glyph tab, chip zoom, capsule project), `mission/MissionCard.vue` | P1 base |
| P4 opened-by | subagent B (sau P3) | `stores/workspace.ts` `Pane.openedBy` (runtime + sessionStorage như `resume`), `openFromAgent` ghi; `stores/peers.ts` dựng link `opened` từ panes | P3 |
| P1 collector (agent) | subagent C | `transcript.ts` signal `coordinator` (main → sub, `origin.kind:"coordinator"` trong `subagents/agent-*.jsonl`) + hand-back `<agent-message>` (origin `peer` + `handback`) → `Agent.msgIn/msgOut`; test | P1 base types. Định dạng VERIFIED thật, không chờ P0 |
| P1 collector (peer) | con | `registry.ts` `sockKey`, signal `peer_out/peer_sent/peer_in`, `peers.ts` `PeerLinkStore`, wiring `monitor/store/index`, demo-fixture `--peers`, docs §9 + §11y | **P0** |
| P5 | con | Review độc lập, E2E `v54-peers.cjs` + chạy lại `agent-map`, `v50-groups`, `v52-polish`, `rail` (qua dev), `.code_index` | tất cả |

Quy tắc luồng song song: mỗi luồng sở hữu file riêng; `style.css`/`themes.css`/`i18n/en.ts`/`vi.ts` chỉ con sửa ở P1 base;
luồng cần chữ thêm thì tạo module riêng (`i18n/peer-map-v54.ts`, `i18n/peer-ws-v54.ts`), con spread vào `en.ts`/`vi.ts`; CSS riêng
của luồng để trong `<style>` của component. Không comment trong code. Không build. Không git.

## 4. Kiểm tra

- `npm run typecheck`, `npm test` (UI desktop (renderer) + collector + shared).
- Store: pulse chỉ từ số tăng, snapshot không pulse, cửa sổ 4 / 8 s hết hạn, `warm` 15 phút, ưu tiên cần-chủ-nhân.
- Layout: `peerPath` hai chiều không chồng, khác hàng.
- Theme: `peer` glyph ≥ 3:1, chữ ngắn ≥ 4.5:1 trên surface/raised/canvas mọi theme.
- Collector: không chuỗi nội dung nào lọt ra ngoài `extractSignals` (test khẳng định).
- Ảnh qua Vite dev + Electron `--dev-url`: Monitor (cung, phong thư frame giữa, vòng), rail 220px không tràn, header < 300px,
  Mission tile; dark + light.

## 5. Hướng dẫn P0 cho chủ nhân

1. Mở 2 pane Claude trong GolAIm (cùng hoặc khác project), đặt tên dễ nhận (`/rename A`, `/rename B`).
2. Ở pane A gõ: *"Dùng ListAgents tìm session B, rồi SendMessage cho B: 'ping từ A, trả lời lại A bằng SendMessage một chữ pong'"*.
3. Đợi B nhận và gửi lại. (Tuỳ chọn) lặp lại khi A ở `bypass` còn B ở mode thường để thấy tin bị giữ.
4. Báo con. Con chỉ đọc tên field / dạng id / timestamp của hai transcript + registry, không đọc nội dung.

## 6. Kết quả

### P0 (2026-10-16, chủ nhân chạy 2 session `claude` A, B ở terminal ngoài; con chỉ đọc cấu trúc)

VERIFIED trên đĩa (khớp bundle, R§3.1):
- Registry `sessions/<pid>.json` có `messagingSocketPath` (54 ký tự, `\\.\pipe\LOCAL\cc-msg-…`) **và `name`** (`"A"`/`"B"`,
  `nameSource: "user"` sau `/rename`; mặc định dạng `<project>-<2 hex>`, `nameSource` khác).
- Bên gửi: `assistant` `tool_use` `SendMessage` (`input.to` = tên hoặc địa chỉ thô `uds:…` 58 ký tự khi trả lời) → `user`
  `toolUseResult {success, message, display, msg_id}` (`msg_id` = UUID 36 ký tự).
- Bên nhận (đang rảnh): `queue-operation enqueue` (`content` mở bằng `<cross-session-message from="uds:<path>" [hop-chain=…]
  from-name="A" from-mode="…">`) → `queue-operation dequeue` → `user` `isMeta:true, turnOrigin:"peer", promptSource:"system",
  origin {kind:"peer", from:"uds:<path>", msg_id, name, fromMode, hopChain?, body}`.
- `from` bỏ `uds:` **bằng đúng** `messagingSocketPath` của người gửi (không percent-encode trên Windows). `msg_id` bên gửi ==
  `origin.msg_id` bên nhận cả hai chiều → gộp hai đầu bằng `msg_id`.
- Trễ: `toolUseResult` bên gửi và `enqueue` bên nhận cách nhau < 10 ms.
- Chưa thấy: nhận giữa lượt (`queued_command`), tin bị giữ, `notify_when_idle` → P5.

### Code (2026-10-16)

- P1 base: shared types, `stores/peers.ts` (+ test), token `peer` 14 theme (test contrast), `.ccm-peer-ring` / `.ccm-peer-sweep(-x)`
  (giữ sáng 1,4 s), i18n `peer-v54.ts`, `COLOR-SYSTEM.md`. Link dựng lại từ lịch sử (lastAt > 10 s) không pulse; dot msgIn/msgOut
  không bắn lúc `sessionsLoading`.
- Collector (docs §11y, §11z): `Agent.msgIn/msgOut` (hand-back cuối = một lần msgOut, tới trước completed ~9 s; coordinator ghi lúc
  sub nhận, trễ trung vị 8,6 s), peer links ghép theo `msg_id`, `sockKey` hash, TTL `CCM_PEER_TTL_MIN` (60), `demo-fixture --peers`.
- Monitor: `PeerEdge.vue`. Cùng hàng: vòm `clamp(20, 0.12·dx, 44)` + fit chừa trên. Khác hàng: đường vuông góc bên trái qua khe cột và
  hành lang giữa hàng (cùng cột = dấu "["), không cắt cây subagent. MainNode: vòng khi phong thư hạ cánh, dòng 3, chip một peer chỉ glyph,
  chip "Điều phối N". Dot ↑ lúc completed bị bỏ nếu hand-back đã bắn trong 60 s.
- Workspace: rail / header (chữ chip peer ẩn < 720px, co trước chip status; lúc cần chủ nhân = badge ở chip status) / tab / capsule /
  Mission; `Pane.openedBy`. Glyph "Được mở bởi" `CornerDownRight` ink-muted ở cả hai nơi.

Lệch so với research: không có badge 8px ở header khi cần chủ nhân (dùng badge trên chip status); tab / capsule chỉ báo tin đến; Mission
tile chip là span (tile đã là button); một cặp vừa `opened` vừa có tin chỉ vẽ một cung.

Kiểm: typecheck sạch · collector 20 file / 254 test · desktop 39 file / 568 test · UI desktop (renderer) 77 file / 747 test · E2E
agent-map 34/34 (qua dev; một lần fail do fixture sống làm card đổi chỗ) · ảnh dev 1600 / 1000px dark + light (UI bơm event giả: bản
collector trong `apps/desktop/stage` là bản build cũ).
Chưa: E2E `v54-peers.cjs`; chip "+N" của viewer zoom + cột avatar 52px chưa có badge peer; phong thư từ pill subagent (đang từ card main);
P5 (tin bị giữ, notify_when_idle, peer ngoài máy, `claude` lồng, teams macOS).
