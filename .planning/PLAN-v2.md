# PLAN v2 — Token dashboard · Tên terminal · Redesign · Animation · Art

## Trạng thái (2026-10-07)

- Đã chốt: alias trên dashboard + gợi ý /rename · có chi phí USD ước tính · giữ lịch sử mãi · làm hết theo plan.
- XONG: tên terminal (alias), collector UsageIndex + cache, tab Usage, redesign token/typography/header tabs, animation pass, token trên Agent Map.
- CÒN: gắn art khi chủ nhân gen xong (prompt mục 5 đã đổi sang palette mới cobalt/graphite); validate thủ công 375–1440 px dark/light.

Ngày: 2026-10-07. Bổ sung cho `PLAN.md` (MVP 1–7 đã xong). Nguyên tắc cũ giữ nguyên: chỉ quan sát, không tốn token, không lộ nội dung session.

---

## 1. Tab "Usage" — thống kê token

### Dữ liệu (đã kiểm tra trên máy, 2026-10-07)

- Nguồn: `projects/**/*.jsonl` (main + `subagents/`), record `assistant` có `message.usage`, `message.model`, `message.id`, `timestamp`. Dedupe theo `message.id` (đã có trong `transcript.ts`).
- Thực tế: 301 file, 1.7 GB, 19 160 message, 2026-09-06 → 2026-10-07. Quét full = ~12 s → **không được quét lại mỗi lần khởi động**.
- Model gặp: `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `<synthetic>` (bỏ qua).
- `usage` có 4 loại cần tách:
  | Loại | Key | Ghi chú |
  |---|---|---|
  | Input | `input_tokens` | rất nhỏ (phần lớn đi qua cache) |
  | Cache write | `cache_creation_input_tokens` | |
  | Cache read | `cache_read_input_tokens` | chiếm >95% tổng |
  | Output | `output_tokens` | |
  → Hiển thị "input" gộp sẽ bị cache read lấn át; UI phải tách 4 loại, mặc định chart Input/Output, cache là lớp riêng bật/tắt.
- Claude tự xoá transcript cũ (`cleanupPeriodDays`, mặc định 30 ngày) → muốn giữ lịch sử dài phải tự lưu tổng hợp.

### Thiết kế collector

- `UsageIndex` mới (`apps/collector/src/usage.ts`):
  - Cache file `<CCM data dir>/usage-index.json` (vd `%LOCALAPPDATA%/ccm/`): mỗi file transcript lưu `{size, mtime, offset}` + bucket đã cộng.
  - Bucket = `day (local) × model × project(cwd slug)` → `{messages, input, output, cacheWrite, cacheRead}`. Không lưu message id lâu dài; dedupe chỉ trong phạm vi 1 file (id lặp chỉ xảy ra trong cùng file).
  - Khởi động: đọc cache, chỉ tail phần mới từ `offset` (file đổi size); file bị truncate → tính lại file đó. Lần đầu quét full chạy nền, báo progress.
  - Live: tái dùng `JsonlTailer` đang tail session sống → cộng thẳng vào bucket, flush cache debounce 30 s.
  - Bucket còn giữ khi transcript gốc bị Claude xoá → lịch sử > 30 ngày.
  - Lệch PLAN.md ("No database"): đây là file cache JSON, không phải DB — ghi vào `docs/claude-code-integration.md` §10.
- Protocol (`packages/shared`): thêm `usage` vào snapshot + event `usage.updated` (patch bucket theo key), `usage.scan` (progress quét lần đầu). Không gửi raw record.
- Chi phí ước tính (tuỳ chọn, bật được): bảng giá public per model trong `packages/shared/src/pricing.ts`, gắn nhãn "ước tính", model không có giá → "—". Không bịa.

### UI tab Usage

- Điều hướng: header có tab `Monitor | Usage` (router nhẹ hoặc `ui.activeTab`, nhớ localStorage).
- Bộ lọc: khoảng thời gian (Hôm nay / 7 ngày / 30 ngày / Tất cả), project, model.
- Khối:
  1. KPI: Tổng token · Input · Output · Cache read · Cache write · Số message · (Chi phí ước tính).
  2. Stacked area/bar theo ngày (Input / Output / Cache).
  3. Theo model: donut + bảng (model, msg, in, out, cache, %).
  4. Theo project: bar ngang top 10.
  5. Session đang chạy: token live từng terminal (đã có dữ liệu trong `Agent`).
- Chart lib: ECharts (tree-shake) hoặc uPlot; đọc skill `dataviz` trước khi làm chart. Màu chart lấy từ theme token.

---

## 2. Tên terminal không hiển thị

### Nguyên nhân

Registry hiện tại (`sessions/<pid>.json`): `name = "claude-code-monitor-f4"`, `nameSource = derived` → Claude tự đặt theo thư mục. Đổi tên **tab Windows Terminal** (chuột phải → Rename tab) chỉ nằm trong UI của Windows Terminal, không đi vào registry, Win32 cũng không đọc title từng tab (đã ghi ở integration doc §8).

### Phương án

| # | Cách | Độ tin cậy | Ghi chú |
|---|---|---|---|
| A | Đặt tên phía Claude: `claude -n "Tên"` lúc mở, hoặc `/rename Tên` trong session | Cao — đã hỗ trợ sẵn (registry `name`, `nameSource=user`) | Không cần code. Claude cũng ghi tên này lên title tab |
| B | Đổi tên ngay trên dashboard (alias) | Cao | Lưu `aliases.json` trong collector, key = `claudeSessionId` (theo `/clear` thì chuyển theo terminal id). Ưu tiên alias > registry name |
| C | Đọc tên tab Windows Terminal qua UI Automation | Thấp | UIA đọc được tên tab nhưng không có PID → chỉ ghép được theo title, mà tab đã rename thì title không còn khớp → không ghép được tin cậy. Không làm |

Đề xuất: A (hướng dẫn trong UI, tooltip "Đặt tên bằng `/rename`") + B (alias trên dashboard). UI hiện thêm badge nguồn tên (user / auto / alias).

---

## 3. Redesign UI

Skill bắt buộc trước khi code: `frontend-design:frontend-design`, `ui-ux-pro-max:ui-ux-pro-max`, `dataviz` (cho chart).

- Hướng: dev tool kiểu "mission control" — tối giản, đậm đặc nhưng thoáng, không gradient/glass (rule trong CLAUDE.md).
- Chữ to hơn: base 14 → 15/16 px, tiêu đề card 16–18, số KPI 28–32 tabular-nums, line-height 1.5.
- Spacing scale 4/8, card radius 10–12, border 1px token, shadow rất nhẹ ở light.
- Layout Monitor: header (tab + trạng thái kết nối + theme/lang) → metrics strip → 2 cột: danh sách session | Agent Map; Activity feed thành panel thu gọn được.
- Status vẫn icon + text + màu. Kiểm tra contrast AA cả dark/light.
- Responsive 375/768/1024/1440, không scroll ngang.

## 4. Animation

Chỉ animation có ý nghĩa, tôn trọng `prefers-reduced-motion`, chỉ animate `transform`/`opacity`.

- Session card: enter/leave (`<TransitionGroup>` fade + slide 8px, 180 ms), đổi status → pulse viền 1 lần.
- Agent Map: node mới scale 0.9→1 + fade; edge vẽ dần (stroke-dashoffset); node đang `working` có ring xoay chậm; xong → check pop.
- Số KPI/token: count-up khi đổi (rAF, ≤ 400 ms).
- Activity feed: item mới trượt vào từ trên, highlight nền mờ dần 1.5 s.
- Chart: animate lần đầu vẽ, update không animate lại toàn bộ.
- Chuyển tab Monitor ↔ Usage: crossfade 150 ms. Chuyển theme: transition màu 200 ms.
- Skeleton khi quét usage lần đầu + progress bar.

## 5. Art (để chủ nhân gen)

Dùng chỗ: empty state "Chưa có session", empty state Usage, logo/favicon, ảnh nền header mờ (opacity thấp, không gây nhiễu). Xuất PNG nền trong suốt hoặc SVG.

Prompt (tiếng Anh cho model ảnh):

1. **Logo / app icon**
   > Minimal flat vector app icon for a developer tool called "Claude Code Monitor": a small radar sweep merged with a terminal prompt chevron ">_", a tiny orange (#FF9A5C) spark at the center, geometric, two colors (cobalt blue #3457D5 and deep graphite #0F131A), centered, generous padding, transparent background, no text, no gradient, crisp edges, 1024x1024.

2. **Empty state — chưa có session**
   > Minimal line illustration, a calm sleeping terminal window with a soft blinking cursor, small radar dish beside it scanning empty space, a few faint dotted orbit lines, monochrome cool slate-gray line art with a single cobalt blue (#3457D5) accent, 2px uniform strokes, lots of whitespace, transparent background, no text, flat, friendly, developer-tool aesthetic, 1200x900.

3. **Empty state — Usage chưa có dữ liệu**
   > Minimal line illustration of an empty bar chart being built by tiny geometric robot hands placing token blocks, isometric light perspective, cool slate-gray strokes with a cobalt blue (#3457D5) accent on one block, transparent background, no text, flat, clean, 2px strokes, 1200x900.

4. **Agent Map — hero / onboarding**
   > Abstract node graph illustration: one larger central node connected to several smaller nodes in a tree, some nodes glowing softly as if active, thin connecting lines, deep graphite background #0F131A, cobalt blue (#8BA4FF) and soft orange (#FF9A5C) accents, flat vector, subtle, no text, no gradient-heavy effects, wide 1920x600, suitable as a low-opacity header background.

5. **Bộ icon model (tuỳ chọn)**
   > Set of 4 minimal flat vector badges representing AI model tiers: large heavy crystal (Opus), balanced prism (Sonnet), small light leaf-shaped gem (Haiku), and a generic chip; consistent 2px stroke style, single cobalt blue (#3457D5) accent, transparent background, each 256x256, no text.

Sau khi có ảnh: đặt vào `apps/web/src/assets/art/`, kiểm 4 góc trong suốt.

---

## 6. Thứ tự làm

1. Tên terminal: alias + hint `/rename` (nhỏ, giá trị ngay).
2. Collector `UsageIndex` + cache + protocol + test.
3. Redesign foundation (tokens, typography, tab nav) — load 2 skill design.
4. Tab Usage UI + chart.
5. Animation pass.
6. Gắn art khi chủ nhân gen xong.
7. Validate: CPU khi idle, thời gian quét lần đầu, 375–1440 px, dark/light, EN/VI; cập nhật `.code_index/` + integration doc.

## 7. Cần chủ nhân chốt

- Đổi tên đang làm ở đâu: tab Windows Terminal hay `/rename`?
- Có hiện chi phí USD ước tính không?
- Lịch sử: giữ vô hạn trong cache hay giới hạn (vd 90 ngày)?
