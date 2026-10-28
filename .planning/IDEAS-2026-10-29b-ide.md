# Ý tưởng IDE đợt 3 (2026-10-29)

Sau v67 và hai đợt ý tưởng trước (`IDEAS-2026-10-28-ide.md`, `IDEAS-2026-10-29-ide.md`). Chủ đề đợt này: **chạy nhiều agent song song mà không dẫm chân nhau**, và những tiện ích đọc code nhỏ không cần language server.

Ràng buộc giữ nguyên: không index nền, không LSP / JVM chạy sẵn, không polling nhanh; việc nặng chạy khi bấm / khi mở, có timeout + huỷ. Không gửi prompt thay chủ nhân (chỉ prefill), không gọi LLM. Local only, gửi ra ngoài phải confirm native. Không lộ nội dung session / secret.

## Đã có hoặc đã lên kế hoạch (không đề xuất lại)

Split pane / rail / Mission Control, Explorer + Atom icons, Quick Open, Find in Files (`search.ts`), Changes (stage / commit / discard hunk), Checks + lỗi bấm được, Checkpoint `before:` / `after:` (`checkpoints.ts`), WorktreeMenu (add / remove / compare với base `compareBranch` / merge ff-squash `mergeBranch`, copy setup files), Git Log + branch toolbar, Run pane, browser pane, hook bridge (compacting, denied), CommandPalette (Ctrl+K). Đã plan: review hunk lượt agent, squiggle Checks trong editor, giải conflict, PR + CI, blame.

## Tham khảo thị trường

- **Conductor / Crystal (Nimbalyst) / Superset**: mỗi agent một worktree rồi dựa vào cô lập; các nguồn đều thừa nhận "chạy N workspace thì sẽ có merge conflict", không thấy tool nào cảnh báo *trước* khi gộp ([so sánh DEV](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8), [madewithlove về Conductor](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/)). Crystal có "compare approaches" giữa các session.
- **Anthropic Agent Teams**: danh sách task chung + file locking để tránh xung đột (thử nghiệm).
- **Zed**: "Follow agent" — editor tự đi theo file agent đang sửa.
- **Warp**: Workflows / Prompts lưu sẵn, tham số hoá. **Cursor**: commands / rules tái sử dụng. **Claude Code**: slash commands `.claude/commands`, skills.
- **JetBrains / VS Code**: Structure view, Go to Symbol (Ctrl+Shift+O), Find usages.

---

## 1. Overlap radar: cảnh báo agent đang sửa trùng file / sắp conflict

**Người dùng thấy.** Chip cảnh báo trên header pane agent và card Mission Control: "2 agent cùng sửa `src/a.ts`" (cùng checkout), hoặc "nhánh `feat-x` và `feat-y` cùng sửa 3 file". Bấm chip mở popover: danh sách file trùng, agent nào, nút "Thử gộp (dry-run)" cho kết quả "sạch" / "N file conflict" mà **không đụng working tree**.

**Vì sao.** Đây là khoảng trống thị trường (mọi tool dựa vào worktree rồi để chủ nhân tự gặp conflict lúc merge). Orrery vốn quan sát nhiều agent nên có đủ dữ liệu. Giảm đúng nỗi đau lớn nhất khi chạy 3–8 agent.

**Cách làm.**
- Desktop `preview/overlap.ts` (mới): nhận danh sách root (từ `RootWatcher` trong `preview/watch.ts:22`, đã báo `changed[]` theo root khi file / index đổi — dùng lại, không watcher mới). Giữ map `root → Set<file đã đổi so với HEAD>` lấy từ `parseStatusV2` (`changes.ts`), tính giao giữa các root cùng repo (cùng `git rev-parse --git-common-dir`). Cùng một checkout mà 2 pane agent → dùng owner pane từ `pty/host.ts` `owners`.
- Dry-run: `git merge-tree --write-tree --name-only <base> <branchA> <branchB>` (git ≥ 2.38, chỉ đọc object; fallback "không hỗ trợ" nếu git cũ), chạy khi bấm, timeout 20 s, huỷ qua `signal` như `search.ts:61`. Không ghi ref, không đụng index.
- IPC `ccm:overlap-state` (đọc map hiện tại) + `ccm:overlap-dryrun`; push `ccm:overlap-event` khi giao thay đổi (throttle 1 s, chỉ gửi khi tập giao đổi).
- Web: `stores/overlap.ts`, `lib/overlap.ts` (pure: `intersect`, `chipText`) + test; chip trong `PaneHeader` / `MissionControl` card; nút "Báo agent kia" dùng `workspace.insertInto` (prefill, không submit) nội dung "agent khác đang sửa file X, tránh sửa tiếp".
- i18n `workspace-overlap.ts` (en / vi).

**Cost.** M.

