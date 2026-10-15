# v36 — Git Log: thanh công cụ Branches (kiểu IntelliJ / Android Studio)

Goal: dải công cụ dọc bên trái Log: Show/Hide Branches, New Branch, Update Selected, Delete Branch, Compare with Current, Search, Fetch, Favorite, Navigate Log to Selected Branch, More (Group by folder, Show tags), Expand / Collapse All.

## Pieces
- `@ccm/shared` `gitBranch.ts` (`checkBranchName`, `BranchOpResult`); `gitlog.ts` `LogQuery.notRef`.
- Desktop `preview/branches.ts` (create, delete plan + run, fetch, ff update, `sanitizeGitError`); `execGit` thêm `killTree` (git mạng hết 120 s → kill cả cây, Windows không sót `git-remote-https`) và cờ `timedOut` (lỗi spawn → `failed`, không còn báo `timeout`) — audit 2026-10-15.
- IPC `ccm:git-branch-create|delete|update`, `ccm:git-fetch` (dòng `ccm:log-*` của CHANNELS), `confirmGit` trong main (`registerPreviewIpc`) + `strings.ts`, preload, `lib/preview.ts`.
- Web: `refTree` opts + `expandableIds`, `lib/refPrefs.ts`, `LogRefsToolbar.vue`, `NewBranchDialog.vue`, `useGitLog.reveal`, `LogTable.scrollToHash`, strip so sánh + thông báo kết quả trong `LogPane`.

## Rulings
1. Log không còn read-only hẳn: tạo nhánh (tuỳ chọn chuyển sang), fast-forward, fetch, xóa nhánh. Không bao giờ: force-push, update không ff, reset, xóa nhánh hiện tại, xóa tag, checkout nhánh có sẵn.
2. Xóa chỉ sau native confirm trong main hiện đúng lệnh git; nhánh chưa merge cần confirm thứ hai cho `-D`.
3. Update Selected = chỉ fast-forward (nhánh hiện tại `pull --ff-only`, nhánh khác `fetch <remote> <b>:refs/heads/<b>`); không có upstream → từ chối.
4. Fetch = `git fetch --all` (không prune), mạng timeout 120 s, `GIT_TERMINAL_PROMPT=0`.
5. Compare with Current = log `<ref> --not HEAD`, có Swap / Show all; không diff file giữa hai nhánh.
6. Sao = favorite (theo repo, mặc định main / master), nổi lên đầu nhóm; tracking hiện bằng ↑↓ và tooltip.
7. Dải dọc ở mép trái Log, vẫn hiện khi ẩn cây nhánh; nút đầu là Show/Hide Branches (chuyển từ header).
8. Dòng đang focus trong cây = mục tiêu của toolbar; click vẫn lọc log như v30.

## Đổi so với plan chi tiết (lúc review)
- Xóa nhánh remote: `push <remote> --delete refs/heads/<b>` (đủ tên, tag cùng tên trên remote không bị xóa nhầm).
- Update lỗi không nhận ra → `failed` (bỏ fallback `non-ff`: chỉ báo non-ff khi git nói rõ `non-fast-forward` / `Not possible to fast-forward` / `rejected`).
- Compare dùng `refs/heads/<nhánh hiện tại>` thay `HEAD` (sau Swap thanh lọc hiện đúng nhánh nó liệt kê); detached → `HEAD`.
- Clear trên strip so sánh khôi phục filter nhánh trước Compare (`branchBeforeCompare`), không để log đứng ở nhánh vừa so.
- Navigate (`reveal`): commit không có trong list và đang có filter → xóa filter, tải lại ngay rồi mới phân trang tìm; không thấy trong 10 trang → thông báo `notLoaded`.
- `busy` gồm `delete` (toolbar khóa New / Update / Delete / Fetch khi đang xóa, nút Delete hiện spinner).
- Thêm: `fetch --all --no-write-fetch-head`, git < 2.29 thử lại không cờ; `pull --ff-only --no-rebase`; `setFilters` với nhánh mới xóa `notRef`.
- Audit 2026-10-15: `selectedRef` reset khi ẩn cây / đổi repo (`LogRefsTree` key theo root); nhánh hiện tại là favorite hiện cả icon current lẫn sao (sao nhỏ cuối dòng, có aria-label); cây ref có Home / End, → vào con đầu, ← về cha; E2E favorite kiểm thứ tự (nổi lên trên nhánh thường), Compare kiểm list chỉ còn commit không có ở nhánh hiện tại.

## Out of scope
Force push, xóa tag, checkout nhánh có sẵn, diff file giữa hai nhánh. Lệnh xóa không chạy trong E2E (không bấm được native confirm qua CDP) — unit test IPC phủ.

## Tests
`apps/desktop/test/branches.test.ts` (tên, sanitize, create, delete plan/run, fetch/update, non-ff, IPC cancel / -D lần hai / root lạ), `test/log.test.ts` (`notRef`); web `gitRefs.test.ts`, `refPrefs.test.ts`, `logQuery.test.ts`, `useGitLog.test.ts` (`reveal`, reset `notRef`); E2E `apps/desktop/e2e/log.cjs`.

Plan gốc: `docs/superpowers/plans/2026-10-15-log-branches-toolbar.md`. Không bump version theo plan.
