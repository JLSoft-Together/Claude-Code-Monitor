# PLAN v3 — Audit · Vision · Tính năng tiếp theo

Ngày: 2026-10-07. Nối tiếp `PLAN.md` (MVP) và `PLAN-v2.md` (Usage, alias, redesign, animation). Ràng buộc giữ nguyên:
- chỉ quan sát, không tốn token, chỉ chạy trên 127.0.0.1;
- không lộ nội dung session;
- token và tiền chỉ hiện khi dữ liệu tin cậy.

---

## 1. Audit hiện trạng

### Đã có
| Mảng | Có gì |
|---|---|
| Giám sát | Session sống, status (working/waiting/idle/stale), tool đang chạy, cây main → subagent lồng nhau, activity feed |
| Agent Map | Vue Flow, token trên node, ẩn subagent đã xong, focus theo session |
| Thống kê | Token theo ngày / model / project, 4 loại token, chi phí ước tính, lịch sử giữ mãi (cache JSON) |
| Đặt tên | Alias trên dashboard + gợi ý `/rename`, `claude -n` |
| UX | Dark/light, EN/VI, animation, thu gọn panel Session / Hoạt động |

### Khoảng trống (theo mức ảnh hưởng)
1. **Không báo khi session chờ mình.** Status `waiting` chỉ hiện khi đang nhìn tab dashboard. Mà đây là lý do chính để mở một monitor: biết lúc nào Claude cần mình.
2. **Không thấy context còn bao nhiêu.** Session sắp đầy context (sẽ tự compact, chậm, mất ngữ cảnh) nhưng dashboard không cảnh báo.
3. **Chi phí chỉ là ước tính.** Transcript có record `cost-state` do chính Claude ghi (`totalCostUSD`, `modelUsage[*].costUSD`), nhưng dashboard chưa dùng.
4. **Không thấy chế độ quyền.** Record `permission-mode` (`auto`, `plan`, `bypassPermissions`, …) chưa hiện. Session đang `bypass` là thông tin an toàn quan trọng.
5. **Không có số liệu năng suất.** Đã có `turn_duration.durationMs`, `cost-state.totalLinesAdded/Removed`, số lần gọi theo tên tool, tool lỗi, nhưng chưa gom lại.
6. **Compact không hiện trong activity.** Record `compact_boundary` có `trigger` và `preTokens → postTokens`.
7. **Session đã đóng biến mất** sau 120 phút; không xem lại được session hôm qua đã làm gì (số liệu, không phải nội dung).
8. Nợ kỹ thuật:
   - Map không tự fit lại sau khi thu gọn panel.
   - Art chưa gắn.
   - Chưa validate thủ công 375–1440 px.
   - Chưa chạy typecheck sau v2 (chủ nhân tự chạy).

### Nguồn dữ liệu mới đã kiểm (2.1.289, chỉ đọc key và enum)

| Record | Field dùng được | Ghi chú riêng tư |
|---|---|---|
| `cost-state` | `totalCostUSD`, `modelUsage{model → inputTokens, outputTokens, thinkingTokens, cacheRead/CreationInputTokens, webSearchRequests, costUSD}`, `totalLinesAdded/Removed`, `totalAPIDuration`, `totalToolDuration`, `totalDuration` | Chỉ số liệu → an toàn. 36 record / 40 transcript gần nhất (không phải session nào cũng có) |
| `permission-mode` | `permissionMode` (thấy: `auto`) | Enum → an toàn |
| `mode` | `mode` (thấy: `normal`) | Enum |
| `system/turn_duration` | `durationMs`, `messageCount` | Số |
| `system/compact_boundary` | `compactMetadata.trigger` (`manual`/`auto`), `preTokens`, `postTokens`, `durationMs` | Số + enum. **Không** gửi `content` |
| `assistant.message.usage` | context hiện tại ≈ `input + cache_read + cache_creation` của message main mới nhất | Model id có hậu tố `[1m]` → cửa sổ 1M, còn lại 200k |
| record chung | `gitBranch` | Tên branch là metadata, hiện được |

