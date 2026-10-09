# Tool Timeline (A-live): thiết kế

- Ngày: 2026-10-09
- Trạng thái: chờ duyệt
- Phạm vi: nhóm A, phần live. Phần lịch sử và heatmap (A-history) có spec riêng sau.

## 1. Mục tiêu

Trả lời câu hỏi *"session này đang làm gì, tool nào chậm hoặc lỗi"* ngay trên dashboard:
- **Swim-lane:** mỗi agent là một lane, mỗi tool call là một bar theo thời gian.
- **Bảng thống kê tool** trong cửa sổ đang xem.

Dữ liệu phải còn nguyên sau khi refresh trang hoặc restart collector, trong phạm vi 2 giờ gần nhất.

### Ràng buộc (không đổi)
- Chỉ quan sát. Không gửi prompt, không gọi API, không dùng LLM.
- Chỉ đọc **tên tool** và **timestamp**. Không bao giờ đọc hay gửi đi `input` của `tool_use` hay nội dung `tool_result`.
- Không có database, không lưu ra đĩa thêm file nào.
- Không cuộn ngang. Mọi chuỗi giao diện đi qua i18n (`en` và `vi`), mọi màu đi qua token theme. Trạng thái luôn thể hiện bằng icon/họa tiết + chữ + màu, không bao giờ chỉ bằng màu.

### Tiêu chí thành công
1. Mở Timeline sau khi restart collector vẫn thấy tool call của 2 giờ gần nhất, với các session còn sống.
2. Bar của tool đang chạy kéo dài theo thời gian thực; khi tool kết thúc thì bar đóng lại trong khoảng 1 giây.
3. Bảng thống kê khớp với các bar trong cùng cửa sổ.
4. Không có chuỗi nào từ tham số tool xuất hiện trong payload WebSocket (có test kiểm tra).
5. `tool.started`/`tool.failed`, `errorLoops`, toast và ActivityFeed giữ nguyên hành vi.

## 2. Mô hình dữ liệu (`packages/shared/src/types.ts`)

```ts
export type ToolOutcome = 'ok' | 'error' | 'interrupted'

export interface ToolSpan {
  id: string          // tool_use id, duy nhất trong một terminal
  terminalId: string
  agentId: string     // `${terminalId}:main` hoặc id subagent
  tool: string        // chỉ tên, tối đa 80 ký tự
  start: string       // ISO, lấy từ timestamp của record tool_use
  end?: string        // chưa có = đang chạy
  outcome?: ToolOutcome
}
```

## 3. Collector

### 3.1 `apps/collector/src/tool-spans.ts`: `ToolSpanLog` (module mới)

Mỗi `SessionTracker` sở hữu một `ToolSpanLog`.

| Đầu vào (Signal) | Hành động |
|---|---|
| `tool_use` có `at` | Mở span. Nếu `id` đã tồn tại (do resume/fork copy record) thì bỏ qua. Record không có timestamp thì bỏ qua. |
| `tool_result` khớp span đang mở | Đóng span: `end = at` (nếu `end < start` thì đặt `end = start`), `outcome = isError ? 'error' : 'ok'`. |
| `tool_result` không khớp span nào | Bỏ qua. |
| `turn_end` | Đóng mọi span còn mở **của agent đó**: `end = at`, `outcome = 'interrupted'`. |

- **Giới hạn:** tối đa 2000 span mỗi terminal; span đã đóng có `end` cũ hơn 2 giờ thì bị bỏ. Việc cắt chạy ngay khi ghi, không có timer. Span đang mở không bao giờ bị bỏ.
- **API:** `apply(signals, agentId) → ToolSpan[]` trả về các span vừa đổi; `list(since?: number) → ToolSpan[]`.
- **Thời gian sống:** span **không** reset khi `sessionId` đổi (`/clear`), vì đó là lịch sử thật của terminal. Span chỉ mất khi tracker bị xóa.
- Agent/Task chạy nền (`async_launched`) đóng ngay khi có kết quả launch, đúng như dữ liệu thực. Phần việc thật hiện trên lane riêng của subagent.

