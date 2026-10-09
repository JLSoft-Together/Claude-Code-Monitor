# Tool Timeline (A-live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ghi lại tool call của từng agent thành span (`tool_use` → `tool_result`) và hiển thị chúng dưới dạng swim-lane kèm bảng thống kê trong view Timeline của panel Agent Map.

**Architecture:** Mỗi `SessionTracker` sở hữu một `ToolSpanLog` (chỉ trong RAM, 2 giờ / 2000 span, ghi cả khi catch-up). Lúc live, `Monitor` broadcast các span thay đổi dưới dạng `tool.span` (upsert). Client mở Timeline thì lấy dữ liệu qua `toolSpans.get` và nhận `toolSpans.data` trả lời trực tiếp. Web giữ một store `toolSpans`; logic thuần nằm ở `lib/toolTimeline.ts`, còn `ToolTimeline.vue` thay canvas Vue Flow khi toggle sang Timeline.

**Tech Stack:** Node + TS (collector), Vue 3 + Pinia + vue-i18n + Tailwind v4 (web), Vitest (happy-dom ở web).

**Spec:** `docs/superpowers/specs/2026-10-09-tool-timeline-design.md`

## Global Constraints

- Chỉ đọc **tên tool** và **timestamp**. Không bao giờ đọc hay gửi `input` của `tool_use` hay nội dung `tool_result`. Test assert payload không chứa `secret`.
- Không có DB, không lưu file mới. Span chỉ nằm trong RAM.
- Giới hạn: `SPAN_LIMIT = 2000` span mỗi terminal, `SPAN_RETENTION_MS = 2 * 60 * 60_000`, `MAX_TOOL_NAME = 80`.
- Cửa sổ Timeline: 15 / 30 / 60 phút, mặc định 15. Vạch trục: 5 phút (cửa sổ ≤ 30), 10 phút (60).
- Cảnh báo một tool: `errors >= 3 && errors / (ok + error) >= 0.2`.
- Phân vị: nearest-rank (`sorted[ceil(p/100 * n) - 1]`), chỉ tính span đã đóng có outcome `ok` hoặc `error`.
- Không đổi `protocolVersion`. `tool.started` / `tool.failed` / `errorLoops` / ActivityFeed giữ nguyên.
- UI: mọi chuỗi qua i18n `tools.*` (`en.ts` + `vi.ts`), mọi màu qua token theme sẵn có, trạng thái luôn có icon/họa tiết + chữ + màu, không cuộn ngang.
- Lệnh: `npm test -w @ccm/collector -- <file>`, `npm test -w @ccm/web -- <file>`, `npm run typecheck`.
- Đã biết: `test/job-actions.test.ts › looks for the real executable…` lỗi sẵn trên macOS (đường dẫn Windows), không liên quan tới plan này.

## Review Focus

1. Span **bắt đầu trước cửa sổ** (đang chạy hoặc kết thúc trong cửa sổ) → bar bị kẹp ở `left = 0`, không âm, không tràn. Test: Task 4 `laneLayout clamps…`.
2. **Timestamp lệch giờ** (start/end ở tương lai so với `now`) → `left + width ≤ 100`. Test: Task 4 `laneLayout clamps…`.
3. **Race giữa `get` và `tool.span`**: span đóng tới qua broadcast trước khi reply `data` (cũ hơn, còn mở) tới → bản đã đóng phải được giữ. Test: Task 5 `keeps a closed span over an older open copy`.
4. **Tên tool MCP rất dài** → cắt 80 ký tự ở collector, và ở UI bar/bảng dùng `truncate` + `title`. Test: Task 1 `caps tool names at 80 chars`.
5. **Subagent của session cũ** (đã bị xóa khỏi agents store sau `/clear`) → vẫn có lane với nhãn `tools.endedSubagent`, xếp sau cây hiện tại. Test: Task 4 `lanesFor appends orphan agents`.

---

### Task 1: Kiểu `ToolSpan` dùng chung + `ToolSpanLog`