Không dùng: `away_summary.content`, `ai-title`, `last-prompt`, `attachment`, tham số tool (đúng hard rule).

---

## 2. Product vision

**Vấn đề gốc:** người chạy nhiều Claude Code cùng lúc phải liên tục chuyển qua các terminal để biết cái nào xong, cái nào đang kẹt chờ mình, cái nào sắp hết context, và hôm nay đã tốn bao nhiêu. Thiếu một nơi để nhìn bao quát, nên mất tập trung và tốn thời gian chờ không cần thiết.

Phương án:
1. *"Một cái nhìn, biết hết mọi Claude đang làm gì — không tốn thêm một token nào."*
2. *"Để Claude làm việc, để monitor canh chừng, để bạn chỉ quay lại khi thật sự cần."*
3. *"Trạm điều khiển yên tĩnh cho người làm việc cùng nhiều Claude."*
4. *"Không bao giờ để một Claude phải chờ bạn mà bạn không biết."*
5. *"Biết rõ mỗi Claude đang làm gì, tốn bao nhiêu, và lúc nào cần bạn."*

**Chọn: (2)** — *"Để Claude làm việc, để monitor canh chừng, để bạn chỉ quay lại khi thật sự cần."*

- **Truyền cảm hứng:** hứa lấy lại sự tập trung chứ không chỉ đưa thêm số liệu.
- **Khả thi:** dữ liệu cần đã có sẵn trên máy (waiting, context, cost-state), không phải gọi API.
- **Cảm xúc:** bớt lo bỏ sót và yên tâm giao việc.
- **Hợp giá trị dự án:** chỉ quan sát, riêng tư, không tốn token, nên "canh chừng" không đánh đổi gì.

**North-star metric:** thời gian từ lúc session chuyển `waiting` tới lúc người dùng phản hồi (giảm). Đo local bằng `waiting → working`, không gửi đi đâu.

---

## 3. Ứng viên tính năng (ưu tiên)

| # | Tính năng | Giá trị | Công sức | Rủi ro dữ liệu | Ưu tiên |
|---|---|---|---|---|---|
| F1 | Thông báo khi session chờ / xong (desktop notification + badge title tab) | Rất cao (đúng north-star) | S | Không | **P0** |
| F2 | Đồng hồ context (% cửa sổ) trên card + node, cảnh báo ≥ 80% | Cao | S | Thấp (ghi "ước tính") | **P0** |
| F3 | Badge chế độ quyền (auto/plan/bypass) + branch git trên card | Cao (an toàn) | S | Không | **P0** |
| F4 | Chi phí do Claude ghi (`cost-state`) cạnh chi phí ước tính | Trung bình–cao | M | Không | P1 |
| F5 | Compact trong activity + số lần compact trên card | Trung bình | S | Không | P1 |
| F6 | Thống kê năng suất: thời gian mỗi turn, số dòng thêm/xoá, top tool theo tên + tỉ lệ lỗi | Trung bình | M | Chỉ tên tool | P1 |
| F7 | Lịch sử session đã đóng (bảng: tên, project, thời lượng, token, chi phí, dòng code) | Trung bình | M–L | Không | P2 |
| F8 | Ngưỡng ngân sách ngày (token / $) → cảnh báo | Trung bình | S | Không | P2 |
| F9 | Tìm / lọc session, phím tắt (`/` tìm, `1/2` đổi tab, `[ ]` thu gọn panel) | Thấp–trung bình | S | Không | P2 |
| F10 | Xuất CSV thống kê | Thấp | S | Không | P3 |

Không làm:
- Tự focus đúng tab Windows Terminal: không map được PID sang tab.
- Đọc nội dung hoặc tóm tắt hội thoại: vi phạm quy tắc riêng tư.
- Gửi thông báo ra ngoài máy (Discord, điện thoại): ra ngoài 127.0.0.1, để sau nếu chủ nhân muốn và chủ động cấu hình.

---

