import type { BackupSectionId } from '@ccm/shared'

export type RunKind = 'amend' | 'ff' | 'squash' | 'restore' | 'abort' | 'take'

const clip = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}…` : s)

const en = {
  appName: 'Orrery',
  loading: 'Starting the monitor…',
  promptsExportTitle: 'Export prompt library',
  promptsImportTitle: 'Import prompt library',
  promptsFilter: 'Orrery prompts',
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
    `Orrery will ${on ? 'add async hooks (PreCompact, PostCompact, PermissionDenied, PermissionRequest) to' : 'remove its hooks from'} ${file}; your other hooks stay:

${json}

They run in the background and keep only the event name, trigger, tool name, the session folder and, for permission dialogs, the suggested rule or the first words of the command. The old file is kept as settings.json.ccm-backup. New Claude sessions pick it up.`,
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
  httpHostTitle: (host: string) => `Send a request to ${host}?`,
  httpHostDetail: (method: string) =>
    `This ${method} request from a .http file goes out to the internet, with the headers and body it shows (variable values included). Orrery asks once per host until the app restarts.`,
  httpHostSend: 'Send',
  replaceTitle: (lines: number, files: number) =>
    `Replace in ${lines === 1 ? '1 line' : `${lines} lines`} across ${files === 1 ? '1 file' : `${files} files`}?`,
  replaceDetail: (find: string, replacement: string, paths: string[]) =>
    `"${find}" → "${replacement}"\n\n${paths.join('\n')}\n\nFiles changed since the search are skipped. The text before is kept in Local History.`,
  replaceConfirm: 'Replace',
  permTitle: (n: number) => `Add ${n === 1 ? '1 allow rule' : `${n} allow rules`} to settings.local.json?`,
  permDetail: (file: string, diff: string) =>
    `Orrery will write ${file} (only on this machine, not shared). Other keys stay; the old file is kept as settings.local.json.ccm-backup:

${diff}

Claude Code will run these without asking in this project.`,
  permConfirm: 'Add rules',
  denyTitle: (n: number, scope: 'project' | 'local' | 'user') =>
    `Block ${n === 1 ? 'this' : `these ${n}`} next time ${scope === 'user' ? 'in every project' : 'in this project'}?`,
  denyDetail: (file: string, scope: 'project' | 'local' | 'user', diff: string) =>
    `Orrery will add deny rules to ${file}${scope === 'project' ? ' (shared with everyone who clones the repo)' : scope === 'local' ? ' (only on this machine)' : ' (your user settings, every project)'}. Other keys stay; the old file is kept as ${file.split(/[\\/]/).pop()}.orrery-bak:

${diff}

Claude Code will refuse matching tool calls instead of asking.`,
  denyConfirm: 'Block',
  prefsWriteTitle: (pkg: string) => `Change a SharedPreferences value of ${pkg}?`,
  prefsWriteDetail: (file: string, key: string, before: string, after: string) =>
    `${file}
${key}: ${clip(before)} → ${clip(after)}

