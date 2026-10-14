# AUDIT v18 — SpaceVibe Deck (tham khảo) + HyperFrames (Apple style) → Agent Monitor

Nguồn: `F:\work\test\spacevibe-deck` v2.10.0 (Electron 43 + Preact + xterm 6 + node-pty 1.1), `F:\work\web\hyper-frames\web\src\styles.css`, `apps/web` hiện tại. 5 sub agent đọc song song 2026-10-14.

## 1. Bảo mật Deck — xác nhận lý do tự làm

Không keylog, scrollback không ghi đĩa, input không log. Nhưng:

| Rủi ro | Mức | Bằng chứng | Ta làm |
|---|---|---|---|
| Analytics bắt buộc, không tắt được (ping 15 phút → `api.deck.spacevibe.dev`) | Cao (niềm tin) | `src/telemetry/usage-notice.ts:75` `USAGE_ANALYTICS_MANDATORY = true` | **Không** telemetry gì cả |
| Sentry luôn bật, chỉ scrub `$HOME` (path ngoài home lọt) | TB | `electron/crash-reporting/init.ts:60`, `spawn.ts:94` | Không gửi crash ra ngoài; log local |
| Mặc định `--dangerously-skip-permissions`, codex `--dangerously-bypass-approvals-and-sandbox` | Cao | `src/lib/agents/claude.ts:14`, `codex.ts:28` | Preset an toàn, flag nguy hiểm phải bật tay từng lần |
| `sandbox:false`, không CSP, không permission handler | TB | `electron/main.ts:212` | sandbox true + CSP + deny permission (spike đã có 2/3) |
| Ghi hook vào `~/.claude/settings.json` toàn cục, wrap statusLine | TB | `agent-hooks/claude-user-settings.ts` | Không đụng settings toàn cục ngoài bridge statusline đã có |
| Bridge preload = RCE (spawn_shell, write_pty, `open_editor` qua `sh -c`) | TB (bản chất) | `electron/ipc/channels.ts`, `links.ts:200` | Allowlist kênh + preset cố định, không nhận command string |
| `DECK_DEV_SERVER_URL` không chặn ở bản packaged | TB | `main.ts:77,344` | Gate `!app.isPackaged` |
| Không Electron fuses, Windows unsigned + auto-update | Cao (supply chain) | `electron-builder.release.yml` | Không auto-update; fuses tắt `NodeOptions`/`inspect` (RunAsNode cần cho bridge) |
| `session.json` plaintext (cwd, command, prompt ≤4 KB) | Thấp | `src/lib/session-schema.ts` | Chỉ lưu cwd + preset + sessionId, không prompt |

Copy ý tưởng tốt: allowlist ký tự lệnh `^[A-Za-z0-9 _.,:@+=/-]+$` ≤200; hook server loopback + token per pane; từ chối UNC path trước mọi fs call (rò NTLM); store đọc lỗi → khoá ghi, không ghi đè default.

## 2. Kiến trúc terminal Deck → bài học áp vào ta

