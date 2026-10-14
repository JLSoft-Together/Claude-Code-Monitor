# Plan: Git Diff Viewer cho IDE TypeScript

Oct 14, 2026 · @Titan Zentrixa

## Tổng quan & mục tiêu

Mục tiêu: đưa ba trải nghiệm diff cốt lõi của Android Studio vào IDE TypeScript — change markers trong gutter, Diff Viewer (side-by-side / unified) và panel danh sách file thay đổi. Merge 3-way để sang giai đoạn sau.

Android Studio chạy trên nền IntelliJ Platform, nên toàn bộ UI diff giống IntelliJ IDEA; tài liệu tham chiếu là JetBrains Help (bản 2026.2).

**Trong phạm vi MVP**

- Gutter markers trên editor đang mở: thêm / sửa / xoá so với HEAD, click để xem bản cũ và rollback từng hunk.
- Diff Viewer mở trong editor tab: 2 chế độ, highlight theo dòng + theo từ, điều hướng F7 / Shift+F7, thu gọn vùng không đổi.
- Panel Changes: liệt kê file modified / added / deleted / untracked, double-click hoặc Ctrl+D để mở diff.

**Ngoài phạm vi MVP**

- Changelists, stage từng dòng qua viewer 3 bên, giải quyết conflict, diff thư mục, diff binary.

## Phân tích logic UI diff của Android Studio

Kết luận chính: Android Studio tách diff thành 2 tầng tính toán (diff theo dòng → diff bên trong dòng theo từ) và 3 bề mặt UI dùng chung dữ liệu đó: gutter markers trên editor, Diff Viewer trong tab, và danh sách file thay đổi trong Commit tool window.

### Điểm vào

