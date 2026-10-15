# Audit hiệu năng GolAIm — 2026-10-15

Câu hỏi: viết lại một phần bằng Go/Rust có nhanh hơn không, hay tối ưu ngay trên stack hiện tại (Node/TS + Electron + Vue)?

## Kết luận

**Không viết lại collector/desktop bằng Go/Rust.** Các điểm chậm đo được đều do **thuật toán và cách spawn process**, không do tốc độ V8:

1. Chậm nhất lúc boot là một bug O(n²) trong `ToolSpanLog.prune`: chiếm 34 % CPU boot. Throttle nó thì `/health` giảm từ **1.39 s xuống 0.76 s**, tức −46 % (đã đo).
2. Mỗi lần gọi PowerShell + CIM tốn khoảng **1.1 s wall và 1.5–1.8 CPU-s**. Lúc boot có một lần nằm trên critical path (khiến boot chậm thêm khoảng 1.6 s), sau đó chạy định kỳ 60 s. Bản C# đọc cùng dữ liệu chỉ mất **62 ms và 0.05 CPU-s** (đã đo).
3. Khi tải nặng, collector bị giới hạn bởi số syscall, vì mỗi lần sync nó stat lại *mọi* subagent. Chỉ cần bỏ qua subagent đã xong là CPU giảm từ **65 % xuống 45 %** (đã đo). Rust vẫn phải làm cùng số syscall đó.
4. Renderer có lúc treo tới **0.9 s** do shiki tokenize trên main thread. WASM bị CSP chặn (không có `wasm-unsafe-eval`) và cũng không giải quyết được việc treo. Cách sửa là chuyển sang Web Worker.

Nơi duy nhất native thật sự đáng làm là **truy vấn process table trên Windows**. Việc này không cần thêm toolchain Go/Rust: dùng FFI qua `koffi` (prebuilt giống `node-pty`) hoặc một exe C# nhỏ compile bằng `csc` có sẵn trong Windows (e2e đã dùng cách này).

## Số đo (máy chủ nhân, Windows 11, Node 24.13, Electron 44)

Collector chạy là bản `apps/desktop/stage/collector.cjs`, copy sang scratchpad, chạy `--dev` trên cổng 4391–4393 và trỏ vào data dir riêng. Không đụng tới app đang chạy.

| Kịch bản | Kết quả |
|---|---|
| Dữ liệu thật `~/.claude` (3.4 GB, 475 jsonl, 1 session live: main 27 MB + 41 subagent 173 MB), cache usage **trống** | `/health` 4.05 s, usage scan xong ở 12.1 s, CPU boot 11.5 s, RSS đỉnh **308 MB**, sau đó 68 MB |
| Như trên, cache usage **ấm** | `/health` **3.58 s**, CPU boot 1.4 s, RSS đỉnh 258 MB → 66 MB, steady 0.5 % CPU |
| Ấm, `CCM_VERIFY_PROCESSES=0` (không gọi PowerShell) | `/health` **1.96 s** → PowerShell cộng thêm ≈ 1.6 s vào critical path |
| Ấm, không verify, chạy dưới `-r` timer | 1.39 s (bản gốc) và **0.76 s** (prune throttle). Lặp lại 2 lần: 1.37/1.41 so với 0.75/0.77 |
| Demo thực tế: 6 session × 3 subagent, tick 1.2 s | `/health` 129 ms, CPU **2.7 %**, RSS 59→67 MB, 40 event/s, snapshot 17 KB |
| Demo nặng: 30 session × 6+ subagent (≈1 000 agent sau 60 s), tick 250 ms | CPU **64–70 %** 1 core, RSS 92→190 MB, 760–810 event/s, 150 KB/s WS, snapshot 145–171 KB |
| Nặng + prune throttle | 67.5 % (prune không ảnh hưởng steady state) |
| Nặng + bỏ tail subagent đã resolved (chỉ đọc lại 1/20 lần) | **44.7 %** |
| PowerShell `-NoProfile -Command 1` | 638 ms |
| PowerShell CIM lọc theo PID (`process.ts`) | 1 030–1 410 ms, **1.45–1.81 CPU-s** mỗi lần (TotalProcessorTime) |
| PowerShell CIM toàn bảng (`codex/processes.ts`, `pty/owners.ts`) | 1 083–1 332 ms |
| C# Toolhelp32 + GetProcessTimes, toàn bảng 300 proc (prototype trong scratchpad) | **57–65 ms, 0.03–0.06 CPU-s** |
| `git diff --shortstat` + `ls-files --others` (repo này) | 113 ms; `git status --porcelain=v2` 50 ms |
| Parse JSONL 185 MB (35 524 dòng, dòng dài nhất 1.3 MB) | split+utf8: 218 ms (851 MB/s); `JSON.parse` mọi dòng: **467 ms (397 MB/s)**, RSS 85 MB |
| shiki (JS regex engine) tokenize TS trên main thread | 33 k ký tự 231 ms (lần đầu), 100 k 255 ms, **400 k (= `HIGHLIGHT_MAX_CHARS`) 925 ms** |
| `wordDiff` LCS ở giới hạn 250 k ô | 3.3 ms/block |
| Bundle web (`apps/web/dist`, build 14:09) | JS 5.9 MB / 76 file, CSS 0.16 MB, font 2.06 MB (tải theo nhu cầu). Entry `index-*.js` **934 KB** (305 KB gzip), compile V8 lazy ≈ **19 ms**. `WorkspaceView` 1.05 MB (xterm + webgl), `cpp` grammar 778 KB, `CodeEditor` 383 KB |
| layoutlib init (log thật `%APPDATA%/Agent Monitor/logs/layout.log`) | **3 235 / 3 469 / 5 302 ms** (chỉ initialize trong JVM, chưa tính lúc JVM boot) |

