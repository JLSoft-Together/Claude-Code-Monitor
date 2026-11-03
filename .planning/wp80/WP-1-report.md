# WP-1 report — MCP registry + notify_owner, open_in_workspace, who_is_editing

## Đã đổi
- **Registry**: `apps/desktop/src/pty/mcpTools/` mới — `types.ts` (ToolHost, ToolDef, McpTool), `paths.ts` (`resolveInside`, `mtimeOf`), `openSession.ts` (chuyển nguyên schema/texts/`openText`/`toOpenResult`), `notifyOwner.ts` (+ `NoteQueue`), `openInWorkspace.ts`, `whoIsEditing.ts`, `index.ts` (`MCP_TOOLS`, open_session đứng đầu). `pty/mcp.ts` chỉ còn JSON-RPC dispatch + `mcpGate`; `handleMcp(body, host: ToolHost, version)`.
- **IPC nối** (ghi rõ): host `parentPort {t:'mcp', call}` → `supervisor.relayMcp` → `opts.onMcp` = `main.pageMcp` → page `ccm:mcp-call` / `ccm:mcp-reply` (5 s, `isAppFrame`) → host `{t:'mcp-reply'}` → `parseMcpPageResult`. notify: main post `agent.note` cho collector (`host.post`) → `Toaster.observeNote` (toast + phone). Preload `onMcpCall` (1 handler, cái cuối thắng).
- **host.ts**: Session thêm `rates`, `notes`; `toolHost(s)`, `askPageMcp`, `noteFrom`; kill() dispose NoteQueue.
- **shared**: `packages/shared/src/mcpCall.ts` mới (types, `cleanNoteText`, `parseMcpPageResult`, `parseAgentNote`), export ở index; `phone.ts` thêm reason `note` + `text`.
- **collector**: `index.ts` parse `agent.note`; `toast.ts` `observeNote` + TEXT `noteTitle`/`noteMore` (en/vi), `hideFor` gồm `note:`.
- **desktop phone/send.ts**: TEXT `note` (en/vi).
- **web**: `composables/useMcpCalls.ts` (mới, `installMcpCalls()` gọi từ `WorkspaceView.vue`), `stores/workspace.ts` `showForAgent`, `lib/whoIsEditing.ts` (mới), `lib/inbox.ts` reason `note` + `InboxNote`, `stores/inbox.ts` `notes`/`addNote`, `InboxPanel.vue` hiện text note, `ChangesPane.vue` `typingElsewhere()` (không cướp focus), `lib/desktop.ts` type `onMcpCall`, `i18n/ui-v80-wp1.ts` (mới).
- **docs** §11w: đoạn "More tools (v80)" + ví dụ gọi PowerShell.
- `apps/desktop/src/strings.ts`: không cần chuỗi native mới (không có dialog).

## Tool + schema
- `notify_owner {text: string ≤200 (required), level?: 'info'|'attention'|'done' = info}` → Inbox (note mới nhất của session) + toast/phone: attention theo công tắc "needs you", done theo công tắc "done" (mặc định tắt → chỉ Inbox), + quiet hours + snooze; info chỉ Inbox. 6/phút/pane, dư gộp 1 note (text cuối, level gấp nhất, "+N").
- `open_in_workspace {path (required), line?: int ≥1, diff?: boolean}` → viewer nhảy dòng hoặc Changes chọn file, đặt cạnh pane gọi, không activate / không đổi view; reuse viewer/Changes đang mở. 20/phút/pane.
- `who_is_editing {path (required)}` → các pane Claude/Codex đang chạy có file trong changes (vs nhánh main) ở worktree khác cùng repo hoặc cùng folder (`sameCheckout`); tên (alias/tab/folder), agent, status, branch, root, lastActivityAt, mtime file. 20/phút/pane.
- `open_session`: schema + hành vi y nguyên (vẫn bỏ qua arg lạ như trước).