**Files:**
- Modify: `packages/shared/src/types.ts` (thêm kiểu, union event / client message)
- Create: `apps/collector/src/tool-spans.ts`
- Test: `apps/collector/test/tool-spans.test.ts`

**Interfaces:**
- Produces (shared):
  ```ts
  export type ToolOutcome = 'ok' | 'error' | 'interrupted'
  export interface ToolSpan { id: string; terminalId: string; agentId: string; tool: string; start: string; end?: string; outcome?: ToolOutcome }
  export interface ToolSpansData { terminalId?: string; since?: string; spans: ToolSpan[] }
  // MonitorEvent += { type: 'tool.span'; payload: ToolSpan } | { type: 'toolSpans.data'; payload: ToolSpansData }
  // ClientMessage += { type: 'toolSpans.get'; terminalId?: string; since?: string }
  ```
- Produces (collector):
  ```ts
  export const SPAN_LIMIT = 2000, SPAN_RETENTION_MS = 7_200_000, MAX_TOOL_NAME = 80
  export class ToolSpanLog {
    constructor(terminalId: string, now?: () => number)
    apply(signals: Signal[], agentId: string): ToolSpan[]   // bản sao các span vừa mở/đóng
    list(sinceMs?: number): ToolSpan[]                      // bản sao, sắp theo start; giữ span có end ≥ sinceMs hoặc đang mở
  }
  ```

- [ ] **Step 1: Viết test lỗi** trong `tool-spans.test.ts`. Dùng các Signal tự tạo (`{k:'tool_use',id,name,at}`, `{k:'tool_result',toolUseId,isError,asyncLaunched:false,at}`, `{k:'turn_end',at}`) và `now` giả.
  - `opens on tool_use and closes ok/error on tool_result`: `apply` trả về span mở, rồi span đóng với `outcome:'ok'` / `'error'` và `end` đúng.
  - `skips tool_use without a timestamp and unmatched results`: kết quả trả về `[]`.
  - `ignores a repeated tool_use id`: `list()` chỉ có 1 span, `start` là của bản đầu.
  - `clamps end before start to start`.
  - `turn_end interrupts only that agent's open spans`: span của agent `a1` vẫn mở khi `turn_end` áp cho main.
  - `caps tool names at 80 chars`: `tool.length === 80`.
  - `drops closed spans older than 2h but never open ones`: tăng `now` thêm 2 giờ + 1 ms.
  - `keeps at most 2000 spans, dropping the oldest closed first`: 2001 span đã đóng thì span `start` nhỏ nhất bị bỏ; span đang mở được giữ.
  - `list(since) keeps spans ending at or after since and open ones`.
  - `never carries tool input or output`: signal kèm field thừa `input:{command:'secret'}` → `JSON.stringify(list())` không chứa `secret`.
- [ ] **Step 2:** `npm test -w @ccm/collector -- test/tool-spans.test.ts` → FAIL (module không tồn tại).
- [ ] **Step 3: Implement.** Thêm kiểu vào `types.ts`. `ToolSpanLog` dùng `Map<id, ToolSpan>` (thứ tự chèn ≈ thứ tự start). Việc cắt span (retention trước, rồi limit bỏ span đóng có start nhỏ nhất) chạy trong `apply` sau khi ghi. Chỉ copy các field có tên ở trên, không spread signal.
- [ ] **Step 4:** chạy lại → PASS. `npm run typecheck` sạch.
- [ ] **Step 5: Commit** `feat(collector): ToolSpanLog pairs tool_use with tool_result`.

### Task 2: Tích hợp vào `SessionTracker`

**Files:**
- Modify: `apps/collector/src/tracker.ts` (`constructor`, `applyMain`, vòng đọc subagent trong `syncOnce`)
- Modify: `apps/collector/src/monitor.ts:286` (truyền `now`)
- Test: `apps/collector/test/tracker.test.ts` (thêm vào `describe('SessionTracker')`)

