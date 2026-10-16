const en = {
  mapV53: {
    node: {
      main: 'main agent',
      sub: 'subagent',
    },
    tray: {
      count: '{n} finished | {n} finished',
      collapse: 'Collapse finished',
      open: 'Show {n} finished subagent | Show {n} finished subagents',
      close: 'Collapse {n} finished subagent | Collapse {n} finished subagents',
      openAll: 'Show finished subagents',
      closeAll: 'Collapse finished subagents',
    },
  },
}

const vi: typeof en = {
  mapV53: {
    node: {
      main: 'agent chính',
      sub: 'subagent',
    },
    tray: {
      count: '{n} đã xong',
      collapse: 'Thu gọn đã xong',
      open: 'Hiện {n} subagent đã xong',
      close: 'Thu gọn {n} subagent đã xong',
      openAll: 'Hiện subagent đã xong',
      closeAll: 'Thu gọn subagent đã xong',
    },
  },
}

export default { en, vi }
