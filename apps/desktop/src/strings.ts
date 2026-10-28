export type RunKind = 'amend' | 'ff' | 'squash' | 'restore' | 'abort' | 'take'

const en = {
  appName: 'Orrery',
  loading: 'Starting the monitor…',
  loadingHint: 'Local server on 127.0.0.1',
  errorTitle: 'The monitor could not start',
  retry: 'Try again',
  logHint: 'Recent log',
  collectorExited: (code: number | null) => `Collector stopped (code ${code ?? '?'}). Is port in use by another app?`,
  collectorTimeout: 'Collector did not respond within 30 s.',
  portInUse: (port: number) => `Port ${port} is taken: an older Orrery (.bat / npm start) or another app (4317 is also the OpenTelemetry collector default). Close it or set CCM_PORT.`,
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
  quitDetail: 'These terminals run inside Orrery and stop when it quits:',
  quitConfirm: 'Quit',
  quitCancel: 'Cancel',
  devRemoveTitle: (n: number) => (n === 1 ? 'Forget this device?' : `Forget ${n} devices?`),
  devRemoveDetail: (ids: string[]) => ids.join('\n') + '\n\nOrrery stops listing and auto-connecting them. Nothing on the devices changes.',
  devRemoveConfirm: 'Forget',
  quitRunsTitle: (n: number) => (n === 1 ? 'Quit and stop 1 running app?' : `Quit and stop ${n} running apps?`),
  quitRuns: 'Running from Orrery (stopped on quit, the app on the device keeps its data):',
  quitUnsavedTitle: (n: number) => (n === 1 ? 'Save changes to 1 file before quitting?' : `Save changes to ${n} files before quitting?`),
  quitUnsavedDetail: 'Edited in Orrery and not saved yet:',
  quitUnsavedSave: 'Save',
  quitUnsavedDiscard: "Don't save",
  quitUnsavedFailed: 'Some files could not be saved. Quitting was cancelled; check the file tabs.',
  runReinstallTitle: 'Uninstall the old build and reinstall?',
  runReinstallDetail: (pkg: string) => `The installed ${pkg} was signed with a different key. Reinstalling deletes its data on the device.`,
  runReinstallConfirm: 'Uninstall and reinstall',
  runTrustTitle: (name: string) => `Run "${name}" from the project files?`,
  runTrustDetail: (cwd: string, command: string, before: string[], envKeys: string[]) =>
    [
      'This configuration comes from the repository (shared or imported). Run it only if you trust its author.',
      `Folder: ${cwd}`,
      `Command: ${command || '—'}`,
      ...(before.length ? ['Before launch:', ...before.map((l) => `  ${l}`)] : []),
      ...(envKeys.length ? [`Environment variables: ${envKeys.join(', ')}`] : []),
      'You are asked again whenever the configuration changes.',
    ].join('\n'),
  runTrustConfirm: 'Trust and run',
  accessTitle: (folder: string) => `Allow Orrery to open files in ${folder}?`,
  accessDetail: 'The link points outside the folders of your open terminals. Allowing lets the browser and file tabs read this folder until the app quits.',
  accessAllow: 'Allow',
  fullAccessTitle: 'Let Orrery open files in every folder?',
  fullAccessDetail:
    'File tabs, Explorer, Changes and the browser tabs inside the app can read and, when you save, rename or delete, change any folder on this computer without asking, including ones with keys or .env files. Turn it off again in Settings → File access.',
  fullAccessConfirm: 'Allow every folder',
  accessDeny: 'Cancel',
  gitDeleteTitle: (name: string) => `Delete branch ${name}?`,
  gitForceTitle: (name: string) => `${name} is not fully merged. Delete it anyway?`,
  gitDeleteDetail: (commands: string[]) => `Orrery will run:\n\n${commands.join('\n')}\n\nCommits only on this branch can be lost.`,
  gitDeleteConfirm: 'Delete',
  gitDeleteCancel: 'Cancel',
  runTitle: (kind: RunKind, a: string, b: string) =>
    kind === 'amend'
      ? 'Amend the last commit?'
      : kind === 'ff'
        ? `Fast-forward ${b} to ${a}?`
        : kind === 'squash'
          ? `Squash ${a} into one commit on ${b}?`
          : kind === 'abort'
            ? `Abort the ${a} in progress?`
            : kind === 'take'
              ? `Take ${a} from ${b} into this checkout?`
              : `Restore ${a} from the checkpoint?`,
  runDetail: (kind: RunKind, lines: string[]) =>
    kind === 'restore'
      ? `These go back to how they were at the checkpoint; files that did not exist then go to the trash:\n\n${lines.join('\n')}`
      : kind === 'abort'
        ? `Orrery will run:\n\n${lines.join('\n')}\n\nConflict resolutions not yet committed are lost.`
        : kind === 'take'
          ? `Orrery will run:\n\n${lines.join('\n')}\n\nThe file in this checkout is replaced (it has no uncommitted changes).`
          : `Orrery will run:\n\n${lines.join('\n')}`,
  runConfirm: 'Continue',
  ghRemoveTitle: (login: string) => `Remove GitHub account ${login}?`,
  ghRemoveDetail: 'Orrery forgets its token. Repos that used it go back to automatic choice. The token stays valid on GitHub until you revoke it there.',
  ghRemoveConfirm: 'Remove',
  statusLineTitle: 'Turn on the status line bridge?',
  statusLineDetail: (file: string, json: string, chained: boolean) =>
    `Orrery will set this in ${file}${chained ? ' (your current status line keeps running after the bridge)' : ''}:

${json}

The old file is kept as settings.json.ccm-backup. New Claude sessions pick it up.`,
  statusLineConfirm: 'Turn on',
  statusLineCancel: 'Cancel',
  hooksOnTitle: 'Turn on the hook bridge?',
  hooksOffTitle: 'Turn off the hook bridge?',
  hooksDetail: (file: string, json: string, on: boolean) =>
    `Orrery will ${on ? 'add async hooks (PreCompact, PostCompact, PermissionDenied) to' : 'remove its hooks from'} ${file}; your other hooks stay:

${json}

They run in the background and keep only the event name, trigger and tool name. The old file is kept as settings.json.ccm-backup. New Claude sessions pick it up.`,
  grantTitle: 'Choose your projects folder',
  extTitle: (kind: 'install' | 'remove' | 'source'): string =>
    kind === 'install' ? 'Install into Claude Code?' : kind === 'remove' ? 'Remove from Claude Code?' : 'Add to Claude Code?',
  extDetail: (where: string, commands: string[]) => `Orrery will run, for ${where}:

${commands.join('\n\n')}

New Claude sessions pick up the change.`,
  extWhereUser: 'all your projects (user config)',
  extWhereProject: (dir: string) => `${dir}, shared with the team (.mcp.json / .claude/settings.json, usually committed)`,
  extWhereLocal: (dir: string) => `${dir}, only you (not committed)`,
  extWhereNone: 'Claude Code (user settings)',
  extConfirm: 'Run',
  extCancel: 'Cancel',
  linkOpenBadFolder: 'Orrery cannot open this folder',
  linkOpenFailed: 'Orrery could not open the terminal. Open the Workspace and try again.',
  linkOpenLive: 'This session is still running in another terminal. Close it there first, then open the link again.',
}

