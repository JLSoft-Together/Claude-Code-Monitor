# PLAN v18 — Terminal workspace (prompt trực tiếp trong Agent Monitor)

Tham chiếu: SpaceVibe Deck (deck.spacevibe.dev) — Electron, MIT, PTY qua IPC, sidebar project → space/tab → split pane, worktree label, OSC 7 cwd, git HEAD watcher, session restore (`claude --resume <id>`), quick launch agent, watch dashboard + usage/cost.
Mục tiêu: bản tự build, local-only, không phụ thuộc binary người khác.

## 1. Audit hiện trạng

| Đã có (tái dùng) | Thiếu |
|---|---|
| Collector: registry pid → session, transcript tail, status working/waiting/idle, subagent tree, context %, branch (`gitBranch` trong transcript), usage/cost | PTY, terminal emulator trong UI |
| Codex runs gắn dưới Claude agent | Git worktree (tạo / list / xoá) |
| Favorites + `launcher.ts` mở wt.exe / Terminal.app (bên ngoài) | Layout tab / split / space |
| Electron shell, `utilityProcess` host collector, tray, notification, dock badge | Session restore (layout + resume) |
| WS 127.0.0.1 + Host check + `isAllowedOrigin` | Auth token cho kênh có quyền thực thi |

Kết luận kỹ thuật:
- **Không thể** gõ prompt vào terminal đang chạy ở wt.exe/Terminal.app (Windows: chỉ có hack `AttachConsole`/`WriteConsoleInput`, dễ vỡ, giống keylogger). → Prompt chỉ cho terminal **do CCM tự spawn qua PTY**. Terminal ngoài giữ read-only như hiện tại.
- Vi phạm nguyên tắc PLAN.md "Monitoring must never send prompts" → cần ghi rõ deviation: CCM vẫn **không tự** gửi prompt / gọi API; chỉ chuyển phím người dùng gõ vào PTY. Zero token thêm vẫn giữ.
- PTY qua WS = **remote code execution surface**. Origin/Host check chưa đủ → bắt buộc token.

## 2. Kiến trúc đề xuất

```
apps/collector
  pty/manager.ts     node-pty spawn/resize/write/kill, ring buffer scrollback (~256 KB/pane), cap số pane
  pty/channel.ts     WS binary frame riêng (/pty?token=), không đi qua snapshot/patch store
  git/worktree.ts    `git worktree list --porcelain`, add, remove (execFile, args array, không shell string)
  workspace.ts       layout (spaces → tabs → split tree) + pane meta → <dataDir>/workspace.json
packages/shared      PtyMessage, WorkspaceLayout, PaneSpec, Worktree types
apps/web
  views/WorkspaceView.vue   tab mới cạnh Monitor / Usage
  workspace/Sidebar.vue     project → worktrees → panes (badge waiting/done từ store sẵn có)
  workspace/SplitPane.vue   split tree ngang/dọc, PanelSplitter tái dùng
  workspace/TermPane.vue    xterm.js (+ fit, webgl, search, web-links addons), header: agent, branch, status, context gauge
  stores/workspace.ts       layout, activePane, focus
apps/desktop          rebuild node-pty cho Electron ABI, asarUnpack *.node, inject token
```

Liên kết pane ↔ session monitor: spawn **thẳng** `claude` (không qua shell trung gian) → biết pid → khớp registry `<pid>.json` → `terminalId` → pane hiển thị status/context/subagent của chính nó; click card bên Monitor → focus pane.

## 3. Bảo mật (lý do chủ nhân muốn tự host)

1. Token ngẫu nhiên 32 byte mỗi lần boot; Electron đưa qua `preload` / query lúc load; WS `/pty` từ chối nếu thiếu. Browser mode (`npm start`) mặc định **tắt** PTY (env `CCM_PTY=1` mới bật, in URL kèm token ra console).
2. Giữ 127.0.0.1 + Host + Origin check; thêm check `Sec-WebSocket-Protocol` mang token (không để token trong log URL).
3. Lệnh spawn: whitelist agent preset (claude, codex, shell mặc định); cwd chỉ từ favorites / worktree đã biết / folder chọn qua dialog native — **không** nhận command string tự do từ client.
4. Không ghi scrollback ra đĩa (hoặc opt-in), không log input. Không bật `--dangerously-skip-permissions` mặc định (Deck bật sẵn — không theo).
5. Dependency pin exact version, `npm audit`, không telemetry, không auto-update từ server ngoài.

