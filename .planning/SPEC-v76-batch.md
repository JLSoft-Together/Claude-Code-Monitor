# SPEC v76 — tài nguyên agent + thư mục chụp / quay (chủ nhân chốt 2026-11-01)

Nguồn: `.planning/IDEAS-2026-11-01.md`. Tính năng đã có: `.code_index/features.md`. Rule subagent: dùng lại `.planning/AGENT-RULES-v75.md` (git chỉ khi chủ nhân bảo, không trailer, ít comment, E2E cổng riêng, adb giả).

Chủ nhân chốt:
- Làm **R1 session / server bỏ quên**, **R2 bản đồ cổng**, **R3 giữ máy không ngủ**, **R4 thư mục chụp / quay** (`L:\AI\cache` trên máy này).
- R1: báo + nút tắt (confirm native, không tự kill); theo dõi dev server / shell nền + process mồ côi (không theo dõi MCP riêng); ngưỡng nhàn rỗi mặc định 60 phút.
- Ra ở 2.6.0: dòng changelog vào `## Changelog chờ` dưới đây + `.planning/RELEASE-2.6.0.md`.
- Không commit tới khi chủ nhân bảo.
- Nguyên tắc zero token giữ nguyên: không gửi prompt, không gọi API.

## Nền chung — đo process (collector)

