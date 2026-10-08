const en = {
  appName: 'Claude Code Monitor',
  loading: 'Starting the monitor…',
  loadingHint: 'Local server on 127.0.0.1',
  errorTitle: 'The monitor could not start',
  retry: 'Try again',
  logHint: 'Recent log',
  collectorExited: (code: number | null) => `Collector stopped (code ${code ?? '?'}). Is port in use by another app?`,
  collectorTimeout: 'Collector did not respond within 30 s.',
  trayOpen: 'Open dashboard',
  trayCompact: 'Compact window',
  trayBrowser: 'Open in browser',
  trayLogin: 'Start with Windows',
  trayLogs: 'Open log folder',
  trayQuit: 'Quit',
  hiddenNotice: 'Still running in the tray. Quit from the tray menu.',
}

const vi: typeof en = {
  appName: 'Claude Code Monitor',
  loading: 'Đang khởi động monitor…',
  loadingHint: 'Server nội bộ trên 127.0.0.1',
  errorTitle: 'Không khởi động được monitor',
  retry: 'Thử lại',
  logHint: 'Log gần nhất',
  collectorExited: (code) => `Collector đã dừng (mã ${code ?? '?'}). Port có đang bị app khác dùng?`,
  collectorTimeout: 'Collector không phản hồi sau 30 giây.',
  trayOpen: 'Mở dashboard',
  trayCompact: 'Cửa sổ gọn',
  trayBrowser: 'Mở trong trình duyệt',
  trayLogin: 'Chạy cùng Windows',
  trayLogs: 'Mở thư mục log',
  trayQuit: 'Thoát',
  hiddenNotice: 'Monitor vẫn chạy dưới khay hệ thống. Thoát từ menu khay.',
}

export type Strings = typeof en

export const stringsFor = (locale: string): Strings => (locale.toLowerCase().startsWith('vi') ? vi : en)
