# Thông báo thông minh và macOS parity (nhóm C): thiết kế

- Ngày: 2026-10-09
- Trạng thái: chờ duyệt
- Phạm vi: C1 (phân loại trạng thái chờ), C2 (báo hiệu trên dock + focus đúng terminal trên macOS), C3 (launcher + chọn thư mục trên macOS).
- Sửa đổi 2026-10-09 sau kiểm chứng §2: macOS không cho app ký ad-hoc gửi thông báo native (`UNErrorDomain 1`, không có hộp thoại xin quyền), nên C2b đổi từ thông báo native sang **badge + nảy icon trên dock** (người dùng chọn).

## 1. Mục tiêu

Trên macOS, khi dùng **app desktop (.dmg)**:
- Icon app trên dock có badge đếm session đang chờ và nảy khi có session mới cần bạn; mở app thì WaitingQueue + Jump đưa tới đúng terminal.
- Nút Jump và WaitingQueue hoạt động trên macOS.
- Có thể mở session mới từ Favorites và chọn thư mục.

Trên mọi nền tảng, dashboard phân biệt **"cần duyệt quyền"** với **"đang hỏi bạn"**.

Môi trường của người dùng: Terminal.app / iTerm2 (focus tới **đúng tab**) và JetBrains (chỉ **đưa app lên trước**).

### Ràng buộc (không đổi)
- Chỉ quan sát. Không gửi prompt và không gõ phím vào session Claude đang chạy. Launcher chỉ mở một shell **mới**.
- Mọi chuỗi đến từ hệ thống (tty, đường dẫn, bundle) được truyền qua `argv`, không bao giờ ghép vào script.
- Không có DB. Mọi chuỗi giao diện qua i18n (`en`, `vi`). Màu chỉ dùng token theme. Trạng thái luôn có icon + chữ + màu.
- Windows giữ nguyên hành vi. Linux vẫn `unsupported`.

### Tiêu chí thành công
1. Trên app desktop macOS, một session chuyển sang `waiting` thì icon trên dock nảy liên tục và badge tăng. Mở app, bấm Jump trong WaitingQueue thì tab Terminal/iTerm2 chứa session đó lên trước, hoặc app JetBrains lên trước. Session hết chờ (hoặc bạn đang nhìn dashboard) thì badge giảm.
2. Nút Jump và WaitingQueue trên macOS cho kết quả `ok`, `appOnly`, `denied`, `notFound` hoặc `failed`, kèm thông điệp rõ ràng. Không còn thấy "Only available on Windows".
3. Mở session từ Favorites trên macOS bằng Terminal.app hoặc iTerm2 tùy cài đặt. Nút Browse mở hộp thoại chọn thư mục.
4. WaitingQueue, SessionCard và toast/thông báo trình duyệt hiện "Cần duyệt: {tool}" hoặc "Đang hỏi bạn" với icon riêng. Chuỗi lạ giữ nguyên hành vi cũ.

## 2. Kiểm chứng trước khi code (bước đầu của plan)

1. **Giá trị `waitingFor` thật:** người dùng gây ra một permission prompt (Bash), một AskUserQuestion và một bước duyệt plan. Đọc `~/.claude/sessions/<pid>.json` và ghi lại chuỗi `waitingFor` cùng `status`. Kết quả vào `docs/claude-code-integration.md` (mục mới), và bảng phân loại §3 được chỉnh theo đó.
2. **Electron Notification trên app ký ad-hoc:** đã thử — thất bại (`UNErrorDomain 1`), xem §5.
3. **AppleScript tới Terminal.app / iTerm2 theo tty:** thử chọn tab, ghi lại lời nhắc quyền Automation và mã lỗi khi bị từ chối (`-1743`).

## 3. C1: phân loại trạng thái chờ

`packages/shared/src/status.ts`:
```ts
export type WaitReason = 'permission' | 'question' | 'other'
export function waitReason(waitingFor?: string): WaitReason
```
- So khớp sau khi `trim` và chuyển về chữ thường.
- `permission`: `permission prompt`, `sandbox request`, `worker request`.
- `question`: `input needed`, `dialog open`.
- `other`: chuỗi khác hoặc rỗng (hiện nguyên văn như hiện tại).
- Đã kiểm chứng 2026-10-09 trên 2.1.289 (Terminal.app, đối chiếu tool đang mở trong transcript): `input needed` ↔ `AskUserQuestion`; `permission prompt` ↔ `Bash` (xin quyền) và `ExitPlanMode` (duyệt plan). `sandbox request`, `worker request`, `dialog open` chưa quan sát được, giữ theo docs.

Không đổi protocol: `waitingFor` gửi xuống như cũ.

Hiển thị trong WaitingQueue, SessionCard (`detail`), AgentNode, CompactView, ActivityFeed (`terminal.status` → waiting), nội dung toast/thông báo, và `useNotifications`:

