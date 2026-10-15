# GolAIm

App desktop (Windows exe, macOS `.dmg`) theo dõi realtime mọi session Claude Code CLI đang chạy, kèm các lần Codex CLI do chúng gọi: session nào đang `working` / `waiting` / `idle`, session nào chờ bạn, agent đang chạy tool gì, token và chi phí. Có thêm **Workspace**: terminal ngay trong app để chạy Claude Code / Codex / shell, chia ô, tab, worktree.

Tên cũ: **Claude Code Monitor**. Mã nội bộ giữ nguyên (`appId` `dev.ccm.monitor`, thư mục data `ccm`, biến `CCM_*`), nên bản cài cũ cập nhật thẳng, không mất cài đặt.

- Theo dõi chỉ đọc file local của Claude Code: không gọi API, không gửi prompt, **không tốn thêm token**. Terminal trong Workspace chỉ chuyển phím bạn gõ.
- Chỉ bind `127.0.0.1` và chỉ mở trong cửa sổ app: collector từ chối mọi request không mang khoá của app (trình duyệt mở `http://127.0.0.1:4317` nhận `403`). Không đưa nội dung prompt, tham số tool, env hay secret ra dashboard.

## Yêu cầu

- Windows 10 / 11 (bản exe không cần Node.js)
- macOS: bản `.dmg` (không cần Node). Theo dõi đầy đủ; nhảy tới terminal (đúng tab với Terminal.app / iTerm2, chỉ mở app với IDE khác), chọn thư mục, mở Claude mới từ Yêu thích đều dùng được. Cảnh báo là badge + nảy Dock (toast chỉ có trên Windows)
- Claude Code CLI `2.1.289` (version khác vẫn chạy, có cảnh báo)
- Không bắt buộc: Git (đếm thay đổi chưa commit, worktree), VS Code (nút mở thư mục)
- Build từ mã nguồn: Node.js `20.19+` hoặc `22.12+`

## Cài và chạy (Windows)

Chạy `GolAIm-Setup-<ver>.exe` (hoặc bản `GolAIm-Portable-<ver>.exe` không cần cài), rồi chạy `claude` ở terminal bất kỳ: session hiện lên trong khoảng 1 giây.

- Icon ở khay hệ thống (tray): Mở dashboard, Cửa sổ gọn, **Chạy cùng Windows** (chỉ bản đã đóng gói, khởi động ẩn dưới tray), Mở thư mục log, Thoát.
- Đóng cửa sổ = ẩn xuống tray, monitor vẫn chạy. Thoát thật từ menu tray (còn terminal đang chạy thì app hỏi trước).
- Bấm nút trên toast Windows mở thẳng app (link `agent-monitor://`): session chạy trong Workspace thì nhảy tới đúng ô terminal, session ở terminal ngoài thì đưa cửa sổ đó lên.
- Đã cài bản tên cũ (Claude Code Monitor): chạy Setup mới để cập nhật đè, cùng thư mục cài; "Chạy cùng Windows" tự trỏ sang exe mới.
- Exe chưa ký số nên Windows SmartScreen cảnh báo lần đầu: bấm **More info → Run anyway**.

Lần đầu mở, app tự hiện **hướng dẫn từng bước**. Xem lại: `Ctrl K` → "Xem hướng dẫn".

Nên làm thêm:

1. Bấm **chuông** trên header để bật thông báo khi session chờ bạn.
2. Cài **status line bridge** (dưới) để có giới hạn 5 giờ / 7 ngày và chi phí.

Status line bridge ở bản desktop được chép ra `%LOCALAPPDATA%\ccm\bin\statusline-bridge.mjs` (đường dẫn không đổi qua update). Cài đặt → Status line hiện đúng lệnh cần dán: máy có `node` → `node "<...>/statusline-bridge.mjs"`; không có `node` → file `statusline-bridge.cmd` chạy chính exe của app (`ELECTRON_RUN_AS_NODE=1`). Bản portable giải nén vào thư mục tạm khác nhau mỗi lần nên **luôn cần `node`** cho status line.

Build:

```powershell
npm install
npm run dist        # tự chọn theo OS (Windows → dist:win, macOS → dist:mac)
npm run dist:win    # → apps/desktop/release/: GolAIm-Setup-<ver>.exe (NSIS) + GolAIm-Portable-<ver>.exe
npm run desktop     # chạy thử bản dev, không đóng gói
```