**Interfaces:**
- Consumes: `ToolSpanLog` (Task 1).
- Produces:
  ```ts
  constructor(terminalId, record, projectsDir, hints = {}, now: () => number = Date.now)
  drainSpans(): ToolSpan[]                 // span đổi khi live, kể từ lần drain trước; catch-up không thêm gì
  toolSpans(sinceMs?: number): ToolSpan[]  // = spans.list(sinceMs)
  ```
  `resetSession()` **không** đụng tới log span.

- [ ] **Step 1: Viết test lỗi**:
  - `records spans during catch-up without queueing them`: sau `sync(true)` thì `toolSpans()` có span `t1` đóng `ok`, còn `drainSpans()` là `[]`.
  - `queues live span changes once`: append `tool_use t2` + `tool_result t2`, chạy `sync(false)` → `drainSpans()` có span `t2` (bản cuối là đã đóng); gọi lần hai → `[]`.
  - `records subagent spans under the subagent id`: dựng lại fixture subagent `a1` → `toolSpans().some(s => s.agentId === 'a1' && s.tool === 'Grep')`.
  - `keeps spans across a session switch`: `setRecord({sessionId: SID2})` thì `toolSpans()` vẫn chứa `t1`.
- [ ] **Step 2:** `npm test -w @ccm/collector -- test/tracker.test.ts` → các test mới FAIL.
- [ ] **Step 3: Implement.** Trong `applyMain` và vòng subagent, gọi `const changed = this.spans.apply(signals, agentId)` trước `state.apply`; nếu `!catchUp` thì `this.pendingSpans.push(...changed)`. `Monitor` truyền `() => this.deps.now()` làm tham số thứ 5.
- [ ] **Step 4:** chạy toàn bộ test collector → PASS (trừ test macOS đã biết).
- [ ] **Step 5: Commit** `feat(collector): track tool spans per session`.

### Task 3: Broadcast `tool.span` + `toolSpans.get` / `toolSpans.data`

**Files:**
- Modify: `apps/collector/src/store.ts` (`toolSpan`)
- Modify: `apps/collector/src/monitor.ts` (`syncTracker`, `sendToolSpans`)
- Modify: `apps/collector/src/server.ts:291` (kiểm tra `toolSpans.get`)
- Modify: `apps/collector/src/index.ts:120` (route)
- Modify: `docs/claude-code-integration.md` (thêm §11m trước `## 12. Open items`)
- Test: `apps/collector/test/monitor.test.ts`, `apps/collector/test/hardening.test.ts`

**Interfaces:**
- Consumes: `tracker.drainSpans()`, `tracker.toolSpans(sinceMs)` (Task 2).
- Produces:
  ```ts
  MonitorStore.toolSpan(span: ToolSpan): void        // emit { type: 'tool.span', payload: span }
  Monitor.sendToolSpans(reply: Reply, terminalId?: string, since?: string): void
  // reply({ type: 'toolSpans.data', payload: { terminalId, since, spans } }); không có terminalId → mọi tracker; id lạ → spans: []
  ```

- [ ] **Step 1: Viết test lỗi**:
  - `monitor.test.ts` `broadcasts tool spans live and answers toolSpans.get`: sau `start`, append `tool_result` cho `toolu_bash` vào transcript, chạy `reconcile()` → store đã emit `tool.span` với `{id:'toolu_bash', outcome:'ok'}` (đăng ký `store.subscribe` để bắt event). Sau đó `monitor.sendToolSpans(reply, terminalId)` → `payload.spans` chứa `toolu_bash`; với `'nope'` → `spans: []`; với `since` sau mọi `end` → chỉ còn span đang mở. `JSON.stringify` của mọi event không chứa `secret`.
  - `hardening.test.ts` `accepts toolSpans.get only with valid fields`: dùng `startServer` với `onClientMessage` giả. `{type:'toolSpans.get'}` và `{…, terminalId:'x', since:'2026-10-09T00:00:00.000Z'}` lọt qua; `since:'nope'`, `since` dài 41 ký tự, `terminalId: 5` bị bỏ.
