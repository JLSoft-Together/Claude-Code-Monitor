# PLAN v81 — DeepSeek CLI (Codewhale) trong Workspace + quy trình giao việc

Ngày: 2026-11-03. Chủ nhân chốt: CLI DeepSeek **riêng** (không phải claude + API DeepSeek), port skill / rule /
workflow từ Claude sang; hand-back **tự gửi** vào pane gốc. Mục đích DeepSeek: code phụ, sinh test, chạy
`clone-app-re`.

## CLI chọn: Codewhale (ex DeepSeek-TUI, Hmbown, MIT)

- Cài: `winget install HunterBown.CodeWhale` | `npm i -g codewhale` | `curl -fsSL https://codewhale.net/install.sh | sh`.
  Binary `codewhale` (alias `codew`). Key DeepSeek nhập trong app (`/provider`), không qua env.
- MCP: `~/.codewhale/mcp.json` hoặc env `DEEPSEEK_MCP_CONFIG`; server HTTP `{ url, bearer_token_env_var }` → khớp
  cách cấp token per-pane `ORRERY_TOKEN` hiện có.
- Skill: đọc `~/.claude/skills`, `~/.agents/skills`, project `.claude/skills` (read-only) → skill Claude dùng được
  ngay (`/skill clone-app-re`). Frontmatter `allowed-tools`/`model` chỉ warning.
- Rule: tự đọc `AGENTS.md`; `CLAUDE.md` khi `project_instruction_imports = ["claude"]` trong config user.
- Headless: `codewhale exec "<prompt>" --auto [--output-format stream-json]`; resume `--resume <id-prefix>`
  (DeepSeek-TUI), session ở `~/.codewhale|~/.deepseek/sessions` — **phải kiểm trên bản cài** (bước 0).
- Phương án dự phòng: DeepSeek Harness `dsh` (chính chủ, developer preview, Web UI) — chưa dùng.

## Bước

0. **Discovery** (bắt buộc trước code, theo luật repo): cài Codewhale, ghi `docs/deepseek-integration.md`:
   version, cờ CLI thật (`--help`), vị trí + format session (id, cwd, trạng thái), mcp.json, config TOML,
   skill có thấy `clone-app-re` không, env nào cần strip trong `childEnv`.
1. **Preset `deepseek`**: `packages/shared/src/pty.ts` `PTY_PRESETS` += `deepseek`; `presets.ts` `agentCommand`
   → `codewhale` (+ `--resume <id>` nếu bước 0 xác nhận). MCP: supervisor ghi `<dataDir>/orrery-mcp-deepseek.json`
   (url literal theo port host, `bearer_token_env_var: ORRERY_TOKEN`), pane đặt `DEEPSEEK_MCP_CONFIG`.
   Web: menu New pane / rail icon / i18n `en`+`vi`. Thiếu binary → pane báo "chưa cài" + nút cài.
2. **open_session**: enum `agent` += `deepseek`, `LABELS`, mô tả tool nêu khi nào nên giao DeepSeek.
3. **Cài đặt trong app** (Settings → Agents hoặc Extensions): phát hiện `codewhale`, nút Cài (winget / npm,
   native confirm), nút "Đồng bộ rule": ghi `~/.codewhale/config.toml` `project_instruction_imports=["claude"]`
   (backup + chỉ thêm key, giống `writeStatusLine`), không đụng key API.
4. **Giao việc** (Claude/Codex → DeepSeek): `open_session({agent:'deepseek', prompt, cwd})`. Khác claude:
   prompt **tự gửi** cho deepseek? → KHÔNG, giữ prefill (v49). Chỉ hand-back tự gửi (chủ nhân chốt).
   Pane mới nhớ `origin` = pane gọi (ticket mang `from`).
5. **Hand-back tool `hand_back`** (MCP, chỉ pane có `origin`): DeepSeek ghi báo cáo
   `.planning/handoff/DS-<yyyymmdd-hhmm>-<slug>.md` (mẫu: việc đã làm, file sửa, test chạy + kết quả, việc còn
   lại), gọi `hand_back({report})` → host kiểm path trong root, chờ pane gốc **idle** (collector status
   `idle`/`waiting`, timeout 30 phút, hủy nếu pane gốc đóng) → gõ + Enter `Đọc bàn giao từ DeepSeek:
   <path> rồi review / tích hợp.` vào pane gốc + toast. Rate 1 lần / 2 phút / pane. Ngoại lệ thứ 2 của
   "không tự gửi prompt" → ghi docs §11 + CLAUDE.md.
6. **Monitor** (tuỳ bước 0): nếu session Codewhale có file đọc được → collector `deepseek/` hiển thị dưới agent
   gọi nó như Codex (WP v16). Không có → chỉ hiện pane trong Workspace.