The app is force-stopped first, then the file is written on the device. The first original of this file is kept in Orrery for Restore original.`,
  prefsWriteConfirm: 'Write and stop app',
  prefsRestoreTitle: (pkg: string) => `Restore the original SharedPreferences file of ${pkg}?`,
  prefsRestoreDetail: (file: string) => `${file} goes back to the copy kept before the first change from Orrery. The app is force-stopped first.`,
  prefsRestoreConfirm: 'Restore and stop app',
  updateQuitTitle: (n: number) => (n === 1 ? 'Restart to update and close 1 session?' : `Restart to update and close ${n} sessions?`),
  updateQuitDetail: 'Orrery quits, installs the new version and opens again. Agents in closed panes can be reopened with resume.',
  updateQuitConfirm: 'Restart and update',
  avdWipeTitle: (name: string) => `Wipe all data of the emulator ${name}?`,
  avdWipeDetail: 'Apps, accounts, files and snapshots inside this virtual device are erased, then it starts like new. This cannot be undone.',
  avdWipeConfirm: 'Wipe and start',
  recSaveTitle: 'Save screen recording',
  recFilter: 'MP4 video',
  perfColdTitle: (pkg: string) => `Measure a cold start of ${pkg}?`,
  perfColdDetail: 'The app is stopped first (unsaved state in it is lost), then its launcher activity is started and the start time is read.',
  perfColdConfirm: 'Stop and start app',
  fsDeleteTitle: (name: string, dir: boolean) => (dir ? `Delete the folder ${name} and everything in it from the device?` : `Delete ${name} from the device?`),
  fsDeleteDetail: (where: string) => `${where}\n\nThis cannot be undone.`,
  fsDeleteConfirm: 'Delete',
  fsReplaceTitle: (name: string) => `Replace ${name} on the device?`,
  fsReplaceDetail: (where: string) => `${where} already exists and will be overwritten.`,
  fsReplaceConfirm: 'Replace',
  fsPullTitle: 'Pull to folder',
  fsPushTitle: 'Push files to the device',
  releasePickTitle: 'Choose the APK or AAB to verify',
  hookToggleTitle: (on: boolean, event: string) => (on ? `Turn the ${event} hook back on?` : `Turn off this ${event} hook?`),
  hookToggleDetail: (on: boolean, file: string, diff: string) =>
    `Orrery will write ${file}. Other keys stay; the old file is kept as ${file.split(/[\\/]/).pop()}.ccm-backup.${on ? '' : ' The hook is kept in Orrery so it can be turned back on.'}

${diff}

Running Claude sessions pick this up on their next start.`,
  hookToggleConfirm: (on: boolean): string => (on ? 'Turn on' : 'Turn off'),
  hookTestTitle: (event: string) => `Run this ${event} hook once as a test?`,
  hookTestDetail: (text: string, cwd: string) =>
    `${text}