| Chủ đề | Deck | Ta (đề xuất) |
|---|---|---|
| Chỗ chạy node-pty | Main process, IPC string | Collector `utilityProcess` + WS token (spike P0 PASS) — main không bị block |
| Spawn agent | Mở shell rồi **gõ** lệnh vào (đợi OSC 133;B, timeout 15 s) | `powershell -NoLogo -NoExit -Command claude` (Windows) / `$SHELL -l -i -c 'claude; exec $SHELL -l'` (mac): agent thoát vẫn còn shell, không race gõ phím |
| Liên kết pane ↔ session | Poll `claude agents --json` 5 s + hooks + scan transcript | Collector đã có registry `<pid>.json` + `queryProcesses` (ppid) → tìm con cháu `claude.exe` của pid PTY. Không cần hooks |
| Trạng thái working / needs-you | OSC 9;4 + heuristic thời gian output + hooks | Dùng status collector sẵn có (transcript + registry) — chính xác hơn. Bổ sung OSC 9/777/BEL cho shell thường |
| Batching | Microtask, 64 KiB/batch, `pty.pause()` khi queue > 512 KiB | Giữ flush 8 ms của spike + thêm pause/resume theo `ws.bufferedAmount` |
| Exit order | flush decoder → flush batch → emit exit | Áp y nguyên |
| Kill | mac: SIGHUP nhóm → SIGKILL 500 ms; Win `taskkill /T` | Áp y nguyên (node-pty `kill()` Windows không giết cây con) |
| Quit | Census pane bận → confirm nêu rõ cái gì sẽ chết; đọc process table lỗi → **từ chối quit** | Áp y nguyên (đã chốt confirm) |
| Resize | ResizeObserver debounce 90 ms, min 24 cols | Áp |
| Layout | Window → Tab(space) → cây split nhị phân bất biến, ratio 0.15–0.85, auto-tile vào lá rộng nhất | Port `split-tree` sang TS thuần trong `packages/shared` |
| Restore | `session.json` debounce 1 s, không tự restore, nút "Reopen", resolver theo cwd + mtime, mỗi sessionId chỉ dùng 1 lần | Áp; lưu ít hơn (không prompt) |
| Worktree | `git worktree add <dest> -b <branch>` argv, `GIT_TERMINAL_PROMPT=0`, không `--force`; **không có remove** | Có remove (chặn khi dirty) — hơn Deck |
| Branch label | Poll `rev-parse` 2 s pane đang focus | Watch `.git/HEAD` + `.git/worktrees/*/HEAD`; `git status --no-optional-locks` (không thì vòng lặp watch) |
| Quota 5h/7d | Wrap statusLine (Claude), `codex app-server` JSON-RPC (Codex) | Đã có (`PlanLimits`, bridge) |

