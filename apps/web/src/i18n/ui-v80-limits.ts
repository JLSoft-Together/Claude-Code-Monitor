// Top-level `limitsV80` of en.ts / vi.ts (v80): limit forecast in the status popover and on new agents.
const en = {
  limitsV80: {
    runsOutAt: 'Runs out around {at} at the current pace',
    dot: 'Limit may run out before it resets',
    launchWarn: '{provider} {window} limit may run out around {at} (in about {min} min) at the current pace.',
  },
}

const vi = {
  limitsV80: {
    runsOutAt: 'Hết lúc {at} nếu dùng như hiện tại',
    dot: 'Hạn mức có thể cạn trước khi được làm mới',
    launchWarn: 'Hạn mức {window} của {provider} có thể cạn lúc {at} (còn khoảng {min} phút) nếu dùng như hiện tại.',
  },
}

export default { en, vi }
