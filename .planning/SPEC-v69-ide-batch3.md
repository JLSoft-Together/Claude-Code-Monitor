# SPEC v69 — IDE đợt 3 (chốt 2026-10-29 01:25)

Chủ nhân chốt 6 mục (AskUserQuestion 2026-10-29):

1. Giải xung đột (hoàn tất phần giao diện còn dở từ v68 mục 4).
2. Thư viện prompt.
3. So hai worktree (best-of-N).
4. Cảnh báo sửa trùng file (overlap radar).
5. Outline + Go to Symbol.
6. Hộp "cần chủ nhân" (inbox).

**Không làm** (chủ nhân không chọn, đừng đề xuất lại trừ khi được hỏi): PR + CI, follow agent, chặn trước khi commit, fork session + handoff, cổng / tiến trình, gắn session và chi phí vào commit.

Nguồn ý tưởng: `.planning/IDEAS-2026-10-29b-ide.md` (mục 1, 3, 4, 5), `.planning/IDEAS-2026-10-29c.md` (mục 1), `.planning/IDEAS-2026-10-29-ide.md` (mục 3 giải xung đột).

## Ràng buộc chung (áp cho mọi mục)

- **IDE mượt**:
  - Không index nền, không language server, không JVM chạy sẵn, không watcher mới, không polling.
  - Git / quét chỉ chạy khi bấm hoặc khi mở màn, luôn có timeout, và việc mới huỷ việc cũ (`execGit` `signal`).
  - Phần giao diện mới nạp lười (`defineAsyncComponent`).
- **Không gửi prompt.** Chỉ prefill bằng `workspace.insertInto(paneKey, text)` (`stores/workspace.ts:644`), chủ nhân tự Enter. Không gọi LLM API.
- **Thao tác git có ghi** (checkout file, huỷ gộp) đều qua `confirmRun` native (`apps/desktop/src/strings.ts` `RunKind`), hộp xác nhận hiện đúng lệnh sẽ chạy.
- **Đường dẫn**: mọi path đi qua `safeRepoPath`, `allowedPath` hoặc `repoOf`. Argv không qua shell.
- **Giao diện**:
  - Mọi chữ qua i18n (en + vi), màu qua token theo `.planning/COLOR-SYSTEM.md`.
  - Trạng thái luôn có đủ icon + chữ + màu.
  - Không cuộn ngang trang.
- **Quy ước**:
  - Comment ít, theo CLAUDE.md của user.
  - Cập nhật `.code_index/` sau mỗi mục.
  - Không `git commit` / `git push` khi chủ nhân chưa bảo.
- **Kiểm tra mỗi mục**:
  - `vue-tsc` web, `tsc` desktop.
  - Vitest file mới.
  - Cuối đợt: `npm run typecheck`, `npm test`, build web + desktop, E2E (memory "build + test after code").
- **Quirk công cụ**:
  - `npx vue-tsc` trong `apps/web` bị rtk chuyển thành `npm run vue-tsc` → dùng `../../node_modules/.bin/vue-tsc`.
  - Heredoc dài trong Bash dễ vỡ quote → ghi script Python vào scratchpad rồi chạy `python -I <file>`.
  - Trước khi Write một file mới, kiểm tra file đó chưa tồn tại (đã lỡ ghi đè `lib/conflicts.ts` một lần).

---

## 1. Giải xung đột — phần giao diện (hoàn tất v68 mục 4)

**Đã có:**
- Desktop:
  - `preview/worktrees.ts` `mergeBranch(..., keepConflicts)`: squash bị xung đột thì để nguyên trạng thái và trả `{error:'conflict', kept: <main path>}`.
  - `preview/mergeState.ts`: `mergeState(root)` → `merge | squash | rebase | cherry-pick | revert | null`; `abortMerge(root, confirm)` dùng `abortCommands`.
  - IPC `ccm:git-merge-state`, `ccm:git-merge-abort` (`confirmRun({kind:'abort'})`).
  - Preload `mergeState`, `mergeAbort`; `wtMerge(dir, branch, mode, keep)`.
  - Test `worktrees.test.ts` 5/5.
- Web:
  - `lib/mergeConflicts.ts` `parseConflicts` / `resolveConflict` (giữ EOL, hỗ trợ diff3), test 3/3.
  - `lib/preview.ts` `mergeState`, `mergeAbort`, `wtMerge(…, keep)`.

