const en = {
  dim: {
    toggle: 'Dim other panes',
    toggleOn: 'Stop dimming other panes',
    hint: 'Fades the panes you are not typing in, so the active one stands out',
    menu: 'Dim other panes',
    tipTitle: 'Lots of panes open?',
    tipBody: 'Dim the ones you are not typing in so the active pane stands out. Turn it off from this button or in Settings.',
    tipTry: 'Turn on',
    tipLater: 'Not now',
    setting: 'Dim inactive panes',
    settingHint: 'Workspace: fade the panes you are not typing in',
    said: { on: 'Other panes dimmed', off: 'Other panes no longer dimmed' },
  },
  activity: {
    tool: '{tool} · {time}',
    working: 'Working · {time}',
    diff: '+{ins} −{del}',
    diffTitle: '{files} file changed in this checkout: {ins} added, {del} removed | {files} files changed in this checkout: {ins} added, {del} removed',
  },
}

const vi: typeof en = {
  dim: {
    toggle: 'Làm mờ pane khác',
    toggleOn: 'Thôi làm mờ pane khác',
    hint: 'Làm mờ các pane không gõ, để pane đang dùng nổi bật',
    menu: 'Làm mờ pane khác',
    tipTitle: 'Mở nhiều pane?',
    tipBody: 'Làm mờ các pane không gõ để dễ thấy pane đang dùng. Tắt lại bằng nút này hoặc trong Cài đặt.',
    tipTry: 'Bật',
    tipLater: 'Để sau',
    setting: 'Làm mờ pane không dùng',
    settingHint: 'Workspace: làm mờ các pane không gõ',
    said: { on: 'Đã làm mờ pane khác', off: 'Đã thôi làm mờ pane khác' },
  },
  activity: {
    tool: '{tool} · {time}',
    working: 'Đang làm · {time}',
    diff: '+{ins} −{del}',
    diffTitle: '{files} file đổi trong checkout này: thêm {ins}, xoá {del} | {files} file đổi trong checkout này: thêm {ins}, xoá {del}',
  },
}

export default { en, vi }
