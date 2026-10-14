const en = {
  appName: 'Agent Monitor',
  loading: 'Starting the monitor…',
  loadingHint: 'Local server on 127.0.0.1',
  errorTitle: 'The monitor could not start',
  retry: 'Try again',
  logHint: 'Recent log',
  collectorExited: (code: number | null) => `Collector stopped (code ${code ?? '?'}). Is port in use by another app?`,
  collectorTimeout: 'Collector did not respond within 30 s.',
  portInUse: (port: number) => `Port ${port} is taken: an older Agent Monitor (.bat / npm start) or another app (4317 is also the OpenTelemetry collector default). Close it or set CCM_PORT.`,
  trayOpen: 'Open dashboard',
  trayCompact: 'Compact window',
  trayLogin: 'Start with Windows',
  trayLoginMac: 'Open at login',
  trayLogs: 'Open log folder',
  trayQuit: 'Quit',
  hiddenNotice: 'Still running in the tray. Quit from the tray menu.',
  moveTitle: 'Move to the Applications folder?',
  moveDetail: "Claude Code's status line runs through this app, so it should not run from the disk image or Downloads.",
  moveConfirm: 'Move to Applications',
  moveLater: 'Not now',
  quitTitle: (n: number) => (n === 0 ? 'Quit and close the open terminals?' : n === 1 ? 'Quit and close 1 terminal?' : `Quit and close ${n} terminals?`),
  quitDetail: 'These terminals run inside Agent Monitor and stop when it quits:',
  quitConfirm: 'Quit',
  quitCancel: 'Cancel',
  accessTitle: (folder: string) => `Allow Agent Monitor to open files in ${folder}?`,
  accessDetail: 'The link points outside the folders of your open terminals. Allowing lets the browser and file tabs read this folder until the app quits.',
  accessAllow: 'Allow',
  accessDeny: 'Cancel',
  statusLineTitle: 'Turn on the status line bridge?',
  statusLineDetail: (file: string, json: string, chained: boolean) =>
    `Agent Monitor will set this in ${file}${chained ? ' (your current status line keeps running after the bridge)' : ''}:

${json}

The old file is kept as settings.json.ccm-backup. New Claude sessions pick it up.`,
  statusLineConfirm: 'Turn on',
  statusLineCancel: 'Cancel',
  grantTitle: 'Choose your projects folder',
  extTitle: (kind: 'install' | 'remove' | 'source'): string =>
    kind === 'install' ? 'Install into Claude Code?' : kind === 'remove' ? 'Remove from Claude Code?' : 'Add to Claude Code?',
  extDetail: (where: string, commands: string[]) => `Agent Monitor will run, for ${where}:

${commands.join('\n\n')}

New Claude sessions pick up the change.`,
  extWhereUser: 'all your projects (user config)',
  extWhereProject: (dir: string) => `${dir}, shared with the team (.mcp.json / .claude/settings.json, usually committed)`,
  extWhereLocal: (dir: string) => `${dir}, only you (not committed)`,
  extWhereNone: 'Claude Code (user settings)',
  extConfirm: 'Run',
  extCancel: 'Cancel',
}

const vi: typeof en = {
  appName: 'Agent Monitor',
  loading: 'Đang khởi động monitor…',
  loadingHint: 'Server nội bộ trên 127.0.0.1',
  errorTitle: 'Không khởi động được monitor',
  retry: 'Thử lại',
  logHint: 'Log gần nhất',
  collectorExited: (code) => `Collector đã dừng (mã ${code ?? '?'}). Port có đang bị app khác dùng?`,
  collectorTimeout: 'Collector không phản hồi sau 30 giây.',
  portInUse: (port) => `Cổng ${port} đang bị chiếm: Agent Monitor bản cũ (.bat / npm start) hoặc app khác (4317 cũng là cổng mặc định của OpenTelemetry collector). Hãy tắt nó hoặc đặt CCM_PORT.`,
  trayOpen: 'Mở dashboard',
  trayCompact: 'Cửa sổ gọn',
  trayLogin: 'Chạy cùng Windows',
  trayLoginMac: 'Mở khi đăng nhập',
  trayLogs: 'Mở thư mục log',
  trayQuit: 'Thoát',
  hiddenNotice: 'Monitor vẫn chạy dưới khay hệ thống. Thoát từ menu khay.',
  moveTitle: 'Chuyển vào thư mục Applications?',
  moveDetail: 'Status line của Claude Code chạy qua app này, nên đừng chạy app từ ổ đĩa DMG hay thư mục Downloads.',
  moveConfirm: 'Chuyển vào Applications',
  moveLater: 'Để sau',
  quitTitle: (n) => (n === 0 ? 'Thoát và đóng các terminal đang mở?' : `Thoát và đóng ${n} terminal?`),
  quitDetail: 'Các terminal này chạy bên trong Agent Monitor và sẽ dừng khi thoát:',
  quitConfirm: 'Thoát',
  quitCancel: 'Huỷ',
  accessTitle: (folder) => `Cho phép Agent Monitor mở file trong ${folder}?`,
  accessDetail: 'Liên kết trỏ ra ngoài thư mục của các terminal đang mở. Cho phép thì tab trình duyệt và tab file đọc được thư mục này tới khi thoát app.',
  accessAllow: 'Cho phép',
  accessDeny: 'Huỷ',
  statusLineTitle: 'Bật status line bridge?',
  statusLineDetail: (file, json, chained) =>
    `Agent Monitor sẽ ghi vào ${file}${chained ? ' (status line hiện tại của bạn vẫn chạy sau bridge)' : ''}:

${json}

Tệp cũ được giữ lại thành settings.json.ccm-backup. Các session Claude mới sẽ dùng cấu hình này.`,
  statusLineConfirm: 'Bật',
  statusLineCancel: 'Huỷ',
  grantTitle: 'Chọn thư mục chứa các project',
  extTitle: (kind) => (kind === 'install' ? 'Cài vào Claude Code?' : kind === 'remove' ? 'Gỡ khỏi Claude Code?' : 'Thêm vào Claude Code?'),
  extDetail: (where, commands) => `Agent Monitor sẽ chạy, cho ${where}:

${commands.join('\n\n')}

Các phiên Claude mới sẽ nhận thay đổi.`,
  extWhereUser: 'mọi project của bạn (cấu hình user)',
  extWhereProject: (dir) => `${dir}, chia sẻ cho cả team (.mcp.json / .claude/settings.json, thường được commit)`,
  extWhereLocal: (dir) => `${dir}, chỉ mình bạn (không commit)`,
  extWhereNone: 'Claude Code (cấu hình user)',
  extConfirm: 'Chạy',
  extCancel: 'Huỷ',
}

export type Strings = typeof en

export const stringsFor = (locale: string): Strings => (locale.toLowerCase().startsWith('vi') ? vi : en)
