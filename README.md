# Claude Code Monitor

Dashboard local, realtime, theo dõi mọi session Claude Code CLI đang chạy trên máy Windows: session nào đang `working` / `waiting` / `idle`, main agent đang chạy tool gì, subagent nào đang chạy, token đã dùng.

- Chỉ đọc file local của Claude Code — **không** gọi API, **không** gửi prompt, **không** tốn thêm token.
- Chỉ bind `127.0.0.1` — máy khác trong mạng không truy cập được.
- Không lưu và không gửi nội dung prompt, tham số tool, env hay secret ra dashboard.

## Yêu cầu

| Thứ | Version |
|---|---|
| Windows | 10 / 11 |
| Node.js | `20.19+` hoặc `22.12+` |
| Claude Code CLI | `2.1.289` (version khác vẫn chạy, dashboard hiện cảnh báo version) |

## Chạy nhanh

**Cách dễ nhất (Windows):** clone về rồi bấm đúp `Claude-Code-Monitor.bat`. Trình duyệt mở trang cài đặt hiện từng bước: kiểm tra Node.js → `npm install` → build dashboard → khởi động monitor, xong tự chuyển sang dashboard. Lần sau bấm lại chỉ mất vài giây (bước nào đã mới nhất thì bỏ qua). Chưa có Node.js thì `Claude-Code-Monitor.bat` đề nghị cài bằng `winget`. Giữ cửa sổ `Claude-Code-Monitor.bat` mở trong lúc dùng; đóng nó là tắt monitor. Lần chạy đầu tạo `Claude-Code-Monitor.lnk` (có icon) cạnh file bat; trang cài đặt có ô tạo lối tắt ngoài Desktop và chạy cùng Windows. Máy khác Windows: `node scripts/launch.mjs`.

Cách thủ công:

```powershell
git clone git@github.com:JLSoft-Together/Claude-Code-Monitor.git
cd Claude-Code-Monitor
npm install
npm start
```

Mở **http://127.0.0.1:4317**.

Mở Claude Code ở terminal khác (`claude`) — session hiện lên dashboard trong khoảng 1 giây. Không cần cài hook hay cấu hình gì thêm.

- Tab **Thống kê**: token theo ngày / model / project, tách input · output · cache write · cache read, kèm chi phí ước tính theo giá API. Lần chạy đầu collector đọc toàn bộ transcript (vài chục giây với ~2 GB), sau đó chỉ đọc phần mới.
- Đặt tên session: bấm nút bút chì trên thẻ session, hoặc `/rename <tên>` trong Claude, hoặc mở bằng `claude -n "<tên>"`. Tên đổi ở tab Windows Terminal không đọc được.
- Thông báo: nút chuông trên header → thông báo trên máy khi session chờ hoặc Claude trả lời xong (chỉ khi tab dashboard đang ở nền). Tiêu đề tab hiện `(N)` = số session đang chờ.
- Thẻ session hiện % context (cảnh báo 60 / 80 / 95 %), chế độ quyền (`bypass` tô đỏ), branch git, số lần compact.
- Yêu thích: bấm ★ trên thẻ session để lưu thư mục. Trong mục Yêu thích: mở Claude mới hoặc `claude --continue` trong thư mục đó (Windows Terminal tab mới, không có WT thì mở cửa sổ PowerShell).
- Cài đặt (⚙): bộ màu Cam Claude / Cobalt, bật tắt từng loại thông báo.

Dừng: `Ctrl+C` ở terminal đang chạy `npm start`.

## Chạy chế độ dev (sửa code)

```powershell
npm run dev
```

| Thành phần | Địa chỉ |
|---|---|
| Web (Vite, tự reload khi sửa) | http://127.0.0.1:5173 |
| Collector (WebSocket `/ws`, `/health`) | http://127.0.0.1:4317 |

Vite proxy `/ws` sang collector, nên chỉ cần mở port `5173`.

## Dùng dashboard

| Khu vực | Có gì |
|---|---|
| Header | Số session, subagent đang chạy, số `working` / `waiting` / lỗi; trạng thái kết nối; đổi `EN` / `VI`; đổi dark / light |
| Sessions | Mỗi terminal Claude Code một card: tên session, `kind` (`interactive`, `bg`, …), status, thư mục, PID, thời gian chạy, số subagent, token. **Bấm card** → Agent Map focus vào session đó |
| Agent Map | Cây main agent → subagent → subagent lồng nhau. Kéo để pan, cuộn để zoom. **Bấm node** → làm nổi cây cha–con + mở panel chi tiết |
| Recent Activity | Tool bắt đầu / lỗi, subagent bắt đầu / xong, đổi tên session, session kết thúc |

