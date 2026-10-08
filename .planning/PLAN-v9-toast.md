# PLAN v9 — Windows toast khi session chờ input

## Mục tiêu
Session chuyển sang `waiting` mà user không nhìn dashboard (tab khác, browser ẩn/thu nhỏ/đã đóng, không đeo tai nghe)
→ vẫn biết. Thông báo desktop của browser cần bật chuông + permission và tự ẩn sau ~5 s, nên chưa đủ.

## Cách làm
- Collector gửi **Windows toast** (PowerShell 5.1 + WinRT `ToastNotificationManager`, AUMID của powershell.exe).
  - `scenario='reminder'` → toast nằm trên màn tới khi user bấm (không tự ẩn).
  - PS 5.1 không subscribe được WinRT event (`Register-ObjectEvent` báo "cannot subscribe to Windows RT events")
    → click dùng `activationType='protocol'` tới `http://127.0.0.1:<port>/focus?t=<id>&k=<nonce>`:
    collector raise cửa sổ terminal (`focusProcessWindow`), trang trả về tự `window.close()`.
  - Session rời `waiting` → `History.Remove(tag, 'ccm')` gỡ toast.
  - Chỉ gửi khi không client nào đang nhìn (`client.presence.attentive` = tab visible + focused).
    Không client nào kết nối → vẫn gửi.
  - Throttle 30 s / terminal. Lần đầu thấy session (prev undefined) không gửi.
- Bật/tắt: lưu ở collector `<dataDir>/notify.json` `{ toast, locale }`, snapshot `toast`, event `notify.settings`.
  Env `CCM_TOAST=0` tắt cứng. Non-win32 → `unsupported`.
- Web: toggle "Windows toast" trong Settings; toast bật thì browser Notification bỏ kind `waiting`/`reminder`
  (tránh báo đôi); tiêu đề tab nhấp nháy khi tab ẩn và có session chờ.

## Trạng thái
- [x] Verify toast show + History.Remove chạy trên máy (Win 11 26200).
- [x] Collector: `toast.ts`, presence + `/focus` ở server, wiring index.
- [x] Shared types, web settings/presence/title blink, i18n.
- [x] Test, typecheck, code index, integration doc.
- [ ] User verify trên máy thật: restart collector, bật toggle, session chờ khi tab ẩn → toast; bấm → raise terminal.
