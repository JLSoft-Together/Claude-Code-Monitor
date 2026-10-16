const en = {
  compact: {
    menu: 'Compact…',
    hint: 'Writes a handoff, then stops for /compact',
    cancel: 'Cancel compact',
    block: {
      busy: 'Wait until the session is idle',
      asking: 'The session is waiting for your answer',
      unlinked: 'No session linked yet',
    },
    prompt:
      'Prepare for /compact: write a handoff to `{file}` (create the folder if needed) covering what you are working on, how far it got, key decisions and constraints, the files to re-read, and the next steps in order, enough that after compacting, reading this file is all it takes to continue. Stop once it is written and do nothing else.',
    resume: 'Read `{file}` and continue.',
    step: {
      writing: 'Writing handoff…',
      missing: 'No handoff file yet',
      compact: 'Handoff ready · Enter runs /compact',
    },
    said: {
      started: 'Asked {name} to write a handoff',
      ready: 'Handoff written. /compact is typed in {name}, press Enter to run it',
      missing: '{name} went idle without writing {file}',
      resumed: '{name} compacted. Typed the line that reads the handoff',
      cancelled: 'Compact cancelled for {name}',
    },
  },
}

const vi: typeof en = {
  compact: {
    menu: 'Compact…',
    hint: 'Viết handoff rồi dừng để /compact',
    cancel: 'Huỷ compact',
    block: {
      busy: 'Đợi session rảnh đã',
      asking: 'Session đang chờ anh trả lời',
      unlinked: 'Chưa liên kết session',
    },
    prompt:
      'Chuẩn bị /compact: viết handoff vào `{file}` (tạo thư mục nếu chưa có), gồm việc đang làm, đã xong tới đâu, các quyết định và ràng buộc quan trọng, các file cần đọc lại, và các bước tiếp theo theo thứ tự, đủ để sau compact chỉ cần đọc file này là làm tiếp được. Viết xong thì dừng lại, không làm thêm việc gì khác.',
    resume: 'Đọc `{file}` rồi làm tiếp.',
    step: {
      writing: 'Đang viết handoff…',
      missing: 'Chưa thấy file handoff',
      compact: 'Handoff xong · Enter để chạy /compact',
    },
    said: {
      started: 'Đã yêu cầu {name} viết handoff',
      ready: 'Handoff đã xong. Đã gõ sẵn /compact trong {name}, bấm Enter để chạy',
      missing: '{name} đã dừng nhưng chưa ghi {file}',
      resumed: '{name} đã compact. Đã điền sẵn lệnh đọc handoff',
      cancelled: 'Đã huỷ compact của {name}',
    },
  },
}

export default { en, vi }