## 4. Phase

| # | Nội dung | Ước lượng |
|---|---|---|
> Cập nhật sau audit Deck (`AUDIT-v18-deck-reference.md`): thêm **D0–D2** (Apple design system) chạy trước P1 để workspace dựng thẳng trên control mới, không làm 2 lần.

| # | Nội dung | Ước lượng |
|---|---|---|
| P0 | ✅ Spike node-pty + xterm (chờ test tay) | xong |
| — | ✅ D0–D2 xong 2026-10-14 (kit `@layer components` trong `style.css`, `ui/SegmentedControl.vue`; review D2 đã sửa) · ✅ P1 code xong 2026-10-14 · ✅ P2–P7 xong 2026-10-14 (§5d–§5i), E2E CDP pass (dev + bản đóng gói win) | |
| D0 | Token Apple: thay block `--ccm-*` trong `style.css` (canvas/surface/raised/ink/line/accent + mới fill, control, material, material-pop, shadow-*, radius-*), type scale, focus ring; theme light/dark giữ cơ chế `.dark` + pre-paint | 1 ngày |
| D1 | Control kit `components/ui/`: SegmentedControl, PushButton/BorderlessButton/IconButton, TextField, Switch (38×22), Popover/Menu, Sheet, SourceList row; thay AppSelect/ToggleSwitch/dialog scrim cũ | 2 ngày |
| D2 | Áp kit vào shell hiện có: AppHeader → toolbar material + segmented, SettingsMenu → sheet grouped rows, dialogs, Usage cards (thống nhất radius 12/8/6), SessionCard/AgentNode | 2 ngày |
| P1 | PTY manager (pause/resume theo `bufferedAmount`, exit order, `taskkill /T`) + WS channel + token + WorkspaceView 1 pane trên control mới | 2 ngày |
| P2 | Quick launch: chọn folder (favorites / dialog) + agent preset → pane; liên kết pid ↔ terminalId, header pane hiển thị status/context | 1.5 ngày |
| P3 | Layout: tabs + split tree + drag resize + phím tắt (Ctrl+T, Ctrl+Shift+D split, Ctrl+W, Alt+←→); persist `workspace.json` | 2 ngày |
| P4 | Worktree: list theo repo, tạo (branch mới / có sẵn) → mở pane trong đó, xoá (chặn khi dirty, confirm), label branch live (watch `.git/HEAD` / `worktrees/*/HEAD`) | 2 ngày |
| P5 | Session restore: lưu layout + sessionId; mở lại app → nút "Khôi phục" chạy `claude --resume <id>` | 1 ngày |
| P6 | Sidebar project tích hợp badge waiting/done, Monitor ↔ Workspace focus, notification click → pane, compact mode | 1 ngày |
| P7 | Test (manager, worktree parser, token), docs (`claude-code-integration.md` deviation, `.code_index/*`), packaging Win + mac | 1 ngày |

MVP dùng được hằng ngày = D0–D2 + P1–P3 (~10.5 ngày). Full ~15 ngày.

Chỉnh từ audit Deck vào các phase:
- P2: spawn `powershell -NoLogo -NoExit -Command claude` (agent thoát vẫn còn shell); link pane ↔ session qua con cháu `claude.exe` của pid PTY (`queryProcesses`); trạng thái lấy từ collector, không heuristic output.
- P3: cây split nhị phân bất biến (`packages/shared`), ratio 0.15–0.85, auto-tile lá rộng nhất, min 24 cols, WebGL chỉ pane đang hiện, phím theo `event.code`.
- P4: `git worktree add <dest> -b <branch>` argv, `GIT_TERMINAL_PROMPT=0`, `windowsHide`, `status --no-optional-locks`; có remove (chặn dirty).
- P5: không tự restore; resolver cwd + mtime, mỗi sessionId 1 pane; không lưu prompt.
- P6: attention latched đến khi focus pane, chip "N cần bạn" + Ctrl+Shift+A; close confirm nêu tên thứ sẽ chết.

## 4b. Design — workspace (Apple)

