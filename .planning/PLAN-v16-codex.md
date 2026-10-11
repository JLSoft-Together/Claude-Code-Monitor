# PLAN v16 — Monitor Codex CLI (gọi từ Claude Code + chạy riêng)

Yêu cầu (2026-10-11): ngoài Claude Code, monitor cả Codex CLI — chủ nhân hay gọi `codex exec` từ Claude Code (Bash tool, cả trong subagent) và có plugin `codex@openai-codex` (app-server).

## Discovery (Codex 0.162.0, máy này) → chi tiết `docs/codex-integration.md`
- `$CODEX_HOME` (mặc định `~/.codex`) `sessions/YYYY/MM/DD/rollout-<giờ local>-<threadId>.jsonl`: 1 file / thread, JSONL append `{timestamp, ordinal?, type, payload}`.
  - `session_meta` (dòng 1): id, timestamp (lúc tạo thread), cwd, originator (`codex_exec` | `codex-tui` | `Codex Desktop` | `Claude Code` = plugin), source (`exec` | `cli` | `vscode` | object khi là subagent), cli_version.
  - `turn_context`: model, effort, approval_policy, sandbox_policy.type.
  - `event_msg`: `task_started` (model_context_window), `task_complete`, `token_count` (total/last usage cộng dồn theo thread + `rate_limits` primary 300 phút / secondary 10080 phút, `used_percent`, `resets_at` epoch s).
  - `response_item` `function_call`/`custom_tool_call` (call_id, name) + `*_output` (call_id) → tool đang chạy.
- `session_index.jsonl` {id, thread_name}: tên thread (TUI tự đặt).
- Process: `codex.exe` (npm vendor binary). Từ Claude: claude.exe → bash.exe → node.exe (codex.js) → codex.exe.
- File rollout rất lớn: tới 1.5 GB, tổng 3.1 GB, 1 dòng có thể vài MB (ảnh base64) → chỉ đọc head + đuôi ≤ 8 MB, lọc dòng theo 256 byte đầu trước khi parse.
- Không dùng: sqlite (`state_5`, `logs_2` — node:sqlite experimental, schema riêng; exec không ghi log db), `auth.json`, `config.toml`.

## Giới hạn (ghi vào docs)
- Rollout không lưu approval request → Codex không bao giờ `waiting`; tool chờ duyệt hiện như đang chạy.
- Không có registry → ghép pid ↔ thread theo giờ start process vs `session_meta.timestamp` (−2 s … +120 s) hoặc `resume <id>` trên command line (chỉ parse subcommand trong bộ nhớ, không lưu/gửi).
- Bỏ qua thread Codex Desktop / IDE (originator `Codex Desktop`).
- Tên: `thread_name` hoặc basename cwd; không bao giờ dùng prompt đầu.
- Token theo quy ước Claude: input = input − cached, cacheRead = cached, total = input + output.

## Mô hình
- shared: `Provider = 'claude' | 'codex'`; `TerminalSession.provider?`, `codexSessionId?`, `codexVersion?`; `Agent.provider?`; snapshot `codexLimits?: PlanLimits` + event `codexLimits.updated`.
- Thread Codex do Claude gọi (ancestor process = pid Claude terminal; hoặc originator `Claude Code` + cùng cwd) → `Agent` trong terminal Claude: id `codex:<threadId>`, parent = agent Claude có tool Bash/PowerShell nhắc `codex` gần nhất trước lúc thread tạo (≤ 120 s), không có → main.
- Thread chạy riêng (TUI/exec ở terminal khác) → `TerminalSession` id `codex:<threadId>` + main agent.
- Subagent Codex (source object có `parent_thread_id`) → con của thread cha (parse chịu lỗi, chưa có mẫu trên máy).
- Trạng thái: turn mở → working; `task_complete` → agent completed / terminal idle; process chết khi turn mở → cancelled; không ghép được process → hết hạn sau 15 phút im.
- Startup chỉ lấy thread đang có turn mở hoặc process còn sống (không dựng lại lịch sử exec đã xong).
- Giới hạn: ≤ 20 agent Codex đã xong / terminal Claude.

## Collector
- `codex/rollout.ts`: phân loại dòng theo head, `extractCodexSignals`, `CodexThreadState`.
- `codex/reader.ts`: `readSessionMeta` (head), `RolloutTailer` (offset, chunk, bỏ dòng skip không buffer, bắt đầu từ đuôi).
- `codex/processes.ts`: `listCodexProcesses` (win 1 lệnh PowerShell CIM; mac/linux `ps`) → pid, start, mode, resumeId, ancestors.
- `codex/monitor.ts` `CodexMonitor`: watch `sessions/` recursive + `session_index.jsonl`, scan ngày hôm nay/hôm qua lúc start, ghép process, link Claude (`ClaudeLinks` do Monitor cung cấp), publish vào store, limits Codex (`LimitHistory` file `codex-limit-history.json`).
- `transcript.ts`: `tool_use.codex` (Bash/PowerShell có chữ codex) → `TranscriptState.codexCalls`; tracker `codexCalls()`.
- `monitor.ts`: publish không xóa agent codex; recordOf bỏ agent codex; focus/open/dismiss ủy quyền cho codex với id `codex:`.
- config: `codexHome` (CODEX_HOME), `CCM_CODEX=0` tắt. Diagnostics thêm `codex`.

## Web
- Badge "Codex" (icon + chữ) trên AgentNode / SessionCard / tab; model chip hiện id GPT.
- Ẩn action chỉ dành cho Claude trên session Codex (sao, đổi tên, ghi chú); giữ focus cửa sổ + mở thư mục.
- PlanLimits: chip Codex 5h / tuần khi có dữ liệu.
- i18n en/vi.

## Ngoài phạm vi v1
Usage tab cho Codex (chưa có giá GPT tin cậy), thread Codex Desktop, alias/note/favorite cho session Codex, phát hiện chờ duyệt (cần hook Codex opt-in).

## Tiến độ
- [x] shared types
- [x] collector codex/*
- [x] Monitor/transcript tích hợp
- [x] web
- [x] tests (collector 126, web 40), docs, code index
- [x] E2E bằng `codex.exe` giả (node.exe đổi tên) từ Bash của Claude: link đúng session + main agent; qua `timeout` (chuỗi cha đứt) vẫn link nhờ fallback; bị kill → cancelled; startup bỏ run đã chết.

## Phát sinh khi làm
- MSYS (`timeout`, subshell) "exec" bằng process mới rồi thoát → chuỗi cha đứt → thêm `orphan` (đứt ngay trên shell/runtime) + fallback theo lệnh Bash nhắc `codex` gần nhất trong transcript Claude.
- Startup: exec/TUI không ghép được process sau scan thành công = đã thoát → bỏ.