Profile CPU (`--cpu-prof`) lúc boot ấm: `prune` (tool-spans) chiếm 34.4 % self, `consume` (tailer, gồm cả `JSON.parse`) 20.1 %, idle 16.9 %. Profile khi tải nặng: main thread chỉ bận khoảng 21 % (syncTracker 5.7 %, publish 4.7 %, stat 4.7 %, readDiffStat/spawn git 1.7 %). Phần CPU còn lại của process (≈ 45 điểm %) nằm ở libuv threadpool (stat/open/read/close) và GC.

## Phát hiện, xếp theo tác động

### 1. `ToolSpanLog.prune` chạy cho từng bản ghi transcript, O(records × spans) — boot −46 %
- `apps/collector/src/tool-spans.ts:16-33`: `apply()` gọi `this.prune()` ở cuối **mỗi lần gọi**. `tracker.ts:237,248,256` gọi `trackSpans` cho **từng dòng** JSONL, cả trong catch-up.
- `tool-spans.ts:64` `prune()` duyệt toàn bộ map (tối đa `SPAN_LIMIT` 2000) và chạy `Date.parse(span.end)` cho từng span. Với 35 k dòng × ~2 000 span thì có hàng chục triệu lần `Date.parse`.
- Đo được: 34 % CPU boot. Throttle (chỉ prune khi size > limit hoặc khi đã qua 1 s) cho 1.39 s → 0.76 s.
- Sửa: prune một lần sau mỗi `syncOnce` hoặc mỗi lần `list()`, và lưu `endMs` dạng số. Khoảng 1 giờ làm.

### 2. PowerShell + WMI cho mọi truy vấn process — đắt nhất cả lúc boot lẫn steady state trên Windows
- `collector/src/process.ts:40-50,120-136`: `queryProcesses` spawn `powershell.exe … Get-CimInstance`. Được gọi từ `monitor.ts:379` (`verifyNew`, **chạy trước khi server listen**: `monitor.ts:139` → `index.ts:92-94`) và `monitor.ts:143/399` (`verifyLive` mỗi 60 s khi có session live).
- `codex/processes.ts:103-104`: enumerate **toàn bộ** Win32_Process. Gọi từ `codex/monitor.ts:145` mỗi 60 s khi có thread Codex live, và mỗi rollout mới (`SCAN_DEBOUNCE_MS` 300).
- `desktop/src/pty/owners.ts:34-37`: cũng là CIM toàn bảng (khi web hỏi `owners`, `useWorkspaceLinks.ts:40`, retry 10 s khi lỗi). Ngoài ra còn `toast.ts:88` (mỗi toast show/hide), `focus.ts:95`, `folder-pick.ts:120` và Android Stop dùng CIM process table.
- Chi phí: 1.0–1.4 s wall và 1.5–1.8 CPU-s mỗi lần. Với 1–2 spawn/phút ở steady state là **2.5–6 % một core trung bình**. Con số này **lớn hơn cả collector** (0.4–3.8 % đo được) và không hiện trong RSS/CPU của collector vì nằm ở child process.
- Boot: `verifyNew` cộng thêm ≈ 1.6 s vào thời gian `/health`. `toaster.refreshHealth()` (`index.ts:85`) spawn thêm một PowerShell song song lúc boot.
- Prototype C# (Toolhelp32Snapshot + GetProcessTimes, cùng dữ liệu pid/ppid/creation FILETIME) cho 62 ms và 0.05 CPU-s, nhanh hơn khoảng 17× về wall và 30× về CPU.