**Rủi ro mượt.** Thấp: tính giao là set nhỏ trong bộ nhớ, trigger theo sự kiện watcher sẵn có; `merge-tree` chỉ khi bấm. Rủi ro: repo lớn `git status` mỗi lần đổi — dùng cache status sẵn của Changes thay vì chạy lại.

---

## 2. Follow agent + nhãn "agent đang sửa" trong Explorer

**Người dùng thấy.** Nút "Follow" trên pane agent: khi bật, FilePane tự mở (read-only, giữ nguyên tab xem) file agent vừa sửa, nhảy tới vùng thay đổi và tô nhẹ dòng mới. Trong Explorer tree, file agent đang / vừa sửa có chấm màu `agent-*` kèm tên tab agent; Changes gom theo agent khi nhiều agent chung checkout.

**Vì sao.** Zed "follow agent" là cách duy nhất để vừa nhìn code vừa theo agent mà không tắt-bật tab. Trong Orrery còn giải bài toán "file đổi này là của agent nào" khi nhiều pane cùng repo.

**Cách làm.**
- Nguồn: hook bridge `hook-bridge.mjs` (v67, `hooks.ts`, entries `async: true`) đã chuyển sự kiện tool; thêm `PostToolUse` matcher `Edit|Write|MultiEdit` chỉ lấy `tool_input.file_path` (không đưa nội dung vào protocol). Nếu hook chưa bật: fallback collector đọc `tool_use` trong transcript (đã đọc cho trạng thái) — cần xác minh ở `docs/claude-code-integration.md`. Thêm sự kiện shared `file.touched` `{terminalId, path, ts}` trong `packages/shared`; collector chuẩn hoá path (trong cwd session, bỏ nếu nằm ngoài root cho phép `paneRoots`).
- Web: `stores/touched.ts` (ring ≤ 500 mục / terminal, TTL 30 phút), `ExplorerTree.vue` hiển thị chấm, `useFollowAgent.ts` mở file qua `openFromExplorer(path, keep, line)` (đã có), throttle 1 lần / 2 s và **tắt tạm khi chủ nhân đang gõ** trong editor (`isTyping`).
- Dòng đổi: lấy `git diff -U0` của file (đã có `changes.ts`), không phân tích thêm.

**Cost.** M.

**Rủi ro mượt.** Thấp–vừa: sự kiện hook thưa (theo tool call); phải throttle mở tab và không cướp focus. Không chạy khi tắt Follow. Rủi ro riêng tư: chỉ path, đã giới hạn trong root.

---

## 3. Best-of-N: so sánh hai nhánh / worktree với nhau và nhặt file

**Người dùng thấy.** Trong WorktreeMenu chọn 2 worktree → "So sánh A ↔ B": Changes pane hiện diff giữa hai nhánh (không phải so với `master`), nhóm theo file với `+/-`; mỗi file có "Lấy bản của B" (vào checkout hiện tại) và "Xem cạnh nhau". Kèm nút "Gửi cùng một prompt vào cả hai" (prefill vào 2 pane agent, chủ nhân tự Enter) để thử cách tiếp cận khác nhau.

**Vì sao.** Crystal "compare approaches", Conductor best-of-N workflow. Orrery có `wt-compare` nhưng chỉ ahead/behind so với base (`worktrees.ts:42` `compareBranch`), chưa so hai nhánh với nhau, chưa có nhặt file.

**Cách làm.**
- Desktop `preview/worktrees.ts` thêm `diffBetween(dir, a, b)` = `git diff --name-status --numstat a...b` + `git diff a b -- file` lấy theo file khi mở (lazy), dùng lại `parseUnifiedDiff` phía web; `takeFile(dir, from, file)` = `git checkout <from> -- <file>` sau `confirmRun` (thêm `RunKind` `take`, hiển thị lệnh như `strings.ts` `runDetail`), từ chối khi file đang dirty ở checkout đích. IPC `ccm:wt-diff` / `ccm:wt-take`; ref qua `cleanRef` sẵn có (`gitRefs`), argv không qua shell.
- Web: mode "Compare" trong `ChangesPane.vue` dùng `DiffView` / `SplitDiff` (đã có), `WorktreeMenu.vue` thêm chọn 2 dòng. "Gửi prompt vào cả hai": `workspace.insertInto` lần lượt cho 2 pane.
- Test: `worktrees.test.ts` thêm case `diffBetween` / `takeFile` từ chối khi dirty.

**Cost.** S–M (hầu hết là ghép phần đã có).

**Rủi ro mượt.** Rất thấp: chỉ chạy khi mở màn so sánh; diff từng file lazy, giới hạn kích thước như Changes.

---

## 4. Thư viện prompt + slash command của project (prefill)