**Còn làm:**
- `components/workspace/ConflictView.vue` (mới):
  - Hiện trong `ChangesPane.vue` thay cho diff khi entry đang chọn có `kind === 'conflict'`.
  - Đọc file bằng `readFile(abs)`, ghi bằng `fileWrite(abs, text, mtimeMs)` để từ chối khi đĩa đã đổi.
  - Mỗi khối có hai cột "Của mình (`oursLabel`)" và "Của nhánh (`theirsLabel`)", cột base nếu là diff3.
  - Nút cho mỗi khối: **Lấy của mình / Lấy của nhánh / Lấy cả hai**, và **Sửa tay** (mở file trong FilePane ở dòng `block.line`).
  - Đầu khung có bộ đếm "còn N xung đột".
  - Khi N = 0: nút **Đánh dấu đã giải** → `gitStage(root, [path])`, rồi nạp lại status.
- Banner trong `ChangesPane.vue`:
  - Khi `mergeState.kind` khác null: "Đang gộp (merge / squash / rebase…)".
  - Nút **Huỷ gộp** → `mergeAbort` (native confirm).
  - Gợi ý "Giải xong thì commit trong ô Commit".
  - `mergeState` chỉ đọc khi mở Changes và sau mỗi lần nạp lại status (không polling).
- `WorktreeMenu.vue`: khi gộp squash trả `conflict`, hiện thêm nút **Giữ lại để giải** → `wtMerge(dir, branch, 'squash', true)`; nếu có `kept` thì `workspace.openChanges(kept)`.
- i18n `workspace.conflicts.*` (thêm vào `i18n/workspace-commit.ts`).
- **Xong khi:**
  - Typecheck sạch.
  - Test component (nếu có) pass.
  - E2E: tạo repo có xung đột → chọn "Lấy của nhánh" → hết marker → Đánh dấu đã giải → index sạch xung đột.

## 2. Thư viện prompt

**Người dùng thấy:**
- Ctrl+K có mục "Chèn prompt…". Thêm phím riêng `prompts` trong `lib/workspaceKeys.ts`, đề xuất Ctrl/⌘+Shift+P; nếu trùng thì chọn phím khác và ghi lại.
- Picker liệt kê:
  - (a) prompt chủ nhân lưu, theo project và toàn cục;
  - (b) lệnh `.claude/commands/*.md` của project và `~/.claude/commands`, chỉ hiện tên + `description`.
- Chọn một mục → xem trước bản đã thay biến → **Điền** vào pane agent đang focus (không submit).
- Lệnh slash điền dạng `/<name> `.
- Biến hỗ trợ:
  - `{file}`: file đang mở, dạng mention `fileMention` từ `lib/promptAttachments.ts`.
  - `{selection}`: vùng chọn trong FilePane / editor nếu có.
  - `{branch}`.
  - `{diffstat}`: từ Changes.
  - `{checks}`: lỗi Checks lần gần nhất, tối đa 20 dòng, `lib/checks.ts` `groupErrors`.
  - `{wt}`: đường dẫn worktree.
  - Thiếu biến → báo trong phần xem trước, vẫn cho điền.

**Cách làm:**
- Web:
  - `lib/promptLibrary.ts` (thuần): `expand(template, ctx)`, `missingVars(template, ctx)`, `cleanPrompts(raw)`; kèm test.
  - `stores/prompts.ts`: localStorage `ccm.prompts` `{id, name, text, scope: 'global' | <dirKey>}`, tối đa 200 mục, mỗi mục 8 KB; có thêm / sửa / xoá.
  - `components/workspace/PromptPicker.vue`: fuzzy theo `lib/fuzzy.ts` `highlightRuns`.
  - Gắn vào `CommandPalette.vue`.
- Desktop:
  - `preview/commands.ts`: `listCommands(root)` quét `<root>/.claude/commands` và `~/.claude/commands`.
    - Tối đa 200 file `.md`, đọc 4 KB đầu mỗi file, lấy `description` trong front matter hoặc dòng đầu.
    - Không đọc phần còn lại, không theo symlink ra ngoài.
  - IPC `ccm:commands-list` (root qua `repoOf`/`allowedPath`), preload `commandsList`; kèm test.
