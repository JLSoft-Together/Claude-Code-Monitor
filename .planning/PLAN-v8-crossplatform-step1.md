# PLAN v8: Linux và macOS, bước 1 (giám sát đầy đủ)

Mục tiêu: trên Linux và macOS, collector theo dõi session đúng như trên Windows, gồm phát hiện session, kiểm PID, đánh dấu session đã tắt, thống kê, lịch sử, status line bridge và mở thư mục. Chạy được bằng `npm start` hoặc một file script.

Ngoài phạm vi (để bước 2): chọn thư mục (`folder-pick.ts`), mở Claude mới từ Yêu thích (`launcher.ts`), nhảy tới terminal (`focus.ts`), tạo shortcut. Các phần này vẫn trả `unsupported`, web hiện thông báo "chỉ dùng trên Windows" như hiện tại.

Ước lượng: khoảng 1 ngày code và unit test. Kiểm trên máy thật tính riêng.

## Dữ kiện đã xác minh (Claude Code 2.1.289, đọc từ chuỗi trong binary)

- Session file `~/.claude/sessions/<pid>.json` có cùng định dạng trên mọi hệ điều hành.
- **Windows:** ghi `procStartFt`, là FILETIME của `Win32_Process.CreationDate`. Collector đang so khớp với giá trị này.
- **Linux và macOS:** ghi `procStart` = stdout đã trim của `ps -o lstart= -p <pid>`, chạy với `LC_ALL=C TZ=UTC`. Ví dụ: `Thu Oct  8 03:01:22 2026`, độ chính xác 1 giây.
  - Hiện tại `procStartMatches()` thấy giá trị không phải số thì trả `true`. Vì vậy trên Linux và Mac không có bước chống PID bị tái sử dụng.
- `pidDomain`:
  - Linux: `win32:<machine-id>:<pid ns>`.
  - macOS: `win32`.
  - Collector không dùng trường này, giữ nguyên như vậy.

Cần ghi các dữ kiện trên vào `docs/claude-code-integration.md`, mục mới "Linux / macOS".

## Việc cần làm

### 1. Kiểm process trên Unix (`apps/collector/src/process.ts`)

- Thêm hàm `queryProcessesUnix(pids)`:
  - Chạy `execFile('ps', ['-o', 'pid=,ppid=,lstart=,comm=', '-p', pids.join(',')])` với `env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' }`, timeout 8 s.
  - Không đi qua shell. PID đã được lọc thành số nguyên dương nên không có input từ client lọt vào.
  - Tách mỗi dòng bằng regex `^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s+(.*)$`.
  - Lấy `lstart` nguyên chuỗi như Claude Code ghi. `comm` lấy basename.
- Thêm một lệnh `ps -o pid=,comm= -p <ppids>` để lấy tên process cha. Kết quả gán vào `shell`, giống `parentName` trên Windows.
- Đổi `ProcessInfo`:
  - `creationFileTime: bigint` đổi thành `start: { kind: 'filetime'; value: bigint } | { kind: 'lstart'; value: string }`.
  - `procStartMatches(procStart, start)`:
    - `filetime`: giữ logic so lệch ±10 000 như cũ.
    - `lstart`: so chuỗi sau khi gộp các khoảng trắng liên tiếp.
    - `procStart` thiếu: trả `true`, như cũ.
- `queryProcesses()` gọi bản Windows khi `win32`, bản Unix khi `linux` hoặc `darwin`, nền tảng khác trả `null`.
- Hàm parse output (`parsePsOutput`) phải là hàm thuần, không phụ thuộc hệ điều hành, để test chạy được trên Windows.

### 2. Bật kiểm process (`apps/collector/src/config.ts`)

- `verifyProcesses: ['win32', 'linux', 'darwin'].includes(process.platform) && env.CCM_VERIFY_PROCESSES !== '0'`.
- `monitor.verifyNew` và `monitor.verifyLive` giữ nguyên. Chỉ đổi tham số truyền vào `procStartMatches`.

### 3. Thư mục data theo hệ điều hành

- Tạo `apps/collector/src/datadir.ts`, hàm `defaultDataDir(env, platform, home)`:
  - `win32`: `%LOCALAPPDATA%/ccm`, như hiện tại.
  - `darwin`: `~/Library/Application Support/ccm`.
  - Còn lại: `$XDG_DATA_HOME/ccm`, nếu không có thì `~/.local/share/ccm`. Kết quả giống fallback hiện tại.
- Gọi hàm này trong `config.ts`.
- `scripts/statusline-bridge.mjs` không có dependency nên phải viết lại logic này trong file. Để comment "Must match …" và thêm một test so kết quả của hai hàm trên cả 3 nền tảng (dùng tham số giả).

### 4. Mở thư mục và VS Code (`apps/collector/src/opener.ts`)