const vi: typeof en = {
  appName: 'Orrery',
  loading: 'Đang khởi động monitor…',
  loadingHint: 'Server nội bộ trên 127.0.0.1',
  errorTitle: 'Không khởi động được monitor',
  retry: 'Thử lại',
  logHint: 'Log gần nhất',
  collectorExited: (code) => `Collector đã dừng (mã ${code ?? '?'}). Port có đang bị app khác dùng?`,
  collectorTimeout: 'Collector không phản hồi sau 30 giây.',
  portInUse: (port) => `Cổng ${port} đang bị chiếm: Orrery bản cũ (.bat / npm start) hoặc app khác (4317 cũng là cổng mặc định của OpenTelemetry collector). Hãy tắt nó hoặc đặt CCM_PORT.`,
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
  quitDetail: 'Các terminal này chạy bên trong Orrery và sẽ dừng khi thoát:',
  quitConfirm: 'Thoát',
  quitCancel: 'Huỷ',
  devRemoveTitle: (n) => (n === 1 ? 'Quên thiết bị này?' : `Quên ${n} thiết bị?`),
  devRemoveDetail: (ids) => ids.join('\n') + '\n\nOrrery sẽ không hiện và tự kết nối các thiết bị này nữa. Không có gì trên thiết bị bị thay đổi.',
  devRemoveConfirm: 'Quên',
  quitRunsTitle: (n) => `Thoát và dừng ${n} app đang chạy?`,
  quitRuns: 'Đang chạy từ Orrery (sẽ dừng khi thoát, dữ liệu app trên thiết bị giữ nguyên):',
  quitUnsavedTitle: (n) => `Lưu thay đổi của ${n} file trước khi thoát?`,
  quitUnsavedDetail: 'Đã sửa trong Orrery và chưa lưu:',
  quitUnsavedSave: 'Lưu',
  quitUnsavedDiscard: 'Không lưu',
  quitUnsavedFailed: 'Có file không lưu được. Đã huỷ thoát; xem lại các tab file.',
  runReinstallTitle: 'Gỡ bản cũ và cài lại?',
  runReinstallDetail: (pkg) => `${pkg} trên máy được ký bằng key khác. Cài lại sẽ xoá dữ liệu của app trên thiết bị.`,
  runReinstallConfirm: 'Gỡ và cài lại',
  runTrustTitle: (name) => `Chạy "${name}" từ file của project?`,
  runTrustDetail: (cwd, command, before, envKeys) =>
    [
      'Cấu hình này đến từ repository (dùng chung hoặc được import). Chỉ chạy khi bạn tin người viết nó.',
      `Thư mục: ${cwd}`,
      `Lệnh: ${command || '—'}`,
      ...(before.length ? ['Trước khi chạy:', ...before.map((l) => `  ${l}`)] : []),
      ...(envKeys.length ? [`Biến môi trường: ${envKeys.join(', ')}`] : []),
      'Mỗi khi cấu hình thay đổi, app sẽ hỏi lại.',
    ].join('\n'),
  runTrustConfirm: 'Tin và chạy',
  accessTitle: (folder) => `Cho phép Orrery mở file trong ${folder}?`,
  accessDetail: 'Liên kết trỏ ra ngoài thư mục của các terminal đang mở. Cho phép thì tab trình duyệt và tab file đọc được thư mục này tới khi thoát app.',
  accessAllow: 'Cho phép',
  fullAccessTitle: 'Cho phép Orrery mở tệp ở mọi thư mục?',
  fullAccessDetail:
    'Tab file, Explorer, Changes và các tab trình duyệt trong app sẽ đọc được, và khi bạn lưu, đổi tên hay xoá thì sửa được, mọi thư mục trên máy mà không hỏi, kể cả thư mục chứa key hay file .env. Tắt lại trong Cài đặt → Quyền truy cập tệp.',
  fullAccessConfirm: 'Cho phép mọi thư mục',
  accessDeny: 'Huỷ',
  gitDeleteTitle: (name) => `Xoá nhánh ${name}?`,
  gitForceTitle: (name) => `${name} chưa được merge hết. Vẫn xoá?`,
  gitDeleteDetail: (commands) => `Orrery sẽ chạy:\n\n${commands.join('\n')}\n\nCác commit chỉ có trên nhánh này có thể bị mất.`,
  gitDeleteConfirm: 'Xoá',
  gitDeleteCancel: 'Huỷ',
  runTitle: (kind, a, b) =>
    kind === 'amend'
      ? 'Sửa commit cuối?'
      : kind === 'ff'
        ? `Fast-forward ${b} lên ${a}?`
        : kind === 'squash'
          ? `Gộp ${a} thành một commit trên ${b}?`
          : kind === 'abort'
            ? `Huỷ ${a} đang làm dở?`
            : kind === 'take'
              ? `Lấy ${a} từ ${b} vào checkout này?`
              : `Khôi phục ${a} từ checkpoint?`,
  runDetail: (kind, lines) =>
    kind === 'restore'
      ? `Các file này trở về như lúc checkpoint; file chưa có lúc đó sẽ vào thùng rác:\n\n${lines.join('\n')}`
      : kind === 'abort'
        ? `Orrery sẽ chạy:\n\n${lines.join('\n')}\n\nPhần giải xung đột chưa commit sẽ mất.`
        : kind === 'take'
          ? `Orrery sẽ chạy:\n\n${lines.join('\n')}\n\nFile ở checkout này bị thay (nó không có thay đổi chưa commit).`
          : `Orrery sẽ chạy:\n\n${lines.join('\n')}`,
  runConfirm: 'Tiếp tục',
  ghRemoveTitle: (login) => `Gỡ tài khoản GitHub ${login}?`,
  ghRemoveDetail: 'Orrery sẽ quên token của tài khoản này. Các repo đang dùng nó quay về chế độ tự chọn. Token vẫn còn hiệu lực trên GitHub cho tới khi bạn thu hồi ở đó.',
  ghRemoveConfirm: 'Gỡ',
  statusLineTitle: 'Bật status line bridge?',
  statusLineDetail: (file, json, chained) =>
    `Orrery sẽ ghi vào ${file}${chained ? ' (status line hiện tại của bạn vẫn chạy sau bridge)' : ''}:

${json}

Tệp cũ được giữ lại thành settings.json.ccm-backup. Các session Claude mới sẽ dùng cấu hình này.`,
  statusLineConfirm: 'Bật',
  statusLineCancel: 'Huỷ',
  hooksOnTitle: 'Bật hook bridge?',
  hooksOffTitle: 'Tắt hook bridge?',
  hooksDetail: (file, json, on) =>
    `Orrery sẽ ${on ? 'thêm hook chạy nền (PreCompact, PostCompact, PermissionDenied) vào' : 'gỡ hook của mình khỏi'} ${file}; các hook khác của bạn giữ nguyên:

${json}

Hook chạy nền và chỉ giữ tên sự kiện, trigger và tên tool. Tệp cũ được giữ lại thành settings.json.ccm-backup. Các session Claude mới sẽ dùng cấu hình này.`,
  grantTitle: 'Chọn thư mục chứa các project',
  extTitle: (kind) => (kind === 'install' ? 'Cài vào Claude Code?' : kind === 'remove' ? 'Gỡ khỏi Claude Code?' : 'Thêm vào Claude Code?'),
  extDetail: (where, commands) => `Orrery sẽ chạy, cho ${where}:

${commands.join('\n\n')}

Các phiên Claude mới sẽ nhận thay đổi.`,
  extWhereUser: 'mọi project của bạn (cấu hình user)',
  extWhereProject: (dir) => `${dir}, chia sẻ cho cả team (.mcp.json / .claude/settings.json, thường được commit)`,
  extWhereLocal: (dir) => `${dir}, chỉ mình bạn (không commit)`,
  extWhereNone: 'Claude Code (cấu hình user)',
  extConfirm: 'Chạy',
  extCancel: 'Huỷ',
  linkOpenBadFolder: 'Orrery không mở được thư mục này',
  linkOpenFailed: 'Orrery không mở được terminal. Hãy mở Workspace rồi thử lại.',
  linkOpenLive: 'Session này vẫn đang chạy ở một terminal khác. Hãy đóng nó ở đó trước rồi mở lại liên kết.',
}

export type Strings = typeof en

export const stringsFor = (locale: string): Strings => (locale.toLowerCase().startsWith('vi') ? vi : en)
