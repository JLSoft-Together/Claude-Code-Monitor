# PLAN v53 — Thiết kế lại tab Giám sát (Monitor) + Thống kê (Usage)

Trạng thái: **đã làm P0–P4 (2026-10-16), chờ chủ nhân xem + build**. Kết quả + chỗ lệch spec ở §7.

Chủ nhân (2026-10-16): Monitor rối, subagent phải khác hẳn main agent, làm lại motion; Usage nhiều
thông tin, phải cuộn nhiều. Bắt buộc dùng `frontend-design` + `ui-ux-pro-max`, giữ hệ Apple HIG
(`AUDIT-v18-deck-reference.md` §4, `COLOR-SYSTEM.md`).

Bằng chứng: chụp bản dev build qua CDP (`apps/desktop/e2e/cdp.cjs`), cửa sổ 1600×960, data giả
(`demo-fixture --sessions=4 --subagents=4`) và data thật (`~/.claude`, chỉ đọc). Ảnh ở
`%TEMP%/ccm-e2e/{fixture,real}-{monitor,usage,usage-full}-{dark,light}.png`.

## 0. Quyết định của chủ nhân

| Câu | Chọn |
|---|---|
| Subagent hiển thị | **Viên thuốc (pill) trên graph**, toả nhánh dưới card main; sub xong thu thành **chấm** "● ● ● N đã xong" |
| Usage bố cục | **1 màn kiểu Screen Time** + sheet "Xem tất cả" |
| Số lớn Usage | **Theo nút Token / Chi phí**, tổng = đúng các series đang bật |
| Session panel trái | **Giữ card, bớt rối** (ẩn nút tới khi hover/focus, bỏ gợi ý đổi tên, bỏ phần lặp với node main) |

## 1. Vấn đề đo được

### Monitor
| # | Vấn đề | Bằng chứng |
|---|---|---|
| M1 | Main và subagent gần như y hệt: cùng card, cùng viền, cùng shadow, cùng dòng token + context. Chỉ khác chip "Main agent" 2xs | `AgentNode.vue` một template cho cả hai, khác `px`/`text-base` |
| M2 | **Bug chồng node**: layout xếp theo ô cố định (`ROW_HEIGHT` 128, `MAIN_HEIGHT` 150) chứ không đo chiều cao thật. Sub có dòng token xuống 2 dòng (SUB_WIDTH 240, tiếng Việt) + context gauge + chip `+2.1K` cao ~140px → đè lên node dưới | `lib/layout.ts` `computeLayout`; ảnh fixture dark/light |
| M3 | Session 21 subagent (đã xong hết) → cột cao ~1700px, fit view thu còn ~40%, chữ ~6px không đọc được | ảnh real-monitor |
| M4 | Sub đã xong chiếm chỗ ngang sub đang chạy; muốn gọn phải bấm con mắt "ẩn đã xong" | `settings.hideFinished` |
| M5 | Thanh công cụ map nổi đè lên hàng node đầu (fit view `padding: 0.2` đối xứng, không chừa chỗ toolbar) | ảnh real-monitor; `AgentMap.vue` `fitView` |
| M6 | Motion ồn: mọi node working có `ccm-breathe` vô hạn + mọi cạnh working có nét đứt cam chạy vô hạn → nhiều session = cả màn nhấp nháy; trạng thái "cần chủ nhân" (quan trọng nhất) lại không nổi hơn working | `style.css` `.ccm-breathe`, `.ccm-edge-hot` |
| M7 | Chip `+2.1K` token nảy ra đè lên chữ Input/Output | ảnh fixture |
| M8 | Card session bên trái cao ~300px/cái (5 nút icon luôn hiện, dòng gợi ý đổi tên lặp ở mọi card, model/context/token lặp y như node main) → màn 960px chỉ thấy ~2 session | `SessionCard.vue`, ảnh |
| M9 | Màn có 4 dải ngang: banner "Cần chủ nhân" + toolbar map + metrics strip + thanh tab session | `MonitorView.vue`, `SessionBar` |

