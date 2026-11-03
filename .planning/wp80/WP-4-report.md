# WP-4 report — MCP run_app / run_status / run_log + device_screenshot

## Đã đổi
- **shared** `packages/shared/src/mcpRun.ts` (mới): `McpRunCall` / `McpRunResult`, `isMcpRunId`, `runPhase`, `cleanRunText`, `parseMcpRunResult`. `mcpCall.ts`: union `McpPageCall` / `McpPageResult` thêm run types, `parseMcpPageResult` chuyển sang `parseMcpRunResult` cho 4 tool. `index.ts` + `export * from './mcpRun'`.
- **desktop host** `pty/mcpTools/`: `runApp.ts`, `runStatus.ts`, `runLog.ts`, `deviceScreenshot.ts`, `runCommon.ts` (mask lại `createLogMasker`, text lỗi, `sessionLine`) (mới). `types.ts`: `page` nhận `PageAsk` (= McpPageCall bỏ id/from/cwd, trừ notify_owner) — WP-5 cũng dùng được.
- **desktop main** `devices/mcpShot.ts` (mới, `mcpScreenshot`, `writeTempShot`); `main.ts`: import + `screenshotMcp()` + 1 dòng đầu `pageMcp` (device_screenshot không hỏi page).
- **web** `lib/mcpRun.ts` (mới, `createRunCalls` app/status/log); `composables/useMcpCalls.ts` +import, `runCalls`, 4 dòng dispatch (kiểm `callerOf`); `stores/run.ts` tách `startConfig(root, configId, deviceId)` khỏi `start` (Run không đổi pick của Run bar).
- **docs**: `claude-code-integration.md` §11w đoạn "Run / device tools (v80 WP-4)"; `codex-integration.md` §8 1 dòng.
- `apps/desktop/src/strings.ts`: không cần (không dialog mới; trust confirm có sẵn của Run).

## Tool + schema
- `run_app {action: start|reload|restart|stop (required), config?: id, device?: serial, full?: boolean (chỉ với reload = hot restart)}` → page: config phải nằm trong `run.loadConfigs(root)`, device trong `run.devicesFor(cfg)` (config pin device thì từ chối device khác); mặc định = pick của Run bar, không đổi pick. start: cặp đang live → `running`; restart = Rerun; stop/reload: run live của cặp, else run Run pane đang hiện / mới nhất; reload cần `running`. Trả ngay, ≤4 s (`RUN_REPLY_MS`), lâu hơn (trust confirm, stop cũ) → `waiting` (không lỗi). 6/phút/pane.
- `run_status {}` → configs (id, name, type, pinned device, selected), devices (serial, name, platform, state, selected), 5 run mới nhất: `starting|running|stopping|crashed|stopped` + rawState, `lastError` 1 dòng (failure → build error → crash block → dòng lỗi cuối). 30/phút.
- `run_log {lines? 1–200 = 50, errorsOnly?}` → N dòng cuối của run đang hiện + ≤20 build error, `partial` nếu window reload mất log. 30/phút.
- `device_screenshot {serial?}` → main: thiết bị online + ready trong `DeviceManager.snapshot()`; không serial: thiết bị run live của project → thiết bị duy nhất → `several` (kèm list) / `no-device`. `screencap` (ready check sẵn) → capture folder `shots/` (`CaptureFolder.writeShot`, tên Orrery), không có folder → `<tmp>/orrery-shots` (giữ 30 file mới nhất). Trả path + w×h. 10/phút.
- Mặc định đã chọn: "thư mục chụp của project" = capture folder v76 (folder chung chủ nhân chọn), fallback temp thay vì báo lỗi.