**Người dùng thấy.** Phím tắt / mục trong Ctrl+K "Chèn prompt…" mở danh sách: (a) prompt do chủ nhân lưu theo project / toàn cục, (b) lệnh `.claude/commands/*.md` và skill của project + `~/.claude/commands` (chỉ tên + mô tả dòng đầu). Chọn → điền vào ô nhập của pane agent đang focus, **không submit**. Hỗ trợ biến: `{file}` (tab đang mở), `{selection}`, `{branch}`, `{diffstat}`, `{checks}` (lỗi Checks lần gần nhất), `{wt}`; biến được thay trước khi điền, hiện xem trước.

**Vì sao.** Warp Workflows, Cursor commands, Claude slash commands. Khi chạy nhiều agent, gõ lại cùng prompt ("review diff", "viết test cho `{file}`", "sửa lỗi Checks") là việc lặp nhiều nhất; Orrery đã có sẵn nguồn ngữ cảnh (file, selection, Checks) mà tool khác không có ở một chỗ.

**Cách làm.**
- Web: `lib/promptLibrary.ts` (pure: `expand(template, ctx)`, `missingVars`) + test; `stores/prompts.ts` lưu trong `settings` (key `ccm.prompts`, validate như `cleanLayout`); `PromptPicker.vue` (mở từ `CommandPalette.vue` scope `p:`); điền qua `workspace.insertInto`; `{file}` dạng `@file` dùng `lib/promptAttachments.ts` `fileMention`; `{checks}` dùng `lib/checks.ts` `groupErrors` cắt ≤ 20 lỗi; `{diffstat}` từ Changes store.
- Desktop: `preview/commands.ts` + IPC `ccm:commands-list` quét `<root>/.claude/commands` và `~/.claude/commands` (≤ 200 file, 4 KB đầu mỗi file lấy `description` front matter), chỉ khi mở picker, trong `paneRoots` / grants.
- i18n `workspace-prompts.ts`.

**Cost.** S.

**Rủi ro mượt.** Rất thấp: quét thư mục nhỏ khi mở picker, không watcher. Lưu ý: prompt người dùng có thể chứa secret → không ghi vào log, không đồng bộ ra ngoài.

---

## 5. Outline + Go to Symbol + Find usages (không LSP)

**Người dùng thấy.** `Ctrl/⌘+Shift+O` trong FilePane: danh sách hàm / class / method của file đang mở (fuzzy, nhảy tới dòng); panel Outline tuỳ chọn trong Explorer. Chuột phải / `F12` trên một định danh: "Tìm nơi dùng" → mở Find in Files sẵn với từ đó (`-w`), và "Tìm khai báo" gợi ý các dòng có dạng `function|class|def|fun|const X`.

**Vì sao.** Đọc code agent viết (file lớn, nhiều hàm) cần nhảy nhanh; mọi IDE có Structure / Go to Symbol. Không muốn LSP → dùng cây cú pháp Lezer của CodeMirror đã tải theo ngôn ngữ (`lib/editor/cmLanguage.ts` `languageFor`) khi file mở, không index.

**Cách làm.**
- Web: `lib/editor/outline.ts` (pure): duyệt `syntaxTree(state)` tìm node `FunctionDeclaration | ClassDeclaration | MethodDeclaration | …` theo bảng tên node mỗi ngôn ngữ (ts / js / kotlin / dart / python / java / vue script); ngôn ngữ không có bảng → regex đơn giản theo dòng, giới hạn 5000 dòng. Test với mẫu mỗi ngôn ngữ. `OutlinePicker.vue` dùng `lib/fuzzy.ts` (`highlightRuns`) như Quick Open. Parse tăng dần nên cắt ở 1 s (`ensureSyntaxTree(state, pos, 1000)`).
- Find usages: gọi lại `lib/preview.ts` `searchFiles` với `{ word: true, query: sym }` (đã có `-w`), mở `ExplorerSearch.vue`; không thêm IPC.
- Phím: thêm `outline` vào `workspaceKeys.ts` (cùng chỗ `search`).

**Cost.** S–M (bảng node theo ngôn ngữ là phần công sức).

**Rủi ro mượt.** Thấp: chỉ chạy khi bấm phím, trên file đang mở; không index nền; không process mới.

---

## Xếp hạng

| # | Ý tưởng | Giá trị | Cost | Rủi ro mượt | Ghi chú thứ tự |
|---|---|---|---|---|---|
| 1 | Overlap radar | rất cao (khoảng trống thị trường) | M | thấp | Làm đầu; dùng `RootWatcher` + `merge-tree` |
| 3 | Best-of-N compare / nhặt file | cao | S–M | rất thấp | Rẻ nhất trong nhóm worktree, hợp với v67 |
| 4 | Thư viện prompt + slash command | cao | S | rất thấp | Rẻ, dùng hằng ngày |
| 2 | Follow agent + nhãn file | cao | M | thấp–vừa | Cần xác minh hook `file_path`; sau hook bridge ổn |
| 5 | Outline / Go to Symbol | vừa | S–M | thấp | Nền tảng đọc code, không phụ thuộc agent |

Thứ tự gợi ý: 4 → 3 → 1 → 5 → 2.