### 3. `/health` (và cả UI) chờ toàn bộ catch-up của mọi session live
- `index.ts:92-94`: `await monitor.start()` (gồm `reconcile(true)`, `verifyNew` và `tracker.sync(true)` đọc **toàn bộ** transcript main + mọi subagent), rồi `await codex.start()`, rồi mới `startServer`. `desktop/src/main.ts:477-486`: dashboard chỉ load sau `host.start()` (chờ `/health`).
- Session đang live của chủ nhân có 200 MB transcript. Parse riêng phần này mất ≈ 0.5 s, RSS boot lên 230–310 MB. Năm session lớn sẽ thành 2–3 s, cộng thêm PowerShell.
- Hiện intro `INTRO_MS` 2 300 ms + `LEAVE_MS` 280 (`pages.ts:6-8`) che được boot ≤ 2.3 s. Đo ấm ra 3.58 s, tức người dùng chờ thêm khoảng 1.3 s. Với dữ liệu lớn hơn sẽ lộ rõ hơn.
- Sửa: listen trước (snapshot rỗng hoặc từng phần; tracker mới tự phát `terminal.created`), không await `verifyNew`/codex trên critical path. Với subagent đã xong (meta + notification trong main), chỉ đọc **tail** như `codex/reader.ts` (`RolloutTailer` bắt đầu từ 8 MB cuối).

### 4. Sync đọc lại mọi subagent mỗi lần có thay đổi (tải nặng → giới hạn bởi syscall)
- `monitor.ts:763-777` `routeProjectChange` đã biết **file nào** đổi nhưng lại bỏ thông tin đó và gọi `syncTracker` cho cả session. `tracker.ts:230-241` `syncOnce` thì `readdir(subagents)` rồi `tailer.read()` (stat + open) cho **mọi** subagent, kể cả đã xong.
- `monitor.ts:337-344`: reconcile mỗi 5 s cũng sync mọi tracker live.
- Dữ liệu thật: tối đa 57 subagent/session, trung bình 11.6. Demo nặng: 64–70 % CPU, phần lớn ngoài main thread (fs threadpool). Bỏ tail subagent resolved cho ra 44.7 %.
- Sửa: chuyển đường dẫn file đổi xuống tracker và chỉ tail file đó; reconcile chỉ đọc subagent chưa resolved. Rust **không** giúp gì ở đây vì vẫn phải làm cùng số syscall.

### 5. Main thread renderer: shiki tokenize đồng bộ tới 400 k ký tự
- `web/src/lib/highlight.ts:49` `HIGHLIGHT_MAX_CHARS = 400_000`. `tokenize` chạy `codeToTokensBase` trên main thread. Gọi từ `FilePane.vue:286` và `useDiffDecor.ts:35` (hai lần song song, cho bên cũ và bên mới).
- Đo được 925 ms cho 400 k ký tự, khoảng 230 ms cho file 33 k ký tự bình thường ở lần đầu. Trong khoảng đó UI đứng hẳn (cả xterm).
- `FilePane.vue:231` dựng HTML cho **mọi dòng** rồi đưa vào `v-html` (không virtualize). `DiffView.vue:233` và `SplitDiff.vue:272,296` làm tương tự. `LogTable` và `ExplorerTree` thì đã virtualize.
- Sửa: chạy shiki trong Web Worker. CSP `script-src 'self'` vẫn cho phép worker cùng origin, Vite `?worker` xuất file tĩnh, engine JS không cần WASM. Render code/diff lớn theo cửa sổ (hoặc dùng CodeMirror read-only, vốn đã virtualize). `wordDiff` (3.3 ms/block ở giới hạn) có thể chuyển vào cùng worker.