## 4. User stories

### F1 — Thông báo khi session cần mình
**Description:** Là người chạy nhiều session, tôi muốn được báo ngay khi một session chờ tôi hoặc làm xong, để tôi không phải canh từng terminal.
**Design:** chưa có — chuông trên header + popover cài đặt.

**Acceptance criteria:**
1. Lần đầu bấm chuông trên header thì trình duyệt hỏi quyền Notification; bị từ chối thì chuông hiện trạng thái "bị chặn" kèm hướng dẫn bật lại.
2. Session chuyển `working → waiting` thì trong ≤ 2 s có notification ghi tên session (alias nếu có) và lý do chờ (`permission`, `input`, …), không kèm nội dung prompt.
3. Session chuyển `working → idle` (turn xong) chỉ báo khi người dùng bật tùy chọn "Báo khi xong"; mặc định tắt.
4. Tab dashboard đang được nhìn thì không bắn notification, chỉ flash card. Title tab trình duyệt hiện `(N) Claude Code Monitor` với N = số session đang chờ.
5. Bấm notification thì focus tab dashboard, chuyển sang màn Giám sát và focus session đó trên map.
6. Cùng một session không bắn quá 1 thông báo / 30 s. Cài đặt (bật/tắt từng loại) lưu `localStorage` (try/catch). Mọi chuỗi đều qua i18n.

### F2 — Đồng hồ context
**Description:** Là người dùng, tôi muốn thấy mỗi session đã dùng bao nhiêu % context, để chủ động `/compact` hoặc mở session mới trước khi bị chậm.
**Design:** thanh mảnh dưới tên session trên card + vòng nhỏ trên AgentNode.

**Acceptance criteria:**
1. Context hiện tại = `input + cache_read + cache_creation` của message assistant mới nhất của main agent. Collector chỉ gửi con số, không gửi message.
2. Cửa sổ = 1 000 000 nếu model id có `[1m]`, còn lại 200 000. Bảng giới hạn đặt trong `packages/shared`, model lạ thì không hiện gauge.
3. Hiện `% + "≈ 412k / 1M"`, tooltip ghi "ước tính". Gauge có icon + text + màu, không chỉ dựa vào màu.
4. ≥ 80% đổi sang màu cảnh báo kèm icon; ≥ 95% đổi sang màu lỗi.
5. Sau `compact_boundary` gauge cập nhật theo `postTokens` ngay, không đợi message kế tiếp.
6. Subagent có gauge riêng trong AgentDetails. Không làm giật layout khi số thay đổi (`tabular-nums`, giữ sẵn chỗ).

### F3 — Chế độ quyền và branch
**Description:** Là người dùng, tôi muốn thấy session nào đang ở chế độ `bypass`/`auto`/`plan` và đang ở branch nào, để tránh nhầm và biết session nào đang chạy không cần hỏi.
**Design:** badge cạnh `kind` trên SessionCard.

**Acceptance criteria:**
1. Collector đọc `permission-mode.permissionMode` mới nhất và `gitBranch` của record mới nhất, rồi gửi trong `TerminalSession`.
2. Giá trị enum lạ thì hiện nguyên chuỗi, không crash. Thiếu dữ liệu thì không hiện badge.
3. `bypassPermissions` dùng màu cảnh báo + icon khiên. `plan` / `auto` dùng màu trung tính + icon riêng.
4. Đổi chế độ thì card cập nhật trong ≤ 2 s và activity feed ghi "chuyển sang chế độ X".
5. Branch dài thì cắt ngắn kèm tooltip, không gây scroll ngang. `HEAD` (detached) hiện "detached".

### F4 — Chi phí do Claude ghi
**Description:** Là người dùng, tôi muốn thấy chi phí do chính Claude Code ghi cho mỗi session, để so với ước tính và tin con số hơn.
**Design:** dòng phụ trong tab Thống kê + UsageLive.