### Usage
| # | Vấn đề | Bằng chứng |
|---|---|---|
| U1 | Trang cao **~2870px** ở 1600px (data thật) — cuộn ~3 màn | ảnh real-usage-full |
| U2 | 6 khối số (Tổng + 4 loại token + dải chi phí) lặp đúng thông tin legend biểu đồ | `UsageKpis.vue` |
| U3 | Số lệch: "Tổng token 1.8B" tính cả cache read, biểu đồ ngay dưới mặc định ẩn cache read ("35.1M") → hai con số "tổng" khác 50 lần, không ghi rõ | `UsageKpis` vs `usage.hidden = ['cacheRead']` |
| U4 | Bảng project 10 cột, mỗi dòng 2 tầng (tên + path + thanh), 20+ dòng, có thanh cuộn ngang | `ProjectTable.vue` |
| U5 | "Session đang chạy" lặp với Monitor (token từng session đã có ở node main + SessionBar), bảng cuộn ngang | `UsageLive.vue` |
| U6 | Bảng model 7 cột cho 1–3 dòng, khối nửa trống | `UsageModels.vue` |
| U7 | Biểu đồ 320px cao cho 7 cột, phần lớn khoảng trống | `UsageDailyChart.vue` |
| U8 | Subtitle + footnote dài chiếm chỗ | `UsageView.vue` |

## 2. Hướng thiết kế

Chủ thể: **GolAIm = tháp điều khiển cho một người chạy nhiều Claude cùng lúc**.
- Monitor có đúng 1 việc: *liếc 2 giây biết ai cần mình, ai đang chạy, subagent nào đang làm gì*.
- Usage có đúng 1 việc: *tuần này tốn bao nhiêu, dồn vào đâu, tăng hay giảm*.

Hệ thị giác giữ nguyên (Apple HIG, token màu hiện có, font hệ thống, không gradient). Khác biệt main/sub
làm bằng **kích thước + độ nổi + hình dạng + mật độ**, không thêm màu (status color chỉ cho lifecycle).

Tham chiếu Apple:
- Monitor → sơ đồ tổ chức gọn kiểu **Xcode Debug navigator / Instruments**: tiến trình là khối lớn, thread là nhãn nhỏ.
- Usage → **Screen Time / Battery (macOS Settings)**: 1 biểu đồ cột theo ngày, số lớn + trung bình ngay trên,
  danh sách "dùng nhiều nhất" có thanh ngang bên dưới, bấm 1 ngày để xem riêng ngày đó.

Từ `ui-ux-pro-max` áp: `visual-hierarchy` (size/spacing chứ không màu), `progressive-disclosure`,
`excessive-motion` (1–2 chuyển động chính mỗi view), `motion-meaning` (chuyển động = nhân quả),
`exit-faster-than-enter`, `chart-type` (thành phần theo thời gian → cột chồng; xếp hạng → thanh ngang sắp giảm dần),
`direct-labeling`, `legend-interactive`, `number-tabular`, `reduced-motion`. Phần "design system" sinh tự động
(OLED dark, Lora/Raleway, accent xanh lá) **bỏ** — lệch hệ Apple đã chốt.

**Dấu ấn (signature) duy nhất:** *"giao việc → trả kết quả"* — main giao việc: một chấm sáng chạy theo cạnh
xuống pill sub; sub xong: chấm chạy ngược lên main, rồi pill **co lại thành một chấm** và bay vào hàng
"● ● ● N đã xong". Mọi thứ khác im lặng.

## 3. Monitor

### 3.1 Node: main = card, sub = pill

```
          ┌──────────────────────────────────────────┐   main: bg-surface + shadow-card, 300px,
          │ ✳ claude-code-monitor           Working │   tiêu đề 15px semibold
          │ Opus 5.5 · xhigh     ◔ 14%     102.8K tok │   context = vòng nhỏ (không thanh)
          │ Đang chạy Edit · 2m 14s                   │   dòng "đang làm gì"
          └────────────────────┬─────────────────────┘
             ┌─────────────────┼──────────────────┐
     (✳ Explore · Grep 12s) (✳ Plan · Read 4s) (⚠ general-purpose)   pill: rounded-full, cao 28px,
                               │                                      bg-raised, viền line, không shadow
                     (✳ code-reviewer · Bash 2s)
          ● ● ● ● ● ● ● ● ● ● ● ●  +6   18 đã xong ▸                 khay chấm (1 node)
```