- [ ] **Step 2:** chạy hai file → FAIL.
- [ ] **Step 3: Implement.** `syncTracker`: sau `publish` thì `for (const s of tracker.drainSpans()) this.store.toolSpan(s)`. Kiểm tra trong server: `since === undefined || (typeof since === 'string' && since.length <= 40 && Number.isFinite(Date.parse(since)))`. Route trong `index.ts` theo pattern `timeline.get`.
- [ ] **Step 4:** chạy lại → PASS; `npm run typecheck` sạch.
- [ ] **Step 5: Docs.** §11m `Tool spans (2026-10-09)`: ghép cặp theo `tool_use.id` ↔ `tool_result.tool_use_id`, `turn_end` → `interrupted`, giới hạn, ghi cả khi catch-up nhưng chỉ broadcast khi live, chỉ đọc tên tool và timestamp.
- [ ] **Step 6: Commit** `feat(collector): broadcast tool spans and answer toolSpans.get`.

### Task 4: `lib/toolTimeline.ts` (logic thuần ở web)

**Files:**
- Create: `apps/web/src/lib/toolTimeline.ts`
- Test: `apps/web/src/lib/toolTimeline.test.ts`

**Interfaces:**
- Consumes: `ToolSpan` (shared), `Agent`, `treeOrder` từ `lib/layout.ts`.
- Produces:
  ```ts
  export const WINDOWS = [15, 30, 60] as const
  export type WindowMin = (typeof WINDOWS)[number]
  export function spansInWindow(spans: Iterable<ToolSpan>, fromMs: number): ToolSpan[]   // end ≥ from hoặc đang mở; sắp theo start
  export interface Bar { span: ToolSpan; left: number; width: number; running: boolean }  // phần trăm, kẹp trong [0, 100]
  export function laneLayout(spans: ToolSpan[], fromMs: number, nowMs: number): Bar[]
  export interface Lane { agentId: string; agent?: Agent; depth: number; spans: ToolSpan[] }
  export function lanesFor(spans: ToolSpan[], agents: Agent[]): Lane[]   // theo treeOrder, bỏ lane rỗng, agent mồ côi xếp cuối với depth 1
  export interface ToolStat { tool: string; calls: number; errors: number; errorRate: number; interrupted: number; running: number; p50?: number; p95?: number; totalMs: number; warn: boolean }
  export function toolStats(spans: ToolSpan[], nowMs: number): ToolStat[]   // sắp theo totalMs giảm dần, rồi theo tên tool
  export function percentile(sortedMs: number[], p: number): number | undefined
  export function ticks(fromMs: number, nowMs: number, windowMin: WindowMin): number[]   // bội số của 5 phút (≤30) / 10 phút (60) nằm trong [from, now]
  export function formatMs(ms: number): string   // <1000 → "850 ms", <60 s → "1.2 s", còn lại → "3m 10s"
  ```
  `totalMs` gồm span đã đóng (mọi outcome) cộng thời gian đã chạy của span đang chạy tới `now`. `errorRate = errors / (ok + error)`, bằng 0 khi mẫu số là 0.

- [ ] **Step 1: Viết test lỗi**:
  - `percentile uses nearest rank`: `[100,200,300,400]` → p50 = 200, p95 = 400; `[]` → `undefined`.
  - `toolStats counts, excludes running and interrupted from percentiles, warns at 3 errors and 20%`: 10 span Bash (3 lỗi, 6 ok, 1 interrupted) cùng 1 span đang chạy → `{calls: 11, errors: 3, interrupted: 1, running: 1, warn: true}`; 2 lỗi trên 10 thì `warn: false`.
  - `toolStats sorts by total time`.
  - `laneLayout clamps spans that start before the window or end in the future`: span bắt đầu trước `from` → `left === 0`; span có end > now → `left + width <= 100`; span đang chạy → `running: true`, kéo tới now.
  - `spansInWindow keeps open and recently ended spans`.
  - `lanesFor follows treeOrder and appends orphan agents`: main, sub `a1` (cha là main), span của `old` không có trong agents → thứ tự `[main, a1, old]`, `old.depth === 1`, `old.agent === undefined`; agent không có span thì không có lane.
  - `ticks steps 5 min up to 30 and 10 min for 60`.
  - `formatMs`: 850 → `850 ms`, 1234 → `1.2 s`, 190000 → `3m 10s`.