### 3.2 `tracker.ts`
- `applyMain` và vòng đọc subagent gọi `spans.apply(...)` **cả khi catch-up**.
- Span vừa đổi chỉ được đẩy vào hàng đợi `pendingSpans` khi **không** catch-up. `Monitor` gọi `tracker.drainSpans(): ToolSpan[]` sau mỗi lần `sync()` và gửi từng span qua `store.toolSpan`. Chữ ký `sync()` giữ nguyên.
- `toolSpans(since?)` để `Monitor` đọc.

### 3.3 `Monitor` / `MonitorStore` / `server.ts` / `index.ts`
- `MonitorStore.toolSpan(span)` → emit `{ type: 'tool.span', payload }`, đi qua batching sẵn có.
- `Monitor.sendToolSpans(reply, terminalId?, since?)` → `reply({ type: 'toolSpans.data', payload: { terminalId, since, spans } })`. Với `terminalId` không tồn tại thì trả `spans: []`.
- `server.ts` kiểm tra `toolSpans.get`: `terminalId` là string nếu có; `since` là string ≤ 40 ký tự và `Date.parse` hợp lệ nếu có. Sai thì bỏ qua message.
- `index.ts` route `toolSpans.get` → `monitor.sendToolSpans(ctx.reply, …)`.

## 4. Protocol

| Hướng | Message | Ngữ nghĩa |
|---|---|---|
| C→S | `{ type: 'toolSpans.get'; terminalId?: string; since?: string }` | Không có `terminalId` = mọi terminal. `since` lọc giữ span có `end ≥ since` hoặc đang mở. |
| S→C (trả lời trực tiếp) | `{ type: 'toolSpans.data'; payload: { terminalId?: string; since?: string; spans: ToolSpan[] } }` | Thay thế dữ liệu của phạm vi đã yêu cầu. |
| S→C (broadcast) | `{ type: 'tool.span'; payload: ToolSpan }` | Upsert theo `id`. Không phát trong lúc catch-up. |

Client cũ bỏ qua event lạ. Không đổi `protocolVersion`.

## 5. Web

### 5.1 Store `stores/toolSpans.ts`
- `byTerminal: Map<terminalId, Map<spanId, ToolSpan>>` (dùng `shallowRef` và bump version để tránh reactivity sâu).
- `tool.span` → upsert (luôn chạy). `toolSpans.data` → trong phạm vi được yêu cầu (một terminal hoặc tất cả), xóa các span thỏa cùng điều kiện lọc (`end ≥ since` hoặc đang mở), rồi ghi các span trả về. Span cũ hơn `since` không bị đụng tới.
- `terminal.removed` → xóa span của terminal đó. Mỗi phút cắt span đã đóng cũ hơn 2 giờ.
- `connection.loadToolSpans(terminalId?, sinceIso)`. Khi reconnect, nếu Timeline đang mở thì gọi lại.

### 5.2 `AgentMap.vue`
- Header có toggle **Map | Timeline** (`role="radiogroup"`, icon + chữ). Lựa chọn lưu ở `ui.mapView` (localStorage, mặc định `map`).
- Khi ở Timeline: ẩn các nút điều khiển của map, hiện chip cửa sổ 15/30/60 phút (`ui.timelineWindow`, mặc định 15), và render `<ToolTimeline :terminal-id>` thay cho canvas (`v-if`).

### 5.3 `components/ToolTimeline.vue`

