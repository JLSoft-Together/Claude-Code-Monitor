const en = {
  paneHead: {
    more: 'More actions',
    zoom: 'Zoom pane ({key})',
    unzoom: 'Show all panes ({key})',
    hidden: '{n} hidden pane — show all | {n} hidden panes — show all',
    branch: 'Worktrees · {branch}',
    attachCount: '{label} ({n})',
    compact: {
      label: 'Context {pct}% · Compact…',
      title: 'Context is {pct}% full. Compact… asks the agent to write a handoff file, then stops so you can run /compact',
    },
  },
}

const vi: typeof en = {
  paneHead: {
    more: 'Thao tác khác',
    zoom: 'Phóng to pane ({key})',
    unzoom: 'Hiện lại mọi pane ({key})',
    hidden: '{n} pane đang ẩn — hiện tất cả | {n} pane đang ẩn — hiện tất cả',
    branch: 'Worktree · {branch}',
    attachCount: '{label} ({n})',
    compact: {
      label: 'Ngữ cảnh {pct}% · Compact…',
      title: 'Ngữ cảnh đã dùng {pct}%. Compact… nhờ agent viết file handoff rồi dừng lại để bạn chạy /compact',
    },
  },
}

export default { en, vi }
