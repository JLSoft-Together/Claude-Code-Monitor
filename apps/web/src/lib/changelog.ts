export interface ChangeItem {
  en: string
  vi: string
}

export interface Release {
  version: string
  /** Tag date, YYYY-MM-DD. */
  date: string
  items: ChangeItem[]
}

/** Version of the running app, from apps/desktop/package.json (vite.config.ts `define`). */
export const APP_VERSION: string = __APP_VERSION__

export const SEEN_KEY = 'ccm.whatsNew.seen'

// Summaries of `git log <prev tag>..<tag>` and the matching .planning plans; newest first.
export const CHANGELOG: Release[] = [
  {
    version: '2.4.0',
    date: '2026-10-29',
    items: [
      { en: "What's new dialog, also opened from Settings and Ctrl+K", vi: 'Hộp "Có gì mới", mở lại được trong Cài đặt và Ctrl+K' },
      { en: 'Explorer Search, Checks and TODO views; Replace in files, previewed per line', vi: 'Explorer có Tìm kiếm, Checks và TODO; Thay trong nhiều file, xem trước từng dòng' },
      { en: 'Stage, commit and blame in the app; merge conflicts solved block by block', vi: 'Stage, commit và blame ngay trong app; giải xung đột gộp theo từng khối' },
      { en: 'Checkpoints per turn and Turn review to keep or drop each hunk', vi: 'Checkpoint theo lượt và Xem lượt này để giữ hoặc bỏ từng đoạn' },
      { en: 'Compare and merge worktrees; a warning when agents edit the same file', vi: 'So sánh và gộp worktree; cảnh báo khi các agent cùng sửa một file' },
      { en: 'Prompt library, a prompt queue per agent pane and an inbox of what needs you', vi: 'Thư viện prompt, hàng chờ prompt cho từng pane agent và hộp việc cần chủ nhân' },
      { en: 'Editor: Outline, Go to Symbol, bookmarks, recent files, Local History, Format', vi: 'Editor: Outline, Go to Symbol, bookmark, file gần đây, Local History, Format' },
      { en: 'JSON / YAML tree, log viewer, .http requests, Markdown split preview, colour swatches', vi: 'Cây JSON / YAML, xem log, gửi request .http, xem trước Markdown song song, ô màu' },
      { en: 'Drop-down terminal (Ctrl+`), project notes, Plan board and terminal errors in Problems', vi: 'Terminal thả xuống (Ctrl+`), ghi chú dự án, Plan board và lỗi terminal vào Problems' },
      { en: 'Ctrl+K developer tools, file and image compare, .env check and i18n key scan', vi: 'Công cụ dev trong Ctrl+K, so file và ảnh, kiểm .env và quét khoá i18n' },
      { en: 'Device screenshot from Devices or the Run pane, attached to an agent pane', vi: 'Chụp màn thiết bị từ tab Thiết bị hoặc Run pane, đính kèm vào pane agent' },
      { en: 'Inspect views on the screenshot: id, text, bounds, Find in files or fill into an agent', vi: 'Soi view trên ảnh chụp: id, chữ, khung, tìm trong file hoặc điền vào agent' },
      { en: 'Test UI on a device: dark mode, font size, display size, app language, animations off, Restore all', vi: 'Thử UI trên máy: giao diện tối, cỡ chữ, cỡ hiển thị, ngôn ngữ app, tắt animation, Trả về như cũ' },
      { en: "Open the project's deep links and exported activities on a device, or type a URI", vi: 'Mở deep link và activity exported của dự án trên máy, hoặc tự nhập URI' },
      { en: 'Run pane catches Android and Flutter crashes and ANRs; project frames open the file', vi: 'Run pane bắt crash và ANR của Android, Flutter; frame trong dự án bấm là mở file' },
      { en: 'Fill a crash into the agent: exception, project frames, log before, secrets masked', vi: 'Điền crash vào agent: exception, frame của dự án, log trước đó, đã che bí mật' },
      { en: 'Permission prompts per project: repeated asks and allow rules to tick', vi: 'Hỏi quyền theo dự án: các lần hỏi lặp lại và luật allow để tích chọn' },
      { en: 'Ticked rules go to settings.local.json after a confirm with the exact diff', vi: 'Luật đã tích được ghi vào settings.local.json sau khi xác nhận đúng phần thay đổi' },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-10-28',
    items: [
      { en: 'Auto save in the file editor, like VS Code (off by default)', vi: 'Tự lưu trong editor như VS Code (mặc định tắt)' },
      { en: 'HTML files render in the file viewer like Markdown', vi: 'File HTML hiển thị trong trình xem file như Markdown' },
      { en: 'Office theme packs, full screen and a 3D office style (beta)', vi: 'Gói giao diện Office, toàn màn hình và kiểu văn phòng 3D (beta)' },
      { en: 'The header now sits in the window title bar', vi: 'Thanh header nằm luôn trên thanh tiêu đề cửa sổ' },
      { en: 'Restore the workspace with only the projects you pick running', vi: 'Khôi phục workspace chỉ chạy những dự án chủ nhân chọn' },
      { en: 'Simpler Monitor: session bar, activity panel and timeline view removed', vi: 'Monitor gọn hơn: bỏ thanh session, bảng hoạt động và chế độ timeline' },
      { en: 'Lighter Agent Map and Office: fewer reflows, calmer motion', vi: 'Agent Map và Office nhẹ hơn: ít tính lại layout, chuyển động êm hơn' },
      { en: 'Atom Material icons for file panes and project folders', vi: 'Icon Atom Material cho pane file và thư mục dự án' },
      { en: 'Fixed duplicated shell prompts when resizing terminal panes', vi: 'Sửa lỗi lặp dấu nhắc shell khi đổi cỡ pane terminal' },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-10-22',
    items: [
      { en: 'Office view in the Monitor: a pixel-art room per project, a character per agent', vi: 'Office trong Monitor: mỗi dự án một phòng pixel-art, mỗi agent một nhân vật' },
      { en: 'Office day timelapse, sound cues and a volume slider', vi: 'Office có timelapse cả ngày, âm báo và thanh chỉnh âm lượng' },
      { en: 'Click an asking agent in the Office to jump to its session', vi: 'Bấm agent đang hỏi trong Office để nhảy tới session của nó' },
      { en: 'Devices tab: connect Android devices over USB or Wi-Fi, by pair code or QR', vi: 'Tab Thiết bị: kết nối máy Android qua USB hoặc Wi-Fi, bằng mã ghép hoặc QR' },
      { en: 'Remembered devices with aliases and auto-connect', vi: 'Ghi nhớ thiết bị, đặt tên riêng và tự kết nối' },
      { en: 'Compact… works for claude typed in a shell pane', vi: 'Compact… dùng được cho claude gõ trong pane shell' },
      { en: 'Terminal panes fall back to installed Nerd Fonts', vi: 'Pane terminal dùng Nerd Font đã cài khi thiếu font' },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-10-18',
    items: [
      { en: 'Renamed to Orrery, with a new logo', vi: 'Đổi tên thành Orrery, kèm logo mới' },
      { en: 'Several GitHub accounts in Settings, used per repo for push, fetch and pull', vi: 'Nhiều tài khoản GitHub trong Cài đặt, dùng theo từng repo khi push, fetch, pull' },
      { en: 'Push dialog in the Log Branches toolbar and a ↑N push button in Changes', vi: 'Hộp Push trên thanh Branches của Log và nút ↑N để push trong Changes' },
      { en: 'The Explorer has its own panel on the right; each file opens in its own viewer', vi: 'Explorer có panel riêng bên phải; mỗi file mở trong trình xem riêng' },
      { en: 'Atom Material file icons in the Explorer tree', vi: 'Icon file Atom Material trong cây Explorer' },
      { en: 'A shell pane running claude or codex shows as that agent', vi: 'Pane shell đang chạy claude hoặc codex được nhận là agent đó' },
      { en: 'Wrapped links in terminal panes open and copy correctly', vi: 'Link bị xuống dòng trong pane terminal mở và chép đúng' },
      { en: 'Flutter Widget Preview lists the widgets of the open Dart file', vi: 'Flutter Widget Preview liệt kê widget của file Dart đang mở' },
    ],
  },
  {
    version: '2.0.0',
    date: '2026-10-16',
    items: [
      { en: 'Desktop-only app with a Workspace of terminals: split panes, tabs and groups', vi: 'Chỉ còn app desktop, có Workspace terminal: chia pane, tab và nhóm tab' },
      { en: 'Browser, file and Changes panes; file Explorer with drag to @mention', vi: 'Pane trình duyệt, file và Changes; Explorer kéo file vào để @mention' },
      { en: 'Project sidebar, saved layouts, scripts menu and multi-project workspaces', vi: 'Sidebar dự án, lưu bố cục, menu script và workspace nhiều dự án' },
      { en: 'Git Log pane with graph, branches and diffs; create, fetch and delete branches', vi: 'Pane Git Log có đồ thị, nhánh và diff; tạo, fetch và xoá nhánh' },
      { en: 'Android Studio style diff with minimap and split view', vi: 'Diff kiểu Android Studio có minimap và xem hai cột' },
      { en: 'Run pane for Android / Flutter, XML Layout Preview and Flutter Widget Preview', vi: 'Pane Run cho Android / Flutter, XML Layout Preview và Flutter Widget Preview' },
      { en: 'Extensions tab installs MCP servers and plugins through the claude CLI', vi: 'Tab Extensions cài MCP server và plugin qua claude CLI' },
      { en: 'Colour themes, bundled fonts, Ctrl+wheel zoom and Quick setup', vi: 'Theme màu, font kèm sẵn, Ctrl+lăn chuột để zoom và Thiết lập nhanh' },
      { en: 'Agents can open Workspace panes; Compact…, pane zoom, undo close, Mission Control', vi: 'Agent mở được pane Workspace; Compact…, phóng pane, hoàn tác đóng, Mission Control' },
      { en: 'Redesigned Monitor map and Usage, with messages between main agents', vi: 'Thiết kế lại bản đồ Monitor và Usage, hiện tin nhắn giữa các agent chính' },
    ],
  },
  {
    version: '1.2.3',
    date: '2026-10-12',
    items: [
      { en: 'macOS: dock badge and bounce when a session needs you', vi: 'macOS: badge và nảy icon trên dock khi session cần chủ nhân' },
      { en: 'macOS: focus the terminal tab, launch sessions and pick folders', vi: 'macOS: chuyển tới tab terminal, mở session và chọn thư mục' },
      { en: 'Waiting sessions say whether they need approval or ask a question', vi: 'Session đang chờ ghi rõ cần duyệt hay đang hỏi' },
      { en: 'Tool timeline view in the Agent Map panel', vi: 'Chế độ timeline tool trong panel Agent Map' },
      { en: 'Activity text wraps instead of being cut off', vi: 'Chữ trong Hoạt động xuống dòng thay vì bị cắt' },
      { en: 'A clear message when the port is taken, instead of restarting over and over', vi: 'Báo rõ khi cổng đã bị chiếm thay vì khởi động lại liên tục' },
      { en: 'Stopped background jobs stay hidden after a restart', vi: 'Job nền đã dừng vẫn ẩn sau khi mở lại app' },
      { en: 'Faster reading of large transcripts', vi: 'Đọc transcript lớn nhanh hơn' },
    ],
  },
  {
    version: '1.2.2',
    date: '2026-10-11',
    items: [
      { en: 'Codex CLI runs show up under the Claude agent that started them', vi: 'Lượt chạy Codex CLI hiện dưới agent Claude đã gọi nó' },
      { en: 'Renamed to Agent Monitor', vi: 'Đổi tên thành Agent Monitor' },
    ],
  },
  {
    version: '1.2.1',
    date: '2026-10-10',
    items: [{ en: 'Smoother motion across the new layout', vi: 'Chuyển động mượt hơn trên bố cục mới' }],
  },
  {
    version: '1.2.0',
    date: '2026-10-10',
    items: [
      { en: 'Full-screen Agent Map', vi: 'Agent Map toàn màn hình' },
      { en: 'Session bar to switch between sessions', vi: 'Thanh session để chuyển giữa các session' },
      { en: 'Keyboard shortcuts', vi: 'Phím tắt' },
    ],
  },
  {
    version: '1.1.1',
    date: '2026-10-09',
    items: [{ en: 'New app logo', vi: 'Logo app mới' }],
  },
  {
    version: '1.1.0',
    date: '2026-10-09',
    items: [{ en: 'macOS app (.dmg)', vi: 'App macOS (.dmg)' }],
  },
  {
    version: '1.0.2',
    date: '2026-10-09',
    items: [{ en: 'The app takes over when a shared collector stops', vi: 'App tự chạy collector riêng khi collector dùng chung bị dừng' }],
  },
  {
    version: '1.0.1',
    date: '2026-10-09',
    items: [
      { en: 'Watch every running Claude Code session live, with terminal titles and status', vi: 'Theo dõi trực tiếp mọi session Claude Code, kèm tên terminal và trạng thái' },
      { en: 'Agent Map of main agents and their sub-agents', vi: 'Agent Map hiện agent chính và các sub-agent' },
      { en: 'Usage tab with statistics and the plan quota left', vi: 'Tab Usage có thống kê và hạn mức gói còn lại' },
      { en: 'History tab with a daily recap you can export', vi: 'Tab History có tóm tắt theo ngày, xuất ra được' },
      { en: 'Windows toasts with snooze, quiet hours and stuck / context alerts', vi: 'Thông báo Windows có hoãn, giờ yên lặng, cảnh báo kẹt và đầy context' },
      { en: 'Session notes, favourites, git diff stats and open folder', vi: 'Ghi chú session, mục yêu thích, thống kê git diff và mở thư mục' },
      { en: 'Compact mode, onboarding tour and break reminders', vi: 'Chế độ thu gọn, hướng dẫn làm quen và nhắc nghỉ giải lao' },
      { en: 'Windows app: installer and portable exe', vi: 'App Windows: bản cài đặt và bản portable' },
    ],
  },
]

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Shown once per app version, including a fresh install (nothing seen yet). */
export function shouldShowWhatsNew(seen: string | null, current: string): boolean {
  return !!current && seen !== current
}

export function seenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    // Storage blocked: treat this version as seen rather than open the dialog on every launch.
    return APP_VERSION
  }
}

export function markSeen(version: string = APP_VERSION): void {
  try {
    localStorage.setItem(SEEN_KEY, version)
  } catch {
    return
  }
}