### 6. Changes pane chạy git ngay cả khi pane ẩn; watcher không bỏ qua thư mục build
- `desktop/src/preview/watch.ts:8` chỉ bỏ qua `node_modules` và `.git`. `build/`, `.gradle/`, `.dart_tool/`, `dist/`, `.vitest/` đều kích hoạt `ccm:changes-updated` (`preview/ipc.ts:164-166`).
- `ChangesPane.vue:238-240` gọi `scheduleRefresh` mà không xét `props.active`. Mỗi lần refresh là `git status --porcelain=v2 --untracked-files=all` + `git diff --numstat` (`preview/changes.ts:251,259`), khoảng 50–150 ms mỗi lệnh. Debounce trailing 150 + 250 ms nên khi build chạy liên tục thì gần như im lặng, nhưng mỗi đợt ghi file lại tạo một đợt git.
- Sửa: bỏ qua các thư mục build thường gặp (hoặc lọc theo `.gitignore` trước khi notify), refresh khi pane hiện lại thay vì lúc đang ẩn.

### 7. Collector broadcast: không gộp patch, stringify theo từng client
- `store.ts:333-336` đẩy mọi event vào batch 50 ms nhưng **không gộp** `agent.updated`/`terminal.updated` cùng id. Demo nặng: 19 103 `agent.updated` và 7 328 `terminal.updated` trong 60 s.
- `server.ts:275,358` gọi `JSON.stringify(message)` **cho từng client** (thường là main + compact window).
- Sửa: gộp patch theo id trong `pending`, stringify một lần. Ít việc, giảm số event phía web từ 30 % đến hơn 50 % khi tải nặng.

### 8. Đồng hồ 1 s toàn cục và `Intl.RelativeTimeFormat` tạo mới mỗi lần gọi
- `web/src/lib/format.ts:9` cập nhật `now` mỗi giây, khiến khoảng 21 component phụ thuộc re-render, kể cả khi cửa sổ ẩn ở tray (timer chỉ bị throttle chứ không dừng). `relativeTime` tạo `new Intl.RelativeTimeFormat` cho từng lần gọi.
- Sửa: dừng clock khi `document.visibilityState === 'hidden'` và cache formatter theo locale. Đây là việc nhỏ nhưng chạy suốt.

### 9. layoutlib daemon: 3.2–5.3 s mỗi lần khởi động JVM lạnh, chưa dùng CDS
- `desktop/src/layout/daemon.ts:65-78`: `-Xmx1g …` mà không có `-XX:SharedArchiveFile`. Phần tốt đã có sẵn: start lười, `ccm:layout-warmup` khi mở layout (`layout/ipc.ts:317-319`), idle shutdown 10 phút (`daemon.ts:341`).
- AppCDS (JDK ≥ 19: `-XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=<cacheDir>/daemon-<jdk>-<layoutlib>.jsa`) thường cắt **20–40 %** phần nạp class. Đây là ước tính, chưa đo, vì không chạy gradle hay daemon trong lúc agent khác đang build. Phần init resource/font của layoutlib không đổi. Có thể đo bằng log `initialized layoutlib … in N ms` đã có sẵn.
- Không thể thay bằng Go/Rust: layoutlib là Java.

### 10. Những phần đã ổn (không nên đụng)
- pty host (`desktop/src/pty/host.ts:31-35,90-109`): batch 8 ms, backpressure pause/resume ở 512 KB / 128 KB, ring 256 K ký tự. WebGL chỉ bật cho pane đang hiện (`TermPane.vue:214-227`).
- UsageIndex (`usage.ts:360`): lọc trước bằng `indexOf('"usage"')`, cache offset, sweep 10 phút với stat theo lô 32. Scan lạnh 3.4 GB mất khoảng 8 s CPU một lần duy nhất (RSS đỉnh 308 MB).
- Agent Map (`AgentMap.vue:91-128`): `addNodes`/`updateNode`/`removeNodes` theo kiểu incremental. Store Pinia patch thẳng vào reactive. Activity ring 1 000.
- Bundle: entry compile khoảng 19 ms, shiki grammar / CodeMirror lang / lottie / Workspace / Extensions đều là chunk lazy. Tách Vue Flow khỏi entry chỉ lợi vài ms, ưu tiên thấp.
- gitstat collector (`gitstat.ts`, `monitor.ts:635-657`) theo sự kiện (status rời `busy`), debounce, `GIT_OPTIONAL_LOCKS=0`.

## Bộ nhớ (process khi chạy đầy đủ)

App không chạy lúc audit nên các con số Electron là **ước tính**. Collector thì đã đo.