```
┌ toolbar (material blur) ─────────────────────────────────────────────┐
│ ● Monitor │ Workspace │ Usage │ History        [2 cần bạn] Claude 42%·5h  ⚙ │
├──────────────┬────────────────────────────────────────────────────────┤
│ SOURCE LIST  │ tab: claude · feat/x ✕ │ shell ✕ │ +                     │
│ (material)   ├─────────────────────────────┬──────────────────────────┤
│ ▾ cc-monitor │ ┌ claude · Đang sửa store… ┐│ ┌ codex · Chờ duyệt  ⚠ ┐ │
│   ⎇ master   │ │                           ││ │                      │ │
│    ✳ claude  │ │   TERMINAL WELL           ││ │   TERMINAL WELL      │ │
│   ⎇ feat/x wt│ │   (luôn tối, cả 2 theme)  ││ │                      │ │
│    ⚠ codex   │ │                           ││ │                      │ │
│ ▸ hyper-fr.. │ └───────────────────────────┘│ └──────────────────────┘ │
│ ＋ Worktree  │                                                         │
└──────────────┴────────────────────────────────────────────────────────┘
```

- Dấu ấn: terminal "well" luôn tối, bo 12, hairline 0.5px, đặt trên nền cửa sổ sáng/tối — như viewer video của HyperFrames; mọi thứ khác im lặng, trung tính.
- Sidebar = source list macOS: row 28 px, chọn = `accent-soft` + chữ accent (macOS) — khác Deck dùng đảo màu; hierarchy project › checkout › session, 1 status glyph/row (icon + text trong tooltip/aria).
- Pane header 28 px: logo agent · câu mới nhất · status glyph; pane focus = viền accent 1px, không đổi kích thước.
- Accent chỉ cho tương tác/selection; vàng = cần bạn, đỏ = lỗi, cam = đang chạy (giữ map status hiện tại).
- Motion: 1 easing `cubic-bezier(0.22,1,0.36,1)`, 150 ms màu, 200 ms popover, press scale .985; reduced-motion tắt hết.

## 5. Rủi ro

- node-pty native: phải khớp Electron ABI, CI mac build x64+arm64 riêng; Windows cần ConPTY (Win10 1809+, OK).
- Claude Code TUI (Ink) cần terminal chuẩn: xterm.js xử lý tốt, nhưng IME tiếng Việt (Unikey/telex) trên xterm.js đôi khi lỗi composition → test sớm ở P0.
- Paste ảnh (Ctrl+V ảnh vào Claude Code) không đi qua PTY như terminal native → cần tính năng riêng hoặc chấp nhận thiếu.
- Đóng app = kill PTY = kill claude đang chạy. Cần confirm khi còn agent working; tray "quit" cũng phải hỏi.
- Bộ nhớ: mỗi pane xterm ~10–30 MB; cap ~12 pane, pane ẩn dừng render.

## 5b. Kết quả P0 (2026-10-14)

- Package: **`@lydell/node-pty@1.2.0-beta.15`** — prebuilt N-API cho win/mac/linux x64+arm64 → **không cần electron-rebuild / VS build tools**. Chạy được trong `utilityProcess` Electron 44.4.5.
- Windows PASS: không token / sai token / origin lạ đều bị từ chối; spawn 13 ms; round trip shell ~1.1 s (gồm thời gian PowerShell khởi động); reattach replay scrollback OK.
- ConPTY trả `pid` **bất đồng bộ** (0 ngay sau spawn, có sau ~30 ms) → manager phải đợi/emit sau.
- node-pty Windows giữ event loop sau khi tiến trình con exit → shutdown phải `process.exit` tường minh.
- `claude.cmd` (npm) chỉ là shim gọi `node_modules\@anthropic-ai\claude-code\bin\claude.exe` → P2 resolve thẳng `claude.exe` để pid PTY = pid trong registry `<pid>.json`; fallback cmd.exe + tìm con qua `queryProcesses` (ppid).
- Token qua `Sec-WebSocket-Protocol` (`ccm.pty.<hex>`), so sánh `timingSafeEqual`.

Chờ chủ nhân test tay: gõ tiếng Việt (Unikey telex/VNI), Claude Code TUI hiển thị đúng, latency gõ phím (footer p50/p95), Ctrl+V ảnh vào Claude, Reload + reattach, resize cửa sổ. macOS chưa test.

