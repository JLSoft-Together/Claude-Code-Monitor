# PLAN v68 — IDE đợt 2 (2026-10-29)

Nguồn: `.planning/IDEAS-2026-10-29-ide.md`. Chủ nhân: "làm hết đi". Ràng buộc như v67: mượt (không chạy nền, không polling), không gửi prompt, gửi ra ngoài phải confirm.

## Thứ tự

1. Lỗi Checks trong editor (`@codemirror/lint`, F8, chấm lỗi trong tree).
2. Review lượt agent: diff `before → after` checkpoint, Giữ / Bỏ hunk.
3. Blame theo dòng → Git Log.
4. Giải xung đột khi gộp (giữ trạng thái merge, khối ours / theirs / both).
5. Tạo PR + trạng thái CI (GitHub account v58, confirm native).

Song song: subagent nghiên cứu thêm 5 ý tưởng → `.planning/IDEAS-2026-10-29b-ide.md`.

## Tiến độ

- [x] 1. Lỗi Checks trong editor: `lib/problems.ts` (+test), `stores/checks.ts` `problemRuns` / `marked`, `ProblemBar.vue` (F8 / Shift+F8), `CodeEditor.vue` prop `problems` → `@codemirror/lint` (dep 6.9.7, màu token), FilePane gạch sóng dòng lỗi, `ExplorerTree.vue` gạch tên file. Typecheck sạch.
- [x] 2. Review lượt: desktop `CheckpointStore.diff(id, to)` / `fileDiff` / `revertHunk` (apply -R qua kho riêng), IPC `ccm:cp-file-diff|revert-hunk`; web `lib/turnReview.ts` `turnPair` (+test), `TurnReview.vue` (Giữ / Bỏ đoạn / Bỏ cả file), nút "Xem lượt này" trong `CheckpointsPanel.vue`. Test desktop checkpoints 4/4.
- [x] 3. Blame: desktop `preview/blame.ts` (`parseBlame`, abort per page) + IPC `ccm:git-blame` (+test 2/2); web `lib/blame.ts` (+test), FilePane menu "Blame", cột tác giả · ngày, bấm → `openLog(root, {select})` qua emit `showCommit`.
- [~] 4. Giải xung đột: desktop xong — `mergeBranch(..., keepConflicts)` trả `kept`, `preview/mergeState.ts` (`mergeState`, `abortMerge` + `confirmRun({kind:'abort'})`), IPC `ccm:git-merge-state|merge-abort`, test worktrees 5/5; web `lib/mergeConflicts.ts` (+test 3/3). CÒN: `ConflictView.vue` trong ChangesPane (entry kind `conflict`), banner "Đang gộp — Huỷ", WorktreeMenu nút "Giữ lại để giải".
- [ ] 5. PR + CI: chưa làm.
- Ghi chú: `apps/web/src/lib/conflicts.ts` là file cũ (xung đột session cùng checkout) — đã lỡ ghi đè rồi khôi phục bằng `git checkout`; code mới ở `mergeConflicts.ts`.
- Ý tưởng mới: `.planning/IDEAS-2026-10-29b-ide.md`, `.planning/IDEAS-2026-10-29c.md` — chờ chủ nhân chốt.
