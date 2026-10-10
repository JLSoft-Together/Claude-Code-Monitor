# PLAN v14 — Monitor layout / Agent Map

Mockups: https://claude.ai/artifact/Hiam71HxAdwSFUCUaCSoTx

## Nguyên nhân (window 1360×860)

1. Grid `lg:h-[calc(100dvh-header-2rem)]` (MonitorView.vue:91, SessionView.vue:17) không trừ SessionTabs + WaitingQueue + MetricsStrip → đáy map dưới fold ~150px.
2. `AgentDetails` `absolute bottom-3` trong canvas (AgentDetails.vue:61) → rơi vào vùng khuất; khi thấy thì che node.
3. Sessions 360 + Activity 340 cố định (ui.ts:42) → map ~580px.
4. `max-w-[1800px]` Monitor/Header, `max-w-[1560px]` Usage/History → màn rộng bỏ trống.

## Phương án

- **A. Vừa khung (S, 1–2 ngày)**: bỏ max-w; App shell `h-dvh flex-col`, grid `flex-1 min-h-0`; MetricsStrip compact 1 dòng (auto khi cao < 900); AgentDetails neo top-right + pan tránh che; default sessions 310 / activity 260, activity auto-rail < 1440.
- **B. Workbench + Inspector (M, 4–6 ngày) — đề xuất đích**: sessions trái (card compact), map giữa full height, Inspector phải (Agent | Session | Activity theo selection), StatusBar đáy thay MetricsStrip; `[` `]` toggle cột, `F` fit; < 1024: drawer + bottom sheet.
- **C. Map toàn màn, panel nổi (M–L)**: không đề xuất (mất tổng quan).
- **D. Tab session thanh tóm tắt ngang (S–M, 2 ngày)**: thay cột SessionCard 360 bằng header ngang; map ~980px; main agent auto-select.

- **E. C + D (M, 4–5 ngày) — chủ nhân thích**: map full màn; `SessionBar` ngang (tab session + tóm tắt / số liệu tổng ở "Tất cả", thay MetricsStrip) dock đáy mặc định, đổi lên trên (⇅), thu gọn 1 dòng (▾, phím B), persisted; Sessions (S) / Activity (A) panel nổi, Shift = ghim thành cột; chi tiết agent = popover cạnh node (flowToScreen, lật khi gần mép; khi ghim Activity thì hiện trong panel); < 768 px: drawer + bottom sheet. File: SessionBar.vue, FloatingPanel.vue, AgentPopover.vue mới; AgentMap, MonitorView, SessionView, App, ui.ts, tour, i18n.

## Lộ trình

1. A → bản vá v1.1.2.
2. D (thử Inspector trong tab session).
3. B nếu D ổn, có toggle "Bố cục cũ" 1 phiên bản.

## Chờ chủ nhân chốt

- Màn hình chính (1360 window / FHD / 2K+)?
- Activity luôn hiện hay chỉ khi chưa chọn?
- MetricsStrip: giữ ô hay chip/status bar?
- Giữ tab session hay gộp vào Inspector?

## Chốt: E (2026-10-10)

- Đã làm: bố cục E + phím tắt dễ thấy: badge phím (KeyHint) trên nút, bật/tắt bằng H / Settings / Ctrl+K, phím ? mở bảng phím tắt.
- Mặc định: Sessions ghim cột, Activity đóng, thanh ở đáy.
- Chưa làm: map tự pan tránh panel nổi; bottom sheet < 768 px; sửa lại nội dung tour.
