## WP-4: MCP tool run_app / run_status / run_log + device_screenshot
- Nền: registry `apps/desktop/src/pty/mcpTools/` (WP-1: types.ts McpTool, paths.ts kiểm path, notifyOwner.ts làm mẫu rate limit + gọi renderer qua
  useMcpCalls / shared mcpCall.ts). Đọc WP-1-report.md trước. `mcpTools/index.ts` là hot file của main: KHÔNG sửa, ghi dòng cần thêm vào report.
- Tool:
  1. `run_app(config?: string, device?: string, action: start|reload|restart|stop)`: chạy config Run của project pane gọi (stores/run.ts + desktop run/),
     config id / serial phải khớp danh sách hiện có (whitelist, không nhận lệnh tự do). stop = hành vi nút Stop. Không cài app lạ.
  2. `run_status()`: config đang chạy, thiết bị, trạng thái (starting/running/crashed/stopped), lỗi gần nhất (tóm tắt 1 dòng).
  3. `run_log(lines ≤ 200, errorsOnly?: boolean)`: N dòng cuối log Run của project, đã che secret (shared/secretMask.ts).
  4. `device_screenshot(serial?)`: chụp qua adb (desktop devices/, đường chụp có sẵn cho Run/Devices), lưu vào thư mục chụp của project (capture folder v76),
     trả đường dẫn PNG + kích thước. Thiết bị phải đã kết nối; không cài / không đổi setting máy.
- Bảo mật như AGENT-RULES-v80 "v80 extra"; rate limit (vd run_app 6/phút, screenshot 10/phút/pane). Test vitest desktop (arg sai, config lạ, serial lạ,
  không có Run, không thiết bị). Docs §11w + codex §8.
- Phạm vi: mcpTools/runApp.ts, runStatus.ts, runLog.ts, deviceScreenshot.ts (mới), bridge cần thêm trong desktop run/ / devices/ (ghi rõ), web stores/run.ts chỉ
  khi cần handler, test, docs. Cấm: mcpTools/index.ts, notifyOwner/openInWorkspace/whoIsEditing/openSession/paths.ts (đề xuất sửa nếu cần), WP-5 file.
- Model: opus. Build/e2e: `.planning/wp/build.lock`, CCM_E2E_DBG=9451 CCM_E2E_PORT=4392; KHÔNG đụng 4317 / điện thoại thật RFCTB05YJWJ (dùng run-fakes adb).
- Báo cáo `.planning/wp80/WP-4-report.md`.

## Nhật ký

- 2026-11-03 WP-4 xong: 4 tool + mcpShot (main) + lib/mcpRun (page); typecheck sạch; vitest desktop 1106/1106, web 1659/1659; report WP-4-report.md.
