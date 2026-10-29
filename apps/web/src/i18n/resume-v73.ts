// Top-level `limitResume` of en.ts / vi.ts (v73): usage limit hit → prefill a continue prompt at the reset.
const en = {
  limitResume: {
    waiting: 'Waiting for reset {time}',
    scheduled: 'Continue at {time}',
    schedule: 'Schedule continue',
    title: 'Continue after the usage limit resets',
    hit: 'This agent stopped at the usage limit. It resets at {time}.',
    auto: 'Claude Code also said it will continue on its own at the reset; scheduling here only fills the input, so check before pressing Enter.',
    textLabel: 'Text to fill in',
    defaultText: 'continue',
    hint: 'At the reset the text is filled into this agent’s input and the pane is focused. Nothing is sent: you press Enter.',
    confirm: 'Schedule',
    update: 'Update',
    cancel: 'Cancel schedule',
    close: 'Close',
    filled: 'Usage limit reset: the continue text is in the input. Press Enter to send.',
    cancelledResumed: 'The agent replied again, so the scheduled continue was cancelled.',
    toastTitle: 'Usage limit reset',
    toastBody: 'Continue text filled into {n} agent pane. Press Enter to send. | Continue text filled into {n} agent panes. Press Enter to send.',
  },
}

const vi: typeof en = {
  limitResume: {
    waiting: 'Chờ reset {time}',
    scheduled: 'Tiếp tục lúc {time}',
    schedule: 'Hẹn tiếp tục',
    title: 'Tiếp tục khi hạn mức được reset',
    hit: 'Agent này dừng vì chạm hạn mức sử dụng. Hạn mức reset lúc {time}.',
    auto: 'Claude Code cũng báo sẽ tự tiếp tục lúc reset; hẹn ở đây chỉ điền chữ vào ô nhập, hãy xem lại trước khi nhấn Enter.',
    textLabel: 'Chữ sẽ điền',
    defaultText: 'tiếp tục',
    hint: 'Đến giờ reset, chữ được điền vào ô nhập của agent này và pane được focus. Không gửi gì: bạn tự nhấn Enter.',
    confirm: 'Hẹn',
    update: 'Cập nhật',
    cancel: 'Huỷ hẹn',
    close: 'Đóng',
    filled: 'Hạn mức đã reset: chữ tiếp tục đã nằm trong ô nhập. Nhấn Enter để gửi.',
    cancelledResumed: 'Agent đã trả lời lại nên lời hẹn tiếp tục đã được huỷ.',
    toastTitle: 'Hạn mức đã reset',
    toastBody: 'Đã điền chữ tiếp tục vào {n} pane agent. Nhấn Enter để gửi. | Đã điền chữ tiếp tục vào {n} pane agent. Nhấn Enter để gửi.',
  },
}

export default { en, vi }