It runs in ${cwd} with a made-up JSON input on stdin and a minimal environment, stopped after 10 seconds. A hook that changes files or calls a service really does so.`,
  hookTestConfirm: 'Run test',
  resKillTitle: (n: number, name: string) => (n === 1 ? `Stop ${name}?` : `Stop ${n} forgotten processes?`),
  resKillDetail: (lines: string[], session: boolean) =>
    `${lines.join('\n')}\n\nEach process is stopped together with everything it started.${session ? ' A stopped agent session loses the reply or tool call it is in the middle of; reopen it later with claude --resume.' : ''}`,
  resKillConfirm: (n: number): string => (n === 1 ? 'Stop' : 'Stop all'),
  resKillSession: 'agent session',
  freePortTitle: (pane: string, port: number) => `An agent in “${pane}” wants to free port ${port}`,
  freePortDetail: (lines: string[]) =>
    `${lines.join('\n')}\n\nThe agent asked through Orrery's free_port tool. Each process is stopped together with everything it started.`,
  freePortConfirm: 'Stop',
  tgCommandTitle: 'Install the /bot-tele-send-notify command?',
  tgCommandDetail: (file: string) => `Orrery writes ${file}. In any Claude Code session opened in Orrery, /bot-tele-send-notify on | off | status then turns Telegram reports on or off for the whole app.`,
  tgCommandConfirm: 'Install',
  tgCommandCancel: 'Cancel',
  tgReceiveTitle: 'Install the /bot-tele-receive command?',
  tgReceiveDetail: (file: string) =>
    `Orrery writes ${file}. In a Claude Code session opened in Orrery, /bot-tele-receive on lets your paired Telegram account mention the bot in a project topic to type a message into that project's session. Nobody else can. It turns off again when Orrery restarts.`,
  tgReceiveAskTitle: (pane: string) => `An agent in “${pane}” wants to turn on Telegram commands`,
  tgReceiveAskDetail: (owner: string) =>
    `While on, the paired Telegram account ${owner} can mention the bot in a project topic to send messages into that project's sessions and approve their permission prompts. The agent asked through Orrery's telegram_receive tool; allow it only if you asked for it. It turns off again when Orrery restarts.`,
  tgReceiveAskConfirm: 'Turn on',
  capturePickTitle: 'Folder for screenshots and recordings',
  captureMissingTitle: 'Capture folder not available',
  captureMissingBody: (dir: string) => `${dir} cannot be found (drive removed?). Recordings go to the temp folder and screenshots to the clipboard until it is back.`,
  backupApplyTitle: (n: number) => (n === 1 ? 'Import 1 section and restart Orrery?' : `Import ${n} sections and restart Orrery?`),
  backupApplyDetail: (names: string[]) =>
    `${names.map((n) => `• ${n}`).join('\n')}\n\nThese values replace the ones on this machine. The current setup is saved first in the backups folder of the Orrery data folder. Orrery restarts to finish.`,
  backupApplyConfirm: 'Import and restart',
  backupSections: {
    appearance: 'Appearance and fonts',
    settings: 'Settings and notifications',
    workspace: 'Workspace tabs and layouts',
    notes: 'Notes, prompts and bookmarks',
    names: 'Names, aliases and favourites',
    devices: 'Remembered Android devices',
    run: 'Run settings and templates',
    updates: 'Update preferences',
    github: 'GitHub account names (tokens are added again)',
  } as Record<BackupSectionId, string>,
  agentPickTarget: 'Choose the drive folder to move the agent data into',
  agentPickBackup: 'Choose a folder for the original transcripts',
  agentData: {
    cancel: 'Cancel',
    group: (id: string): string =>
      (({ debugLogs: 'Debug logs', shellSnapshots: 'Shell snapshots', appCache: 'App caches', codexLogs: 'Codex logs', codexCache: 'Codex caches', codexTemp: 'Codex temp files' }) as Record<string, string>)[id] ?? id,
    cleanTitle: (files: number, size: string) => (files === 1 ? `Delete 1 cache file (${size})?` : `Delete ${files} cache files (${size})?`),
    cleanDetail: (lines: string[], days: number) =>
      `${lines.join('\n')}\n\n${days ? `Only files not changed for ${days} days.` : 'Every file in these groups.'} Files changed in the last 24 hours are kept. Transcripts, settings and sign-in are never touched.`,
    cleanConfirm: 'Delete',
    stripTitle: (files: number, images: number) => `Remove ${images} images from ${files} old transcripts?`,
    stripDetail: (size: string, backup: string) =>
      `About ${size} of image data is replaced by a short note. The original files are copied first to:\n${backup}\n\nResuming those sessions later works, but the agent no longer sees the removed images. Running sessions and recent ones are skipped.`,
    stripConfirm: 'Back up and remove images',
    moveTitle: (from: string, to: string) => `Move ${from} to ${to}?`,
    moveDetail: (size: string, original: string) =>
      `${size} is copied and checked (file count, sizes, sample hashes). Then the original is renamed to ${original} and a link takes its place, so Claude Code, Codex and Orrery keep using the same path.\n\nDo not start Claude Code or Codex until it finishes. Orrery's monitor restarts once. The original stays until you choose Delete original.`,
    moveConfirm: 'Copy and move',
    undoTitle: (folder: string) => `Move ${folder} back?`,
    undoDetail: (target: string, newFiles: number, originalDeleted: boolean) =>
      originalDeleted
        ? `The original was deleted, so everything is copied back from:\n${target}\n\nThe copy there is kept.`
        : newFiles
          ? `${newFiles} files were written at ${target} after the move. Copy them back over the original, or go back to the original as it was when it was moved. The copy at the new place is kept either way.`
          : `The link is removed and the original comes back. The copy at ${target} is kept.`,
    undoCopyBack: (n: number) => (n === 1 ? 'Undo and copy back 1 file' : `Undo and copy back ${n} files`),
    undoOnly: 'Undo',
    deleteTitle: (folder: string) => `Delete the original ${folder}?`,
    deleteDetail: (size: string) => `${size} is deleted for good. The moved copy keeps working; Undo after this copies everything back from it.`,
    deleteConfirm: 'Delete original',
    discardTitle: (folder: string) => `Delete the unfinished copy ${folder}?`,
    discardDetail: 'A move was interrupted before it finished. The original folder is in place and in use; only this partial copy is deleted.',
    discardConfirm: 'Delete copy',
  },
  buildClean: {
    cancel: 'Cancel',
    title: (dirs: number, size: string) => (dirs === 1 ? `Delete 1 build folder (${size})?` : `Delete ${dirs} build folders (${size})?`),
    detail: (lines: string[], more: number, reinstall: boolean, trash: boolean) =>
      `${lines.join('\n')}${more ? `\n…and ${more} more` : ''}\n\n${reinstall ? 'Packages (node_modules / .venv) must be installed again, and the next build takes longer.' : 'The next build rebuilds them and takes longer.'} ${trash ? 'They go to the Recycle Bin / Trash.' : 'They are deleted for good, not moved to the Recycle Bin / Trash.'} Source files are never touched.`,
    confirm: 'Delete',
    confirmTrash: 'Move to Trash',
  },
  deepseek: {
    cancel: 'Cancel',
    installTitle: 'Install the DeepSeek CLI (Codewhale)?',
    downloadTitle: 'Download the Codewhale program?',
    installDetail: (commands: string[]) =>
      `Orrery will run:\n\n${commands.map(clip).join('\n')}\n\nThe first run of codewhale downloads its program (about 130 MB) from GitHub Releases.`,
    installConfirm: 'Install',
    downloadConfirm: 'Download',
    updateTitle: 'Update the DeepSeek CLI (Codewhale)?',
    updateDetail: (commands: string[]) => `Orrery will run:\n\n${commands.map(clip).join('\n')}\n\nDeepSeek panes that are open keep the old version until they restart.`,
    updateConfirm: 'Update',
    logoutTitle: 'Log out of DeepSeek?',
    logoutDetail: 'Codewhale deletes the saved DeepSeek API key (codewhale auth clear --provider deepseek). DeepSeek panes stop working until you add a key again.',
    logoutConfirm: 'Log out',
    syncTitle: 'Copy rules, skills and MCP servers from Claude?',
    syncDetail: (files: { file: string; action: 'create' | 'update' }[], servers: string[], outbox = false) =>
      `${files.map((f) => `${f.action === 'create' ? 'Create' : 'Update'} ${f.file}`).join('\n')}${servers.length ? `\n\nMCP servers added to ~/.codewhale/mcp.json: ${servers.join(', ')}` : ''}${outbox ? '\n\nconfig.toml: turn on the lifecycle outbox ([lifecycle_outbox] path = ~/.codewhale/notifications/outbox.jsonl) so the Monitor shows DeepSeek session status.' : ''}\n\nEach file that already exists is backed up once as <file>.orrery-backup. In AGENTS.md only the Orrery block changes.`,
    syncConfirm: 'Write files',
  },
}

