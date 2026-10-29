// Top-level `runCrash` of en.ts / vi.ts (v72): runtime crash blocks in the Run pane.
const en = {
  runCrash: {
    chip: 'Crash {time}',
    chipLabel: 'Crashes in this run: {n}. Show',
    title: 'Crashes',
    kind: {
      android: 'Android crash',
      anr: 'ANR',
      flutter: 'Flutter exception',
    },
    times: '×{n}',
    causedBy: 'Caused by',
    frames: 'Stack',
    ownHint: 'Bold frames are in this project; click to open the file at that line.',
    resolving: 'Matching frames to project files…',
    noFrames: 'No stack frames in this block.',
    open: 'Open {file} at line {line}',
    fill: 'Fill into agent',
    fillHint: 'Pastes the exception, project frames and a few log lines before into the agent input, with tokens and emails masked. Nothing is sent.',
    close: 'Hide crashes',
    more: '+{n} more frames',
  },
}

const vi = {
  runCrash: {
    chip: 'Crash {time}',
    chipLabel: 'Số lần crash trong lần chạy này: {n}. Xem',
    title: 'Crash',
    kind: {
      android: 'Crash Android',
      anr: 'ANR',
      flutter: 'Exception Flutter',
    },
    times: '×{n}',
    causedBy: 'Nguyên nhân',
    frames: 'Stack',
    ownHint: 'Frame in đậm nằm trong dự án; bấm để mở file tại dòng đó.',
    resolving: 'Đang khớp frame với file trong dự án…',
    noFrames: 'Khối này không có stack frame.',
    open: 'Mở {file} tại dòng {line}',
    fill: 'Điền vào agent',
    fillHint: 'Dán exception, frame của dự án và vài dòng log trước đó vào ô nhập của agent, đã che token và email. Không gửi gì.',
    close: 'Ẩn crash',
    more: '+{n} frame nữa',
  },
}

export default { en, vi }