| Process | Số lượng | RSS |
|---|---|---|
| Electron main, GPU, network utility | 3 | ước tính 80–150 MB mỗi cái (Chromium) |
| Renderer main window (+ compact window, + mỗi `<webview>` BrowserPane) | 1–n | ước tính 200–400 MB cho main window khi có nhiều xterm/CodeMirror |
| Collector utilityProcess | 1 | **đo được 65–69 MB steady; đỉnh boot 230–310 MB** (catch-up hoặc scan lạnh); 190 MB khi có khoảng 1 000 agent |
| pty host utilityProcess + mỗi terminal (conpty/OpenConsole + shell + agent) | 1 + 3×n | phần agent là của người dùng |
| layoutlib JVM | 0–1 | `-Xmx1g`; các Gradle JVM trên máy này đang ở 830–880 MB để tham khảo; tự tắt sau 10 phút idle |
| flutter daemon / `flutter run` / adb | 0–n | chỉ khi dùng Run/Preview; `releaseDevicesIfIdle` đã có |
| PowerShell tạm thời | 1–2/phút | khoảng 60–80 MB mỗi lần, sống khoảng 1 s |

Viết lại collector bằng Go sẽ cắt khoảng 40 MB RSS (từ 66 MB xuống khoảng 20 MB) trong một app mà Chromium đã chiếm 500 MB trở lên. Không đáng.

## Go/Rust theo từng thành phần