- **Riêng tư**: prompt chủ nhân lưu không ghi vào log, không gửi ra ngoài.
- **Xong khi**: test `promptLibrary` + `commands` pass; E2E mở picker → điền vào pane shell → kiểm tra ô nhập có text, không có Enter.

## 3. So hai worktree (best-of-N)

**Người dùng thấy:**
- `WorktreeMenu.vue` cho chọn 2 worktree / nhánh rồi bấm **So sánh A ↔ B**.
- Một dialog / pane mở ra:
  - danh sách file khác nhau (`+/-`);
  - bấm vào file → diff giữa hai nhánh (`DiffView`, layout inline / split theo `readDiffOpts`).
- Mỗi file có nút **Lấy bản của B vào checkout hiện tại** (native confirm hiện lệnh). Bị từ chối khi file đó đang bẩn ở checkout đích.
- Nút **Điền cùng prompt vào cả hai**: ô nhập text → `insertInto` vào pane agent của A và B (pane có cwd trùng worktree). Không có pane thì nút bị tắt kèm lý do.

**Cách làm (desktop `preview/worktrees.ts`):**
- `diffBetween(dir, a, b)` = `git diff --no-renames --name-status -z a b` + `--numstat`, tối đa 1000 file.
- `fileBetween(dir, a, b, rel)` = `git diff a b -- rel`, cap `MAX_DIFF_BYTES`.
- `takeFile(dir, from, rel, confirm)` = `git checkout <from> -- <rel>`:
  - từ chối nếu `git status --porcelain -- rel` không rỗng;
  - thêm `RunKind` `'take'` (en / vi trong `strings.ts`).
- Ref chỉ nhận nhánh trong `knownBranch`.
- IPC `ccm:wt-diff`, `ccm:wt-file-diff`, `ccm:wt-take`; kèm test trong `worktrees.test.ts`.
- **Phần giao diện**: `components/workspace/WorktreeCompare.vue` (mới, nạp lười), i18n `workspace.wt.compare.*`.
- **Xong khi**: test desktop pass; E2E so 2 nhánh có file khác → thấy diff → Lấy bản của B → file đổi.

## 4. Cảnh báo sửa trùng file (overlap radar)

**Người dùng thấy:**
- Chip cảnh báo (màu `warning`, icon + chữ) trên header pane agent và trên card Mission Control:
  - "Cùng sửa `a.ts` với <tên pane>" khi hai pane cùng checkout;
  - "Trùng 3 file với nhánh `feat-y`" khi các worktree cùng repo.
- Bấm chip → popover:
  - danh sách file trùng + pane;
  - **Thử gộp** = dry-run `git merge-tree --write-tree --name-only <A> <B>`, kết quả "Gộp sạch" / "N file xung đột: …";
  - **Báo agent kia** = prefill vào pane kia: "Agent khác đang sửa X; tránh sửa tiếp".

**Dữ liệu (không watcher mới):**
- Dùng status Changes / gutter mà app đã nạp khi file đổi (`RootWatcher` `preview/watch.ts` + `GitDirWatcher` đã có), cộng `TerminalSession.diff` từ collector.
- Danh sách file đổi theo root lấy từ `changes-status` sẵn có, chỉ cho các root đang có pane agent.
- **Cùng checkout**: dùng `lib/conflicts.ts` `sessionConflicts` (file **cũ, giữ nguyên**: nó báo hai session cùng một checkout), thêm giao file.
- **Khác worktree cùng repo**: nhóm theo `commonDir` (`preview/changes.ts`), giao tập file "đổi so với base", lấy từ `compareBranch` mở rộng thành `--name-only`.
- Tính giao chỉ khi status của một root đổi, có throttle 1 s.
- **Cần đo trước**: chi phí `git status` trên repo lớn. Nếu đắt thì chỉ tính khi mở Mission Control hoặc khi bấm.

**Cách làm:**
- Desktop:
  - `preview/overlap.ts`: `changedVsBase(dir, base)` (name-only) và `dryMerge(dir, a, b, signal)` (git ≥ 2.38; máy này 2.45.1; git cũ → `unsupported`).
  - IPC `ccm:overlap-files`, `ccm:overlap-dryrun`.
- Web:
  - `lib/overlap.ts` (thuần: `intersect`, `overlapChips`) + test.
  - `stores/overlap.ts`.
  - Chip trong pane header (`WorkspaceView.vue` / header component) và `MissionControl.vue`.
  - i18n `i18n/workspace-overlap.ts`.
