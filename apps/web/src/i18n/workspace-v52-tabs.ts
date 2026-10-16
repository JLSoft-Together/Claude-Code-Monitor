const en = {
  zoom: {
    zoom: 'Zoom pane',
    unzoom: 'Show all panes',
    tabGlyph: 'Zoomed: {n} other pane hidden | Zoomed: {n} other panes hidden',
    said: {
      on: 'Zoomed {name}, {n} other pane hidden | Zoomed {name}, {n} other panes hidden',
      off: 'Showing all {n} panes',
    },
  },
  undo: {
    closed: 'Closed {name}',
    closedMany: 'Closed {n} pane | Closed {n} panes',
    action: 'Undo',
    actionTitle: 'Reopen what you just closed ({keys})',
    shellNote: 'A shell reopens fresh in the same folder | Shells reopen fresh in the same folder',
    dismiss: 'Dismiss',
    reopened: 'Reopened {name}',
    reopenedMany: 'Reopened {n} pane | Reopened {n} panes',
  },
}

const vi: typeof en = {
  zoom: {
    zoom: 'Phóng to pane',
    unzoom: 'Hiện mọi pane',
    tabGlyph: 'Đang phóng to: ẩn {n} pane khác',
    said: {
      on: 'Đã phóng to {name}, ẩn {n} pane khác',
      off: 'Đang hiện cả {n} pane',
    },
  },
  undo: {
    closed: 'Đã đóng {name}',
    closedMany: 'Đã đóng {n} pane',
    action: 'Hoàn tác',
    actionTitle: 'Mở lại thứ vừa đóng ({keys})',
    shellNote: 'Shell mở lại là phiên mới, cùng thư mục',
    dismiss: 'Bỏ qua',
    reopened: 'Đã mở lại {name}',
    reopenedMany: 'Đã mở lại {n} pane',
  },
}

export default { en, vi }