**Acceptance criteria:**
1. Collector đọc record `cost-state` mới nhất mỗi transcript. Chỉ lấy `totalCostUSD`, `modelUsage[*].costUSD`, `totalLinesAdded/Removed`, `totalDuration`.
2. UsageLive có cột "Claude ghi" khi có dữ liệu, không có thì "—". Không bịa số.
3. KPI chi phí của tab Thống kê hiện "Claude ghi $X · ước tính $Y" khi khoảng thời gian có cost-state. Nhãn giải thích khi hai số lệch nhau.
4. `hasUnknownModelCost = true` thì gắn cảnh báo "có model chưa biết giá".
5. Số liệu cost-state được lưu vào usage cache để còn sau khi transcript bị xoá. Có test cho parse và dedupe (lấy record mới nhất mỗi session).

### F5 — Compact trong activity
**Description:** Là người dùng, tôi muốn biết khi nào session bị compact và mất bao nhiêu context, để hiểu vì sao Claude "quên".
**Acceptance criteria:**
1. `compact_boundary` sinh activity "{title} compact {pre} → {post} ({trigger})".
2. Card hiện số lần compact trong cuộc hội thoại hiện tại (reset khi `/clear`).
3. Không gửi `content`, `preservedSegment`, `preservedMessages`.
4. Có test với record mẫu (manual và auto).

### F6 — Thống kê năng suất
**Description:** Là người dùng, tôi muốn xem thời gian mỗi turn, số dòng code thay đổi và các tool hay dùng, để hiểu Claude đang làm gì nhiều nhất.
**Acceptance criteria:**
1. Tab Thống kê có thêm khối "Năng suất": tổng turn, thời gian turn trung vị / p90, dòng +/−, theo cùng bộ lọc ngày / model / project.
2. Khối "Tool" gồm top 10 theo số lần gọi kèm tỉ lệ lỗi. Chỉ dùng tên tool; tool MCP gom theo server (`mcp__<server>`).
3. Dữ liệu tính tăng dần trong `UsageIndex` (cùng offset), cache version tăng, có migration (quét lại).
4. Có bảng thay thế cho biểu đồ (a11y). Màu theo palette dataviz đã validate.
5. Quét warm start vẫn dưới 300 ms trên dữ liệu thật.

### F7 — Lịch sử session
**Description:** Là người dùng, tôi muốn xem lại các session đã đóng gần đây (số liệu, không nội dung), để biết hôm qua mỗi session tốn bao nhiêu và chạy bao lâu.
**Acceptance criteria:**
1. Khi session đóng hoặc hết TTL, collector lưu bản tóm tắt gồm tên hiển thị, project, bắt đầu/kết thúc, model, token theo loại, chi phí, dòng +/−, số subagent.
2. Tab Thống kê có bảng "Session gần đây", phân trang 50 dòng, sắp xếp theo cột.
3. Không lưu prompt, title do AI tạo hay đường dẫn file ngoài cwd.
4. Lưu trong `CCM_DATA_DIR`, có giới hạn (mặc định 1000 session) để file không phình.
5. Có nút xoá lịch sử (kèm xác nhận).

### F8 — Ngưỡng ngân sách
**Acceptance criteria:**
1. Cài đặt ngưỡng ngày theo token hoặc $ ước tính (để trống = tắt).
2. Vượt 80% và 100% thì banner trên header kèm notification (dùng lại F1), mỗi mức chỉ báo một lần trong ngày.
3. Nói rõ là ước tính, gói subscription tính khác.

### F9 — Tìm kiếm và phím tắt
**Acceptance criteria:**
1. Phím `/` focus ô tìm session (theo tên, alias, project). `Esc` xoá ô tìm.
2. `1`/`2` đổi tab, `[`/`]` thu gọn panel, `f` fit map. Không bắt phím khi đang gõ trong input.
3. Có bảng liệt kê phím tắt (`?`).

---

## 5. Thứ tự đề xuất

1. **Sprint A (P0):**
   - F1: thông báo.
   - F3: badge chế độ quyền + branch.
   - F2: gauge context.
   - Kèm: map tự fit sau khi thu gọn panel.
   - Đây là bộ đưa sản phẩm tới vision ("chỉ quay lại khi cần").