## 5c. P1 — quyết định khi code (2026-10-14)

- PTY host là utilityProcess **riêng của desktop** (`apps/desktop/src/pty/`), không nằm trong collector như §2: collector có thể là bản ngoài (bat), browser mode không có đường tới PTY, native module chỉ ở desktop. Fork lười khi mở terminal đầu tiên.
- Token tới trang qua preload + IPC (`ccm:pty-endpoint`), main chỉ trả cho top-level frame cùng origin app **và** khi collector là của chính app (`ownsPort`) — chạy collector ngoài (bat) thì workspace báo không dùng được. Lý do: tiến trình lạ chiếm port 4317 trước sẽ được load vào cửa sổ có preload.
- **P7 bắt buộc:** CSP cho trang collector (`script-src 'self'` + hash pre-paint script, `connect-src 'self' ws://127.0.0.1:*`) — XSS trong dashboard giờ tương đương shell. Hiện chỉ có `v-html` ở ArtImage (SVG đóng gói), rủi ro thấp.
- cwd P1 = thư mục tuyệt đối tồn tại (mặc định home); P2 siết về favorites / dialog native / worktree.
- Đóng tab đang chạy chưa hỏi confirm (P6 làm confirm nêu tên). Phím tắt kiểu Windows Terminal để P3.
- Packaging mac 2 arch: npm chỉ cài prebuilt của máy build → CI mac cần cài thêm `@lydell/node-pty-darwin-<arch>` còn lại (P7).

## 5d. P2 — quyết định khi code (2026-10-14)

- Liên kết pane ↔ session: PTY host trả lời `owners` (pid nào là con cháu shell của pane, đi ngược ppid ≤32 tầng) — không cần resolve `claude.exe` hay đổi lệnh spawn; gõ `claude` tay trong pane shell cũng tự liên kết. Một lần quét = 1 PowerShell CIM (~0.5–1.5 s), chỉ khi có terminal mới xuất hiện và có pane đang chạy.
- cwd: không siết allowlist như §3.3 — trang đã có shell thì cwd allowlist không thêm an toàn; giữ kiểm tra của host (tuyệt đối, tồn tại, không UNC). Folder đến từ: gần đây / favorites / cwd các session đang chạy / dialog native (`ccm:pick-folder`) / home.
- Header pane: status + branch + tiêu đề + context lấy từ collector (không heuristic output). Click card Monitor → focus pane để P6.

## 5e. P3 — quyết định khi code (2026-10-14)

- Cây split ở `apps/web/src/lib/splitLayout.ts` (chỉ web dùng, không đưa vào shared). Mọi pane render phẳng + absolute theo box → split / đổi tab không remount xterm.
- Persist layout chỉ trong sessionStorage (Ctrl+R giữ nguyên). Qua lần mở app mới PTY đã chết → khôi phục layout + `claude --resume` là việc của P5 (không tự spawn lúc khởi động).
- Phím: kiểu Windows Terminal; Alt+Arrow chỉ bắt khi tab có >1 pane (để shell dùng khi 1 pane). mac: Cmd+T/D/W…, menu Close bỏ đăng ký Cmd+W.
- Ctrl+K của palette bị bỏ qua khi focus trong terminal.
- E2E: script CDP trong scratchpad (Electron dev cô lập: `CCM_PORT=4399`, `CCM_DATA_DIR` + `--user-data-dir` tạm). Phát hiện + sửa: biến môi trường phiên Claude cha lọt vào pane (`CLAUDE_CODE_CHILD_SESSION`…).

## 5f. P4 — quyết định khi code (2026-10-14)

- Git chạy trong PTY host (kênh có token), không ở collector (WS dashboard không token, không được có thao tác ghi). `git` tìm qua PATH tự viết (libuv thử cwd trước → repo lạ có `git.exe` sẽ chạy).
- Worktree mới tách từ HEAD của pane đang mở menu; branch có sẵn thì checkout. Không bao giờ `--force`: chặn khi dirty / main / còn terminal chạy trong đó.
- Branch live: watch thư mục git của cwd lúc spawn (HEAD đổi qua rename). Shell `cd` sang repo khác không cập nhật (không có OSC 7) — chấp nhận.
- UI: chip branch trên header pane → popover Worktree. Sidebar project → worktree → pane để P6.

