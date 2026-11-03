// Top-level `paletteV80` of en.ts / vi.ts (v80 WP-10): one search box for sessions, projects, files and settings; tool timeline in the agent panel.
const en = {
  paletteV80: {
    placeholder: "Search sessions, projects, files, settings… (> {'@'} # :)",
    group: { projects: 'Projects', files: 'Files', settings: 'Settings' },
    scope: { all: 'All', sessions: 'Sessions', projects: 'Projects', commands: 'Commands', files: 'Files', settings: 'Settings' },
    prefix: { actions: 'Actions', sessions: 'Sessions', files: 'Files', settings: 'Settings' },
    more: 'Show {n} more',
    resume: 'continue',
    newTab: 'new tab',
    project: { tabs: '{n} tab | {n} tabs' },
    files: {
      noProject: 'Open a project in the Workspace to search its files.',
      loading: 'Loading files…',
      failed: 'Could not list the files of this project.',
      truncated: 'Large project: only the first {n} files are searched.',
      line: 'line {n}',
    },
    tools: {
      title: 'Tool calls',
      empty: 'No tool calls recorded for this sub-agent yet.',
      more: '{n} older calls not shown',
    },
  },
}

const vi = {
  paletteV80: {
    placeholder: "Tìm session, dự án, file, cài đặt… (> {'@'} # :)",
    group: { projects: 'Dự án', files: 'File', settings: 'Cài đặt' },
    scope: { all: 'Tất cả', sessions: 'Session', projects: 'Dự án', commands: 'Lệnh', files: 'File', settings: 'Cài đặt' },
    prefix: { actions: 'Hành động', sessions: 'Session', files: 'File', settings: 'Cài đặt' },
    more: 'Xem thêm {n}',
    resume: 'tiếp tục',
    newTab: 'tab mới',
    project: { tabs: '{n} tab | {n} tab' },
    files: {
      noProject: 'Mở một dự án trong Workspace để tìm file của nó.',
      loading: 'Đang tải danh sách file…',
      failed: 'Không liệt kê được file của dự án này.',
      truncated: 'Dự án lớn: chỉ tìm trong {n} file đầu tiên.',
      line: 'dòng {n}',
    },
    tools: {
      title: 'Lệnh gọi tool',
      empty: 'Chưa ghi nhận lệnh gọi tool nào của sub-agent này.',
      more: '{n} lệnh cũ hơn không hiển thị',
    },
  },
}

export default { en, vi }