Hiện `win-procs.ts` chỉ có pid, ppid, name, creation time. Mở rộng:
- `WinProcApi.usage(pid)` → `{ privateBytes, workingSet, cpuMs }` qua koffi `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `K32GetProcessMemoryInfo` (psapi / kernel32) + `GetProcessTimes` (kernel + user). macOS / Linux: `ps -o pid=,ppid=,rss=,time=,command=` một lần mỗi vòng. `CCM_NATIVE_PROCS=0` → PowerShell CIM (`Win32_Process` WorkingSetSize, KernelModeTime, UserModeTime).
- Module mới `apps/collector/src/resources/`: `sampler.ts` vòng **30 s** (chỉ chạy khi có client WS hoặc toast bật; không poll dày), CPU% = Δ cpuMs / Δ wall / số lõi; giữ 1 mẫu trước mỗi pid; pid tái dùng phân biệt bằng creation time.
- `tree.ts` thuần: từ bảng process dựng cây con cháu của mỗi session (pid claude.exe / codex đã biết), phân loại con: `shell` (bash / pwsh / cmd / sh / zsh), `dev-server` (có cổng LISTEN, xem R2), `daemon` (Gradle / Kotlin daemon nhận theo command line: `GradleDaemon`, `KotlinCompileDaemon`), `mcp` (con trực tiếp stdio của claude, chỉ để cộng RAM), `other`.
- Mồ côi: process có lịch sử là con cháu của một session đã biết (nhớ pid + creation time lúc session còn sống) mà session đã kết thúc → `orphan`. Không đoán từ tên với process chưa từng thấy dưới session.
- Command line hiển thị qua `maskSecrets`, cắt 200 ký tự.

## R1 — Session / server bỏ quên

Collector:
- Session nhàn rỗi: process còn sống, status `idle` / `waiting`, `now - lastActivityAt ≥ idleMin`, không subagent `running`, không job nền chạy.
- Server nhàn rỗi (`shell` / `dev-server`, sống ≥ idleMin): CPU < 1 % ở mọi mẫu trong idleMin **và** 0 kết nối TCP established tới cổng LISTEN của nó (R2) trong idleMin. Ghi rõ trên UI là ước lượng ("không có kết nối, CPU ≈ 0 trong 60 phút").
- Mồ côi: luôn liệt kê, không cần idleMin.
- Shared type mới `ResourceReport { at, sessions: SessionRes[], servers: ServerRes[], totals }`; `SessionRes { sessionId, ramBytes (cả cây), cpuPct, idleSinceMs | null }`; `ServerRes { pid, start, kind, name, cmd (đã che), cwd?, ports, ramBytes, cpuPct, idleSinceMs | null, sessionId | null, orphan }`. Event `resources` (gửi khi đổi, tối đa 1 lần / 30 s); client cũ bỏ qua event lạ.
- Toast kind mới `idle` (Settings → Thông báo, mặc định bật): 1 toast / episode / mục, gộp "3 mục bỏ quên dùng 2,4 GB"; giờ yên lặng + snooze như toast cũ.
- Settings: `idleMinutes` 15 / 30 / **60** / 120 / 240, tắt được.

Desktop (kill, vì collector không có quyền hành động):
- IPC `ccm:res-kill { pid, start }`: kiểm lại pid + creation time khớp (tránh pid tái dùng), confirm native `confirmBox` (nêu tên, RAM, command line đã che, cảnh báo session sẽ mất phần đang dở + gợi ý `claude --resume`), rồi `taskkill /T /F /PID` (Windows) / `kill -TERM` cây → 5 s → `-KILL` (macOS).
- Session trong pane Workspace → dùng đường kill pane sẵn có (`pty/host.ts`), có undo close như v52.
- Không bao giờ kill process không có trong `ResourceReport` mới nhất.

Web:
- Thẻ **Tài nguyên** (Monitor, cạnh Mission Control): tổng RAM / CPU các agent; bảng Session (tên, project, RAM cây, CPU, nhàn rỗi bao lâu) và Server (loại, tên, cổng, RAM, CPU, nhàn rỗi, session cha / "Mồ côi"); lọc "Chỉ bỏ quên"; nút Tắt từng dòng + "Tắt tất cả bỏ quên" (một confirm liệt kê hết).
- Badge số mục bỏ quên ở Mission Control và rail.
- Card session: dòng nhỏ RAM / CPU khi có.
- Chuỗi qua vue-i18n en + vi; màu `warning` cho bỏ quên, không dùng màu trạng thái lifecycle; status = icon + chữ + màu.

### R1b — Daemon Gradle / Kotlin / Dart (ý 1 đề xuất)
- Liệt kê mọi `GradleDaemon`, `KotlinCompileDaemon`, Dart / Flutter analysis server (`analysis_server`, `flutter_tools ... daemon`) trên máy, kể cả không thuộc session (daemon sống độc lập với claude).
- Mỗi dòng: loại, phiên bản Gradle (từ command line / classpath), JDK, RAM, CPU, nhàn rỗi bao lâu (CPU < 1 % liên tục), session / project đã gọi gần nhất nếu biết (cha lúc sinh ra).
- Nhàn rỗi ≥ idleMin → vào danh sách bỏ quên. Nút **Dừng** từng daemon (kill sau confirm; Gradle chịu được daemon chết) và **Dừng tất cả daemon nhàn rỗi**. Không chạy `gradlew --stop` (cần đúng wrapper / version, dừng cả daemon đang build).
- Không dừng daemon đang có CPU > 1 % trong 2 phút gần nhất (đang build).

## R2 — Bản đồ cổng

- Collector `resources/ports.ts`: Windows koffi `iphlpapi.GetExtendedTcpTable` (`TCP_TABLE_OWNER_PID_ALL`, IPv4 + IPv6) — LISTEN + số established mỗi cổng local; macOS `lsof -nP -iTCP -sTCP:LISTEN` + `-sTCP:ESTABLISHED`. Cùng vòng 30 s của sampler.
- Gắn cổng vào `ServerRes.ports`; liệt kê cả cổng LISTEN của process không thuộc session (nhãn "ngoài agent", không có nút Tắt mặc định, chỉ Mở / Chép).
- UI tab **Cổng** trong thẻ Tài nguyên: cổng, địa chỉ (127.0.0.1 / 0.0.0.0 / ::), process, session, số kết nối; nút Mở `http://localhost:<port>` (pane Browser), Chép, Tắt (chỉ process thuộc agent / mồ côi, qua R1 kill).
- Đụng cổng: collector nhận `EADDRINUSE` / "address already in use" / "port ... is already in use" trong output tool lỗi của transcript (chỉ tên lỗi + số cổng, không lưu nội dung) → thông báo trong app "Cổng 5173 đang bị <process> (session X) giữ" + nút mở dòng cổng.
- Không quét cổng mạng ngoài máy, không mở socket thử.

## R3 — Giữ máy không ngủ khi agent chạy