- **Commit tool window (Alt+0)**: danh sách file thay đổi; chọn file rồi Ctrl+D (hoặc double-click) mở Diff Viewer thành một editor tab ([commit](https://www.jetbrains.com/help/idea/commit-changes-dialog.html)).
- **Gutter của editor**: click vào change marker → popup có nút Show Diff ([gutter](https://www.jetbrains.com/help/idea/editor-gutter.html)).
- **Project view**: menu chuột phải → Compare Files / Compare File with Editor; Git tool window → Show Diff ([diff viewer](https://www.jetbrains.com/help/idea/differences-viewer.html)).
- **Cây file**: tên file đổi màu theo trạng thái (modified, added, deleted…), thư mục cha cũng được tô để lộ file đổi bên trong ([file status](https://www.jetbrains.com/help/idea/file-status-highlights.html)).

### Change markers trong gutter

Mỗi file đang mở được so liên tục với bản gốc (HEAD / index). Mỗi lần gõ, IDE tính lại các khoảng thay đổi và vẽ marker bên trái dòng; commit xong thì marker biến mất vì bản gốc đã cập nhật.

| Loại | Màu nền light / dark | Hình dạng |
| --- | --- | --- |
| Added | #C9DEC1 / #384C38 | thanh dọc cạnh các dòng mới |
| Modified | #C3D6E8 / #374752 | thanh dọc cạnh các dòng sửa |
| Whitespace-modified | #EDDCBC / #4C4638 | thanh dọc, chỉ khác khoảng trắng |
| Deleted | #9F9F9F / #656E76 | tam giác nhỏ nằm giữa hai dòng |

Click marker mở một popup gồm: khung hiển thị nội dung cũ của đoạn đó (highlight theo từ), toolbar Previous / Next change, Rollback, Show Diff, và cho phép copy một phần nội dung cũ. Rollback chỉ thay đúng hunk đó, không đụng phần còn lại của file.

Về nội bộ, mỗi khoảng là một `Range` gồm `line1, line2` (bên hiện tại) và `vcsLine1, vcsLine2` (bên gốc), kèm danh sách inner range; tracker có `getNextRange`, `getPrevRange`, `getRangeForLine`, `rollbackChanges` ([ví dụ mã nguồn](https://gist.github.com/theY4Kman/7233d15dd976a524e8f287055c0f0451), [forum JetBrains](https://intellij-support.jetbrains.com/hc/en-us/community/posts/360004438339/comments/360000696519)). Loại suy ra từ độ dài: bên gốc rỗng = Added, bên hiện tại rỗng = Deleted, còn lại = Modified.

### Diff Viewer

Diff Viewer mở như một editor tab, so file local với bản repository; nội dung bên phải là editor thật (có completion), chỉnh sửa ở đây ghi thẳng vào file ([diff viewer](https://www.jetbrains.com/help/idea/differences-viewer.html)).

| Tính năng | Hành vi | Phím tắt |
| --- | --- | --- |
| Chế độ hiển thị | Side-by-side (2 pane) hoặc Unified (1 pane); chỉ sửa được pane phải / dòng dưới | — |
| Màu thay đổi | Xanh lá = thêm, xanh dương = sửa, xám = xoá | — |
| Điều hướng thay đổi | Nhảy tới thay đổi trước / sau; hết file thì bấm thêm lần nữa để sang file kế | F7 / Shift+F7 |
| Đổi file | So file trước / sau trong danh sách thay đổi | Alt+Left / Alt+Right |
| Jump to Source | Mở file thật, giữ nguyên vị trí caret | F4 |
| Collapse Unchanged | Thu gọn vùng không đổi, số dòng ngữ cảnh cấu hình được | — |
| Align changes | Chèn khoảng trống để hai bên thẳng hàng theo dòng | — |
| Synchronize scrolling | Cuộn hai pane cùng nhau | — |
| Chuyển pane | Đổi pane đang có caret | Ctrl+Shift+Tab |
| Accept / Append | Mũi tên giữa hai pane áp thay đổi sang bên kia; giữ Ctrl để đổi thành append | — |
| Ignore whitespace | None, Trim, Ignore whitespaces, Ignore whitespaces và dòng trống, Ignore imports và formatting | — |
| Mức highlight | Words, Lines, Split changes, Characters, None | — |
| Popup lệnh diff | Menu nhanh các lệnh diff thường dùng | Ctrl+Shift+D |

### Hai tầng tính diff

IntelliJ tính diff theo dòng trước (`ComparisonManager.compareLines`), rồi với mỗi khối sửa mới tính diff bên trong theo từ (`compareLinesInner`, `ByWord`) ([forum JetBrains](https://intellij-support.jetbrains.com/hc/zh-cn/community/posts/208583685/comments/203691070)). Viewer vẽ nền cho cả khối dòng, rồi tô đậm hơn đúng các từ đổi bên trong; chế độ Words / Characters / Lines chỉ là chọn tầng nào được vẽ.

### Viewer 3 bên (để sau MVP)

Compare HEAD, Staged and Local mở 3 pane: trái là HEAD, phải là local, giữa là editor để soạn nội dung sẽ stage, cho phép stage tới từng dòng ([commit](https://www.jetbrains.com/help/idea/commit-changes-dialog.html)). Merge viewer có thêm Apply non-conflicting changes và Resolve simple conflicts.

## Kiến trúc đề xuất

Tách 3 lớp giống IntelliJ: lớp git (main process) chỉ lấy dữ liệu, lớp lõi (VcsStore + DiffEngine) giữ trạng thái và tính diff, lớp UI chỉ hiển thị. Nhờ vậy panel, viewer và gutter luôn nhất quán vì đọc cùng một nguồn.

&#91;embedded content: kiến trúc diff · 7 module, 2 process\]

GitService chỉ chạy ở main process; việc tính diff nặng đẩy sang worker để gõ không giật. Rollback đi qua API edit của editor, còn stage hunk gọi ngược về GitService.

### Mô hình dữ liệu

Quy ước dòng đánh số từ 0, khoảng nửa mở `[start, end)` giống `Range` của IntelliJ: `line1 == line2` nghĩa là bên hiện tại rỗng (Deleted), `vcsLine1 == vcsLine2` nghĩa là bên gốc rỗng (Added).

```typescript
type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

interface FileChange {
  path: string;
  oldPath?: string;      // khi renamed
  status: FileStatus;
  staged: boolean;
  binary: boolean;
}

type RangeType = 'added' | 'modified' | 'deleted';

interface LineRange {
  line1: number; line2: number;        // bên hiện tại
  vcsLine1: number; vcsLine2: number;  // bên gốc (HEAD hoặc index)
  type: RangeType;
  inner?: InnerRange[];                // diff theo từ, chỉ cho 'modified'
}

interface InnerRange {
  start: number; end: number;          // offset trong khối hiện tại
  vcsStart: number; vcsEnd: number;    // offset trong khối gốc
}

type Ref = 'HEAD' | 'INDEX' | 'WORKTREE' | string; // string = commit sha

interface DiffTabInput { path: string; left: Ref; right: Ref; }

interface GitService {
  status(): Promise<FileChange[]>;
  show(ref: Ref, path: string): Promise<string>;
  applyCached(patch: string): Promise<void>;
  restoreStaged(path: string): Promise<void>;
}
```

### Cấu trúc thư mục gợi ý

```text
src/
  main/vcs/git-service.ts          # git CLI + IPC handlers
  main/vcs/fs-watcher.ts
  renderer/vcs/vcs-store.ts         # status + cache bản gốc + events
  renderer/vcs/diff-engine.worker.ts
  renderer/vcs/line-status-tracker.ts
  renderer/ui/changes-panel/
  renderer/ui/diff-tab/             # toolbar, side-by-side, unified
  renderer/ui/gutter/hunk-popup.ts
```

## Lựa chọn thư viện

Chọn theo editor IDE đang dùng: Monaco thì dùng diff editor có sẵn của Monaco, CodeMirror 6 thì dùng `@codemirror/merge`. Cả hai đã có sẵn side-by-side, unified, thu gọn vùng không đổi và nút revert từng khối, nên không cần tự vẽ viewer từ đầu.

| Thành phần | Khuyến nghị | Phương án thay thế | Ghi chú |
| --- | --- | --- | --- |
| Diff Viewer (Monaco) | `monaco.editor.createDiffEditor` | — | Có `renderSideBySide`, `hideUnchangedRegions` (contextLineCount, minimumLineCount), `ignoreTrimWhitespace`, `renderMarginRevertIcon`, `originalEditable` ([typedoc](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IDiffEditorBaseOptions.html)) |
| Diff Viewer (CodeMirror 6) | `MergeView` + `unifiedMergeView` từ `@codemirror/merge` | — | Split view căn thẳng dòng không đổi; unified có accept/reject chunk, `collapseUnchanged`, `changeOriginalDocEffect` để thay bản gốc ([npm](https://npmjs.com/package/@codemirror/merge), [changelog](https://cdn.jsdelivr.net/npm/@codemirror/merge@6.12.1/CHANGELOG.md)) |
| Lớp Git | Gọi `git` CLI qua `child_process` ở main process | `simple-git` (wrapper CLI), `isomorphic-git` (JS thuần, không cần git cài sẵn) | CLI nhanh và đúng nhất với `.gitattributes`, autocrlf, hooks |
| Diff theo dòng cho gutter | `diff` (jsdiff) `diffLines` / `structuredPatch` | Tái dùng API tính diff của Monaco / `@codemirror/merge` | Chạy trong Web Worker để không giật khi gõ |
| Diff theo từ trong khối sửa | `diffWordsWithSpace` của jsdiff | Diff ký tự `diffChars` | Chỉ chạy trên các khối Modified |
| Stage / revert từng hunk | Tạo patch rồi `git apply --cached` (stage) hoặc ghi lại nội dung file (revert) | `git add -p` không dùng được vì là tương tác | Patch sinh từ `structuredPatch` |

Lệnh git cần dùng:

- `git status --porcelain=v2 -z --untracked-files=all`: danh sách file thay đổi, kể cả rename.
- `git show HEAD:<path>` và `git show :<path>`: nội dung bản HEAD và bản index làm bản gốc.
- `git diff --numstat` hoặc kiểm tra byte NUL: phát hiện file binary.
- `git rev-parse --show-toplevel`: tìm gốc repo khi mở project.

## Lộ trình triển khai

Làm theo thứ tự dữ liệu → panel → viewer → gutter: mỗi giai đoạn dùng lại phần trước và cho ra một tính năng dùng được ngay.

### Giai đoạn 0 — Chuẩn bị

- [ ] Xác định editor đang dùng (Monaco hay CodeMirror 6) để chốt thư viện viewer.
- [ ] Tạo kênh IPC `git:*` giữa renderer và main process.
- [ ] Phát hiện repo khi mở project (`git rev-parse --show-toplevel`); không có repo thì ẩn mọi tính năng VCS.

**Hoàn thành khi:** mở một project có git, renderer nhận được đường dẫn gốc repo và nhánh hiện tại.

### Giai đoạn 1 — GitService và panel Changes

- [ ] `GitService.status()` parse `--porcelain=v2 -z` thành `FileChange[]` (modified, added, deleted, renamed, untracked).
- [ ] `GitService.getBaseContent(path, ref)` cho HEAD và index, có cache theo blob hash.
- [ ] Theo dõi `.git/HEAD`, `.git/index` và file trong workspace để refresh status (debounce).
- [ ] Panel Changes: cây file nhóm theo thư mục, icon và màu theo trạng thái, đếm số file.
- [ ] Tô màu tên file trong explorer hiện có theo trạng thái, tô cả thư mục cha.

**Hoàn thành khi:** panel khớp với `git status` sau khi sửa, tạo, xoá, đổi tên file và sau khi commit từ terminal.

### Giai đoạn 2 — Diff Viewer chỉ đọc

- [ ] Loại editor tab mới `DiffTab` (key = path + ref trái + ref phải), mở bằng double-click hoặc Ctrl+D từ panel Changes.
- [ ] Toolbar: chuyển Side-by-side / Unified, Collapse unchanged, Ignore whitespace, mức highlight Words / Lines.
- [ ] Điều hướng F7 / Shift+F7 giữa các thay đổi; tới cuối thì bấm lần nữa sang file kế trong danh sách.
- [ ] Alt+Left / Alt+Right đổi sang file trước / sau; F4 mở file thật tại đúng dòng.
- [ ] File mới: bên trái rỗng; file xoá: bên phải rỗng; binary: chỉ hiện thông báo khác nhau.

**Hoàn thành khi:** duyệt hết mọi file trong panel chỉ bằng bàn phím, hai chế độ hiển thị đúng như `git diff`.

### Giai đoạn 3 — Gutter markers và popup hunk

- [ ] `LineStatusTracker` cho mỗi document đang mở: giữ bản gốc, tính `LineRange[]` trong worker sau mỗi lần sửa.
- [ ] Vẽ marker Added / Modified / Deleted (tam giác) ở gutter, kèm tick trên thanh cuộn.
- [ ] Click marker mở popup: nội dung cũ có highlight theo từ, nút Prev / Next, Rollback, Show Diff, Copy.
- [ ] Rollback thay đúng các dòng `[line1, line2)` bằng nội dung gốc `[vcsLine1, vcsLine2)` qua API edit của editor (để Ctrl+Z hoàn tác được).
- [ ] Phím tắt đi tới thay đổi kế / trước trong editor thường và rollback hunk tại caret.

**Hoàn thành khi:** marker cập nhật ngay khi gõ, biến mất sau commit, rollback một hunk không đụng hunk khác.

### Giai đoạn 4 — Chỉnh sửa trong Diff Viewer

- [ ] Bên phải (local) là editor thật, dùng chung model với tab file nếu file đang mở.
- [ ] Mũi tên giữa hai pane: revert khối về bản gốc; bản gốc HEAD luôn chỉ đọc.
- [ ] Đồng bộ cuộn và căn thẳng dòng (đã có sẵn trong thư viện, chỉ cần bật).

**Hoàn thành khi:** sửa trong diff được lưu vào file và gutter của tab file cập nhật theo.

### Giai đoạn 5 — Stage và lịch sử

- [ ] Stage / unstage cả file (`git add`, `git restore --staged`) từ panel Changes.
- [ ] Stage một hunk: sinh patch từ hunk rồi `git apply --cached`.
- [ ] Mở diff của một commit trong log (`git show <sha>`) với danh sách file của commit đó.

**Hoàn thành khi:** `git diff --cached` khớp đúng các hunk đã chọn stage.

### Giai đoạn 6 — Để sau

- [ ] Viewer 3 bên HEAD / Staged / Local để stage từng dòng.
- [ ] Merge viewer giải quyết conflict (apply non-conflicting, resolve simple).

## Rủi ro và edge case

Rủi ro lớn nhất là xuống dòng CRLF / LF: không chuẩn hoá thì cả file bị coi là Modified. Các trường hợp còn lại xử lý được bằng kiểm tra trước khi diff.

| Trường hợp | Hậu quả nếu bỏ qua | Cách xử lý |
| --- | --- | --- |
| CRLF vs LF, `core.autocrlf` | Cả file hiện là thay đổi | Lấy bản gốc qua `git show` (đã áp filter) và chuẩn hoá EOL trước khi so |
| BOM, encoding không phải UTF-8 | Dòng đầu luôn khác, ký tự lỗi | Bỏ BOM khi so; đọc theo encoding editor đang dùng |
| File lớn | Treo UI khi gõ | Diff trong worker, đặt ngưỡng kích thước và tắt word diff khi vượt |
| File binary | Hiển thị rác | Phát hiện byte NUL hoặc `-` trong `--numstat`, chỉ báo "binary khác nhau" |
| Rename | Hiện thành 1 file xoá + 1 file mới | Đọc mục `2 R` trong porcelain v2, diff đường dẫn cũ với đường dẫn mới |
| HEAD đổi (commit, checkout, pull) | Marker sai so với bản gốc mới | Theo dõi `.git/HEAD` và `.git/index`, xoá cache bản gốc rồi tính lại |
| File chưa track | Không có bản gốc | Coi bản gốc là rỗng: toàn bộ là Added |
| Rollback khi file có thay đổi chưa lưu | Mất nội dung | Rollback qua API edit của editor, không ghi đĩa trực tiếp, để Undo được |
| Submodule, worktree | Lệnh git chạy sai thư mục | Luôn chạy git với `-C <repo root>` của chính file đó |

**Cần chốt sớm:** gutter so với HEAD (giống Android Studio mặc định) hay với index (giống VS Code). Nên dùng HEAD cho MVP, thêm tuỳ chọn index khi làm stage hunk ở giai đoạn 5.

**Hướng mở rộng:** blame annotation trong gutter, diff giữa hai nhánh, diff thư mục, so với clipboard.