7. **Skill + workflow**:
   - Skill global `~/.claude/skills/deepseek-delegate/SKILL.md` (cho Claude/Codex): khi nào giao (code phụ, sinh
     test, clone-app-re bước RE/spec), mẫu prompt giao việc (mục tiêu, file được sửa, lệnh test, tiêu chí xong,
     "khi xong gọi hand_back"), cách review bàn giao.
   - Skill `~/.agents/skills/handoff-to-origin/SKILL.md` (cho DeepSeek): quy trình làm → test → ghi báo cáo →
     `hand_back`. Luật chung (không commit/push, ít comment, không build verify trừ khi giao) vào `AGENTS.md` global
     của Codewhale.
8. Test: unit `presets` (lệnh deepseek win/posix), `mcp.test` (enum, hand_back gate), hand-back queue (idle,
   timeout, pane đóng); E2E `v81-deepseek.cjs` với binary giả. Index + docs + What's new.

## Đã chốt (2026-11-03, sau discovery 0.10.2 — `docs/deepseek-integration.md`)

- Giao việc: prompt **prefill** (chủ nhân Enter). Hand-back: **tự gửi** khi pane gốc idle.
- Codewhale đã cài trên máy dev (`npm i -g codewhale`), `~/.codewhale/config.toml` đã có
  `project_instruction_imports = ["claude"]`.
- Cài đặt trong app cho máy chưa có: Settings → DeepSeek: trạng thái (binary + version, key đã có chưa),
  nút **Cài** (Windows: winget, fallback npm; macOS: npm, fallback script — native confirm hiện đúng lệnh; npm
  xong chạy `codewhale --version` để tải binary 128 MB, có progress), ô **API key** → `codewhale auth set
  --provider deepseek --api-key-stdin` (key không lưu ở Orrery, không log), nút **Đăng xuất** (`auth clear`),
  checkbox tắt telemetry (`config set telemetry false`).
- `DEEPSEEK_MCP_CONFIG` thay hẳn `~/.codewhale/mcp.json` → file per-pane = server của user + `orrery`.
- "Đồng bộ từ Claude" (native confirm liệt kê thay đổi, backup trước khi ghi):
  1. `~/.codewhale/AGENTS.md`: khối Orrery (quy trình giao/bàn giao) + nội dung `~/.claude/CLAUDE.md` (inline
     `@file`), giữa marker `<!-- orrery:begin/end -->`, phần user tự viết ngoài marker giữ nguyên.
  2. `config.toml`: `project_instruction_imports = ["claude"]`, `[lifecycle_outbox] path` (bước 6).
  3. `~/.codewhale/mcp.json`: thêm server stdio/http từ Claude (`~/.claude.json` `mcpServers`, user scope) chưa có
     (vd `rea` cho clone-app-re); không ghi đè server cùng tên.
  4. Skill: Codewhale đọc sẵn `~/.claude/skills` → không copy. Ghi thêm `~/.codewhale/skills/orrery-handoff`
     (cho DeepSeek) và `~/.claude/skills/orrery-delegate` + `~/.codex/skills/orrery-delegate` (cho Claude/Codex).
- Template nằm trong code (`apps/desktop/src/deepseek/templates.ts`), không chứa rule riêng của chủ nhân.

## Trạng thái (2026-11-03)

- Xong: bước 0–5, 7, 8 (unit). WP-A desktop preset + MCP file + `hand_back`; WP-B web preset + handler;
  WP-C Settings → DeepSeek (cài / login / telemetry / đồng bộ); WP-D checklist lần đầu, launch gate (owner → mở
  Settings; agent → toast + lỗi `setup`), sync `never|current|stale` (fingerprint `deepseek-sync.json`,
  `TEMPLATES_VERSION`), kiểm tra + cập nhật CLI theo đường cài (npm / winget / standalone).
- Còn: bước 6 (Monitor đọc `lifecycle_outbox`), E2E riêng `v81-deepseek.cjs`, token màu `agent-deepseek`,
  timeout cho hand-back đang chờ origin idle, kiểm `-r <id>` với id session thật của Codewhale.

## Tạm dừng (2026-11-03, chủ nhân)

Bản phát hành không gọi DeepSeek ở đâu cả: cả tính năng tắt mặc định sau một cờ `CCM_DEEPSEEK_FEATURE=1` (main + PTY
host). Tắt thì: không `deepseek` trong `open_session`, không `hand_back`, PTY host từ chối spawn pane `deepseek` (kể cả
khôi phục layout), main không đăng ký IPC DeepSeek (không chạy `codewhale`), preload không cấp bridge → web ẩn mọi lựa
chọn DeepSeek + trang Settings, preset mặc định `deepseek` lùi về `claude`. Monitor (đọc file thụ động) giữ nguyên. Lưu ý: nút
đồng bộ vẫn ghi skill `orrery-delegate` (chỉ Claude/Codex mở DeepSeek qua MCP) — gọi lúc đang dừng sẽ bị từ chối.
