// Top-level `monitorV79` of en.ts / vi.ts (v79): Monitor column groups, collapsed waiting strip, project filter, card menu, map zoom.
const en = {
  monitorV79: {
    group: { needs: 'Needs you', running: 'Running', idle: 'Idle', ended: 'Ended' },
    strip: {
      label: 'Needs you · {n}',
      oldest: '{title} waited {waited}',
      open: 'Open the sessions list',
    },
    projectAll: 'All projects',
    card: {
      more: 'Actions for {title}',
      status: 'Status: {status}',
    },
    favHint: { dismiss: 'Hide this tip' },
    zoomGroup: 'Map zoom',
  },
}

const vi = {
  monitorV79: {
    group: { needs: 'Cần chủ nhân', running: 'Đang chạy', idle: 'Rảnh', ended: 'Đã đóng' },
    strip: {
      label: 'Cần chủ nhân · {n}',
      oldest: '{title} đã chờ {waited}',
      open: 'Mở danh sách session',
    },
    projectAll: 'Tất cả dự án',
    card: {
      more: 'Thao tác cho {title}',
      status: 'Trạng thái: {status}',
    },
    favHint: { dismiss: 'Ẩn gợi ý này' },
    zoomGroup: 'Thu phóng sơ đồ',
  },
}

export default { en, vi }
