## WP-14 — XONG (full E2E lần 2: all passed)

Build web + desktop (v3.0.0) OK, rồi chạy lại riêng từng script fail của e2e-full-1.log (CCM_E2E_DBG=9444 CCM_E2E_PORT=4399).

| Script | Kết quả chạy riêng | Nguyên nhân | Sửa |
|---|---|---|---|
| p4, browser, tabs-cwd, explorer, minimap, v27, sidebar | pass lần 1 | flaky / môi trường (máy bận do WP-9 stageshow dev server chạy song song, WP-12 bump version sau build) | không |
| tier2 | fail 2/2 "sidebar groups by project folder" (`dauphReady`) | e2e lệch UI: WP-11 solo row, h3 chứa thêm badge trạng thái | `e2e/tier2.cjs` groupNames đọc `section h3 [data-rail-name]` -> pass 28/28 |
| agent-map, pane-drag, v50-groups, links | pass | flaky (hit-test / merge phụ thuộc tải máy, rail đã ổn sau WP-11) | không |
| v67-ide, whats-new, v74, v75, v76 | pass | whats-new fail do bump 3.0.0 sau build; còn lại flaky / tải | không |

Không có hồi quy code app; chỉ sửa 1 dòng e2e (tier2.cjs:30). Không đổi code app nên không chạy lại typecheck/vitest.

### FULL `node apps/desktop/e2e/run.cjs`
53 script (gồm v79-shots), **1317 PASS / 0 FAIL — "all passed"**.