1. **Swim-lane**
   - **Thứ tự lane:** dùng `treeOrder()` (`lib/layout.ts`). Ở màn tổng quan, nhóm theo session (hàng tiêu đề có tên kèm StatusIcon). Lane không có span trong cửa sổ thì ẩn. Agent không còn trong store thì có nhãn chung `tools.endedSubagent`.
   - **Bar:** `left`/`width` theo % của cửa sổ, tối thiểu 2 px; khi rộng ≥ 48 px thì in tên tool bên trong.
     - `ok`: màu trung tính.
     - `error`: màu `st-error` kèm dấu ✕.
     - `interrupted`: sọc chéo màu `st-waiting`.
     - Đang chạy: màu `st-working`, kéo tới `now`; tắt animation khi reduced-motion.
   - **Trục thời gian:** vạch mỗi 1/5/10 phút tùy cửa sổ, mép phải là "bây giờ".
   - **Tooltip** (hover hoặc focus): tool, thời lượng, giờ bắt đầu, kết quả, agent.
   - **Bàn phím:** mỗi lane là một tab stop; ←/→ chuyển giữa các bar (roving tabindex).

2. **Bảng thống kê** (theo cửa sổ và phạm vi)
   - **Cột:** Tool · Lượt gọi · Lỗi (số, %) · p50 · p95 · Tổng thời gian · Đang chạy.
   - **Sắp xếp:** cố định theo tổng thời gian giảm dần.
   - **Cách tính:** phân vị dùng nearest-rank, chỉ tính span đã đóng với outcome `ok` hoặc `error`; `interrupted` đếm riêng, không coi là lỗi.
   - **Cảnh báo:** ≥ 3 lỗi và tỉ lệ ≥ 20 % thì hiện icon ⚠ kèm chữ.
   - **Liên kết hai chiều:** hover dòng thì nổi các bar của tool đó; hover/focus bar thì nổi dòng tương ứng.

3. **Trạng thái rỗng:** "Không có tool call nào trong {n} phút qua", kèm gợi ý mở rộng cửa sổ. Khi mất kết nối thì giữ dữ liệu và hiện banner stale.

### 5.4 `lib/toolTimeline.ts` (logic thuần)
`spansInWindow`, `laneLayout`, `toolStats`, `ticks`, `formatDuration`.

### 5.5 i18n
Namespace `tools.*` trong `en.ts` và `vi.ts`.

## 6. Hiệu năng
- **Collector:** khoảng 150 B/span; ở mức tối đa 2000 × 10 session ≈ 3 MB.
- **Payload:** `get` luôn kèm `since`, nên cửa sổ 15 phút thường chỉ vài chục KB.
- **Web:** chỉ tính toán khi Timeline đang mở; dùng `now` sẵn có, không thêm polling.

## 7. Kiểm thử
- **Collector**
  - `test/tool-spans.test.ts`: mở/đóng, `interrupted`, id trùng, `end < start`, giới hạn 2000 span và 2 giờ, `since`, cắt tên 80 ký tự, payload không chứa `secret`.
  - `test/tracker.test.ts`: ghi span khi catch-up nhưng không phát activity hay span; span của subagent; span giữ nguyên sau `/clear`.
  - `test/monitor.test.ts` / `hardening.test.ts`: `toolSpans.get` trả lời trực tiếp; message sai kiểu bị bỏ qua; `tool.span` được broadcast khi live.
- **Web**
  - `lib/toolTimeline.test.ts`: phân vị, layout, ticks, lọc cửa sổ.
  - Test store `toolSpans`: upsert, merge `data`, xóa theo `terminal.removed`, cắt span cũ.
- **Thủ công:** `demo-fixture` + `npm run dev`; kiểm tra dark/light, EN/VI, điều hướng bàn phím trên lane.

## 8. Ngoài phạm vi
- Thống kê lịch sử, heatmap giờ × thứ (thuộc A-history).
- Lưu span ra đĩa.
- Xem tham số hay output của tool (vi phạm quy tắc sanitize).
- Sắp xếp bảng theo cột, click bar để mở chi tiết.

## 9. Tài liệu
- `docs/claude-code-integration.md` §11m: ghép `tool_use` ↔ `tool_result`, `turn_end` → `interrupted`, những gì không đọc.
- `.code_index/`: cập nhật `collector.md`, `web.md`, `protocol.md`, `_meta.md`.