- **Main** (`MainNode.vue`): card nổi, 3 dòng cố định (tiêu đề + trạng thái / model · ◔ context · token /
  dòng hoạt động hoặc lý do chờ). Chip delta `+2.1K` nằm cuối dòng token, không đè chữ (M7). Giữ resize.
- **Sub** (`SubPill.vue`): 1 dòng `glyph · type · tool thời gian` (không running → `type · mô tả` ngắn).
  Độ rộng cố định `PILL_W` 184px (truncate + tooltip đủ chữ) → layout tất định, hết chồng (M2). Token, model,
  context, mô tả đầy đủ → tooltip + `AgentDetails` khi chọn. Codex run: `ProviderBadge` short + cạnh `agent-codex`.
  Sub lỗi giữ dạng pill (glyph ⚠, chữ `st-error`), không vào khay.
- **Khay "đã xong"** (`DoneTray.vue`, 1 node / cây): sub `completed`/`cancelled` thành chấm (tối đa 12 chấm + `+N`),
  hover chấm = tooltip type + mô tả, bấm khay = mở lại các pill (toggle, nhớ theo session). Thay nút con mắt
  "ẩn đã xong" (M4); nút toolbar đổi thành "mở hết / gộp hết khay".
- Main vs sub khác nhau ở **5 chiều**: kích thước (300×~96 vs 184×28), hình (card bo 10 vs viên thuốc), độ nổi
  (shadow vs phẳng), chữ (15 semibold vs 12 medium), lượng thông tin (3 dòng vs 1 dòng). Màu status chỉ ở glyph.
- Giữ mọi tương tác v47 (menu chuột phải, phím mũi tên, find, fold, kéo node, chọn nhiều). Fold node = gộp cả nhánh.

### 3.2 Layout (`lib/layout.ts` viết lại phần cây)
- Cây toả xuống kiểu sơ đồ tổ chức: con của một node xếp thành hàng ngang dưới cha, tối đa `MAX_PER_ROW` = 3
  pill/hàng (quá thì xuống hàng), cháu nằm dưới pill cha. Chiều rộng cột session = max(card main, bề rộng nhánh).
- Kích thước tất định: main dùng `MAIN_H` cố định (hoặc `sizes` khi người dùng resize), pill `PILL_W × PILL_H`,
  khay 1 dòng → không cần đo DOM, test được bằng hàm thuần.
- Cạnh `smoothstep` từ handle **dưới** cha tới handle **trên** con (bus kiểu org chart). Handle target của pill đổi
  từ Left sang Top.
- Fit view chừa phần toolbar: `padding` dạng object (top lớn hơn) hoặc offset viewport sau fit (M5).
- Session 21 sub xong → card + 1 khay ≈ 150px thay ~1700px (M3).

### 3.3 Session panel trái (giữ card, bớt rối — M8)
- 5 nút icon ở header chỉ hiện khi hover / `focus-within` card (bàn phím vẫn tới được), giữ menu chuột phải.
- Bỏ dòng "Tên tự đặt · đổi bằng nút bút chì hoặc /rename" — chuyển vào tooltip nút bút chì.
- Bỏ phần lặp với node main: chip model, thanh context đầy đủ → còn `◔ 14%` nhỏ ở footer cạnh token.
- PID / process / thời gian chạy gộp 1 dòng `text-ink-faint`, hoặc vào tooltip đường dẫn.
- Giữ: tiêu đề, trạng thái + chờ/nhắc sau, signals (cache ấm, loop…), branch/mode, diff, cwd + nút mở, footer
  subagent + token. Đích: ~170px/card (từ ~300px).