## Bản desktop macOS (dmg)

Cùng app Electron, đóng gói `.dmg` cho Apple Silicon (`arm64`) và Intel (`x64`). DMG **chỉ build được trên macOS**:

```bash
npm ci
npm run dist        # = dist:mac trên macOS
npm run dist:mac    # → apps/desktop/release/: GolAIm-<ver>-arm64.dmg + GolAIm-<ver>-x64.dmg
```

Không có Mac: GitHub → Actions → **desktop** → *Run workflow* (hoặc push tag `v*`). Workflow build DMG trên `macos-latest` và exe trên `windows-latest`, tải về ở mục *Artifacts* của lần chạy.

- App ký **ad-hoc**, chưa notarize (chưa có Apple Developer ID). Lần đầu mở: kéo app vào **Applications**, mở → bị chặn → **System Settings → Privacy & Security → Open Anyway**. Hoặc: `xattr -dr com.apple.quarantine "/Applications/GolAIm.app"`. Đã cài bản tên cũ thì xoá `Claude Code Monitor.app` sau khi chép bản mới.
- Chạy từ ổ DMG / Downloads thì app hỏi chuyển vào Applications (đường dẫn app nằm trong lệnh status line).
- Lần đầu nhảy tới terminal hoặc mở phiên mới, macOS hỏi quyền **Automation** cho Terminal / iTerm2; nếu đã từ chối: **System Settings → Privacy & Security → Automation**.
- Icon ở menu bar thay cho tray; Cmd W ẩn cửa sổ, bấm icon Dock để mở lại, Cmd Q thoát.
- Data: `~/Library/Application Support/ccm`. Status line bridge chép ra `.../ccm/bin/`; máy không có `node` thì dùng `statusline-bridge.sh` chạy chính app (`ELECTRON_RUN_AS_NODE=1`).

## Tính năng chính

- **Giám sát**: hàng chờ "Cần bạn", danh sách session (branch, % context, thay đổi chưa commit, nhảy tới terminal, hoãn nhắc), Agent Map main → subagent, luồng hoạt động.
- **Workspace**: terminal trong app (Claude Code / Codex / shell), tab + chia ô, worktree `<repo>-wt/<branch>`, khôi phục workspace lần trước (`--resume`), chấm báo ô nào cần bạn. Phím tắt kiểu Windows Terminal.
- **Xem lại ngay trong Workspace**: tab Trình duyệt (mở file HTML agent vừa viết hoặc `localhost`, tự tải lại khi file đổi, giả lập iPhone / iPad, gửi ảnh chụp / lỗi console / phần tử cho agent mà không tự Enter), tab xem file có tô màu cú pháp, tab **Thay đổi** (diff git, bỏ từng hunk / file, file chưa theo dõi vào Thùng rác), chip dev server, mở nhanh file (Ctrl+Shift+P, ⌘P trên mac), tìm trong terminal (Ctrl+Shift+F, ⌘F). Ctrl/⌘+click đường dẫn trong terminal để mở.
- **Sidebar dự án**: nhóm theo repo, mỗi ô một dòng (trạng thái, tên task của agent, thời gian hoạt động gần nhất). **Bố cục** theo dự án: lưu bộ tab đang mở, mở lại một bước, tuỳ chọn tự mở khi bắt đầu. **Chạy script** (nút ▶ trên ô terminal, menu dự án, hoặc gõ `>` trong mở nhanh): đọc `package.json` / `Makefile` / `justfile` / `Cargo.toml` / `pyproject.toml`, chạy ở tab shell mới khi bạn chọn.
- **Codex CLI**: lần `codex exec` / plugin Codex do Claude Code gọi hiện thành node con (badge Codex) dưới đúng agent đã gọi; Codex chạy riêng ở terminal khác là session riêng; chip giới hạn Codex 5h / tuần trên header. Chi tiết: `docs/codex-integration.md`.
- **Thống kê**: token theo ngày / model / project, chi phí ước tính, tỉ lệ cache.
- **Lịch sử**: thời gian làm việc / chờ của từng session trong ngày, xuất recap Markdown.
- **Ctrl K**: tìm session, thư mục yêu thích, chạy lệnh nhanh.
- **Cửa sổ gọn**: cửa sổ nhỏ đặt cạnh editor (menu tray → Cửa sổ gọn).
- **Nhắc nghỉ**: mỗi 45 phút tính từ lần bật collector đầu tiên trong ngày. Tắt trong Cài đặt.
- **Cài đặt** (bánh răng): giao diện, thông báo, ngân sách ngày, status line, chẩn đoán (chép / lưu file log).

