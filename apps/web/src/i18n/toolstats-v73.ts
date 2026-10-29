// Top-level `toolStats` of en.ts / vi.ts (v73): tool / skill / subagent / MCP call counts in History.
const en = {
  toolStats: {
    title: 'Tools, skills and subagents',
    hint: 'Calls counted from transcripts by name only, never their inputs.',
    project: 'Project',
    allProjects: 'All projects',
    range: 'Range',
    days: '{n} days',
    loading: 'Counting calls…',
    empty: 'No tool calls in this range.',
    group: {
      tools: 'Tools',
      skills: 'Skills',
      agents: 'Subagent types',
      mcp: 'MCP servers',
    },
    none: 'None called',
    calls: '{n} call | {n} calls',
    errors: '{pct} errors',
    errorsTitle: '{n} of {total} calls came back as an error',
    showAll: 'Show all {n}',
    showLess: 'Show fewer',
    unused: {
      title: 'Not used in 30 days',
      hint: 'Installed skills and configured MCP servers with no call in the last 30 days still take room in every new session.',
      check: 'Find unused',
      checking: 'Reading installed skills and servers…',
      failed: 'Could not read the installed skills and servers.',
      none: 'Every installed skill and server was called in the last 30 days.',
      skill: 'Skill',
      mcp: 'MCP server',
      scope: {
        user: 'Global',
        project: 'This project',
      },
      open: 'Review in Extensions',
      openHint: 'Opens the Extensions tab. Nothing is turned off for you.',
    },
  },
}

const vi: typeof en = {
  toolStats: {
    title: 'Công cụ, skill và subagent',
    hint: 'Đếm lần gọi trong transcript, chỉ theo tên, không đọc dữ liệu đầu vào.',
    project: 'Dự án',
    allProjects: 'Mọi dự án',
    range: 'Khoảng',
    days: '{n} ngày',
    loading: 'Đang đếm lần gọi…',
    empty: 'Không có lần gọi công cụ nào trong khoảng này.',
    group: {
      tools: 'Công cụ',
      skills: 'Skill',
      agents: 'Loại subagent',
      mcp: 'Máy chủ MCP',
    },
    none: 'Chưa gọi lần nào',
    calls: '{n} lần gọi | {n} lần gọi',
    errors: 'lỗi {pct}',
    errorsTitle: '{n} trên {total} lần gọi trả về lỗi',
    showAll: 'Xem cả {n}',
    showLess: 'Thu gọn',
    unused: {
      title: 'Không dùng trong 30 ngày',
      hint: 'Skill đã cài và máy chủ MCP đã cấu hình mà 30 ngày qua không được gọi lần nào vẫn chiếm chỗ trong mọi session mới.',
      check: 'Tìm mục không dùng',
      checking: 'Đang đọc skill và máy chủ đã cài…',
      failed: 'Không đọc được skill và máy chủ đã cài.',
      none: 'Mọi skill và máy chủ đã cài đều được gọi trong 30 ngày qua.',
      skill: 'Skill',
      mcp: 'Máy chủ MCP',
      scope: {
        user: 'Toàn cục',
        project: 'Dự án này',
      },
      open: 'Xem lại trong Extensions',
      openHint: 'Mở tab Extensions. Không tự tắt gì cả.',
    },
  },
}

export default { en, vi }