| Thành phần | Go/Rust có lợi không | Ước tính lợi | Chi phí / rủi ro | Phương án trong stack |
|---|---|---|---|---|
| **Process table Windows** | **Có**, đây là chỗ duy nhất | 1.1 s → khoảng 5–15 ms (exe Rust/Go); CPU 1.5 s → < 0.05 s | Toolchain thứ hai, cross-compile win x64 (+arm64), ký code / Defender với exe mới, macOS vẫn dùng `ps` (đã nhanh) | **`koffi` FFI** (prebuilt npm, chạy in-process khoảng 1–3 ms, cùng mô hình native với `node-pty`) hoặc **exe C# compile bằng `csc` có sẵn** (đo 62 ms, không cần cài toolchain, e2e đã dùng). Phương án tối thiểu: giữ một PowerShell sống lâu, đọc lệnh qua stdin (bỏ được 640 ms khởi động, WMI vẫn khoảng 400 ms, tốn 60–80 MB thường trú) |
| Parse JSONL (tracker/usage) | Nhỏ | serde/simd-json khoảng 3–5× so với 400 MB/s. Boot 200 MB: 0.5 s → khoảng 0.15 s | Sidecar + IPC truyền signal, tách logic khỏi các test TS | Sửa prune (#1), tail-only cho subagent đã xong (#3), một reader dùng chung cho Usage + tracker. Tổng cộng lợi hơn Rust |
| File watching | Không | 0 | — | `fs.watch` đã gọi native ReadDirectoryChangesW/FSEvents; vấn đề nằm ở xử lý sau sự kiện (#4) |
| Diff engine | Không | — | WASM bị CSP chặn (không có `wasm-unsafe-eval`) | Diff đã do `git` tính. LCS từ chỉ 3.3 ms/block → Worker nếu cần |
| Highlight (shiki) | Không | — | Oniguruma WASM bị CSP chặn | Web Worker (#5) |
| PTY | Không | — | node-pty đã native (ConPTY) | Host đã batch + backpressure; chi phí thật là xterm parse trong renderer |
| Collector toàn bộ | Không | khoảng 40 MB RSS, CPU steady vốn đã 0.4–3.8 % | Mất type/protocol dùng chung `packages/shared`, mất toàn bộ test vitest, phải build 4 target | — |
| layoutlib daemon | **Không thể** (layoutlib là Java) | — | — | AppCDS, giữ JVM ấm (đã có), warm-up khi mở layout (đã có) |
| Electron → Tauri/Rust | Không trong phạm vi | RAM shell | Viết lại toàn bộ; xterm/CodeMirror vẫn chạy trong WebView2/WKWebView | — |

## Việc cần làm (theo ưu tiên)

### Làm nhanh (≤ 1 ngày mỗi việc)
1. **Prune tool-spans một lần mỗi sync**, lưu `endMs` dạng số (`tool-spans.ts:33,47,64`). Lợi: boot `/health` −46 % (đo được). **1–2 h**
2. **Đưa PowerShell ra khỏi critical path lúc boot**: `startServer` trước `monitor.start()`, chạy `verifyNew`/`codex.start()` sau khi đã listen; tracker được duyệt sau sẽ phát `terminal.created`. Lợi: khoảng 1.6 s, đủ để boot ấm lọt hẳn vào thời gian intro 2.3 s. **0.5–1 ngày** (cần test `monitor.test.ts` và thứ tự snapshot)
3. **Gộp patch theo id trong `store.pending` + stringify một lần** (`store.ts:333`, `server.ts:275,358`). **2–3 h**
4. **Changes pane**: không refresh khi `!props.active` (đánh dấu stale, refresh khi pane hiện lại); `RootWatcher` bỏ qua `build`, `.gradle`, `.dart_tool`, `dist`, `.vitest`. **2–4 h**
5. **Clock 1 s**: dừng khi document hidden, cache `Intl.RelativeTimeFormat`. **1 h**
6. **AppCDS cho daemon**: thêm `-XX:+AutoCreateSharedArchive -XX:SharedArchiveFile=…` khi JDK ≥ 19 (đọc `release`), so sánh qua log `initialized … in N ms`. Ước tính −20–40 % phần class-load. **0.5 ngày** + đo

### Mức trung bình (2–5 ngày mỗi việc)
7. **Truy vấn process native trên Windows** dùng chung cho `process.ts`, `codex/processes.ts`, `pty/owners.ts` và Android stop. Thứ tự đề xuất: `koffi` (Toolhelp32 + OpenProcess/GetProcessTimes; dòng lệnh Codex cần NtQueryInformationProcess, hoặc giữ CIM chỉ cho `CommandLine` khi có `codex.exe`) → exe C# → exe Rust. Lợi: 1.1 s → 1–60 ms mỗi lần, khoảng 1.5 CPU-s mỗi phút còn ≈ 0. **2–4 ngày** (kể cả fallback PowerShell + test parity với `parseProcessQueryOutput`)
8. **Sync có mục tiêu**: `routeProjectChange` chuyển file xuống `tracker.sync({ files })`, chỉ tail đúng file đó; reconcile bỏ qua subagent đã resolved. Lợi: tải nặng −30 % CPU (đo được với bản thô), giảm hẳn số syscall. **2–3 ngày**
9. **Catch-up chỉ đọc tail** cho subagent đã xong (status lấy từ main transcript + meta) và cho main transcript quá lớn (giữ link/notification bằng cách quét từ khóa trước khi `JSON.parse`). Lợi: boot 200 MB → vài MB, RSS đỉnh 300 MB → khoảng 100 MB. **3–5 ngày** (rủi ro về độ đúng của status/spans, phải mở rộng `tracker.test.ts`)
10. **shiki + wordDiff trong Web Worker**; FilePane/DiffView/SplitDiff render theo cửa sổ khi file trên khoảng 3 000 dòng. Lợi: hết các lần treo 0.2–0.9 s. **3–5 ngày**
11. **Toast Windows**: giữ một PowerShell host thường trú cho toast (vẫn dùng AUMID powershell.exe như docs §11i yêu cầu cho bản portable), hoặc dùng Electron `Notification({ toastXml })` cho bản cài đặt. **2–3 ngày**

### Lớn (chỉ làm khi số đo sau các bước trên vẫn chưa đủ)
12. Một reader JSONL dùng chung cho `UsageIndex` và `SessionTracker` (hiện mỗi byte được parse hai lần: `usage.ts:343-356` và `tailer.ts`). **1–2 tuần**
13. Sidecar Rust (process + tail JSONL + signals qua stdout NDJSON). **Không khuyến nghị**, chỉ cân nhắc lại nếu sau bước 1–9 collector vẫn trên 10 % CPU ở tải thực tế. **2–3 tuần**, cộng chi phí CI 4 target và ký code

## Giới hạn của audit
- App desktop không chạy nên không đo được RSS của renderer/GPU/main Electron, số xterm thực tế, hay thời gian từ ready-to-show tới first snapshot trong Electron. Thời gian `/health` đo bằng Node 24 thuần, tương đương Electron utilityProcess.
- Không chạy gradle / layout daemon / `npm run build -w @ccm/desktop` (agent khác đang build). Bundle stats đọc từ `apps/web/dist` mới build lúc 14:09.
- Demo nặng (30 session, tick 250 ms) cực đoan hơn thực tế. Kịch bản thực tế (6×3, tick 1.2 s) chỉ tốn 2.7 % CPU.
- Script đo nằm trong scratchpad của session (`harness.mjs`, `tailbench.mjs`, `shikibench.mjs`, `profsum.mjs`, `cs/procq.cs`). Không có thay đổi nào trong code app.