| Loại | Icon (lucide) | Chuỗi |
|---|---|---|
| `permission` | `ShieldQuestion` | `wait.plan` nếu `currentTool === 'ExitPlanMode'`; `wait.permissionTool {tool}` nếu main agent có `currentTool` khác; ngược lại `wait.permission` |
| `question` | `MessageCircleQuestion` | `wait.question` |
| `other` | icon chờ hiện tại | chuỗi gốc như hôm nay |

## 4. C2a: focus terminal trên macOS

Module mới `apps/collector/src/focus-mac.ts`, chỉ chạy khi người dùng thao tác.

1. **Tìm app chủ:** chạy `ps -A -o pid=,ppid=,tty=,comm=` một lần, rồi `parsePsTree(stdout)` thành map. `hostOf(tree, pid)` đi ngược tối đa 8 cấp:
   - `tty` là tty của chính tiến trình `claude`, phải khớp `^ttys\d+$`; giá trị `??` hoặc rỗng nghĩa là không có tty.
   - `bundle` là tổ tiên đầu tiên có `comm` chứa `.app/Contents/MacOS/`, lấy phần tiền tố tới `.app`.
   - `kind` là `terminal` (`/Terminal.app`), `iterm` (`/iTerm.app`) hoặc `app`.
2. **Focus:**
   - `terminal`: `osascript` với `on run argv` (argv = `/dev/<tty>`). Duyệt `windows`/`tabs`; tab nào có `tty` khớp thì `set selected`, `set index of window to 1`, `activate`. In ra `ok` hoặc `notFound`.
   - `iterm`: tương tự trên `windows`/`tabs`/`sessions` (`tty of session`), rồi `select` tab và session, `activate`.
   - `app`: `open -a <bundle>` → `appOnly`.
   - Không có bundle → `notFound`. Có bundle `terminal`/`iterm` nhưng không có tty → `open -a` → `appOnly`.
3. **Lỗi:** stderr chứa `-1743` → `denied`; lỗi khác → `failed`.
4. `FocusWindowResult` (shared) thêm `appOnly` và `denied`. Monitor chọn `focusProcessWindow` (win32) hoặc `focusMacWindow` (darwin) theo platform, platform là tham số để test được. Linux vẫn `unsupported`.
5. **UI:** chuỗi `terminal.jumpError.appOnly` ("đã đưa app chứa terminal lên trước, chưa chọn được tab"; không kèm tên app để không phải đổi payload `terminal.focusResult`), `jumpError.denied` (hướng dẫn mở System Settings › Privacy & Security › Automation). `jumpError.unsupported` viết lại trung tính. `appOnly` được coi là thành công một phần: hiện thông điệp nhẹ, không phải lỗi.

## 5. C2b: badge và nảy icon trên dock (thay cho thông báo native)

Kết quả kiểm chứng §2.2: app ký ad-hoc (`dev.ccm.monitor`) và Electron dev (`com.github.Electron`) đều không xin được quyền thông báo (`UNErrorDomain 1`, không có hộp thoại, không có mục trong `com.apple.ncprefs`). Badge và nảy icon dùng `NSDockTile` / `requestUserAttention`, không cần quyền.

- **Collector,** module mới `apps/collector/src/toast-electron.ts`:
  - `electronToastDeps(post: (msg) => void): ToastDeps`.
    - `show(content)` → `post({ type: 'toast.show', tag, title, persistent })`, trả `true`.
    - `hide(tag)` → `post({ type: 'toast.hide', tag })`.
    - `health()` → `'unknown'`.
  - Toàn bộ quyết định khi nào báo (chuyển sang `waiting`, throttle, nhắc lại, snooze, giờ yên tĩnh, ẩn khi đang nhìn dashboard) vẫn là của `Toaster`.
  - `config.ts`: `toast` supported khi `(platform === 'win32' || env.CCM_TOAST_BACKEND === 'electron') && env.CCM_TOAST !== '0'`. Desktop chỉ đặt `CCM_TOAST_BACKEND=electron` trên darwin (Windows giữ toast PowerShell).
  - `index.ts`: khi `CCM_TOAST_BACKEND === 'electron'` và có `process.parentPort` thì dùng `electronToastDeps(parentPort.postMessage)`.
- **Desktop:**
  - `collector-host.ts` đặt `CCM_TOAST_BACKEND=electron` (darwin) khi fork collector, chuyển message `toast.*` từ `child.on('message')` cho `attention`, kiểm tra hình dạng bằng `parseToastMessage` (shared).
  - `apps/desktop/src/attention.ts`: `Map<tag, { persistent: boolean }>`.
    - `show`: thêm tag; nếu tag mới thì `app.dock.bounce('critical')` (nảy tới khi app được kích hoạt). Cập nhật badge.
    - `hide`: xoá tag, cập nhật badge.
    - Badge = số tag `persistent` đang mở (`app.dock.setBadge(n ? String(n) : '')`).
    - App được kích hoạt (`browser-window-focus`) → `app.dock.cancelBounce(id)`.
  - Bấm icon dock mở app như hiện tại (`activate` → `showMain`). Từ dashboard, WaitingQueue + Jump (C2a) đưa tới đúng terminal.
  - Collector mượn từ `.bat` không có `parentPort`, nên không đổi gì.