- Desktop main: `powerSaveBlocker.start('prevent-app-suspension')` khi có ≥ 1 session / agent `working` (hoặc job nền chạy); thả khi tất cả hết `working` **2 phút** liền. Không chặn tắt màn hình.
- Nguồn trạng thái: main lấy số session working từ collector (kênh utilityProcess sẵn có hoặc WS nội bộ — chọn đường có sẵn trong `desktop.md`).
- Settings → Chung: **Tắt** / **Khi agent đang chạy** / **Khi agent chạy và đang cắm sạc** (mặc định, `powerMonitor.isOnBatteryPower()`; macOS / Windows có pin).
- Trạng thái hiện ở status bar: icon cốc cà phê + "Đang giữ máy thức (2 agent)"; tooltip lý do.
- Thoát app / crash → blocker tự thả (Electron giữ theo process).

## R4 — Thư mục lưu chụp / quay

Hiện trạng: video quay ghi tạm `os.tmpdir()/orrery-rec` (`main.ts:1226`, giữ ≤ 3 file, không dọn khi crash); Lưu video mở dialog mặc định `Videos/screen.mp4`; ảnh chụp và frame chỉ ở bộ nhớ, đính kèm qua clipboard; layout preview cache ở `DATA_DIR/layoutlib/cache`.

- Settings → Thiết bị: **Thư mục chụp / quay** (chọn thư mục, mặc định trống = như cũ). Máy chủ nhân đặt `L:\AI\cache`. Lưu `ccm.captureDir`; desktop đọc qua IPC, kiểm quyền ghi + ổ tồn tại, ổ mất (USB / ổ mạng) → quay về temp + báo 1 lần.
- Khi có thư mục:
  - Video quay tạm ghi vào `<dir>/recordings/` thay vì temp; Lưu video mặc định mở `<dir>/recordings/`.
  - Ảnh chụp / frame gửi agent: ngoài clipboard, thêm lựa chọn **đính kèm dạng file** → ghi `<dir>/shots/<device>-<yyyyMMdd-HHmmss>[-fN].png` và điền đường dẫn vào agent (agent tự đọc file, không qua clipboard).
  - Dọn: giữ 7 ngày / tối đa 2 GB (cài được), dọn lúc mở app + mỗi 6 h; chỉ xoá file đúng mẫu tên do Orrery tạo trong `recordings/` và `shots/`, không đụng file khác trong thư mục.
  - Quét lúc mở app file `orrery-rec-*.mp4` mồ côi trong temp cũ / thư mục mới (sửa lỗi crash để lại file).
- `CCM_DATA_DIR` không đổi; thư mục này chỉ cho file chụp / quay.

## Thêm 2026-11-01 (chủ nhân "làm đi" sau đề xuất 5, 4, 1)

### R1c — Emulator nhàn rỗi
- Process emulator (`emulator.exe` / `qemu-system-*`, tên AVD từ `-avd <name>` trong command line) vào bảng Daemon của R1b với RAM / CPU.
- Nhàn rỗi: không có thao tác thiết bị nào qua Orrery tới serial `emulator-*` đó (desktop ghi mốc `lastUsedAt` mỗi lệnh adb của Devices / Run) **và** không session nào gọi tool có lệnh chứa `adb` / `flutter run` / `installDebug` trong idleMin (collector chỉ giữ cờ + mốc giờ, không lưu lệnh). CPU emulator rảnh vẫn cao nên KHÔNG dùng CPU làm tiêu chí.
- Tắt: dùng đường Tắt AVD sẵn có của v74 (`devices/avd.ts`, `adb emu kill`), confirm native.