- Bỏ dòng chặn `process.platform !== 'win32'`, thay bằng chọn lệnh theo nền tảng:
  - Mở thư mục: `win32` dùng `explorer.exe <dir>`, `darwin` dùng `open <dir>`, `linux` dùng `xdg-open <dir>`.
  - Mở VS Code:
    - `win32`: giữ `findVsCode()`.
    - `darwin`: thử `code` trên PATH (đường dẫn tuyệt đối, tìm bằng cách duyệt PATH, không dùng shell), nếu không có thì `open -a "Visual Studio Code" <dir>`.
    - `linux`: tìm `code` trên PATH, không có thì trả `noApp`.
- Không có `xdg-open` hoặc `open` thì `spawn` báo lỗi `ENOENT`, khi đó trả `noApp`.
- Đường dẫn thư mục vẫn lấy từ collector, không lấy từ client. Không đổi.
- Thêm tham số `platform` (mặc định `process.platform`) để test được cả 3 nhánh bằng `spawner` giả.

### 5. Launcher

- `scripts/launch.mjs`, hàm `npm()`:
  - Thêm ứng viên `path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')`, là cách cài Node chuẩn trên Unix.
  - Fallback `spawn('npm', …, { shell: true })` giữ nguyên.
- Phần shortcut đã có `if (!IS_WIN) return`. Trang cài đặt cần ẩn khối shortcut khi `shortcuts === null`. Cần kiểm lại chỗ này.
- File mới `Claude-Code-Monitor.sh` (đặt `chmod +x` qua `git update-index --chmod=+x`):
  - kiểm `node`, thiếu thì in hướng dẫn cài (nvm, Homebrew, gói của distro) rồi thoát;
  - `cd "$(dirname "$0")"`;
  - `exec node scripts/launch.mjs "$@"`.
- File mới `Claude-Code-Monitor.command`: gọi file `.sh`, để trên Mac bấm đúp là mở Terminal.

### 6. Web

- Không bắt buộc ở bước 1. Thông báo `unsupported` hiện tại có nói rõ "chỉ dùng trên Windows".
- Riêng thông báo mở thư mục (`open.unsupported`) sẽ không còn xuất hiện trên Mac và Linux nữa, nhưng vẫn giữ key.
- Tooltip của nút mở thư mục hiện ghi "Explorer". Đổi thành chữ trung tính "Mở thư mục" / "Open folder" nếu đang ghi Explorer (en và vi).

### 7. Tài liệu

- `docs/claude-code-integration.md`: mục Linux / macOS gồm định dạng `procStart`, lệnh `ps`, thư mục data từng nền tảng, và danh sách những gì chưa hỗ trợ.
- `README.md`:
  - mục Yêu cầu ghi thêm "Linux / macOS: theo dõi đầy đủ; chọn thư mục, mở Claude mới, nhảy tới terminal chỉ có trên Windows";
  - mục Chạy thêm `./Claude-Code-Monitor.sh`;
  - bảng Cấu hình ghi giá trị mặc định của `CCM_DATA_DIR` theo từng nền tảng.
- `CLAUDE.md`: câu "local-only Windows dashboard" đổi thành "Windows-first, Linux/macOS supported for monitoring".
- `.code_index/collector.md` và `_meta.md`.

## Test (Vitest, chạy được trên Windows)

- `process.test.ts`:
  - `parsePsOutput`: dòng chuẩn; ngày có 1 chữ số (2 khoảng trắng); `comm` có khoảng trắng; dòng rác; output rỗng.
  - `procStartMatches`: lstart khớp, lệch 1 giây, khác khoảng trắng; filetime như cũ.
- `datadir.test.ts`: 3 nền tảng, có và không có `XDG_DATA_HOME`. So với hàm trong `statusline-bridge.mjs` (export hàm đó ra).
- `opener.test.ts`: 3 nền tảng × 2 app, với `spawner` giả. Thêm ca `ENOENT` trả `noApp`.
- `monitor.test.ts`: một ca `verifyNew` dùng ProcessInfo kiểu `lstart`, gồm khớp thì nhận và PID tái sử dụng thì loại.

## Kiểm trên máy thật (chủ nhân hoặc WSL)

1. WSL Ubuntu: cài Node 22 và Claude Code, `npm install && npm start`, mở 2 session `claude`, kiểm session hiện lên, tắt một session thì thẻ chuyển sang ended trong 60 giây, nút mở thư mục chạy `xdg-open`. WSL không có GUI thì kết quả là `noApp`, chấp nhận được.
2. macOS (nếu có máy): như trên, thêm `.command` bấm đúp và `open -a "Visual Studio Code"`.
3. Status line bridge: kiểm file ghi vào đúng thư mục data của nền tảng và collector đọc được.

## Rủi ro

- `ps` của BusyBox (Alpine) không có `lstart`. Khi đó `ps` lỗi, `queryProcesses` trả `null` và collector tạm dựa vào TTL như hiện tại. Không làm gì thêm.
- Claude Code đổi định dạng `procStart` ở bản sau. `procStartMatches` vẫn nhận giá trị lạ (trả `true`), nên chỉ mất tính năng chống tái dùng PID, không mất session.
- Claude chạy trong WSL nhưng collector chạy trên Windows là hai thư mục `~/.claude` khác nhau, ngoài phạm vi.