- Banner "Cần chủ nhân" giữ nguyên (M9 để sau, không đổi trong v53).

### 3.4 Motion Monitor (thay bộ cũ)
| Sự kiện | Chuyển động | Thời lượng / easing |
|---|---|---|
| Session mới | card main nổi lên (y 8→0 + opacity), cây khác FLIP nhường chỗ | `--ccm-dur-slow`, `--ease-spring` |
| Sub mới | cạnh vẽ từ cha xuống (`ccm-edge-draw` sẵn có) → pill bật ra từ handle cha (scale 0.6→1 + opacity, origin top) → **chấm "giao việc"** chạy xuống theo cạnh | 220 + 220ms |
| Sub đổi tool | crossfade chữ tool (key Transition); đồng hồ là span riêng, không fade mỗi giây | `--ccm-dur-fast` |
| Sub xong | glyph spinner → ✓ (scale 1→1.15→1) · **chấm "trả kết quả"** chạy ngược lên main · token main tick (`CountNum`) · ~1.2s sau pill **co thành chấm** (width/height qua transform scale + border-radius) và FLIP bay vào khay, số khay tick | 300 + 520ms |
| Sub lỗi | 1 lần flash `st-error`, pill ở lại | `--ccm-dur-signal` |
| Mở / gộp khay | chấm nở thành pill (ngược lại của "co thành chấm"), so le 30ms | `--ccm-dur-base` |
| Main đổi trạng thái | capsule crossfade + 1 lần flash viền (`ccm-flash`) | 900ms |
| **Cần chủ nhân** | trạng thái DUY NHẤT chuyển động liên tục: vòng thở quanh card main | 2.2s loop |
| Working | không thở, không nét đứt chạy; chỉ glyph spinner Claude (đã có); cạnh tới sub đang chạy dùng màu `--ccm-working` nét liền | — |
| Session kết thúc / bị xoá | bụi Thanos (`lib/dust.ts`, quy tắc chủ nhân) | sẵn có |
| Reflow | FLIP transform (`.ccm-map-motion`) đổi sang `--ease-spring` | 300ms |
| Reduced motion | tắt hết, giữ đổi icon + màu + chữ; chấm giao/trả không chạy | — |

Bỏ: `.ccm-breathe` trên working, `.ccm-edge-hot` nét đứt vô hạn, chip `+N` đè chữ (M6, M7).
Chấm giao / trả: một `<circle>` SVG trong lớp cạnh, chạy bằng `offset-path` theo `d` của cạnh (hoặc
`getPointAtLength` + rAF nếu Chromium không nhận `offset-path` trên SVG), tối đa ~6 chấm cùng lúc.

## 4. Usage — 1 màn kiểu Screen Time

```
Thống kê  ⓘ                 [Hôm nay|7 ngày|30 ngày|Tất cả] [Token|Chi phí] [Model ▾] [Project ▾]
┌───────────────────────────────────────────────────────────────┬─────────────────────────┐
│ 614 US$            TB 87,7 US$/ngày   ↘ 3% so với 7 ngày trước │ Giới hạn gói            │
│                                                   ┄┄┄ TB ┄┄┄  │ 5 giờ   ▓▓▓▓░░  62%     │
│   ▁    ▁    ▃    ▆    ▇    ▂    █                             │ Tuần    ▓▓░░░░  31%     │
│  T5   T6   T7   CN   T2   T3   T4  (bấm cột = xem riêng ngày)  │ (ẩn nếu không có data)  │
│ ● Input 20.4K  ● Output 3.9M  ● Cache write 31.2M  ○ Cache read 1.7B · 98% đọc cache     │
└───────────────────────────────────────────────────────────────┴─────────────────────────┘
┌ Project dùng nhiều nhất ─────────────────────────┐┌ Model ───────────────────────────┐
│ aimpro-gitlab        ██████████████  144 US$ 23% ││ claude-opus-5-5  █████████  601 │
│ claude-code-monitor  ████████████    123 US$ 20% ││ claude-opus-4-8  ▏          10,6 │
│ JLSoft-Mix-Garden    ████████████    124 US$ 20% ││ claude-haiku-4-5 ▏          3,13 │
│ ar-filter            ███████          77 US$ 13% ││                                  │
│ Dumpling-5           ████             46 US$  7% ││                                  │
│ Xem tất cả 20 project →                          ││                                  │
└──────────────────────────────────────────────────┘└──────────────────────────────────┘
```