2. **Sprint B (P1):** F5 compact → F4 cost-state → F6 năng suất (cùng `UsageIndex`, chung một lần nâng cache version).
3. **Sprint C (P2+):** F7 lịch sử → F8 ngân sách → F9 phím tắt → F10 CSV.

Mỗi tính năng phải:
- có test collector khi đổi parser;
- thêm i18n en/vi;
- cập nhật `.code_index/` và `docs/claude-code-integration.md` (record mới).

## 6. Đã chốt (2026-10-07)

- F1 báo cả khi chờ lẫn khi Claude trả lời xong (tắt được từng loại).
- F2 ba ngưỡng 60 / 80 / 95 %.
- F7 giữ 1000 session.
- Thêm theo yêu cầu:
  - Bộ màu cam cũ ("Cam Claude", mặc định) + Cobalt trong Cài đặt.
  - ★ yêu thích thư mục + mở Claude mới / `--continue` từ thư mục đó.
  - Bảng project full width (tìm kiếm, lọc ổ đĩa, sắp xếp, 25–500 dòng/trang).
  - Dialog chọn project thay dropdown.

### Trạng thái
- XONG Sprint A: F1, F2, F3 + map tự fit khi thu gọn panel + các mục thêm ở trên. Collector test 32, web test 14.
- CÒN: Sprint B (F4 cost-state, F5 đã có activity + đếm compact → chỉ còn phần trên Usage, F6), Sprint C (F7–F10).
- Chưa validate thủ công giao diện 375–1440 px. Chưa thử mở terminal thật từ Yêu thích (chủ nhân thử giúp).

## 7. Art + animation (prompt để chủ nhân gen)

Bộ màu mặc định giờ là **Cam Claude**:
- nền sáng #F4F4F2 / tối #121211;
- cam #B4532F (sáng) / #E08A68 (tối);
- xám ấm #5F5E58.

Xuất PNG nền trong suốt hoặc SVG, đặt vào `apps/web/src/assets/art/`. Animation: ưu tiên **Lottie JSON** hoặc **SVG có thể tách lớp**; tránh GIF/video (nặng, không tôn trọng reduced-motion). Mọi animation phải có ảnh tĩnh thay thế.

1. **Logo / favicon (thay prompt cũ)**
   > Minimal flat vector app icon for a developer tool "Claude Code Monitor": a radar sweep arc merged with a terminal chevron ">_", a small 8-point asterisk spark at the center, two colors only — warm clay orange #B4532F and near-black warm charcoal #1B1B19, geometric, centered, generous padding, transparent background, no text, no gradient, crisp at 32px, 1024x1024.

2. **Empty state — chưa có session** (panel Session)
   > Minimal line illustration: a closed laptop-style terminal window with a sleeping cursor, a tiny radar dish beside it, three faint dotted orbit rings, warm gray #8A8880 2px strokes with one clay orange #B4532F accent on the cursor, lots of whitespace, transparent background, flat, calm, no text, 1200x900.

3. **Empty state — Yêu thích trống**
   > Minimal line illustration of a folder with a small outlined star pinned on its tab and a terminal prompt ">_" peeking out, warm gray 2px strokes, single clay orange #B4532F accent on the star, transparent background, no text, flat, 800x600.

4. **Empty state — tìm project không thấy** (dialog chọn project)
   > Minimal line illustration of a magnifying glass over a stack of folder tabs labeled with blank drive badges, one tab slightly lifted, warm gray 2px strokes, clay orange #B4532F accent ring on the lens, transparent background, no text, flat, 800x600.

5. **Empty state — Thống kê chưa có dữ liệu**
   > Minimal isometric line illustration of an empty bar chart where a tiny geometric hand places the first token block, warm gray strokes, clay orange #B4532F accent on that block, transparent background, no text, flat, 2px strokes, 1200x900.