const vi: typeof en = {
  appName: 'Orrery',
  loading: 'Đang khởi động monitor…',
  promptsExportTitle: 'Xuất thư viện prompt',
  promptsImportTitle: 'Nhập thư viện prompt',
  promptsFilter: 'Prompt Orrery',
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
    `Orrery sẽ ${on ? 'thêm hook chạy nền (PreCompact, PostCompact, PermissionDenied, PermissionRequest) vào' : 'gỡ hook của mình khỏi'} ${file}; các hook khác của bạn giữ nguyên:

${json}

Hook chạy nền và chỉ giữ tên sự kiện, trigger, tên tool, thư mục của session và, với hộp hỏi quyền, luật được gợi ý hoặc vài chữ đầu của lệnh. Tệp cũ được giữ lại thành settings.json.ccm-backup. Các session Claude mới sẽ dùng cấu hình này.`,
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
  httpHostTitle: (host) => `Gửi request tới ${host}?`,
  httpHostDetail: (method) =>
    `Request ${method} này từ file .http sẽ đi ra internet, kèm header và body như đang hiện (gồm cả giá trị biến). Orrery hỏi một lần cho mỗi host tới khi khởi động lại ứng dụng.`,
  httpHostSend: 'Gửi',
  replaceTitle: (lines, files) => `Thay thế trong ${lines} dòng ở ${files} file?`,
  replaceDetail: (find, replacement, paths) =>
    `"${find}" → "${replacement}"\n\n${paths.join('\n')}\n\nFile đã đổi kể từ lúc tìm sẽ được bỏ qua. Nội dung cũ được giữ trong Local History.`,
  replaceConfirm: 'Thay thế',
  permTitle: (n) => `Thêm ${n} luật allow vào settings.local.json?`,
  permDetail: (file, diff) =>
    `Orrery sẽ ghi ${file} (chỉ trên máy này, không chia sẻ). Các khoá khác giữ nguyên; tệp cũ được giữ lại thành settings.local.json.ccm-backup:

${diff}

Claude Code sẽ chạy các lệnh này không hỏi lại trong dự án này.`,
  permConfirm: 'Thêm luật',
  denyTitle: (n, scope) => `Chặn ${n === 1 ? 'việc này' : `${n} mẫu này`} lần sau ${scope === 'user' ? 'ở mọi dự án' : 'trong dự án này'}?`,
  denyDetail: (file, scope, diff) =>
    `Orrery sẽ thêm luật deny vào ${file}${scope === 'project' ? ' (chia sẻ với mọi người clone repo)' : scope === 'local' ? ' (chỉ trên máy này)' : ' (cài đặt người dùng, mọi dự án)'}. Các khoá khác giữ nguyên; tệp cũ được giữ lại thành ${file.split(/[\\/]/).pop()}.orrery-bak:

${diff}

Claude Code sẽ từ chối các lệnh tool khớp luật thay vì hỏi.`,
  denyConfirm: 'Chặn',
  prefsWriteTitle: (pkg) => `Đổi một giá trị SharedPreferences của ${pkg}?`,
  prefsWriteDetail: (file, key, before, after) =>
    `${file}
${key}: ${clip(before)} → ${clip(after)}

Ứng dụng sẽ bị dừng (force-stop) trước, rồi file được ghi lên thiết bị. Bản gốc đầu tiên của file được giữ trong Orrery để Khôi phục bản gốc.`,
  prefsWriteConfirm: 'Ghi và dừng ứng dụng',
  prefsRestoreTitle: (pkg) => `Khôi phục file SharedPreferences gốc của ${pkg}?`,
  prefsRestoreDetail: (file) => `${file} sẽ trở về bản đã giữ trước lần đổi đầu tiên từ Orrery. Ứng dụng sẽ bị dừng (force-stop) trước.`,
  prefsRestoreConfirm: 'Khôi phục và dừng ứng dụng',
  updateQuitTitle: (n) => `Khởi động lại để cập nhật và đóng ${n} phiên?`,
  updateQuitDetail: 'Orrery sẽ thoát, cài bản mới rồi tự mở lại. Agent trong các pane bị đóng có thể mở lại bằng resume.',
  updateQuitConfirm: 'Khởi động lại và cập nhật',
  avdWipeTitle: (name) => `Xoá toàn bộ dữ liệu của emulator ${name}?`,
  avdWipeDetail: 'Ứng dụng, tài khoản, file và snapshot trong thiết bị ảo này sẽ bị xoá, rồi nó khởi động như mới. Không hoàn tác được.',
  avdWipeConfirm: 'Xoá và khởi động',
  recSaveTitle: 'Lưu video quay màn hình',
  recFilter: 'Video MP4',
  perfColdTitle: (pkg) => `Đo thời gian mở nguội của ${pkg}?`,
  perfColdDetail: 'Ứng dụng sẽ bị dừng trước (trạng thái chưa lưu trong app sẽ mất), rồi activity khởi chạy được mở và thời gian mở được đọc lại.',
  perfColdConfirm: 'Dừng và mở app',
  fsDeleteTitle: (name, dir) => (dir ? `Xoá thư mục ${name} cùng mọi thứ bên trong khỏi thiết bị?` : `Xoá ${name} khỏi thiết bị?`),
  fsDeleteDetail: (where) => `${where}\n\nKhông hoàn tác được.`,
  fsDeleteConfirm: 'Xoá',
  fsReplaceTitle: (name) => `Thay ${name} trên thiết bị?`,
  fsReplaceDetail: (where) => `${where} đã có và sẽ bị ghi đè.`,
  fsReplaceConfirm: 'Thay',
  fsPullTitle: 'Kéo về thư mục',
  fsPushTitle: 'Đẩy file vào thiết bị',
  releasePickTitle: 'Chọn APK hoặc AAB để kiểm chữ ký',
  hookToggleTitle: (on, event) => (on ? `Bật lại hook ${event} này?` : `Tắt hook ${event} này?`),
  hookToggleDetail: (on, file, diff) =>
    `Orrery sẽ ghi ${file}. Các khoá khác giữ nguyên; file cũ được giữ thành ${file.split(/[\\/]/).pop()}.ccm-backup.${on ? '' : ' Hook được cất trong Orrery để bật lại sau.'}

${diff}

Các phiên Claude đang chạy sẽ nhận thay đổi ở lần khởi động sau.`,
  hookToggleConfirm: (on) => (on ? 'Bật' : 'Tắt'),
  hookTestTitle: (event) => `Chạy thử hook ${event} này một lần?`,
  hookTestDetail: (text, cwd) =>
    `${text}

Lệnh chạy trong ${cwd} với input JSON giả trên stdin và môi trường tối thiểu, dừng sau 10 giây. Hook nào sửa file hay gọi dịch vụ thì vẫn làm thật.`,
  hookTestConfirm: 'Chạy thử',
  resKillTitle: (n, name) => (n === 1 ? `Tắt ${name}?` : `Tắt ${n} process bị bỏ quên?`),
  resKillDetail: (lines, session) =>
    `${lines.join('\n')}\n\nMỗi process bị tắt cùng mọi thứ nó đã khởi chạy.${session ? ' Session agent bị tắt sẽ mất câu trả lời hoặc tool đang chạy dở; mở lại sau bằng claude --resume.' : ''}`,
  resKillConfirm: (n) => (n === 1 ? 'Tắt' : 'Tắt tất cả'),
  resKillSession: 'session agent',
  freePortTitle: (pane, port) => `Agent ở “${pane}” muốn giải phóng cổng ${port}`,
  freePortDetail: (lines) => `${lines.join('\n')}\n\nAgent yêu cầu qua công cụ free_port của Orrery. Mỗi process bị dừng cùng mọi thứ nó đã khởi chạy.`,
  freePortConfirm: 'Dừng',
  tgCommandTitle: 'Cài lệnh /bot-tele-send-notify?',
  tgCommandDetail: (file) => `Orrery sẽ ghi file ${file}. Sau đó trong mọi session Claude Code mở trong Orrery, gõ /bot-tele-send-notify on | off | status để bật / tắt báo Telegram cho cả app.`,
  tgCommandConfirm: 'Cài',
  tgCommandCancel: 'Huỷ',
  tgReceiveTitle: 'Cài lệnh /bot-tele-receive?',
  tgReceiveDetail: (file) =>
    `Orrery sẽ ghi file ${file}. Trong session Claude Code mở trong Orrery, gõ /bot-tele-receive on thì tài khoản Telegram đã ghép của chủ nhân tag bot trong topic của project để gửi tin vào session của project đó. Người khác không gửi được. Khởi động lại Orrery thì tự tắt.`,
  tgReceiveAskTitle: (pane) => `Agent ở “${pane}” muốn bật nhận lệnh Telegram`,
  tgReceiveAskDetail: (owner) =>
    `Khi bật, tài khoản Telegram đã ghép ${owner} tag bot trong topic của project để gửi tin vào session của project đó và duyệt các lần xin quyền. Agent yêu cầu qua công cụ telegram_receive của Orrery; chỉ cho phép khi chủ nhân đã yêu cầu. Khởi động lại Orrery thì tự tắt.`,
  tgReceiveAskConfirm: 'Bật',
  capturePickTitle: 'Thư mục lưu ảnh chụp và video quay',
  captureMissingTitle: 'Không dùng được thư mục chụp / quay',
  captureMissingBody: (dir) => `Không tìm thấy ${dir} (đã rút ổ?). Video quay tạm ghi vào thư mục temp và ảnh chụp đi qua clipboard cho tới khi thư mục có lại.`,
  backupApplyTitle: (n) => `Nhập ${n} mục và khởi động lại Orrery?`,
  backupApplyDetail: (names) =>
    `${names.map((n) => `• ${n}`).join('\n')}\n\nCác giá trị này sẽ thay giá trị trên máy này. Cấu hình hiện tại được lưu trước vào thư mục backups trong thư mục dữ liệu Orrery. Orrery sẽ khởi động lại để hoàn tất.`,
  backupApplyConfirm: 'Nhập và khởi động lại',
  backupSections: {
    appearance: 'Giao diện và font',
    settings: 'Cài đặt và thông báo',
    workspace: 'Tab và bố cục Workspace',
    notes: 'Ghi chú, prompt và bookmark',
    names: 'Tên gọi, alias và yêu thích',
    devices: 'Thiết bị Android đã nhớ',
    run: 'Cài đặt Run và mẫu cấu hình',
    updates: 'Tuỳ chọn cập nhật',
    github: 'Tên tài khoản GitHub (cần thêm lại token)',
  },
  agentPickTarget: 'Chọn thư mục trên ổ đích để chuyển dữ liệu agent tới',
  agentPickBackup: 'Chọn thư mục giữ bản gốc của transcript',
  agentData: {
    cancel: 'Huỷ',
    group: (id: string): string =>
      (({ debugLogs: 'Log debug', shellSnapshots: 'Ảnh chụp shell', appCache: 'Cache ứng dụng', codexLogs: 'Log Codex', codexCache: 'Cache Codex', codexTemp: 'File tạm Codex' }) as Record<string, string>)[id] ?? id,
    cleanTitle: (files: number, size: string) => `Xoá ${files} file cache (${size})?`,
    cleanDetail: (lines: string[], days: number) =>
      `${lines.join('\n')}\n\n${days ? `Chỉ file không đổi trong ${days} ngày.` : 'Mọi file trong các nhóm này.'} File đổi trong 24 giờ qua được giữ lại. Không bao giờ đụng transcript, cài đặt hay đăng nhập.`,
    cleanConfirm: 'Xoá',
    stripTitle: (files: number, images: number) => `Gỡ ${images} ảnh khỏi ${files} transcript cũ?`,
    stripDetail: (size: string, backup: string) =>
      `Khoảng ${size} dữ liệu ảnh được thay bằng một dòng ghi chú. File gốc được sao trước vào:\n${backup}\n\nVẫn resume được các session đó, nhưng agent không còn thấy những ảnh đã gỡ. Session đang chạy và session hoạt động gần đây được bỏ qua.`,
    stripConfirm: 'Sao lưu và gỡ ảnh',
    moveTitle: (from: string, to: string) => `Chuyển ${from} sang ${to}?`,
    moveDetail: (size: string, original: string) =>
      `${size} được chép rồi kiểm (số file, dung lượng, hash mẫu). Sau đó bản gốc đổi tên thành ${original} và một liên kết thế chỗ, nên Claude Code, Codex và Orrery vẫn dùng đường dẫn cũ.\n\nĐừng mở Claude Code hay Codex tới khi xong. Bộ theo dõi của Orrery khởi động lại một lần. Bản gốc được giữ tới khi bạn chọn Xoá bản gốc.`,
    moveConfirm: 'Chép và chuyển',
    undoTitle: (folder: string) => `Chuyển ${folder} về chỗ cũ?`,
    undoDetail: (target: string, newFiles: number, originalDeleted: boolean) =>
      originalDeleted
        ? `Bản gốc đã bị xoá, nên mọi thứ được chép về từ:\n${target}\n\nBản ở đó vẫn được giữ.`
        : newFiles
          ? `Có ${newFiles} file được ghi ở ${target} sau khi chuyển. Chép chúng đè lên bản gốc, hoặc quay về bản gốc như lúc chuyển. Bản ở chỗ mới được giữ trong cả hai cách.`
          : `Liên kết bị gỡ và bản gốc trở lại. Bản ở ${target} được giữ.`,
    undoCopyBack: (n: number) => `Hoàn tác và chép về ${n} file`,
    undoOnly: 'Hoàn tác',
    deleteTitle: (folder: string) => `Xoá bản gốc ${folder}?`,
    deleteDetail: (size: string) => `${size} bị xoá hẳn. Bản đã chuyển vẫn chạy bình thường; hoàn tác sau đó sẽ chép mọi thứ về từ bản này.`,
    deleteConfirm: 'Xoá bản gốc',
    discardTitle: (folder: string) => `Xoá bản chép dở ${folder}?`,
    discardDetail: 'Một lần chuyển bị ngắt giữa chừng. Thư mục gốc vẫn ở chỗ cũ và đang được dùng; chỉ bản chép dở này bị xoá.',
    discardConfirm: 'Xoá bản chép',
  },
  buildClean: {
    cancel: 'Huỷ',
    title: (dirs: number, size: string) => `Xoá ${dirs} thư mục build (${size})?`,
    detail: (lines: string[], more: number, reinstall: boolean, trash: boolean) =>
      `${lines.join('\n')}${more ? `\n…và ${more} thư mục nữa` : ''}\n\n${reinstall ? 'Phải cài lại gói (node_modules / .venv), và lần build sau sẽ lâu hơn.' : 'Lần build sau sẽ tạo lại và lâu hơn.'} ${trash ? 'Chúng được chuyển vào Thùng rác.' : 'Chúng bị xoá hẳn, không vào Thùng rác.'} Mã nguồn không bao giờ bị đụng tới.`,
    confirm: 'Xoá',
    confirmTrash: 'Chuyển vào Thùng rác',
  },
  deepseek: {
    cancel: 'Huỷ',
    installTitle: 'Cài DeepSeek CLI (Codewhale)?',
    downloadTitle: 'Tải chương trình Codewhale?',
    installDetail: (commands) =>
      `Orrery sẽ chạy:\n\n${commands.map(clip).join('\n')}\n\nLần chạy codewhale đầu tiên sẽ tải chương trình (khoảng 130 MB) từ GitHub Releases.`,
    installConfirm: 'Cài',
    downloadConfirm: 'Tải về',
    updateTitle: 'Cập nhật DeepSeek CLI (Codewhale)?',
    updateDetail: (commands) => `Orrery sẽ chạy:\n\n${commands.map(clip).join('\n')}\n\nPane DeepSeek đang mở vẫn dùng bản cũ cho tới khi khởi động lại.`,
    updateConfirm: 'Cập nhật',
    logoutTitle: 'Đăng xuất DeepSeek?',
    logoutDetail: 'Codewhale xoá API key DeepSeek đã lưu (codewhale auth clear --provider deepseek). Pane DeepSeek sẽ không chạy được cho tới khi bạn thêm key lại.',
    logoutConfirm: 'Đăng xuất',
    syncTitle: 'Chép rule, skill và MCP server từ Claude?',
    syncDetail: (files, servers, outbox = false) =>
      `${files.map((f) => `${f.action === 'create' ? 'Tạo' : 'Cập nhật'} ${f.file}`).join('\n')}${servers.length ? `\n\nMCP server thêm vào ~/.codewhale/mcp.json: ${servers.join(', ')}` : ''}${outbox ? '\n\nconfig.toml: bật lifecycle outbox ([lifecycle_outbox] path = ~/.codewhale/notifications/outbox.jsonl) để Monitor hiện trạng thái phiên DeepSeek.' : ''}\n\nMỗi file đã có được sao lưu một lần thành <file>.orrery-backup. Trong AGENTS.md chỉ khối Orrery thay đổi.`,
    syncConfirm: 'Ghi file',
  },
}

export type Strings = typeof en

export const stringsFor = (locale: string): Strings => (locale.toLowerCase().startsWith('vi') ? vi : en)
