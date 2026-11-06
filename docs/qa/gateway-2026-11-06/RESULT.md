# QA cổng chung Orrery API (2026-11-06)

Bản dev: Vite 5173 + Electron CDP 9333 (dữ liệu `orrery-qa-tg`), main/host build lại bằng `node build.mjs` trước khi thử. Thư mục thử `…/Temp/orrery-qa-gw/projA|projB`. `~/.claude/settings.json` giống backup trước và sau. Không gửi prompt nào ngoài 1 lượt `say ok` (pane A, bước 7). Ảnh nằm ở `WP-4/`, ảnh WP-3 ở `WP-3/`.

| # | Kịch bản | Kết quả | Chi tiết / ảnh |
|---|---|---|---|
| 1 | Menu mở Claude (`workspace.launch`): id có ngay, ✈ mở | ĐẠT | Pane có `agentSessionId` = `mintedSession` ngay khi mở; process `claude.exe --session-id <id> --mcp-config …`; menu tab có "Kết nối Telegram…" bật được lúc đang ở màn chào. `01-claude-menu-open.png`, `02-claude-telegram-link-enabled.png` |
| 2 | URL `agent-monitor://open?agent=claude&cwd=…` | ĐẠT | Dev không đăng ký protocol nên gọi bằng electron thứ hai cùng `--user-data-dir` (đường `second-instance` → `openLink` → `session.open`, source `url`): pane mới ở projB có id minted ngay. Chưa thử `resume=` qua URL (e2e v49-open phủ) |
| 3 | Claude thấy MCP orrery | ĐẠT | `/mcp` trong pane: `orrery ✓ 17 tools` (14 cũ + 3 mới); `tools/list` bằng token pane: 17 tên, thứ tự cũ giữ, 3 tool mới cuối. `03-claude-mcp-orrery.png` |
| 4 | `list_sessions` từ pane shell (PowerShell, token pane, không in token) | ĐẠT | Trả pane Claude + chính shell (`this is you`), không lộ nội dung/env; sau `open_session` hiện thêm pane `opened by you`. Pane projB không lẫn vào |
| 5 | `open_session` (claude, cwd projA, name) | ĐẠT | Pane mới tách cạnh pane gọi, tên `gwqa-child` hiện ở rail |
| 6 | `send_to_session` | ĐẠT | `qa-ping` hiện trong ô nhập của Claude pane A, KHÔNG submit; gửi cho chính nó / id rác → `target`. `04-send-to-session-prefill.png` |
| 7 | `close_session` | ĐẠT | Pane không phải mình mở → `target`; pane mình mở đang chạy → `confirm:true` + sheet "Đóng terminal này?" của chủ nhân; sau khi xác nhận pane đóng, vào `closedStack` (undo được). `05-close-session-confirm.png`. Không thử `busy` (cần prefill/Compact treo) và `rate` (20/phút) — có unit test `mcp-sessions.test.ts` |
| 8 | Gõ `claude` trong shell → tool orrery + id | ĐẠT | Shim chạy: `claude.exe --session-id <uuid> --mcp-config …` trong pane shell, `untouchedSession` có giá trị. `06-shell-claude-shim.png` (WP-3 có thêm `WP-3/wp3-01`) |
| 9 | Đóng pane shell chạy claude chưa có lượt → mở lại | ĐẠT | Mở lại thành pane Claude MỚI (id mới, `mintedSession`), process `--session-id`, KHÔNG `--resume` |
| 10 | Pane Claude chưa lượt (URL open ở projB, kẹt ở hỏi trust) đóng → mở lại | ĐẠT | Entry đóng không có `resume`; pane mở lại id mới, không `--resume` |
| 11 | Pane Claude đã có lượt (`say ok`) đóng → mở lại | ĐẠT | process `claude.exe --resume 40884515-… --mcp-config …`. `07-reopen-resume-after-turn.png` |
| 12 | Tắt công tắc `agentShim` / codex shim / POSIX shim chạy thật | CHƯA KIỂM | Windows dev, không có rollout codex; công tắc và POSIX có unit test (`shim.test.ts`) + WP-3 ảnh `03-settings-switch` |
| 13 | Telegram `new` / `resume` qua `ccm:orrery` | CHƯA KIỂM | Không bật nhận lệnh Telegram trên bản dev; có test `useOrreryApi` / `telegramTail` / `orrery-api` |
| 14 | URL scheme đăng ký thật (app cài) | CHƯA KIỂM | Cấm đụng app cài / cổng 4317 |

## E2E (`CCM_E2E_DBG=9444`, web + desktop build lại; bản dev vẫn chạy)

| File | Kết quả |
|---|---|
| v49-open | 33 PASS (có `onOrrery`, MCP open, link, resume) |
| v80-mcp | 23 PASS |
| shell-agent | 5 PASS (+ INFO codex chưa có rollout) |
| rail | 37 PASS |
| tier2 | 25 PASS |
| project-panes | 23 PASS |
| tabs-cwd | 17 PASS |
| links | 22 PASS |
| v50-groups | 31 PASS, 1 FAIL lần đầu: `dust runs without long frames` (worst 73 ms, ngưỡng 50) khi máy đang tải; chạy lại riêng: PASS (worst 30 ms) → lỗi đo thời gian, không phải chức năng |

## Lỗi / lệch tìm thấy (không sửa code)

1. Hộp thoại `/mcp` (hoặc mọi dialog làm terminal sang `waiting`) bị tính là một lượt: `mintedSession` bị xoá dù chưa có transcript → đóng/mở lại sẽ `--resume` id không có transcript ("No conversation found"). Chỗ: `apps/web/src/composables/useWorkspaceLinks.ts` (điều kiện xoá minted/untouched theo status `working|waiting`). Tái hiện: mở Claude bằng menu, gõ `/mcp`, đóng pane, `reopenClosed` → entry có `resume`. Gợi ý: chỉ `working`, hoặc đòi thêm dấu hiệu transcript.
2. `list_sessions` trả `sessionId` là id PTY của pane, còn `open_session` trả uuid Claude (dùng cho `resume`): hai "session id" khác nhau cho cùng pane, agent dễ nhầm. Chỗ: `apps/web/src/composables/useSessionActions.ts:141` (`p.sessionId`) vs kết quả `session.open`. Docs §11w đã nói rõ; có thể thêm `agentSessionId` vào `SessionRef`.
3. `list_sessions` `name` của pane vừa mở với `name: "gwqa-child"` ra `"projA"` (`nameOf(p,{title:false})`, `useSessionActions.ts:143`) trong khi rail gọi nó `gwqa-child` (tên Claude tự báo). Nhẹ, chỉ lệch tên.