6. **Ảnh nền header Agent Map (opacity thấp)**
   > Abstract node graph: one larger central node linked to smaller nodes in a loose tree, a few nodes softly glowing as if active, thin connecting lines, background warm charcoal #121211, accents clay orange #E08A68 and muted amber #E3B552, flat vector, very subtle, no text, wide 1920x600, designed to sit at 8–12% opacity behind UI.

7. **Animation — logo "đang quét" khi collector đang kết nối / quét usage** (Lottie, loop 2 s)
   > Lottie animation, 2-second seamless loop, 256x256: radar sweep arc rotating 360° around a terminal chevron ">_", the asterisk spark at the center pulses scale 0.9→1.1 once per loop, two flat colors clay orange #B4532F and charcoal #1B1B19, transparent background, no gradients, layers separated (arc, chevron, spark) so color can be themed.

8. **Animation — "đã xong" (check pop)** cho node subagent completed / toast mở terminal (Lottie, 600 ms, chạy 1 lần)
   > Lottie one-shot 600 ms, 128x128: a thin circle draws itself clockwise (0–300 ms), then a check mark strokes in (300–500 ms) with a tiny 8-point spark burst fading out (450–600 ms), stroke color as a single themable layer (default #3F7A3B), transparent background, ease-out curves.

9. **Animation — chuông thông báo** (Lottie, 800 ms, chạy 1 lần khi bật thông báo)
   > Lottie one-shot 800 ms, 96x96: outline bell swings left-right twice with damping, a small dot badge pops in at the top right at the end, single stroke color layer (clay orange #B4532F), transparent background, 2px strokes, no fill.

Gen xong đưa con file. Con sẽ gắn ảnh, nối animation qua `lottie-web` (light build, chỉ tải khi cần) và tắt animation khi bật `prefers-reduced-motion`.

## 8. Gợi ý thêm tính năng (ngoài plan)

| # | Ý tưởng | Vì sao đáng làm |
|---|---|---|
| G1 | **Bảng phím tắt + command palette (Ctrl+K)**: nhảy tới session, mở yêu thích, đổi tab | Nhanh hơn chuột khi có nhiều session |
| G2 | **Hàng đợi "cần mình"** ở đầu màn Giám sát: các session đang chờ, sắp theo thời gian đã chờ | Đúng north-star: giảm thời gian chờ |
| G3 | **Đồng hồ "đã chờ X phút"** trên card waiting + nhắc lại thông báo sau 5 phút | Đỡ quên session chờ lâu |
| G4 | **Cảnh báo context 95 % bằng thông báo** (dùng lại F1) | Kịp `/compact` trước khi tự compact |
| G5 | **Heatmap giờ × thứ** trong Thống kê (cần thêm bucket theo giờ) | Biết lúc nào dùng nhiều, hợp lý cho budget |
| G6 | **So sánh kỳ trước** (tuần này vs tuần trước, % thay đổi) trên KPI | Thấy xu hướng ngay |
| G7 | **Nhóm project theo repo gốc**: gộp các thư mục con (`app/src/...`) vào project cha có `.git` | Bảng project hiện có nhiều thư mục con lặt vặt |
| G8 | **Ghim (pin) session** lên đầu danh sách + sắp xếp theo trạng thái | Danh sách dài vẫn dễ nhìn |
| G9 | **Chế độ "TV / màn phụ"**: chỉ Agent Map + hàng đợi, chữ to, tự fit | Treo trên màn hình thứ 2 |
| G10 | **Xuất báo cáo tuần** (HTML/CSV) từ Thống kê | Gửi team / tự theo dõi |

Đề xuất làm trước: G7 (giải quyết đúng vấn đề bảng project đang thấy), G2, G3, G4.

**XONG (2026-10-07):** G2 hàng "Cần chủ nhân", G3 thời gian chờ + nhắc lại mỗi 5 phút (tối đa 3 lần), G4 thông báo context ≥ 95 %, G7 gộp theo repo git (216 thư mục → 45 project trên dữ liệu thật, bật/tắt được).