### R5 — Canh file / lệnh nhạy cảm
- Collector đọc tool call trong transcript (đường đọc sẵn có `transcript.ts`), chỉ trích đường dẫn file của Edit / Write / MultiEdit / NotebookEdit và lệnh Bash ở dạng đã phân loại; không lưu nội dung.
- Luật mặc định: file `.env*`, `*.jks`, `*.keystore`, `*.p12`, `*.pem`, `key.properties`, `local.properties`, `google-services.json`, `GoogleService-Info.plist`, `*.mobileprovision`; file ngoài thư mục project của session (trừ `~/.claude/**` của chính session: plan / memory); lệnh `git push --force` / `-f`, `git reset --hard`, `git clean -fd`, `rm -rf` (gốc ngoài project hoặc `~` / `/` / ổ đĩa), `del /s`, `Remove-Item -Recurse` ngoài project, `adb uninstall`, `DROP TABLE`.
- Hiện: activity loại mới `sensitive` (icon khiên + chữ + màu `warning`), badge trên card session, toast kind `sensitive` (mặc định bật). Mỗi mục: session, tool, đường dẫn (rút gọn) / tên luật, giờ; nút Mở file, Mở diff (nếu có checkpoint), Bỏ qua luật này cho project.
- Settings → Canh nhạy cảm: bật / tắt từng nhóm, thêm mẫu glob riêng, danh sách bỏ qua theo project. Lưu ở collector data dir (`sensitive.json`).
- Chỉ cảnh báo, không chặn (chặn thật là việc của hook / permission Claude Code — có gợi ý luật deny trong `.claude/settings.json` qua đường ghi có confirm sẵn có của v72 nếu dễ).

### R6 — Báo ra điện thoại khi agent chờ
- Settings → Thông báo → **Điện thoại**: kênh `ntfy` (URL server + topic) hoặc `Discord webhook` (URL); mặc định **tắt**; nút Gửi thử.
- Gửi khi: agent chuyển sang chờ input / chờ quyền / xong việc dài / chạm hạn mức (dùng cùng episode của toast) **và** máy rảnh ≥ N phút (`powerMonitor.getSystemIdleTime()` ở desktop; mặc định 5, chọn 0 / 5 / 10 / 15). Giờ yên lặng + snooze dùng chung toast.
- Nội dung chỉ: tên app, tên session / project, lý do (chờ input / xin quyền tool X / xong / hạn mức), thời gian chờ. Không prompt, không nội dung chat, không đường dẫn đầy đủ, không tên file nhạy cảm. Qua `maskSecrets`.
- Gửi từ desktop main (`net.fetch`), timeout 10 s, giới hạn 20 tin / giờ, lỗi thì báo 1 lần trong app. URL webhook / topic là secret: cất bằng `safeStorage` như token GitHub v58, không gửi lại cho page, không ghi log.
- Docs: ghi ngoại lệ "gửi ra ngoài" (chủ nhân bật tay) vào docs + README mục Nguyên tắc.

## Thứ tự agent (tuần tự, cùng working tree)

1. Agent A — nền đo process + R1 collector + R1b daemon + R1c emulator (collector + shared types + test thuần: `tree.ts`, CPU%, mồ côi, nhàn rỗi).
2. Agent B — R2 cổng (koffi iphlpapi + lsof parser + đụng cổng) + UI thẻ Tài nguyên (R1 / R1b / R1c / R2) + kill IPC desktop.
3. Agent C — R3 powerSaveBlocker + R4 thư mục chụp / quay.
4. Agent D — R5 canh nhạy cảm + R6 báo điện thoại.
5. Agent E — gate: `npm run typecheck`, vitest từng workspace tuần tự, build web + desktop, E2E mới `apps/desktop/e2e/v76.cjs` (process giả qua env loopback như `CCM_LIBS_REGISTRY`, không kill process thật ngoài fixture) + hồi quy v75 / devices; cập nhật `.code_index/`, docs `claude-code-integration.md` (§ mới: đo process / cổng), `features.md`.

## Rủi ro / cần kiểm khi làm
- `GetExtendedTcpTable` qua koffi: struct layout IPv6 — viết test parser với buffer mẫu.
- CPU% process 32-bit / quyền thấp: `OpenProcess` thất bại → bỏ mục RAM / CPU, không báo nhàn rỗi theo CPU.
- Mồ côi chỉ biết từ lúc app chạy; process mồ côi có trước khi mở app thì không nhận ra (ghi rõ trong docs).
- Claude Code lưu ảnh dán vào transcript ra sao (ảnh hưởng `projects/` 9,4 G) — kiểm trên 2.1.294 trước khi khuyên dùng "đính kèm dạng file".