- **Hero = biểu đồ + số lớn**, legend chính là KPI (giá trị + % của tổng), bấm legend bật/tắt series. Bỏ `UsageKpis` (U2).
- **Số lớn theo nút Token / Chi phí**: Token → tổng đúng các series đang bật, cache read tắt thì ghi nhỏ
  "không tính cache read" (sửa U3); Chi phí → chi phí ước tính của các series đang bật. Kèm TB/ngày + so với kỳ trước
  (`usage.previous` sẵn có). Tỉ lệ đọc cache nằm ở mục legend Cache read.
- Đường trung bình nét đứt mảnh; biểu đồ cao ~200px (U7); giữ nút bảng (a11y `data-table`) + tooltip phím.
- **Bấm 1 cột ngày** → cột khác mờ, số lớn + 2 danh sách dưới chỉ tính ngày đó; bấm lại / Esc bỏ chọn. Data đủ
  (bucket ngày × model × cwd), không bịa.
- Project / Model: danh sách xếp giảm dần, thanh ngang + giá trị + % (direct label). Bấm = lọc cả trang (hành vi cũ).
  Top 6; "Xem tất cả N project →" mở **sheet** chứa `ProjectTable` hiện có (tìm, sắp xếp, ổ đĩa, gộp repo, phân
  trang — tái dùng) (U4, U6).
- "Session đang chạy" (`UsageLive`) bỏ khỏi Usage (U5) — đã có ở Monitor + SessionBar.
- Subtitle + footnote → icon ⓘ cạnh tiêu đề / cạnh số chi phí (tooltip) (U8). Chip filter đang bật giữ (gọn 1 hàng).
- Mục tiêu: 1600×900 **không cuộn**; < 1100px thì 2 cột dưới xếp chồng; < 900px cột "Giới hạn gói" xuống dưới hero.
- "Giới hạn gói" (5h / tuần từ status line bridge, `PlanLimits` đang ở header) chỉ render khi có data.

### Motion Usage
| Sự kiện | Chuyển động |
|---|---|
| Lần đầu có data | cột mọc từ đáy, so le 20ms (`ccm-grow` sẵn có) |
| Đổi range / metric / filter | cột morph chiều cao (scaleY, `--ccm-dur-slow`, out-quint), số lớn đếm (`CountNum`), hàng danh sách FLIP đổi chỗ + thanh co giãn (transform scaleX) |
| Chọn ngày | cột khác mờ 0.35 (`--ccm-dur-fast`), danh sách crossfade |
| Mở "Xem tất cả" | sheet trượt lên từ nút (`modal-motion`), đóng nhanh hơn mở |
| Reduced motion | đổi tức thì |

## 5. Phân pha

| Pha | Nội dung | File chính |
|---|---|---|
| P0 | Sửa bug chồng node (M2) + toolbar đè node (M5) trên layout hiện tại — độc lập, làm trước | `lib/layout.ts`, `AgentMap.vue` |
| P1 | Main card + sub pill + khay "đã xong" + layout cây org chart | `AgentNode.vue` → `MainNode.vue` + `SubPill.vue` + `DoneTray.vue`, `lib/layout.ts`, `AgentMap.vue` (node type mới, handle Top), `lib/mapNav.ts` (phím qua pill/khay), `AgentDetails.vue` (hiện token/model/context của sub) |
| P2 | Motion Monitor (§3.4): chấm giao/trả, pill → chấm, bỏ breathe/dash | `style.css`, `lib/motion.ts`, composable mới `useDispatchPulse` |
| P3 | Session card bớt rối (§3.3) | `SessionCard.vue`, `SessionCardHeader.vue` |
| P4 | Usage hero + danh sách + sheet + chọn ngày + motion | `usage/UsageView.vue`, `UsageDailyChart.vue` (→ hero), `UsageModels.vue`, `UsageProjects.vue`, `stores/usage.ts` (`selectedDay`, `topProjects`, `heroTotal`); gỡ `UsageKpis` / `UsageLive` khỏi view |

