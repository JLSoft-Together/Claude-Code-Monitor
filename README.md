# Claude Code Monitor

Dashboard local, realtime cho mọi session Claude Code CLI đang chạy trên Windows: session nào đang `working` / `waiting` / `idle`, session nào chờ bạn, agent đang chạy tool gì, token và chi phí.

- Chỉ đọc file local của Claude Code: không gọi API, không gửi prompt, **không tốn thêm token**.
- Chỉ bind `127.0.0.1`. Không đưa nội dung prompt, tham số tool, env hay secret ra dashboard.

## Yêu cầu

- Windows 10 / 11, Node.js `20.19+` hoặc `22.12+`
- Claude Code CLI `2.1.289` (version khác vẫn chạy, có cảnh báo)
- Không bắt buộc: Git (đếm thay đổi chưa commit), VS Code (nút mở thư mục)

## Chạy

**Cách dễ nhất:** bấm đúp `Claude-Code-Monitor.bat`. Trang cài đặt tự kiểm Node.js, `npm install`, build rồi mở dashboard. Giữ cửa sổ bat mở trong lúc dùng, đóng là tắt.

Thủ công:

```powershell
npm install
npm start
```

Mở **http://127.0.0.1:4317**, rồi chạy `claude` ở terminal khác: session hiện lên trong khoảng 1 giây.

Lần đầu mở, dashboard tự hiện **hướng dẫn từng bước**. Xem lại: `Ctrl K` → "Xem hướng dẫn".

Nên làm thêm:

1. Bấm **chuông** trên header để bật thông báo khi session chờ bạn.
2. Cài **status line bridge** (dưới) để có giới hạn 5 giờ / 7 ngày và chi phí.
3. Chrome / Edge → "Cài đặt ứng dụng" để chạy trong cửa sổ riêng, có badge số session đang chờ.

## Tính năng chính

- **Giám sát**: hàng chờ "Cần bạn", danh sách session (branch, % context, thay đổi chưa commit, nhảy tới terminal, hoãn nhắc), Agent Map main → subagent, luồng hoạt động.
- **Thống kê**: token theo ngày / model / project, chi phí ước tính, tỉ lệ cache.
- **Lịch sử**: thời gian làm việc / chờ của từng session trong ngày, xuất recap Markdown.
- **Ctrl K**: tìm session, thư mục yêu thích, chạy lệnh nhanh.
- **Chế độ gọn**: cửa sổ nhỏ đặt cạnh editor, mở thẳng `http://127.0.0.1:4317/?mode=compact`.
- **Nhắc nghỉ**: mỗi 45 phút tính từ lần bật collector đầu tiên trong ngày. Tắt trong Cài đặt.
- **Cài đặt** (bánh răng): giao diện, thông báo, ngân sách ngày, status line, chẩn đoán.

## Status line bridge

Claude Code chỉ đưa giới hạn gói và chi phí cho lệnh status line. Thêm vào `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<repo>/scripts/statusline-bridge.mjs\""
  }
}
```

Đã có status line riêng thì nối thêm: `... statusline-bridge.mjs\" --chain <lệnh cũ>`. Cài đặt trong dashboard có sẵn đoạn này với đường dẫn đúng, bấm để chép.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CCM_PORT` | `4317` | Port collector |
| `CCM_STALE_TTL_MIN` | `120` | Phút giữ session đã tắt |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Thư mục data Claude Code |
| `CCM_DATA_DIR` | `%LOCALAPPDATA%/ccm` | Nơi lưu cache thống kê, tên session, yêu thích, lịch sử |
| `CCM_WEB_DIST` | `apps/web/dist` | Web đã build |
| `CCM_VERIFY_PROCESSES` | `1` | `0` = bỏ kiểm PID (dùng với data giả) |

## Dev và test

```powershell
npm run dev         # web http://127.0.0.1:5173 + collector :4317
npm test            # Vitest
npm run typecheck
node scripts/demo-fixture.mjs --sessions=5 --subagents=3   # session giả
```

Với data giả: đặt `CLAUDE_CONFIG_DIR` = thư mục script in ra và `CCM_VERIFY_PROCESSES=0` rồi `npm start`.

## Lỗi thường gặp

Mở **Cài đặt → Chẩn đoán** trước.

| Hiện tượng | Cách xử lý |
|---|---|
| `EADDRINUSE` | Port bận: tắt collector cũ hoặc đổi `CCM_PORT` |
| Dashboard trống | Kiểm `~/.claude/sessions/` có file `<pid>.json`; thư mục khác thì đặt `CLAUDE_CONFIG_DIR` |
| `Reconnecting` | Collector đã tắt, chạy lại `npm start` |
| Không có giới hạn gói | Chưa cài status line bridge, hoặc Claude chưa trả lời lần nào sau khi cài |
| Không có thông báo | Chưa bấm chuông, trình duyệt chặn, hoặc session đang hoãn nhắc |
| `403` khi mở bằng IP LAN | Chủ ý: chỉ nhận `127.0.0.1` / `localhost` |

## Cấu trúc

```
apps/collector     Node.js + TS: đọc session + transcript, chuẩn hoá, WebSocket
apps/web           Vue 3 + Vite + Tailwind + Pinia + vue-i18n + Vue Flow
packages/shared    Kiểu dữ liệu + protocol dùng chung
scripts/           launch.mjs, statusline-bridge.mjs, demo-fixture.mjs
docs/              claude-code-integration.md: nguồn data Claude Code đã kiểm
```