## 5g. P5 — quyết định khi code (2026-10-14)

- Không tự khôi phục: lần mở app mới, Workspace trống hiện thẻ "Khôi phục workspace trước" (số tab, số cuộc trò chuyện sẽ resume). Snapshot localStorage chỉ có preset / cwd / session id, không output, không prompt.
- Session id lấy từ liên kết monitor (không đoán theo cwd + mtime): pane chưa từng liên kết thì khôi phục thành agent mới cùng thư mục.
- "Mở lại trong Agent Monitor" trên SessionCard: session còn chạy → cảnh báo hai bản cùng ghi, phải bấm "Vẫn mở". Một session id chỉ một pane (`resumeSession` focus pane có sẵn).

## 5h. P6 — quyết định khi code (2026-10-14)

- Sidebar = source list material (md+), nhóm theo dự án; worktree `<repo>-wt/*` gộp về repo gốc. Ẩn/hiện bằng nút ở toolbar, nhớ trong localStorage.
- Attention latch: chuyển sang waiting (hoặc working → idle = done) khi pane không đang được nhìn → chấm vàng/xanh ở tab + sidebar, chip "N cần bạn", Ctrl+Shift+A. Xoá khi focus pane; waiting tự xoá nếu agent đã chạy tiếp (trả lời ở nơi khác).
- Đóng pane/tab: chỉ hỏi khi pane đang chạy agent (preset claude/codex hoặc có session liên kết); hộp thoại nêu tên từng thứ sẽ dừng. Shell trống đóng ngay.
- Click thông báo trình duyệt → mở đúng pane nếu session nằm trong workspace. Toast Windows / dock mac vẫn đi đường cũ (focus cửa sổ).

## 5i. P7 — kết quả (2026-10-14)

- CSP cho trang collector: hash script inline tính lúc phục vụ (không phải sửa tay khi index.html đổi). E2E: 0 vi phạm qua Monitor/Usage/History/Workspace/palette/settings/tour; script chèn vào bị chặn; terminal vẫn chạy.
- Test: desktop `test/pty.test.ts` (git/owners/presets), web `splitLayout.test.ts`, collector `csp.test.ts`; E2E `apps/desktop/e2e` (6 script, ~60 kiểm tra) chạy được cả với exe đã đóng gói.
- Đóng gói Windows (`--win dir`) chạy terminal OK; node-pty chỉ còn 1 bản (`resources/pty`). mac: CI cài prebuilt cả 2 arch — **chưa chạy thử trên mac**.
- Docs: deviation `docs/claude-code-integration.md` §11o.
- Còn mở: test tay IME tiếng Việt (Unikey) + Ctrl+V ảnh trong pane Claude; macOS (PTY zsh, Cmd shortcuts, dmg); toast Windows / dock mac click chưa nhảy tới pane.

## 6. Đã chốt (2026-10-14)

- Design (sau audit): font hệ thống Apple (bỏ Google Sans/Google Fonts); material blur chỉ ở toolbar/sidebar/popover; 1 palette Apple (bỏ ember/cobalt); restyle toàn app (D0–D2) trước workspace.
- Thoát app khi còn agent chạy: confirm rồi kill PTY (không chạy ngầm).
- Phím tắt kiểu Windows Terminal (Ctrl+Shift+T, Alt+Shift+D…) để không đụng phím của Claude Code.

- Runtime: **chỉ desktop Electron**. Từ v2.0.0 bỏ hẳn browser mode (`.planning/PLAN-v19-desktop-only.md`); `npm run dev` chỉ để làm UI, không có terminal.
- Worktree: folder anh em `<repo>-wt/<branch>` (branch có `/` → thay bằng `-`).
- Agent preset: Claude Code, Codex CLI, shell mặc định (pwsh / `$SHELL`).
- Terminal ngoài: read-only + nút **"Mở lại trong CCM"** trên SessionCard → pane `claude --resume <sessionId>` tại cwd của session. Chỉ bật khi session ngoài đã ended/idle; nếu còn live → confirm cảnh báo 2 instance cùng ghi transcript. Thêm vào P5.
