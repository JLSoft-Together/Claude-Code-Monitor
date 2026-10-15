// Merged into `workspace` of en.ts / vi.ts in v38: project rail, spaces, Mission Control, needs-you list.
const en = {
  rail: {
    title: 'Projects',
    state: { failed: 'Failed', asked: 'Needs you', ended: 'Ended', working: 'Working', done: 'Finished', starting: 'Starting…', idle: 'Ready' },
    needs: '{n} needs you | {n} need you',
    worktree: 'worktree',
    folder: 'folder',
    closeRow: 'Close {name}',
    closeProject: 'Close project',
    forget: 'Remove {name} from the list',
    moveHint: 'Drag to reorder, or Alt+↑ / Alt+↓',
    moved: '{name} moved to position {n}',
    newIn: 'New tab in {name}',
    column: 'Projects (collapsed)',
    rowLabel: '{first}, {second}',
    runConfirm: {
      title: 'Stop the run and close {name}?',
      body: 'An app is still building or running from this project. Closing the project stops it first.',
      action: 'Stop and close',
      cancel: 'Cancel',
    },
    mission: {
      title: 'Mission Control',
      open: 'Mission Control ({keys})',
      shelf: 'Projects and tabs',
      windows: 'Panes of {name}',
      enter: 'Open {name}',
      empty: 'No output yet',
      panes: '{n} pane | {n} panes',
    },
    needsList: {
      title: 'Needs you',
      empty: 'Nobody needs you right now',
      working: '{n} working',
      done: '{n} finished',
      idle: '{n} ready',
      ended: '{n} ended',
    },
  },
}

const vi: typeof en = {
  rail: {
    title: 'Dự án',
    state: { failed: 'Lỗi', asked: 'Cần bạn', ended: 'Đã kết thúc', working: 'Đang chạy', done: 'Đã xong', starting: 'Đang khởi động…', idle: 'Sẵn sàng' },
    needs: '{n} cần bạn | {n} cần bạn',
    worktree: 'worktree',
    folder: 'thư mục',
    closeRow: 'Đóng {name}',
    closeProject: 'Đóng dự án',
    forget: 'Bỏ {name} khỏi danh sách',
    moveHint: 'Kéo để sắp xếp, hoặc Alt+↑ / Alt+↓',
    moved: 'Đã chuyển {name} tới vị trí {n}',
    newIn: 'Tab mới trong {name}',
    column: 'Dự án (thu gọn)',
    rowLabel: '{first}, {second}',
    runConfirm: {
      title: 'Dừng chạy và đóng {name}?',
      body: 'Ứng dụng của dự án này vẫn đang build hoặc chạy. Đóng dự án sẽ dừng nó trước.',
      action: 'Dừng và đóng',
      cancel: 'Huỷ',
    },
    mission: {
      title: 'Mission Control',
      open: 'Mission Control ({keys})',
      shelf: 'Dự án và tab',
      windows: 'Các pane của {name}',
      enter: 'Mở {name}',
      empty: 'Chưa có output',
      panes: '{n} pane | {n} pane',
    },
    needsList: {
      title: 'Cần bạn',
      empty: 'Hiện không có gì cần bạn',
      working: '{n} đang chạy',
      done: '{n} đã xong',
      idle: '{n} sẵn sàng',
      ended: '{n} đã kết thúc',
    },
  },
}

export default { en, vi }