- [ ] **Step 2:** `npm test -w @ccm/web -- src/lib/toolTimeline.test.ts` → FAIL.
- [ ] **Step 3: Implement** theo các signature ở trên.
- [ ] **Step 4:** chạy lại → PASS.
- [ ] **Step 5: Commit** `feat(web): tool timeline layout and stats helpers`.

### Task 5: Store `toolSpans`, nối với connection, thêm tùy chọn ui

**Files:**
- Create: `apps/web/src/stores/toolSpans.ts`
- Modify: `apps/web/src/stores/connection.ts` (các case `tool.span`, `toolSpans.data`, `terminal.removed`; thêm `loadToolSpans`)
- Modify: `apps/web/src/stores/ui.ts` (`mapView`, `timelineWindow` lưu trong localStorage, theo pattern `ccm.view`)
- Test: `apps/web/src/stores/toolSpans.test.ts`

**Interfaces:**
- Consumes: `ToolSpan`, `ToolSpansData` (Task 1), `WindowMin` (Task 4).
- Produces:
  ```ts
  useToolSpansStore(): {
    version: Ref<number>                         // tăng mỗi lần đổi; component đọc nó để re-compute
    upsert(span: ToolSpan): void                 // span đã đóng thắng bản cũ còn mở
    applyData(data: ToolSpansData): void         // trong phạm vi + bộ lọc since: thay thế, nhưng giữ span đã đóng ở local khi bản tới còn mở
    removeTerminal(terminalId: string): void
    prune(nowMs: number): void                   // bỏ span đã đóng có end < now − 2 giờ
    spansFor(terminalId?: string): ToolSpan[]    // không có id → mọi terminal
  }
  connection.loadToolSpans(terminalId: string | undefined, since: string): boolean
  ui.mapView: Ref<'map' | 'timeline'>            // localStorage 'ccm.mapView', mặc định 'map'
  ui.timelineWindow: Ref<WindowMin>              // localStorage 'ccm.timelineWindow', mặc định 15
  ```
  Dữ liệu là `shallowRef<Map<string, Map<string, ToolSpan>>>`, mỗi lần ghi thì bump `version`. Nếu chưa có timer prune thì chạy `prune` mỗi 60 giây.

- [ ] **Step 1: Viết test lỗi** (`setActivePinia(createPinia())`, gửi message qua `useConnectionStore().onMessage(...)` giống `stores.test.ts`):
  - `upserts tool.span events by id`.
  - `keeps a closed span over an older open copy`: `tool.span` đã đóng tới trước, rồi direct `toolSpans.data` chứa cùng span còn mở → vẫn là bản đã đóng.
  - `toolSpans.data replaces only its scope and since range`: span của `t2`, và span của `t1` có end trước `since`, đều còn nguyên sau khi nhận `data` cho `t1`.
  - `drops spans of a removed terminal`.
  - `prunes closed spans older than 2h`.
- [ ] **Step 2:** `npm test -w @ccm/web -- src/stores/toolSpans.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `toolSpans.data` là direct reply (`seq: -1`), nên phải đi qua cùng nhánh direct như `timeline.data`.
- [ ] **Step 4:** chạy lại cả `src/stores` → PASS; `npm run typecheck` sạch.
- [ ] **Step 5: Commit** `feat(web): tool span store and timeline view prefs`.

### Task 6: `ToolTimeline.vue` + toggle trong `AgentMap` + i18n

**Files:**
- Create: `apps/web/src/components/ToolTimeline.vue`
- Modify: `apps/web/src/components/AgentMap.vue` (header từ dòng ~234; vùng canvas ~276)
- Modify: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/vi.ts` (namespace `tools`)
- Modify: `.code_index/collector.md`, `web.md`, `protocol.md`, `_meta.md`

**Interfaces:**
- Consumes: toàn bộ API của Task 4–5; `useAgentsStore().byTerminal` / `.list`; `useTerminalsStore().list`; `now` (`lib/format`); `StatusIcon`.
- Produces: `<ToolTimeline :terminal-id?="string | null" />`.