## Tiêu chí
- open_session không đổi: e2e v49-open 32/32 PASS.
- 3 tool mới chạy bằng HTTP request có token từ pane thật: e2e v80-mcp 23/23 PASS (`apps/desktop/e2e/v80-mcp.cjs`).
- Test bảo mật pass (vitest + e2e, mục dưới).

## Bảo mật đã kiểm
- Cùng gate + Bearer per-pane token; token sai / pane đã đóng → 401 (e2e).
- Path: `resolveInside` realpath trước khi so → `..`, absolute ngoài project, UNC/`//`, NUL/newline, folder, junction trỏ ra ngoài (test thật bằng junction), file thiếu (chỉ cho diff / who) đều bị chặn trước khi hỏi page.
- Không tool nào gửi/gõ prompt; reply của page được host parse lại (editor có agent lạ / field thừa bị bỏ, error lạ → failed); collector parse `agent.note` lần nữa.
- Note text: bỏ control + bidi override (chống giả tên người gửi trên toast), ≤200; phone qua `maskSecrets`; tên ra ngoài = alias/folder, không dùng auto title.
- who_is_editing: chỉ git status + mtime; host chỉ stat file cùng tên nằm trong root page đưa; không trả nội dung file / env.
- Rate limit mọi thứ hiển thị: notify 6/phút (gộp), view 20/phút, who 20/phút; phone còn giới hạn 20/giờ sẵn có.
- Focus: viewer/Changes đặt không activate; ChangesPane không focus list khi đang gõ ở xterm/input (e2e kiểm activeElement).

## Test số thật
- Vòng sửa: typecheck collector + desktop sạch; vitest collector toast 29/29, desktop mcp/mcp-tools/pty/phone 57/57.
- typecheck: desktop, web, collector, shared — sạch.
- vitest desktop 1072/1072 (mới: `test/mcp-tools.test.ts` 15, `test/mcp.test.ts` 11 cập nhật); web 1619/1619 (mới `src/lib/whoIsEditing.test.ts` 4); collector 373 pass / 0 fail (1 skip; thêm test `Toaster agent notes`).
- build web + desktop OK (có `.planning/wp/build.lock`, đã gỡ).
- e2e (CCM_E2E_DBG=9446 CCM_E2E_PORT=4397): v80-mcp 23/23, v49-open 32/32.

## Hot file cần thêm
- (main đã nối) `apps/web/src/i18n/en.ts`: `import uiV80Wp1 from './ui-v80-wp1'` + `...uiV80Wp1.en,`
- `apps/web/src/i18n/vi.ts`: `import uiV80Wp1 from './ui-v80-wp1'` + `...uiV80Wp1.vi,`
  (chưa nối thì dòng "+N tin nữa" trong Inbox hiện key `mcpNote.more`.)
- Đã tự sửa (ngoài brief nhưng cần): `WorkspaceView.vue` +2 dòng (`installMcpCalls()`), `ChangesPane.vue` (`typingElsewhere`), collector `index.ts`/`toast.ts`, shared `phone.ts`/`index.ts`.

## Index (1–3 dòng)
- desktop.md: `pty/mcpTools/*` registry (`MCP_TOOLS`, `ToolHost`, `resolveInside`, `NoteQueue`); relay `mcp`/`mcp-reply` (host/supervisor `relayMcp`/main `pageMcp`) + `ccm:mcp-call`.
- web.md: `composables/useMcpCalls.ts` `installMcpCalls` (WorkspaceView), `workspace.showForAgent`, `lib/whoIsEditing.ts`, Inbox reason `note` (`inbox.addNote`).
- protocol.md / collector.md: `shared/mcpCall.ts` (`AgentNoteMessage` main→collector, `McpPageCall/Result`), phone reason `note`; `Toaster.observeNote`.

## Changelog
- en: Agents in Workspace panes get three more Orrery tools: notify_owner leaves you a note in the Inbox (and a notification for attention / done), open_in_workspace shows you a file or its diff next to the agent without stealing focus, and who_is_editing tells an agent which other sessions changed the same file.
- vi: Agent trong pane Workspace có thêm ba công cụ Orrery: notify_owner để lại tin trong Hộp thư (kèm thông báo khi cần chủ nhân / đã xong), open_in_workspace mở file hoặc diff cạnh agent mà không cướp focus, who_is_editing cho agent biết session nào khác đang sửa cùng file.