Toolbar Agent Map:

| Nút | Việc |
|---|---|
| 👁 | Ẩn / hiện subagent đã xong (`completed`, `cancelled`). Subagent `error` luôn hiện. Lựa chọn được lưu lại |
| `+` / `−` | Zoom |
| ⛶ | Fit toàn bộ map vào khung |
| ▦ | Xếp lại layout |

Status:

| Icon | Status | Nghĩa |
|---|---|---|
| ✳ (xoay) | `working` | Claude đang chạy |
| ◐ | `waiting` | Chờ bạn: permission prompt, input, dialog |
| ○ | `idle` | Đang rảnh (có thể kèm "Background shell running") |
| ✓ | `completed` | Subagent xong |
| ! | `error` | Subagent lỗi |
| viền đứt | `stale` / `unknown` | Terminal đã tắt — giữ lại 120 phút rồi tự xoá |

Collector tắt / restart → dashboard giữ data cũ, hiện banner stale, tự kết nối lại.

## Cấu hình

Đặt biến môi trường trước khi chạy (PowerShell):

```powershell
$env:CCM_PORT = "4400"
npm start
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CCM_PORT` | `4317` | Port collector |
| `CCM_STALE_TTL_MIN` | `120` | Số phút giữ session đã tắt trước khi xoá khỏi dashboard |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Thư mục data của Claude Code |
| `CCM_WEB_DIST` | `apps/web/dist` | Thư mục web đã build mà collector serve |
| `CCM_VERIFY_PROCESSES` | `1` | `0` = bỏ bước kiểm PID bằng PowerShell (dùng khi test với data giả) |
| `CCM_DATA_DIR` | `%LOCALAPPDATA%/ccm` | Nơi collector lưu `usage-index.json` (cache thống kê token), `aliases.json` (tên đặt trên dashboard), `favorites.json` (thư mục yêu thích) |

`CCM_PORT` áp dụng cho cả `npm run dev`: proxy của Vite tự trỏ theo port mới.

## Test và demo

```powershell
npm test            # Vitest, mọi workspace
npm run typecheck   # tsc + vue-tsc
```

Tạo session giả để xem UI khi nhiều session / subagent (không cần Claude Code thật):

```powershell
node scripts/demo-fixture.mjs --sessions=5 --subagents=3
```

Script in ra thư mục data giả. Mở terminal khác, chạy collector trỏ vào đó:

```powershell
$env:CLAUDE_CONFIG_DIR = "<thư mục script in ra>"
$env:CCM_VERIFY_PROCESSES = "0"
npm start
```

Tham số: `--sessions` (mặc định 4) · `--subagents` (3) · `--tick` ms (1200) · `--duration` giây (0 = chạy tới khi `Ctrl+C`).

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `EADDRINUSE` khi chạy | Port `4317` đang bận → tắt collector cũ, hoặc `$env:CCM_PORT = "4400"` |
| Dashboard trống dù Claude Code đang chạy | Kiểm `~/.claude/sessions/` có file `<pid>.json` không; Claude Code cài thư mục khác thì đặt `CLAUDE_CONFIG_DIR` |
| Cảnh báo version trên card | Claude Code khác `2.1.289` — vẫn chạy, nhưng format file có thể khác |
| Header hiện `Reconnecting` | Collector đã tắt → chạy lại `npm start`, web tự kết nối lại |
| Mở bằng IP LAN / domain khác bị `403` | Chủ ý — chỉ nhận `127.0.0.1` / `localhost` |

## Cấu trúc

```
apps/collector     Node.js + TS: đọc registry session + transcript, chuẩn hoá, WebSocket
apps/web           Vue 3 + Vite + Tailwind + Pinia + vue-i18n + Vue Flow
packages/shared    Kiểu dữ liệu + protocol dùng chung
scripts/           demo-fixture.mjs
docs/              claude-code-integration.md — nguồn data Claude Code đã kiểm
PLAN.md            Scope + trạng thái từng phase
```

Chi tiết nguồn data và cách map status: [`docs/claude-code-integration.md`](docs/claude-code-integration.md).