Bẫy cần áp ngay (đã gặp ở Deck):
- **Tiếng Việt**: dùng `@xterm/addon-unicode-graphemes` (`activeVersion "15-graphemes"`) thay `unicode11` — fix lệch con trỏ với text NFD trong Claude/Ink.
- WebGL chỉ bật cho pane đang hiển thị (745 MB / 72 canvas trước khi sửa); pane ẩn suspend renderer (xterm#6208 làm pane ẩn ăn 1 core).
- `smoothScrollDuration: 0`; không `minimumContrastRatio`; `lineHeight 1.25`, cursor bar.
- Shift+Enter → `\x1b\r` (xuống dòng trong prompt Claude).
- Ctrl+C: có selection → copy, không thì gửi interrupt.
- Ảnh: Deck chỉ hỗ trợ **kéo thả file → ghi path** (không paste ảnh clipboard). Ta làm cả 2: drop path + thử `^V` raw (spike).
- `windowsHide: true` mọi lần spawn git; phím tắt bracket/digit theo `event.code`.
- Chặn navigate + `window.open` (preload sống qua navigation).

## 3. UX Deck — lấy gì, bỏ gì

Lấy:
- Sidebar cây **project › checkout (branch + tag worktree) › session row**, row 2 dòng: tên task / `agent · câu mới nhất của agent`.
- Một dấu trạng thái mỗi row; thứ tự ổn định theo thời điểm mở (không xáo khi đổi trạng thái).
- Attention **latched**: needs-you giữ đến khi focus pane; chip tổng "N cần bạn" + phím nhảy tới (Ctrl+Shift+A).
- Close confirm nêu tên thứ sẽ chết; Ctrl+Shift+T mở lại tab vừa đóng.
- Quick picker: phím 1–9 chọn agent, 0 = shell.
- Settings dạng tài liệu config rows; giá trị không biết hiển thị `—`.

Bỏ / làm tốt hơn:
- 4 kiểu điều hướng chồng nhau (rail, dot space không nhãn, Mission Control, avatar) → ta chỉ sidebar + tab có nhãn.
- Nhiều tính năng chỉ có phím tắt; rename chỉ double-click → ta có menu + nút.
- Không có command palette lọc → ta đã có `CommandPalette` (Ctrl K), mở rộng thêm lệnh workspace.
- Màu là tín hiệu duy nhất cho asked/failed → ta giữ rule icon + text + màu.
- Deck phẳng tuyệt đối (không shadow, không blur) → khác hướng Apple chủ nhân muốn.

## 4. Apple design system (từ HyperFrames) → map vào token của ta

HyperFrames: CSS thuần, 1 file token, macOS-flavoured. Không có sidebar/source list, không có switch → phải tự bổ sung theo HIG.

| Nhóm | Giá trị HyperFrames | Map `--ccm-*` |
|---|---|---|
| Nền cửa sổ | `#ececee` / `#1e1e1e` | `canvas` |
| Card | `#ffffff` / `#262628` | `surface` |
| Nền phụ | `#f5f5f7` / `#2f2f31` | `raised` |
| Label | `#1d1d1f` / `#f5f5f7`; phụ `#6e6e73` / `#a1a1a6` | `ink`, `ink-muted` |
| Separator | `rgb(0 0 0/.1)` / `rgb(255 255 255/.1)`, mạnh .18 | `line`, `line-strong` |
| Accent | systemBlue `#007aff` / `#0a84ff`, soft .12/.22 | `accent`, `accent-soft` |
| Fill | `rgb(116 116 128/.12)` / `rgb(118 118 128/.24)`, mạnh .2/.36 | mới: `fill`, `fill-strong` |
| Control face | `#fff` / `#3a3a3c` | mới: `control` |
| Material bar | `rgb(246 246 248/.78)` / `rgb(40 40 42/.78)` + `saturate(180%) blur(20px)` | mới: `material` (toolbar, sidebar) |
| Material menu | `.94/.95` + blur 24 | mới: `material-pop` (popover, menu, palette) |
| Shadow | hairline 0.5px ring + bóng nhẹ; pop `0 14px 44px` | mới: `shadow`, `shadow-control`, `shadow-pop` |
| Status | red `#d70015`/`#ff453a`, green `#248a3d`/`#30d158`, orange `#ff9f0a`, ink cam `#b25000` | `st-error`, `st-done`, `st-working` (light dùng biến thể high-contrast) |
| Radius | 12 card/popover · 8 button/segmented · 6 segment/input/chip · 999 pill | mới: `radius-card/control/inner` — chấm dứt lẫn lộn lg/xl/2xl |
| Control height | 28 (segment, push button) · 34 icon btn / input (pointer fine) · 44 touch | |
| Type | body 14/1.5; headline 15/600 −0.01em; title 22/700 −0.02em; callout 13/500; footnote 12/500; caption 11 mono | thay scale 12/13/15/16 hiện tại |
| Motion | 1 easing `cubic-bezier(0.22,1,0.36,1)`; 120 press · 150 màu · 200 popover · 300 fade; scale .95/.985 khi bấm | trùng `--ease-out-quint` sẵn có |
| Focus | outline 3px accent 55% offset 1; input glow 3px | thay outline 2px hiện tại |
| Terminal "well" | Vùng luôn tối cả 2 theme (`#111113`/`#0b0b0c`) như viewer video | Áp cho pane terminal — **dấu ấn chính của workspace** |

Component cần dựng/đổi: SegmentedControl (tablist header, SessionTabs, range Usage, radiogroup Settings), PushButton/BorderlessButton/IconButton, TextField, Switch (HIG mac 38×22 — HyperFrames không có), Popover/Menu (AppSelect, PlanLimits, AgentDetails), Sheet (Settings, dialogs — thống nhất scrim `ProjectPickerDialog` đang `bg-black/45`), SourceList sidebar (mới), Toolbar dạng material.

## 5. Xung đột với rule CLAUDE.md (cần chủ nhân quyết)

1. **Font**: CLAUDE.md bắt Google Sans; Apple = `-apple-system, SF Pro Text, Segoe UI Variable` (Windows ra Segoe UI Variable).
2. **"No glassmorphism"**: material blur của Apple chỉ ở toolbar/sidebar/popover — đúng ý HIG "blur báo lớp nổi", nhưng trái câu chữ rule.
3. **Palette ember/cobalt**: Apple dùng systemBlue + greys trung tính; ember (mặc định hiện tại) ấm, lệch hẳn.
4. **"Dense"** vs HIG rộng rãi: desktop dùng control 28/34 px (macOS thật cũng dày), giữ được mật độ.
