// Top-level `linksV80` of en.ts / vi.ts (v80 WP-6): review queue, History resume, Run auto reload.
const en = {
  linksV80: {
    unseen: 'Not reviewed',
    unseenCount: '{n} file changed since you last looked | {n} files changed since you last looked',
    badge: '{n} new',
    markSeen: 'Mark as reviewed',
    autoReload: 'Reload when the agent finishes',
    autoReloadHint: 'Hot reload (Flutter) or rerun (Android) after this project’s agent finishes a turn without an error. Off by default.',
    resume: 'Continue',
    resumeHint: 'Open this session in a Workspace pane with --resume. Nothing is sent to the agent.',
    resumeNoId: 'This session was recorded without its id, so it cannot be continued.',
    resumeNoFolder: 'The project folder is gone.',
    resumeRunning: 'This session is still running.',
    resumeShow: 'Show',
  },
}

const vi = {
  linksV80: {
    unseen: 'Chưa xem',
    unseenCount: '{n} file đã đổi từ lần xem trước | {n} file đã đổi từ lần xem trước',
    badge: '{n} mới',
    markSeen: 'Đánh dấu đã xem',
    autoReload: 'Tự reload khi agent xong',
    autoReloadHint: 'Hot reload (Flutter) hoặc chạy lại (Android) sau khi agent của dự án xong một lượt mà không lỗi. Mặc định tắt.',
    resume: 'Tiếp tục',
    resumeHint: 'Mở session này trong pane Workspace bằng --resume. Không gửi gì cho agent.',
    resumeNoId: 'Session này được ghi lại không kèm id nên không tiếp tục được.',
    resumeNoFolder: 'Thư mục dự án không còn.',
    resumeRunning: 'Session này vẫn đang chạy.',
    resumeShow: 'Hiện',
  },
}

export default { en, vi }