- **Web:** mục toast trong SettingsMenu đổi nhãn trung tính ("Báo hiệu hệ thống" / "System alerts"); trên mac hiện khi `extras.toast` là `on`/`off`. Nút "Test" của toast: trên mac kích hoạt một lần nảy + badge tạm.
- **Snooze** vẫn dùng được trong dashboard (đã có); không có nút snooze ngoài dashboard trên mac.

## 6. C3: launcher và chọn thư mục trên macOS

- **Launcher** (`launcher.ts`):
  - Client lưu `ccm.launchTerminal` (`terminal` | `iterm`, mặc định `terminal`) và gửi `favorite.open { dir, mode, terminalApp? }`. Server chỉ nhận `terminal`/`iterm`, giá trị khác thì bỏ field.
  - `launchArgs('terminal' | 'iterm', dir, mode): string[]` dựng argv cho `osascript` với `on run argv`.
    - Terminal: `do script "cd " & quoted form of d & " && claude"` (`--continue` khi `mode = 'continue'`).
    - iTerm2: `create window with default profile`, rồi `write text` cùng lệnh vào session mới đó.
  - Ràng buộc giữ nguyên: chỉ thư mục đã đánh dấu sao, đường dẫn tuyệt đối, tồn tại.
  - Lỗi → activity `launch.failed` với `error` ∈ `denied` (`-1743`) | `notInstalled` (`-1728` hoặc "Can't get application") | `failed`, mỗi loại có chuỗi i18n.
- **Chọn thư mục** (`folder-pick.ts`): `osascript` với `POSIX path of (choose folder)` (prompt mặc định của macOS, đã được dịch). `-128` → `cancelled`, stdout là đường dẫn → `ok`, còn lại → `failed`.
- **UI:**
  - SettingsMenu có mục "Mở session bằng" (Terminal.app / iTerm2), chỉ hiện khi `isMac`.
  - `pickError.unsupported` viết lại trung tính.
  - FavoritesList gửi kèm `terminalApp`.

## 7. Kiểm thử
- **Shared:** `waitReason` theo bảng giá trị (gồm hoa thường, khoảng trắng, chuỗi lạ).
- **Collector:**
  - `focus-mac.test.ts`: `parsePsTree`, `hostOf` (fixture thật: `claude → zsh → WebStorm.app`, `claude → bun` không tty, chuỗi Terminal.app và iTerm2), `focusMacWindow` với runner inject (argv đúng, không ghép chuỗi, ánh xạ `-1743` → `denied`).
  - `toast-electron.test.ts`: `show`/`hide` sinh đúng message.
  - `config`: chỉ bật toast khi `CCM_TOAST_BACKEND=electron` hoặc win32.
  - `launcher`/`folder-pick`: `launchArgs`, `parseOsaError`, platform darwin với spawner inject.
  - `monitor.test.ts`: `favorite.open` với `terminalApp` hợp lệ hoặc lạ.
  - `hardening.test.ts`: kiểm tra field `terminalApp`; `POST /focus` trả JSON kết quả.
- **Web:** nhãn waiting theo `waitReason` (lib thuần), `ccm.launchTerminal` mặc định và lưu lại.
- **Desktop:** desktop không có test runner. `parseToastMessage(data): ToastMessage | null` và hàm thuần `badgeCount(entries)` đặt trong `packages/shared/src/notify.ts`, test trong `apps/collector/test`. `attention.ts` (Electron runtime) chỉ kiểm thủ công.
- **Thủ công trên máy này:** các bước §2, và tiêu chí thành công §1.1–§1.4.

## 8. Ngoài phạm vi
- Linux.
- Badge trên dock và menu bar.
- Chặn thông báo khi terminal đang ở phía trước.
- Chọn tab trong JetBrains, VS Code, Warp, Ghostty.
- Thông báo native macOS (cần ký Developer ID; xem §5).
- Báo hiệu khi dùng trình duyệt (không phải app desktop) trên macOS.

## 9. Tài liệu
- `docs/claude-code-integration.md`:
  - §7b: bảng nền tảng.
  - §11k: badge/nảy icon, quyền Automation, kết quả kiểm chứng §2 (thông báo native bị từ chối với app ad-hoc).
  - Mục mới: giá trị `waitingFor` quan sát được.
- `.code_index/`: `collector.md`, `web.md`, `desktop.md`, `protocol.md`, `_meta.md`.
