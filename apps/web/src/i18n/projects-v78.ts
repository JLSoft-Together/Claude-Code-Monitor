// Top-level `projectSwitcher` (v78: Go to project, Ctrl+Alt+P / ⌃⌥P) and `railCollapse` (rail fold others) of en.ts / vi.ts.
const en = {
  railCollapse: {
    others: 'Collapse other projects',
    othersHint: 'Collapse every project but this one. Right-click the sidebar to collapse them on every switch.',
    auto: 'Collapse others on switch',
    on: 'On',
    off: 'Off',
  },
  projectSwitcher: {
    title: 'Go to project',
    placeholder: 'Project name or folder',
    results: 'Projects',
    empty: 'No project matches.',
    none: 'No projects yet. Open a folder to start.',
    current: 'Current',
    tabs: '1 tab | {n} tabs',
    closed: 'Closed',
    needs: '1 needs you | {n} need you',
    failed: '1 failed | {n} failed',
    running: 'Running',
    favorite: 'Favourite',
    openFolder: 'Open folder…',
    forget: 'Remove from list',
    palette: 'Go to project…',
    hints: { cycle: 'next (hold)', move: 'move', open: 'open', newTab: 'new tab', forget: 'remove', close: 'close' },
  },
}

const vi: typeof en = {
  railCollapse: {
    others: 'Thu gọn dự án khác',
    othersHint: 'Thu gọn mọi dự án trừ dự án đang xem. Chuột phải vào thanh bên để tự thu gọn mỗi khi chuyển.',
    auto: 'Tự thu gọn khi chuyển dự án',
    on: 'Bật',
    off: 'Tắt',
  },
  projectSwitcher: {
    title: 'Chuyển tới dự án',
    placeholder: 'Tên dự án hoặc thư mục',
    results: 'Dự án',
    empty: 'Không có dự án nào khớp.',
    none: 'Chưa có dự án nào. Mở một thư mục để bắt đầu.',
    current: 'Đang xem',
    tabs: '1 tab | {n} tab',
    closed: 'Đã đóng',
    needs: '1 cần bạn | {n} cần bạn',
    failed: '1 lỗi | {n} lỗi',
    running: 'Đang chạy',
    favorite: 'Yêu thích',
    openFolder: 'Mở thư mục…',
    forget: 'Xoá khỏi danh sách',
    palette: 'Chuyển tới dự án…',
    hints: { cycle: 'tiếp (giữ phím)', move: 'di chuyển', open: 'mở', newTab: 'tab mới', forget: 'xoá', close: 'đóng' },
  },
}

export default { en, vi }
