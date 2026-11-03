# WP-7 report: dự báo hạn mức + thiết bị mặc định theo dự án

## Đã đổi
- `apps/web/src/lib/headerStatus.ts`: thêm `limitRisk(claude, codex, nowMs, withinMs?, only?)` (cửa sổ sớm nhất dự báo đầy trước reset; bỏ qua report stale, không có forecast thì null) + test.
- `components/PlanLimits.vue` (mode `list`, dùng trong popover): thêm dòng `data-limit-forecast` "Hết lúc 14:20 nếu dùng như hiện tại" khi `w.risk` và report không stale.
- `components/HeaderStatusPopover.vue`: chấm cảnh báo `data-status-risk` (góc dưới phải, cạnh chấm disk) + thêm vào aria-label khi có rủi ro.
- `components/workspace/LaunchPicker.vue` (cả menu "+" và màn trống): cảnh báo inline 1 dòng `data-launch-limit-warn` khi preset Claude/Codex mà dự báo chạm 100% trong < 30 phút (không chặn; preset shell không hiện).
- `stores/run.ts`: (a) `selectedDevice` chỉ ưu tiên thiết bị đã nhớ khi `ready`, nếu không thì lấy thiết bị ready đầu tiên, nếu không còn thì trả thiết bị đã nhớ (hiện offline); (b) `hold(root)` gọi `reconnectRemembered`: nếu thiết bị nhớ của dự án là Wi-Fi, đang offline và Auto-connect bật thì `devConnectMany([id])` đúng 1 lần/thiết bị/phiên cửa sổ rồi `refreshDevices()`; không poll. Bộ nhớ thiết bị theo dự án (`ccm.run.selected`) đã có sẵn.
- `i18n/ui-v80-limits.ts` (mới): `limitsV80.{runsOutAt,dot,launchWarn}` en + vi.
- Test mới: `lib/headerStatus.test.ts` (limitRisk), `stores/run.test.ts` (3 ca: ưu tiên thiết bị ready, reconnect 1 lần, không reconnect khi tắt auto/đang online/USB). Mock `../lib/devices` trong run.test.

## Tiêu chí / edge case
- Không có forecast: không dòng, không chấm, không cảnh báo (limitRisk null).
- Report stale (>30 phút): bỏ qua cả ba chỗ.
- Thiết bị offline: chọn thiết bị ready khác; nếu là Wi-Fi nhớ + auto-connect thì thử nối lại 1 lần.
- Nhiều thiết bị: thiết bị nhớ ready thắng; không thì ready đầu tiên.
- Dự án mới (chưa nhớ gì): hành vi cũ (ready đầu tiên), không reconnect.
- Không gọi `open_session` (WP-1/main): cảnh báo chỉ ở LaunchPicker (Workspace "+" và màn trống). Nếu cần cho open_session thì main/WP-1 dùng `limitRisk` từ headerStatus.ts.
- Không đụng: App.vue, apps/desktop, en.ts/vi.ts, devices.ts store (chỉ dùng api `devConnectMany` / `devSnapshot` của lib/devices, không mở hold tracker).

## Test
- `npm run typecheck -w @ccm/web` sạch.
- vitest headerStatus + run + src/i18n: 30/30 pass (messages.test chưa phủ file mới vì chưa nối, chuỗi đơn giản).

## Hot file cần thêm (main nối)
- `i18n/index.ts`: `import v80Limits from './ui-v80-limits'` rồi spread `...v80Limits.en` / `...v80Limits.vi` vào resource en / vi (key top-level `limitsV80`), giống cách nối resources-v76.

## Index (.code_index/web.md)
- `lib/headerStatus.ts` `limitRisk`: cửa sổ hạn mức sớm nhất dự báo đầy trước reset (header dot, popover, LaunchPicker).
- `stores/run.ts` `reconnectRemembered` + `selectedDevice`: nhớ thiết bị theo dự án, nối lại Wi-Fi nhớ khi mở Run pane.
- `workspace/LaunchPicker.vue` `soon`: cảnh báo hạn mức < 30 phút khi mở agent.

## Changelog
- en: Limits now warn when they are forecast to run out: a time in the status popover, a dot on the button, and a line when you open a new agent. Run reselects a project's last device and reconnects it over Wi-Fi.
- vi: Hạn mức giờ báo trước khi sắp cạn: giờ dự kiến trong popover trạng thái, chấm trên nút và một dòng khi mở agent mới. Run chọn lại thiết bị dùng gần nhất của dự án và nối lại qua Wi-Fi.

## Commit đề xuất
`📈 v80 WP-7: limit forecast in status popover + launch warning, per-project device reselect and Wi-Fi reconnect`