- **Xong khi**: test thuần + test `dryMerge` (repo tạm có xung đột / không xung đột) pass; E2E hai worktree sửa cùng file → chip hiện → Thử gộp báo xung đột.

## 5. Outline + Go to Symbol

**Người dùng thấy:**
- Trong FilePane, Ctrl/⌘+Shift+O mở picker liệt kê hàm / class / method của file đang mở (fuzzy); Enter nhảy tới dòng.
- Chuột phải hoặc F12 trên một từ có hai mục:
  - **Tìm nơi dùng**: mở tab Tìm của Explorer với `{query: từ, word: true}`;
  - **Tìm khai báo**: cũng Find in Files, regex `(function|class|def|fun|const|let|val|var) <từ>\b`.

**Cách làm:**
- `lib/editor/outline.ts`:
  - Dùng parser Lezer từ `lib/editor/cmLanguage.ts` `languageFor(grammar)`, parse văn bản file một lần khi mở picker, timeout 1 s qua `ensureSyntaxTree` / `parser.parse` có giới hạn.
  - Bảng tên node theo ngôn ngữ: ts / js / tsx / vue (script), python, java, kotlin (legacy-mode → regex), dart (regex), css (selector), json / yaml (khóa cấp 1).
  - Không có bảng → regex theo dòng, tối đa 5000 dòng.
  - Test với mẫu mỗi ngôn ngữ.
- Giao diện: `components/workspace/OutlinePicker.vue` (nạp lười); phím `outline` trong `workspaceKeys.ts` + `shortcuts.ts`; i18n `workspace.outline.*`.
- Find usages dùng lại `ExplorerPanel.showSearch(query)`. Có thể cần mở rộng `showSearch` để nhận query + word.
- **Xong khi**: test outline pass; E2E mở file ts → Ctrl+Shift+O → chọn hàm → dòng được reveal.

## 6. Hộp "cần chủ nhân" (inbox)

**Người dùng thấy:**
- Nút inbox có badge số ở `AppHeader.vue`, mở popover hoặc panel.
- Mỗi agent một dòng, lấy lý do mạnh nhất, xếp theo độ khẩn. Các lý do:
  - "Chờ trả lời · 4m";
  - "Kẹt · 12m" (`quietFor`);
  - "Lỗi lặp" (`errorLoops`);
  - "Checks lỗi" (`stores/checks.ts` `problemRuns`, root trùng cwd);
  - "Xong, chưa xem lượt" (có checkpoint `after:` mới chưa mở Xem lượt; hoặc idle sau working mà có diff);
  - "Chạm giới hạn" (nếu `extras` có dữ liệu limit).
- Phím trong panel: J / K đi dòng, Enter nhảy tới pane (Workspace) hoặc card (Monitor `ui.focusTerminal`), E "đã xem". Dòng đã xem ẩn đến khi trạng thái của agent đổi.
- Thêm mục "Mở inbox" trong `CommandPalette.vue`.

**Cách làm:**
- `lib/inbox.ts` (thuần: `inboxItems(...)`, `SEVERITY`) + test thứ tự và hết hạn dismiss.
- `stores/inbox.ts`: `reviewed` lưu `ccm.inbox` (bọc try/catch).
- `components/inbox/InboxPanel.vue`.
- `computed` có memo; mốc "since" chỉ cập nhật theo tick phút sẵn có (`lib/format` `now`).
- i18n `i18n/inbox.ts`.
- **Xong khi**: test pass; E2E nạp terminal giả waiting + checks lỗi → badge 2 → Enter nhảy đúng.

---

## Thứ tự làm

1 → 2 → 3 → 4 → 5 → 6: hoàn tất việc dở trước, rồi tới mục rẻ và dùng hằng ngày, việc lớn để sau. Sau mỗi mục: typecheck + test file, append dòng vào `.planning/PROGRESS-2026-10-29.md`, cập nhật `.code_index/_meta.md`.

Cuối đợt:
- `npm run typecheck` + `npm test` toàn repo.
- Build web + desktop.
- E2E: `apps/desktop/e2e/v67-ide.cjs` + script mới `e2e/v69-ide.cjs`.
- Cập nhật `.code_index/web|desktop|protocol.md`.
- Đề xuất commit theo nhóm, **dừng trước lệnh `git`**.
