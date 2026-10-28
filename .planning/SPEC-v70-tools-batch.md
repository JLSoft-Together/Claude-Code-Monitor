# SPEC v70 — 14 tính năng ngoài git (chốt 2026-10-29 ~02:20)

Nguồn: `.planning/IDEAS-2026-10-29d.md` (1–7) + hỏi thêm lúc 02:20 (8–14). Chủ nhân cho tự build + test, đi ngủ; làm liên tục, không commit.

Ràng buộc chung: chỉ chạy khi bấm / mở (không polling), không gửi prompt (chỉ prefill), không gọi LLM, i18n en + vi, màu qua token, comment ít.

## Chủ nhân đã chốt

| # | Tính năng | Quyết định |
|---|---|---|
| 1 | Hàng đợi prompt | Agent hết lượt (working → idle) → **tự điền** việc kế vào ô nhập, chủ nhân Enter. Không bao giờ tự gửi. |
| 3 | Local History | Data dir, 50 bản / file, 7 ngày, chỉ khi app lưu. |
| 5 | HTTP client | **Mọi host**, gửi từ main khi bấm Send, timeout 30 s; host không phải loopback / LAN → native confirm lần đầu mỗi host mỗi phiên. |
| 6 | Ghi chú dự án | Data dir `<dataDir>/notes/<hash>.md`, không trong repo. |
| 7 | Format | Bản trong project trước, **rồi bản global trên PATH** (prettier, dart, ktlint). Luôn xem diff trước khi áp. |

## Danh sách + mặc định con giữ

1. **Hàng đợi prompt** — mỗi pane agent; nút trên header TermPane mở popover (thêm / sửa / xoá / kéo thứ tự, tạm dừng). Lưu sessionStorage theo pane key. Tín hiệu hết lượt dùng chung với overlap store.
2. **Bảng kế hoạch `.planning/`** — pane mới (`plan`), đọc `PLAN-*`, `PROGRESS-*`, `SPEC-*`, `TODO-*`; checklist `- [ ]` / `- [x]` / `- [~]`; bấm ô → `fileWrite` với mtime; lọc "chưa xong"; "Điền vào agent".
3. **Local History** — desktop `preview/localHistory.ts`; IPC `ccm:lh-list|lh-read`; ghi sau mỗi `ccm:file-write` thành công (bản trước khi ghi). Xem trong FilePane "…" → Local History (danh sách + diff + Khôi phục = nạp vào editor, chưa lưu).
4. **Lỗi terminal → Problems** — nút "Quét lỗi" trên pane shell / Run: đọc buffer xterm, parse `file:line[:col]` (tsc, eslint, dart, gradle/kotlin, pytest, node stack) → `stores/problems` nguồn `terminal`; gạch sóng + F8.
5. **HTTP client** — file `.http` / `.rest`: parse request (`###`), biến `{{x}}` từ `http-client.env.json` + `@x = …`; nút ▶ Send; panel kết quả (status, thời gian, header, body JSON fold). Giá trị biến tên chứa token/secret/key/password che `•••`. Body trả về ≤ 5 MB.
6. **Ghi chú dự án** — Ctrl+Alt+N (mac ⌃⌥N) mở pane ghi chú markdown của project; `@path:line` → link mở file; "Điền vào agent".
7. **Format theo yêu cầu** — FilePane "…" → Format: chọn formatter theo đuôi (prettier cho js/ts/vue/json/css/md/html/yaml; `dart format`; ktlint `-F` cho kt/kts), chạy trên nội dung qua stdin, hiện diff, Áp = thay buffer (chưa lưu).
8. **Bookmark (F11)** — F11 bật / tắt bookmark dòng hiện tại; Shift+F11 danh sách mọi bookmark project; dấu ở gutter. localStorage `ccm.bookmarks`.
9. **Gần đây** — Ctrl+E (trong editor; global Alt+Shift+E, mac ⌘E) mở danh sách file vừa xem; tab "Vị trí vừa sửa" có đoạn code. Back / Forward: Ctrl+Alt+← / → (mac ⌃- / ⌃⇧-).
10. **TODO / FIXME** — panel thứ ba trong Explorer (Files | Changes | TODO), `git grep` (dùng `ccm:search`) regex `\b(TODO|FIXME|HACK|XXX)\b`, quét khi mở tab + nút làm mới.
11. **JSON / YAML dạng cây** — nút Tree / Code trên FilePane cho `.json` / `.yaml` / `.yml`; fold, lọc key, copy path.
12. **So sánh ảnh** — ChangesPane: file ảnh đổi → `ImageCompare` (cạnh nhau / trượt / chồng mờ), bản cũ đọc từ `git show HEAD:<path>`.
13. **File log lớn** — `.log` (và `logcat*.txt`) mở chế độ log: tô màu mức, lọc text / mức, follow tail khi file đổi; đọc theo khối từ cuối (≤ 200 MB).
14. **Terminal thả xuống** — Ctrl+` (mac ⌃`) trượt terminal shell từ trên (40 % cao), cwd = project tab đang mở; ẩn thì PTY vẫn sống.

15. **Thay thế trên nhiều file** — ô Replace trong `ExplorerSearch`; xem trước từng chỗ, bỏ tick; native confirm (số file / số chỗ) → desktop ghi lần lượt, mỗi file kiểm mtime, ghi Local History trước. Không regex group thay thế ngoài `$1..$9`.
16. **Màu trong code** — CodeMirror widget ô màu cạnh `#rgb[a]` / `#rrggbb[aa]`, `rgb[a](…)`, `Color(0xAARRGGBB)`, `<color name>#…</color>`; bấm → `<input type=color>` sửa giá trị (giữ alpha).
17. **So hai file bất kỳ** — Explorer: chọn file → menu "Chọn để so", file thứ hai → "So với …" mở merge view; thêm "So với clipboard".
18. **Key i18n thiếu** — desktop quét `res/values*/strings.xml`, `*.arb` (l10n), JSON locale `locales/*.json`; báo thiếu / thừa / giống bản gốc; panel từ Ctrl+K hoặc menu project. (TS locale như en.ts không parse được an toàn → bỏ, ghi lệch.)
19. **Kiểm .env** — so `.env*` với `.env.example` / `.env.sample`: thiếu, thừa, rỗng; giá trị che, bấm mắt mới hiện (đọc từ main khi bấm).
20. **Markdown song song** — FilePane .md chế độ Edit: nút Split preview, cuộn đồng bộ theo tỉ lệ dòng.
21. **Công cụ dev** — Ctrl+K "Tools: …": JWT decode (không verify), base64 ↔, URL ↔, timestamp ↔ ngày, đếm ký tự/byte, UUID v4. Dialog nhỏ, tại máy.

## Thứ tự làm

Nhỏ trước, dùng lại nhiều: 8 → 9 → 11 → 10 → 6 → 3 → 7 → 4 → 1 → 2 → 12 → 13 → 5 → 14 → 20 → 16 → 17 → 21 → 19 → 15 → 18. Sau cùng: E2E `e2e/v70-tools.cjs` + hồi quy, `.code_index`, đề xuất commit (dừng trước git).