**Hành vi (theo spec §5.2–5.3):**
- **Header của `AgentMap`:** radiogroup Map | Timeline (icon `Network` / `ChartGantt` của lucide, kèm chữ). Ở chế độ timeline: ẩn các nút map (picked, hide-finished, `controls`), hiện chip 15/30/60 phút (`aria-pressed`), và `v-if` render `<ToolTimeline>` thay vì `<VueFlow>`.
- **Gọi dữ liệu:** khi mount, khi `timelineWindow` đổi, và khi `connection.state` trở lại `connected` → `loadToolSpans(terminalId, new Date(now - window*60_000).toISOString())`.
- **Lane:**
  - Nhãn lane: tên agent (main = tiêu đề terminal), thụt `depth * 12px`; agent mồ côi dùng `t('tools.endedSubagent')`. Ở màn tổng quan, nhóm theo terminal với hàng tiêu đề (StatusIcon + `displayTitle`).
  - Bar là `button`: `left/width` %, `min-width: 2px`, in tên tool khi bar rộng ≥ 48 px (đo bằng ResizeObserver chiều rộng track).
  - Class theo outcome dùng token: ok `bg-ink-faint/40`, error `bg-st-error` + icon `X`, interrupted `bg-st-waiting` sọc (`repeating-linear-gradient` với `var(--color-st-waiting)`), running `bg-st-working` + `ccm-breathe` (style.css đã tắt khi reduced-motion).
  - Tooltip dùng `title` + `aria-label` = `t('tools.barLabel', { tool, duration, start, outcome, agent })`.
- **Bàn phím:** mỗi lane có `tabindex=0` trên bar đang active; ←/→ chuyển active và gọi `focus()`.
- **Bảng:** `<table>` với các cột ở spec; ⚠ (`TriangleAlert` + chữ `tools.warn`) khi `warn`; hover/focus dòng hoặc bar thì set `hoveredTool` để làm nổi phía bên kia (`ring-2 ring-accent`).
- **Trạng thái rỗng:** `tools.empty` `{ n: window }` + `tools.emptyHint`.
- **Chuỗi i18n tối thiểu:** `view.map`, `view.timeline`, `window`, `minutes`, `empty`, `emptyHint`, `endedSubagent`, `barLabel`, `outcome.{ok,error,interrupted,running}`, các cột `col.{tool,calls,errors,p50,p95,total,running}`, `warn`, `axis`.

- [ ] **Step 1:** Thêm khóa i18n vào cả `en.ts` và `vi.ts`. `npm run typecheck` phải bắt lỗi khi `vi` thiếu khóa (`vi: typeof en`).
- [ ] **Step 2:** Implement `ToolTimeline.vue` và toggle trong `AgentMap.vue`.
- [ ] **Step 3:** `npm run typecheck` và `npm test` (web + collector) → PASS (trừ test macOS đã biết).
- [ ] **Step 4: Kiểm tra thủ công.**
  - Chạy `node scripts/demo-fixture.mjs --sessions=5 --subagents=3`, rồi `CLAUDE_CONFIG_DIR=<root> CCM_VERIFY_PROCESSES=0 npm run dev`.
  - Mở `http://127.0.0.1:5173`, toggle Timeline ở màn tổng quan và ở một tab session. Kiểm tra:
    - Có lane; bar đang chạy dài ra theo thời gian.
    - Đổi cửa sổ 15/30/60 thì gọi lại dữ liệu.
    - Bảng khớp với các bar.
    - Dark/light và EN/VI hiển thị đúng; không có thanh cuộn ngang ở 1280 px và 768 px.
    - Tab vào lane, dùng ←/→ để chuyển bar.
    - Refresh trang thì span vẫn còn.
- [ ] **Step 5:** Cập nhật `.code_index/` (tool-spans.ts, store `toolSpans`, `ToolTimeline`, các event protocol mới) và thêm một dòng vào `_meta.md`.
- [ ] **Step 6: Commit** `feat(web): tool timeline view in the Agent Map panel`.