## Bảo mật
- `take()` chạy đầu tiên ở cả 4 tool (trước validate / hỏi page); arg sai không bao giờ tới page (test).
- Whitelist: config id / serial `^(?!-)[A-Za-z0-9_.:@%-]{1,128}$` (không option `-…`, không khoảng trắng / `;` / `..`), rồi phải khớp danh sách thật (page: configs + devicesFor; main: snapshot ready). Không lệnh tự do; shared/imported config vẫn qua trust confirm native của `RunManager`; IPC Run cũ vẫn gate root qua `resolveDir`.
- Không tin page: host parse lại (`parseMcpRunResult`: kind/state/stream/level enum, session id dạng UUID, appId/platform regex, list cap 50/30/10/200/20, text bỏ ANSI/OSC/control/bidi/tag chars, cap 1000/300/80), rồi mask lại toàn bộ text (home → `~`, token, key=value). Path ảnh phải `.png`, không NUL/newline.
- Không gửi/gõ prompt nào; không đổi setting máy, không cài app. Screenshot quá 7 s → `timeout` và KHÔNG ghi file muộn (cờ `late`).
- Ghi chú: ảnh chụp có thể chứa nội dung riêng trên màn điện thoại — vốn là bản chất tool, đã ghi docs. Stop không có confirm (giống nút Stop, không mất dữ liệu).

## Test số thật
- typecheck shared / desktop / web: sạch.
- vitest desktop: `test/mcp-run-tools.test.ts` 16/16 (mới: arg sai, rate, config lạ, serial lạ, không Run, không thiết bị, several, secure, timeout không ghi, temp fallback, page bịa dữ liệu bị lọc, mask + ANSI); toàn bộ desktop 1106/1106 (trước khi thêm 2 test cuối; file đó chạy lại 16/16).
- vitest web: `src/lib/mcpRun.test.ts` 6/6 (mới) + `stores/run.test.ts` 15/15; toàn bộ web 1659/1659.
- E2E: không viết (luật WP-8 chạy build/e2e); không đụng 4317 / RFCTB05YJWJ.

## Hot file cần thêm
- `apps/desktop/src/pty/mcpTools/index.ts`:
  - import: `import { deviceScreenshot } from './deviceScreenshot'`, `import { runApp } from './runApp'`, `import { runLog } from './runLog'`, `import { runStatus } from './runStatus'`
  - mảng `MCP_TOOLS`: thêm `runApp, runStatus, runLog, deviceScreenshot` (sau các tool WP-1/WP-5).
- Đề xuất (không sửa, WP-5 đang đụng): `pty/mcp.ts` `MCP_INSTRUCTIONS` thêm "; run_app / run_status / run_log to run the project's app and read its log; device_screenshot to see an Android device's screen".
- Đề xuất sau: WP-5 có kênh `mcp-desk` cho tool main tự trả lời; device_screenshot hiện chặn trong `main.pageMcp` (chạy được, không cần page) — main có thể dời sang `desk` cho đồng nhất.
- Đã tự sửa ngoài 4 file tool (cần): `types.ts` (`PageAsk`), `main.ts` (+`screenshotMcp`), `useMcpCalls.ts`, `stores/run.ts` (`startConfig`), shared `mcpCall.ts` / `index.ts`.

## Index (1–3 dòng)
- desktop.md: `pty/mcpTools/runApp|runStatus|runLog|deviceScreenshot` (+`runCommon` mask / `sessionLine`); `devices/mcpShot.ts` `mcpScreenshot` (main `pageMcp` → `screenshotMcp`, capture `shots/` hoặc `<tmp>/orrery-shots`).
- web.md: `lib/mcpRun.ts` `createRunCalls` (useMcpCalls run_*), `run.startConfig`.
- protocol.md: `shared/mcpRun.ts` (`McpRunCall/Result`, `parseMcpRunResult`, `isMcpRunId`, `runPhase`).

## Changelog
- en: Agents in Workspace panes can now run the project's app with its Run configurations (start, hot reload, restart, stop), check how the run is doing, read the last lines of the Run log with secrets masked, and take a screenshot of a connected Android device into your capture folder.
- vi: Agent trong pane Workspace giờ có thể chạy app của project bằng cấu hình Run (chạy, hot reload, chạy lại, dừng), xem trạng thái lần chạy, đọc các dòng cuối của log Run đã che bí mật, và chụp màn hình thiết bị Android đang kết nối vào thư mục chụp của chủ nhân.

## Commit đề xuất
`▶️ v80 MCP tools run_app / run_status / run_log / device_screenshot: Run configs and devices from Orrery's lists only, answers re-checked and masked by the PTY host, screenshots to the capture folder`
