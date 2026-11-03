# WP-8 report: một toast stack + scripts/measure.mjs

## Đã đổi
- `apps/web/src/stores/toasts.ts` (mới): `push({ id?, kind, text, title?, detail?, meta?, actions?, art?, icon?, timeoutMs, attrs?, dismissAttrs?, onDismiss? })`, dedupe theo id (thay tại chỗ, đếm lại giờ), `dismiss(id, reason)`, `remove(id)` (im lặng, không gọi onDismiss), `hold(id, on)` (hover/focus dừng đếm, nhả thì đếm lại từ đầu như UndoToast cũ), `dismissTop`, `visible` = 3 cái mới nhất (cái dư chờ, timer chỉ chạy cho cái đang hiện).
- `apps/web/src/components/ToastHost.vue` (mới, mount 1 lần ở App.vue): góc phải dưới, `aria-live="polite"`, không cướp focus, Esc đóng cái mới nhất, TransitionGroup (motion-safe), hover/focus dừng đếm.
- `apps/web/src/composables/useAppToasts.ts` (mới): Break (theo `ui.breakDue`) + PhoneFail (theo `onPhone`, chỉ khi `hasPhone`) đẩy vào store.
- `App.vue`: bỏ BreakToast/PhoneFailToast, thêm `<ToastHost />` + `useAppToasts()`.
- `WorkspaceView.vue`: bỏ `<UndoToast>` + `agentNotice` (ref, timer, `<p>`); `showNotice` -> toast `ws-notice` 4 s; Undo = watch trên `closedStack` đẩy toast `ws-undo` (nút Hoàn tác + phím + tooltip, dòng shell note, 6 s mặc định, X/Esc -> refocus pane, hết giờ thì không refocus); ẩn workspace thì toast gỡ.
- Xoá: `components/BreakToast.vue`, `components/PhoneFailToast.vue`, `components/workspace/UndoToast.vue`.
- `i18n/ui-v80-toast.ts` (mới): `toast.close` (en "Dismiss notification" / vi "Đóng thông báo"). CHƯA được nối vào en.ts/vi.ts (xem Hot file).
- `scripts/measure.mjs` (mới), `docs/perf/3.0.0-v80.json` (mới), `apps/web/src/stores/toasts.test.ts` (5 test), `apps/desktop/e2e/v80-toasts.cjs` (8 check).

## Bảng toast cũ -> mới
| Cũ | Mới | Hành vi giữ |
|---|---|---|
| BreakToast (ui.breakDue, z-40 phải dưới) | toast `break`, sticky (timeout 0) | art, tiêu đề, nội dung, "since/worked", "next", nút Tắt nhắc (`breakReminder=false`) + Xong, X; dismiss -> `ui.breakDue = null` |
| PhoneFailToast (`data-phone-fail`) | toast `phoneFail`, sticky | icon cảnh báo, tiêu đề, lỗi theo mã, nút mở Settings › Thông báo (đóng toast), giữ `data-phone-fail` (e2e v76 pass) |
| UndoToast (`data-undo-toast`/`data-undo`/`data-undo-dismiss`) | toast `undo` (id `ws-undo`) | 6 s, hover/focus dừng, Hoàn tác + phím, shell note, Esc/X refocus, e2e v52 F2 pass |
| agentNotice `<p>` (workspace.handoff.noTarget) | toast `info` (id `ws-notice`) | 4 s |
| ui.openResult / windowResult | GIỮ NGUYÊN, không gộp | là lỗi inline theo từng thẻ (`terminalId`, hiển thị trong SessionCardHeader / CompactView / WaitingQueue, có unit test); đổi thành toast sẽ mất ngữ cảnh "thẻ nào". Timer 6 s vẫn ở ui.ts. |

Vị trí đổi: Undo trước ở giữa-dưới vùng Workspace, notice giữa-dưới màn hình; giờ tất cả góc phải dưới.

## Edge case đã xét
- Nhiều toast cùng lúc: tối đa 3 hiện, dư xếp hàng (test: cái chờ không hết hạn khi chưa được hiện).
- Toast khi dialog mở: Esc không lấy cái toast nếu `[role=dialog]`/`[aria-modal]` đang có hoặc Esc đã bị preventDefault (e2e: Esc với Shortcuts mở chỉ đóng dialog). Esc trong terminal / input / `.xterm` / `.cm-editor` không bị chặn.
- Reduce motion: translate chỉ khi `motion-safe:`; thời lượng dùng `--ccm-dur-*` (đã về 0 ở reduce motion).
- Break bị bắn lại khi đang hiện: thay tại chỗ (cùng id), không nhân đôi.

## Số đo (docs/perf/3.0.0-v80.json, `node scripts/measure.mjs --startup --label=v80`)
- Bundle: 191 chunk; JS 10 837 KB (gzip 2 473 KB), CSS 200 KB (gzip 36 KB), gzip tổng 2 509 KB, font 2 016 KB. Lớn nhất: index 1 572 KB (gzip 518), WorkspaceView 1 446 KB (gzip 423), cpp 778 KB.
- Quan sát: `cpp-*`, `typescript-*`, `jsx-*` xuất hiện 2 bản cùng kích thước (hash khác) - nghi theme sáng/tối của shiki bị tách đôi, đáng xem lại.
- Startup (dev build, reload trên collector đã ấm, ms từ navigation start, 3 lần): `#app` mount trung vị 61, first snapshot 70, FCP 84. Đây là số reload có cache, không phải cold start.

## Test
- `npm run typecheck -w @ccm/web` sạch. Vitest web toàn bộ: 618 file, 1651 test, 0 fail (kể cả toasts.test.ts và `src/i18n`).
- Build web + desktop stage OK (có `.planning/wp/build.lock`, đã gỡ). E2E (DBG 9453, PORT 4390): v52-polish 39 pass 0 fail; v76 83 pass 0 fail (gồm phone-fail); v80-toasts 8 pass 0 fail; whats-new 19 pass, 1 FAIL "Ctrl+K entry opens it" - palette đang do WP-10 sửa (CommandPalette.vue/ui-v80-palette), không liên quan toast; WP-3 trước đó chạy pass, cần chạy lại sau khi WP-10 xong.
- Không chạy p-*, v77a.

## Hot file cần thêm
- `i18n/en.ts`: `import uiV80Toast from './ui-v80-toast'` + `...uiV80Toast.en,` ; `i18n/vi.ts`: tương tự `...uiV80Toast.vi,` (tới khi nối, tooltip/aria nút đóng toast hiện key `toast.close`).

## Index (.code_index/web.md)
- `stores/toasts.ts` useToastsStore (push/dismiss/remove/hold, cap 3) + `components/ToastHost.vue` (mount ở App.vue) là nơi duy nhất hiển thị toast; `composables/useAppToasts.ts` nuôi break + phone fail.
- `WorkspaceView.vue`: Undo toast = watch closedStack -> toast `ws-undo`; `showNotice` -> `ws-notice`. `scripts/measure.mjs` -> `docs/perf/<ver>-<label>.json`.

## Changelog
- en: Notices (undo, break reminder, phone alerts) now share one stack in the bottom-right corner: up to three at a time, paused on hover, closed with Esc.
- vi: Các thông báo nhỏ (hoàn tác, nhắc nghỉ, cảnh báo điện thoại) giờ dùng chung một chồng ở góc phải dưới: tối đa ba cái, dừng đếm khi rê chuột, đóng bằng Esc.

## Commit đề xuất
`🔔 v80 WP-8: one toast stack (store + ToastHost) replacing Break / PhoneFail / Undo toasts and the agent notice; scripts/measure.mjs with docs/perf baseline`