## Ghi chú / mặc định đã chọn
- (Sửa sau nghiệm thu) `done` note theo công tắc toast "done" như main yêu cầu; `attention` theo "needs you".
- Inbox chỉ nhận note khi pane đã link monitor session (shell thuần → toast/phone vẫn đi, `inbox:false`).
- Codex: WP-2 nối `-c mcp_servers.orrery.*` + `bearer_token_env_var=ORRERY_TOKEN`; Codex gửi `Authorization: Bearer <token>` tới `127.0.0.1:<port>/mcp`, đúng dạng `mcpGate` nhận, token per-pane có cho mọi preset (host `spawn`) → 4 tool dùng được từ Codex. Đã ghi docs §11w + codex-integration.md §8 (kiểm bằng code + e2e HTTP, chưa chạy Codex thật).

## Commit đề xuất
`🛰️ v80 MCP tools: registry per tool, notify_owner (Inbox + toast / phone, rate-folded), open_in_workspace (viewer / diff beside the caller, no focus steal), who_is_editing (overlap data), path checks inside the pane's project`

## Review bảo mật (vòng 2, sau review opus)
1. `take()` chạy trước `resolveInside` trong open_in_workspace / who_is_editing; `SEGMENTS_MAX = 64` (paths.ts); `BATCH_MAX = 16` message mỗi batch (mcp.ts → -32600). Vòng allowMissing dừng khi ra khỏi root.
2. Chỉ nhận file thường (`isFile`, folder → `folder`, còn lại → `path`); win32 từ chối tên thiết bị ở mọi segment (con/prn/aux/nul/com1-9/lpt1-9/conin$/conout$, cả dạng `aux .ts`).
3. `cleanNoteText` bỏ thêm U+2028/2029 (→ khoảng trắng), U+061C, U+180E, tag chars U+E0000–E007F.
4. `parseEditor`: name qua `cleanNoteText` (≤80), branch phải khớp dạng ref (`REF`) nếu không → null, status chỉ chữ thường; `line()` quote name / branch / root bằng JSON.stringify.
5. `withMtime`: root phải là một worktree root host tự lấy (`ToolHost.checkoutRoots` = `git worktree list` của cwd pane); realpath file và root rồi mới kiểm inside + trùng tên.
6. Viewer: main `ccm:read-file` → `readFileForView(target, allowedRoots())` đã giới hạn theo `paneRoots` (cwd + liveCwd của pane đang sống) + grants — đã xác nhận. Thêm: `showForAgent` kiểm lại path nằm trong `caller.cwd` hoặc root thật host gửi (`call.cwd`), sai → `caller`.
7. `main.pageMcp`: chỉ post `agent.note` lên collector khi page trả `ok: true` (pane page biết); ngược lại trả nguyên lỗi.
8. Mỗi agent 1 viewer: file kế tiếp thay viewer cũ của nó (`openedBy` = pane gọi) nếu viewer đó chưa sửa; viewer đang có sửa chưa lưu thì mở thêm, tối đa `AGENT_VIEWERS_MAX = 4` → lỗi `limit` (thêm vào `McpPageError`).
9. Làm: `remoteLinkBelow` lstat từng component dưới root trước realpath, từ chối link có readlink là share (`\host`, `\?\UNC\`), vẫn cho junction ổ local (`\?\C:\`).
- Test: `apps/desktop/test/mcp-tools.test.ts` mục "security review fixes" (1,2,3,4,5,9) + cập nhật who test (roots); `apps/web/src/stores/showForAgent.test.ts` (6, 8). Điểm 7 phủ bởi e2e.
- Gate vòng 2: typecheck desktop/web/shared/collector sạch; vitest desktop 1078/1078, web 1653/1653; build web+desktop OK (lock); e2e v80-mcp 23/23, v49-open đủ PASS, 0 FAIL.
