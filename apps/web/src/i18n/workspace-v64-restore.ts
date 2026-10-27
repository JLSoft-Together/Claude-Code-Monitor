const en = {
  parked: {
    title: 'Asleep',
    hint: 'Kept from your last workspace. Nothing runs until you continue.',
    resume: 'Continue conversation',
    start: 'Start',
    key: 'Enter',
    wakeTab: 'Start tab ({n} asleep)',
  },
  restorePick: {
    hint: 'Ticked projects start now. The rest keep their layout and stay asleep until you open them.',
    sessions: '{n} session | {n} sessions',
    home: 'Home folder',
    all: 'Tick all',
    none: 'Untick all',
    run: 'Restore · start {n} | Restore · start {n}',
    layoutOnly: 'Restore layout',
  },
}

const vi: typeof en = {
  parked: {
    title: 'Đang ngủ',
    hint: 'Giữ từ workspace trước. Chưa chạy gì cho tới khi bạn bấm tiếp tục.',
    resume: 'Tiếp tục cuộc trò chuyện',
    start: 'Chạy',
    key: 'Enter',
    wakeTab: 'Chạy cả tab ({n} đang ngủ)',
  },
  restorePick: {
    hint: 'Project được tích sẽ chạy luôn. Project còn lại giữ bố cục và ngủ tới khi bạn mở.',
    sessions: '{n} session | {n} session',
    home: 'Thư mục home',
    all: 'Tích hết',
    none: 'Bỏ tích hết',
    run: 'Khôi phục · chạy {n} | Khôi phục · chạy {n}',
    layoutOnly: 'Khôi phục bố cục',
  },
}

export default { en, vi }