## Status line bridge

Claude Code chỉ đưa giới hạn gói và chi phí cho lệnh status line. Thêm vào `~/.claude/settings.json` lệnh mà **Cài đặt → Status line** đưa ra (bấm để chép), dạng:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<...>/statusline-bridge.mjs\""
  }
}
```

Đã có status line riêng thì nối thêm: `... statusline-bridge.mjs\" --chain <lệnh cũ>`.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CCM_PORT` | `4317` | Port collector. 4317 cũng là cổng mặc định OTLP/gRPC của OpenTelemetry: nếu đang chạy OTel collector, đặt port khác |
| `CCM_STALE_TTL_MIN` | `120` | Phút giữ session đã tắt |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Thư mục data Claude Code |
| `CODEX_HOME` | `~/.codex` | Thư mục data Codex CLI |
| `CCM_CODEX` | `1` | `0` = không theo dõi Codex |
| `CCM_DATA_DIR` | Windows `%LOCALAPPDATA%/ccm`, macOS `~/Library/Application Support/ccm` | Nơi lưu cache thống kê, tên session, yêu thích, lịch sử |
| `CCM_VERIFY_PROCESSES` | `1` | `0` = bỏ kiểm PID (dùng với data giả) |
| `CCM_TOAST` | `1` | `0` = tắt toast / cảnh báo hệ thống |

## Dev và test

```powershell
npm run desktop     # app dev (build web rồi chạy Electron)
npm run dev         # chỉ để làm UI: Vite http://127.0.0.1:5173 + collector :4317 chế độ --dev (không khoá, không có terminal)
npm test            # Vitest
npm run typecheck
npm run e2e -w @ccm/desktop   # E2E qua CDP (build web + desktop trước)
node scripts/demo-fixture.mjs --sessions=5 --subagents=3   # session giả
```

Với data giả: đặt `CLAUDE_CONFIG_DIR` = thư mục script in ra và `CCM_VERIFY_PROCESSES=0` rồi `npm run desktop` (hoặc `npm run dev`).

## Lỗi thường gặp

Mở **Cài đặt → Chẩn đoán** trước; nút **Lưu file log…** gom phiên bản app, báo cáo và log để gửi kèm.

| Hiện tượng | Cách xử lý |
|---|---|
| App báo cổng bận | Bản cũ chạy bằng `.bat` / `npm start` hoặc app khác giữ cổng: tắt nó (xoá lối tắt `GolAIm.lnk` cũ trong thư mục Startup) hoặc đổi `CCM_PORT` |
| Dashboard trống | Kiểm `~/.claude/sessions/` có file `<pid>.json`; thư mục khác thì đặt `CLAUDE_CONFIG_DIR` |
| Không có giới hạn gói | Chưa cài status line bridge, hoặc Claude chưa trả lời lần nào sau khi cài |
| Không có thông báo | Chưa bấm chuông, Windows chặn thông báo của app, hoặc session đang hoãn nhắc |
| `403` khi mở `127.0.0.1:4317` bằng trình duyệt | Chủ ý: dashboard chỉ mở trong app |

## Cấu trúc

```
apps/collector     Node.js + TS: đọc session + transcript, chuẩn hoá, WebSocket (chạy trong app)
apps/web           Vue 3 + Vite + Tailwind + Pinia + vue-i18n + Vue Flow + xterm.js
apps/desktop       Electron (Windows + macOS): collector + PTY host trong utilityProcess, tray, đóng gói
packages/shared    Kiểu dữ liệu + protocol dùng chung
scripts/           statusline-bridge.mjs, demo-fixture.mjs, make-icon.mjs
docs/              claude-code-integration.md: nguồn data Claude Code đã kiểm
```
