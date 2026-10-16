const en = {
  tabName: {
    rename: 'Rename tab',
    label: 'Tab name',
    hint: 'Leave empty for the automatic name',
    renamed: 'Tab renamed to {name}',
    reset: 'Tab name reset to {name}',
  },
  tabActions: {
    label: 'Actions for {name}',
    open: 'Open',
    rename: 'Rename…',
    ungroup: 'Separate panes',
    close: 'Close tab',
    closeOthers: 'Close other tabs',
    moveTo: 'Move to tab',
    moveOut: 'Move to its own tab',
    closePane: 'Close pane',
    fold: 'Collapse',
    unfold: 'Expand',
    noTargets: 'No other tab in this project',
  },
  paneDrop: {
    merge: 'Add to {name}',
    detach: 'Own tab',
    otherProject: 'Only within the same project',
    moved: '{pane} moved to {tab}',
    detached: '{pane} moved to its own tab',
    merged: '{tab} merged into {target}',
    ungrouped: '{tab} separated into {n} tabs',
  },
  subagentState: {
    waiting: 'Waiting on {n} subagent | Waiting on {n} subagents',
    working: 'Working · {n} subagent | Working · {n} subagents',
    count: '{n} subagent running | {n} subagents running',
  },
}

const vi: typeof en = {
  tabName: {
    rename: 'Đổi tên tab',
    label: 'Tên tab',
    hint: 'Để trống để dùng tên tự động',
    renamed: 'Đã đổi tên tab thành {name}',
    reset: 'Tên tab về mặc định: {name}',
  },
  tabActions: {
    label: 'Thao tác cho {name}',
    open: 'Mở',
    rename: 'Đổi tên…',
    ungroup: 'Tách các pane',
    close: 'Đóng tab',
    closeOthers: 'Đóng các tab khác',
    moveTo: 'Chuyển vào tab',
    moveOut: 'Tách ra tab riêng',
    closePane: 'Đóng pane',
    fold: 'Thu gọn',
    unfold: 'Mở rộng',
    noTargets: 'Không có tab khác trong project này',
  },
  paneDrop: {
    merge: 'Thêm vào {name}',
    detach: 'Tab riêng',
    otherProject: 'Chỉ trong cùng project',
    moved: 'Đã chuyển {pane} vào {tab}',
    detached: 'Đã tách {pane} ra tab riêng',
    merged: 'Đã gộp {tab} vào {target}',
    ungrouped: 'Đã tách {tab} thành {n} tab',
  },
  subagentState: {
    waiting: 'Chờ {n} subagent',
    working: 'Đang chạy · {n} subagent',
    count: '{n} subagent đang chạy',
  },
}

export default { en, vi }
