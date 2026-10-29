// Top-level `deviceTools` of en.ts / vi.ts (v72): device screenshot + view inspector.
const en = {
  deviceTools: {
    capture: {
      button: 'Screenshot',
      title: 'Screenshot · {name}',
      loading: 'Capturing the screen…',
      retake: 'Retake',
      attach: 'Attach to agent',
      attached: 'Attached to the agent pane. Press Enter there to send.',
      close: 'Close',
      size: '{w} × {h}',
      secureHint: 'Screens marked secure (banking, passwords) come out black or are refused.',
      noAgent: 'No Claude or Codex pane is running. Open one in the Workspace first.',
      failed: 'Could not attach the image.',
      image: 'Screen of {name}',
    },
    inspect: {
      toggle: 'Inspect views',
      loading: 'Reading the view tree…',
      hint: 'Click a view on the screenshot.',
      none: 'No view here.',
      count: '{n} views',
      class: 'Class',
      id: 'resource-id',
      text: 'Text',
      desc: 'content-desc',
      bounds: 'Bounds',
      find: 'Find in files',
      fill: 'Fill into agent',
      filled: 'Filled into the agent prompt. Nothing was sent.',
      flutterHint: 'Flutter and Compose without test tags have no ids: search by text or description.',
      path: 'View path',
    },
  },
}

const vi: typeof en = {
  deviceTools: {
    capture: {
      button: 'Chụp màn hình',
      title: 'Ảnh chụp · {name}',
      loading: 'Đang chụp màn hình…',
      retake: 'Chụp lại',
      attach: 'Đính kèm vào agent',
      attached: 'Đã đính kèm vào pane agent. Bấm Enter ở đó để gửi.',
      close: 'Đóng',
      size: '{w} × {h}',
      secureHint: 'Màn hình được đánh dấu bảo mật (ngân hàng, mật khẩu) sẽ ra màu đen hoặc bị từ chối.',
      noAgent: 'Chưa có pane Claude hay Codex nào đang chạy. Mở một pane trong Workspace trước.',
      failed: 'Không đính kèm được ảnh.',
      image: 'Màn hình của {name}',
    },
    inspect: {
      toggle: 'Soi view',
      loading: 'Đang đọc cây view…',
      hint: 'Bấm vào một view trên ảnh chụp.',
      none: 'Không có view nào ở đây.',
      count: '{n} view',
      class: 'Lớp',
      id: 'resource-id',
      text: 'Chữ',
      desc: 'content-desc',
      bounds: 'Khung',
      find: 'Tìm trong file',
      fill: 'Điền vào agent',
      filled: 'Đã điền vào ô nhập của agent. Chưa gửi gì.',
      flutterHint: 'Flutter và Compose không có test tag thì không có id: tìm theo chữ hoặc mô tả.',
      path: 'Đường dẫn view',
    },
  },
}

export default { en, vi }