## Changelog chờ
(điền en + vi khi từng phần xong)
[R1] en: Orrery now measures RAM and CPU of each agent session and the shells, dev servers, Gradle / Kotlin / Dart daemons and emulators around it, and alerts once when something sits forgotten (60 minutes by default, Settings › Notifications).
[R1] vi: Orrery đo RAM và CPU của từng session agent cùng shell, dev server, daemon Gradle / Kotlin / Dart và emulator quanh nó, và báo một lần khi có thứ bị bỏ quên (mặc định 60 phút, Cài đặt › Thông báo).
[R2] en: A Resources card lists sessions, servers, daemons, emulators and listening ports with RAM / CPU; stop forgotten ones after one confirmation, open a port in the Browser pane, and see which process holds a port when a tool call fails with "address already in use".
[R2] vi: Thẻ Tài nguyên liệt kê session, server, daemon, emulator và cổng đang lắng nghe kèm RAM / CPU; tắt mục bỏ quên sau một lần xác nhận, mở cổng trong pane Browser, và biết process nào đang giữ cổng khi một lệnh tool lỗi "address already in use".
[R3] en: Orrery keeps the computer from sleeping while a session, subagent or background job works and for 2 minutes after (Settings › Keep awake: Off, While agents run, Only on power by default); the display can still turn off, and a coffee cup in the header shows when it is active.
[R3] vi: Orrery giữ máy tính không ngủ khi có session, subagent hay job nền đang chạy và thêm 2 phút sau đó (Cài đặt › Giữ máy thức: Tắt, Khi agent đang chạy, mặc định Chỉ khi cắm sạc); màn hình vẫn tắt được, cốc cà phê trên header báo khi đang giữ.
[R4] en: Choose a capture folder (Settings › Screenshots and recordings): screen recordings are kept in recordings/, screenshots and frames go to agents as files in shots/ instead of the clipboard, and old files are cleaned after 7 days or past 2 GB.
[R4] vi: Chọn thư mục chụp / quay (Cài đặt › Ảnh chụp và video quay): video quay giữ trong recordings/, ảnh chụp và khung hình gửi agent dạng file trong shots/ thay vì clipboard, file cũ tự dọn sau 7 ngày hoặc khi quá 2 GB.
[R5] en: Sensitive watch: the session card (click it to list each hit) and an alert warn when an agent edits a secret file (.env, keystores, certificates, key.properties, google-services.json…) or a file outside its project, or runs git push --force, git reset --hard, git clean -fd, a recursive delete outside the project, adb uninstall or DROP TABLE. Open the file, open its diff when checkpoints are on, or ignore the rule for that project; Settings › Sensitive watch picks groups and adds your own patterns. Warns only, never blocks; commands and file contents are not stored.
[R5] vi: Canh nhạy cảm: thẻ session (bấm để xem từng lần) và thông báo cảnh báo khi agent sửa file bí mật (.env, keystore, chứng chỉ, key.properties, google-services.json…) hay file ngoài project, hoặc chạy git push --force, git reset --hard, git clean -fd, xoá đệ quy ngoài project, adb uninstall hay DROP TABLE. Mở file, mở diff khi bật checkpoint, hoặc bỏ qua luật cho project đó; Cài đặt › Canh nhạy cảm chọn nhóm và thêm mẫu riêng. Chỉ cảnh báo, không chặn; không lưu lệnh hay nội dung file.
[R6] en: Phone notifications: Settings › Phone sends to ntfy or a Discord webhook when a session waits for you, asks for a permission, finishes a job of 5 minutes or more, or the limit runs out, and the computer has been idle for a while (5 minutes by default). Off by default; only the app name, session alias or folder name, reason and waiting time leave the computer; at most 20 messages an hour; the URL and topic are kept in the system keychain.
[R6] vi: Báo ra điện thoại: Cài đặt › Điện thoại gửi tới ntfy hoặc Discord webhook khi session chờ chủ nhân, xin quyền, xong việc từ 5 phút trở lên hoặc hạn mức sắp hết, và máy đã rảnh một lúc (mặc định 5 phút). Mặc định tắt; chỉ tên app, alias hoặc tên thư mục session, lý do và thời gian chờ rời khỏi máy; tối đa 20 tin mỗi giờ; URL và topic cất trong keychain của hệ thống.