Mỗi pha: chuỗi i18n `en` + `vi`, màu qua token (`COLOR-SYSTEM.md`), unit test (layout đang test trong
`stores/stores.test.ts` → tách `lib/layout.test.ts`; `stores/usage.test.ts`), sửa E2E `apps/desktop/e2e/agent-map.cjs`
theo selector mới, chụp lại ảnh so sánh bằng CDP, cập nhật `.code_index/web.md` + `_meta.md`. Không comment trong code.
Không commit khi chưa được bảo.

## 6. Rủi ro / chú ý
- Vue Flow: đổi node type + handle → kiểm lại kéo node, vị trí đã lưu (`ui.setNodePos`, `ccm.mapLayout`) — vị trí cũ
  của sub không còn hợp với layout cây → reset vị trí sub đã lưu một lần (migration key).
- `nodeSizes` (resize) giữ cho main; bỏ cho sub (pill cố định).
- Chấm chạy theo cạnh: kiểm `offset-path` với path SVG trên Chromium của Electron đang dùng; fallback rAF.
- Usage chọn ngày: mọi computed (`byModel`, `byProject`, totals) phải nhận `selectedDay` — thêm test.

## 7. Kết quả (2026-10-16)

Làm song song: map (P0–P2) ở luồng chính, P3 + P4 hai subagent, chia theo file; i18n tách 3 module `monitor-v53` / `session-v53` / `usage-v53`.

Kiểm: `npm run typecheck -w @ccm/web` sạch · `npm test -w @ccm/web` 72 file / 708 test pass · E2E `agent-map.cjs` 34/34 pass (chạy qua Vite dev + Electron `--dev-url`, không build) · ảnh CDP `%TEMP%/ccm-e2e/v53-*.png` · Usage 1600×900 không cuộn (scrollHeight = 900, data thật 7 / 30 ngày, dark + light).

Lệch so với spec / quyết định khi làm:
- P0 gộp vào P1: layout viết lại hẳn (kích thước tất định) nên hết chồng node, không vá layout cũ.
- Cây kiểu "lược" (trunk bên trái, bus ngang trên mỗi hàng) thay vì toả giữa: cạnh tới hàng thứ 2 không cắt qua pill hàng 1. Số pill/hàng (1/2/3) tự chọn theo độ phóng vừa màn (`pickLayout`).
- Pill rộng 240px (208 cắt mất tên tool khi type dài như `general-purpose`).
- Cạnh tới sub đang chạy không tô màu working (các cạnh chồng ở trunk trông rối); màu chỉ ở viền pill + chấm giao/trả.
- Handle của Vue Flow đặt trong khung tĩnh ngoài phần thân có animation (Vue Flow đo handle lúc mount, scale/translate làm lệch cạnh).
- Nền sơ đồ `bg-canvas` để card main (surface + shadow) nổi hơn.
- Kéo card main → cả cây đi theo khi thả.
- Usage: sheet "Xem tất cả" dùng lại `ProjectPickerDialog` (mode `all`); hàng danh sách đổi thứ hạng thì trượt (không bụi — không phải xoá); khi chọn ngày ẩn TB/ngày + so kỳ trước; % legend = phần trong cả 4 loại token, % danh sách = phần của số lớn.
- Card session: `ContextRing` dùng chung với node main (gộp bản của P3).
- Dọn 24 key i18n không còn dùng (`usage.*` cũ, `terminal.nameHint`).

Chưa kiểm được: cột "Giới hạn gói" ở Usage (bản dev cách ly không có file status line bridge), animation pill → chấm → khay chỉ thấy qua CSS + 1 frame chụp, chưa quay video.
