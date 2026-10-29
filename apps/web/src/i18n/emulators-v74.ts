// Top-level `emulators` of en.ts / vi.ts (v74): Android Virtual Devices in the Devices tab.
const en = {
  emulators: {
    title: 'Emulators',
    refresh: 'Refresh',
    api: 'API {n}',
    missing: 'Android Emulator is not installed in this SDK. Add it in Android Studio › SDK Manager › SDK Tools, then refresh.',
    empty: 'No virtual devices yet. Create one in Android Studio › Device Manager, then refresh.',
    state: {
      running: 'Running',
      starting: 'Starting…',
      stopped: 'Stopped',
    },
    action: {
      start: 'Start',
      cold: 'Cold boot',
      coldHint: 'Cold boot: start without loading the saved snapshot',
      wipe: 'Wipe data',
      wipeHint: 'Wipe data: erase everything on this virtual device and start it like new (asks first)',
      stop: 'Stop',
    },
    error: {
      'emulator-missing': 'Android Emulator is not installed in this SDK.',
      'emulator-failed': 'The emulator closed right after starting. Open it once from Android Studio to see why.',
      'avd-running': 'This emulator is already running.',
      'avd-not-running': 'This emulator is not running any more.',
      invalid: 'This virtual device no longer exists. Refresh the list.',
    },
  },
}

const vi: typeof en = {
  emulators: {
    title: 'Emulator',
    refresh: 'Làm mới',
    api: 'API {n}',
    missing: 'SDK này chưa cài Android Emulator. Thêm trong Android Studio › SDK Manager › SDK Tools rồi làm mới.',
    empty: 'Chưa có thiết bị ảo nào. Tạo trong Android Studio › Device Manager rồi làm mới.',
    state: {
      running: 'Đang chạy',
      starting: 'Đang khởi động…',
      stopped: 'Đã tắt',
    },
    action: {
      start: 'Chạy',
      cold: 'Cold boot',
      coldHint: 'Cold boot: khởi động không nạp snapshot đã lưu',
      wipe: 'Xoá dữ liệu',
      wipeHint: 'Xoá dữ liệu: xoá mọi thứ trong thiết bị ảo này rồi khởi động như mới (có hỏi trước)',
      stop: 'Tắt',
    },
    error: {
      'emulator-missing': 'SDK này chưa cài Android Emulator.',
      'emulator-failed': 'Emulator đóng ngay sau khi khởi động. Mở nó một lần từ Android Studio để xem lý do.',
      'avd-running': 'Emulator này đang chạy rồi.',
      'avd-not-running': 'Emulator này không còn chạy nữa.',
      invalid: 'Thiết bị ảo này không còn tồn tại. Hãy làm mới danh sách.',
    },
  },
}

export default { en, vi }
