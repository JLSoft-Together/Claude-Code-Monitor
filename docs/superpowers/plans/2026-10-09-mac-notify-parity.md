# macOS Notifications & Parity (group C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phân loại trạng thái chờ (cần duyệt / đang hỏi). Trên app desktop macOS: thông báo native bấm vào để tới đúng terminal, Jump/WaitingQueue hoạt động, mở session và chọn thư mục từ Favorites.

**Architecture:**
- **C1:** hàm thuần `waitReason` trong shared, dùng cho nhãn ở web và nội dung toast.
- **C2a:** `focus-mac.ts` đi ngược cây `ps` để tìm `.app` chủ và tty, rồi chọn tab bằng AppleScript (Terminal/iTerm2) hoặc `open -a` (các app khác).
- **C2b:** thêm backend `ToastDeps` thứ hai, gửi `toast.*` qua `parentPort` sang `notifier.ts` của Electron. Notifier hiện `Notification` native; khi người dùng bấm thì gọi lại `POST /focus` sẵn có.
- **C3:** nhánh darwin cho `launcher.ts` / `folder-pick.ts` qua `osascript` với `on run argv`.

**Tech Stack:** Node + TS (collector), Electron 44 (desktop), Vue 3 + Pinia + vue-i18n (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-mac-notify-parity-design.md`

## Global Constraints

- Chỉ quan sát. Không gõ phím hay gửi input vào session Claude đang chạy. Launcher chỉ ghi lệnh vào shell **mới** do chính nó tạo.
- Mọi chuỗi từ hệ thống (tty, đường dẫn, bundle, dir) đi qua `argv` (`osascript -e <SCRIPT> <args…>` với `on run argv`; `open -a <bundle>`). Không bao giờ ghép chuỗi vào script. Trong AppleScript, đường dẫn đưa vào shell dùng `quoted form of`.
- `tty` phải khớp `^ttys\d+$`. Bundle phải kết thúc bằng `.app`. Không quá 8 cấp tổ tiên.
- `FocusWindowResult` thêm `'appOnly' | 'denied'`. `TerminalApp = 'terminal' | 'iterm'`, mặc định `'terminal'`.
- Mã lỗi osascript: `-1743` → `denied`; `-1728` hoặc "Can't get application" → `notInstalled`; `-128` → `cancelled`; còn lại → `failed`.
- Toast được hỗ trợ khi `(process.platform === 'win32' || env.CCM_TOAST_BACKEND === 'electron') && env.CCM_TOAST !== '0'`. Desktop chỉ đặt `CCM_TOAST_BACKEND=electron` trên darwin.
- Windows giữ nguyên hành vi. Linux vẫn `unsupported`.
- UI: mọi chuỗi qua i18n (`en.ts` + `vi.ts`, `vi: typeof en`). Màu chỉ dùng token theme. Trạng thái có icon + chữ + màu. Không cuộn ngang.
- Lệnh: `npm test -w @ccm/collector -- <file>`, `npm test -w @ccm/web -- <file>`, `npm run typecheck`. Đã biết: `job-actions.test.ts › looks for the real executable…` lỗi sẵn trên macOS.
- Git trong worktree: dùng `/usr/bin/git` (hook RTK bị chặn). Subagent không chạy git; controller commit.

## Review Focus

1. **Đường dẫn có dấu cách, nháy đơn hoặc `$(…)`** khi launch: thư mục phải mở đúng và không thực thi gì. Test ở Task 6 (`launchArgs keeps the dir as a separate argv item`), và bước kiểm thủ công dùng thư mục `a b'c`.
2. **Session không có tty** (`sdk-cli` qua bun) hoặc không có `.app` tổ tiên: trả `notFound`, không crash và không `open -a` lung tung. Test ở Task 3 (`hostOf returns null without an .app ancestor`).
3. **Người dùng từ chối quyền Automation:** trả `denied` kèm hướng dẫn, không phải `failed` chung chung. Test ở Task 3 / Task 6 (ánh xạ `-1743`).
4. **Collector mượn từ `.bat` trên mac** (không có `parentPort`): toast vẫn `unsupported`, không ném lỗi. Test ở Task 4 (`config enables toast only for win32 or the electron backend`) và wiring trong `index.ts`.
5. **`waitingFor` lạ** (Claude Code thêm chuỗi mới): UI giữ nguyên chuỗi gốc, không gán nhầm "Cần duyệt". Test ở Task 2 (`waitReason maps unknown strings to other`).

---

### Task 1: Kiểm chứng trên máy này (controller cùng người dùng, không giao subagent)

**Files:**
- Modify: `docs/claude-code-integration.md` (mục mới `## 11n. Waiting reasons and macOS automation (2026-10-09)` trước `## 12. Open items`)
- Modify (nếu cần): `docs/superpowers/specs/2026-10-09-mac-notify-parity-design.md` §3 (bảng phân loại)

**Interfaces:**
- Produces: bảng `waitingFor` → `WaitReason` đã kiểm chứng (Task 2 dùng). Quyết định có giữ nút Snooze trong thông báo hay không (Task 5 dùng). Câu AppleScript chọn tab đã chạy thật (Task 3 dùng).

- [ ] **Step 1:** Người dùng gây ra (a) một permission prompt Bash, (b) một AskUserQuestion, (c) bước duyệt plan. Controller đọc `~/.claude/sessions/<pid>.json` mỗi lần và ghi lại `status` + `waitingFor`.
- [ ] **Step 2:** Chạy thử AppleScript chọn tab theo tty với Terminal.app (và iTerm2 nếu có cài), từ chính terminal của người dùng. Ghi lại lời nhắc quyền và stderr khi bị từ chối.
- [ ] **Step 3:** Chạy một script Electron tối thiểu (`npx electron` với `new Notification({title, body, actions:[{type:'button',text:'Snooze'}]})`) trên máy. Ghi lại: có hiện không, có xin quyền không, action có hiện không. Ghi chú: app `.dmg` ký ad-hoc có thể khác với `npx electron`, nên kiểm lại ở Task 5.
- [ ] **Step 4:** Ghi kết quả vào §11n. Chỉnh bảng §3 của spec nếu chuỗi thật khác. Commit `docs: record observed waitingFor values and macOS automation behavior`.

### Task 2: C1, `waitReason` + nhãn chờ ở web + nội dung toast

**Files:**
- Modify: `packages/shared/src/status.ts`
- Create: `apps/web/src/lib/wait.ts`, test `apps/web/src/lib/wait.test.ts`
- Modify: `apps/web/src/components/{WaitingQueue,SessionCard,AgentNode,CompactView,ActivityFeed}.vue`, `apps/web/src/composables/useNotifications.ts`, `apps/web/src/i18n/{en,vi}.ts`
- Modify: `apps/collector/src/toast.ts` (`TEXT` + chỗ dựng body waiting, khoảng `:218`, `:472`)
- Test: `apps/collector/test/units.test.ts` (shared `waitReason`), `apps/collector/test/toast.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared
  export type WaitReason = 'permission' | 'question' | 'other'
  export function waitReason(waitingFor?: string | null): WaitReason
  // web lib/wait.ts
  export interface WaitDisplay { reason: WaitReason; icon: Component; text: string }
  export function waitDisplay(waitingFor: string | undefined, tool: string | undefined, t: (k: string, p?: Record<string, unknown>) => string): WaitDisplay | null  // null khi không có waitingFor
  ```
  Icon: `ShieldQuestion` (permission), `MessageCircleQuestion` (question), icon chờ hiện có của từng component cho `other` (lấy từ `StatusIcon`/`Hourglass` như hiện tại; `waitDisplay` trả `Hourglass` cho `other`).
  i18n: `wait.permission`, `wait.permissionTool {tool}`, `wait.question`.

- [ ] **Step 1: Test lỗi.**
  - `waitReason maps documented values`: `'permission prompt'`, `' Permission Prompt '`, `'sandbox request'`, `'worker request'` → `permission`; `'input needed'`, `'dialog open'` → `question`.
  - `waitReason maps unknown strings to other`: `'something new'`, `''`, `undefined` → `other`.
  - `waitDisplay` dùng tool khi có; `other` trả text gốc.
  - Toast body cho session `permission prompt` có tool đang mở thì chứa nhãn "Needs approval: Bash" (en). Lấy tool từ `store` (main agent `currentTool`) qua `observe` input mới `toolOf(id)`, cùng kiểu với `contextPct`.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Implement.** Bảng phân loại lấy từ kết quả Task 1. Các component thay `t('terminal.waitingFor', { reason })` bằng `waitDisplay(...)` (icon + text). Chuỗi `other` giữ nguyên định dạng cũ.
- [ ] **Step 4:** Chạy test focused, rồi toàn bộ suite web và collector cùng typecheck → PASS.
- [ ] **Step 5:** Commit `feat: label waiting sessions as needing approval or asking a question`.

### Task 3: C2a, focus terminal trên macOS

**Files:**
- Create: `apps/collector/src/osascript.ts`, `apps/collector/src/focus-mac.ts`
- Modify: `apps/collector/src/focus.ts` (dispatcher), `apps/collector/src/monitor.ts:57` (default `focusWindow`), `packages/shared/src/types.ts:344`
- Modify: `apps/web/src/i18n/{en,vi}.ts` (`terminal.jumpError.appOnly`, `.denied`, `.unsupported` viết trung tính), `apps/web/src/components/SessionCardHeader.vue` / `WaitingQueue.vue` / `CompactView.vue` (hiện `appOnly` bằng màu `ink-muted` + icon `Info`, không dùng màu lỗi)
- Test: `apps/collector/test/focus-mac.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // osascript.ts
  export interface RunResult { code: number; stdout: string; stderr: string }
  export type Runner = (command: string, args: string[]) => Promise<RunResult>
  export const runCommand: Runner                       // spawn, không shell, timeout 10 s
  export type OsaError = 'denied' | 'notInstalled' | 'cancelled' | 'failed'
  export function parseOsaError(stderr: string): OsaError
  // focus-mac.ts
  export interface PsRow { pid: number; ppid: number; tty: string; comm: string }
  export function parsePsTree(stdout: string): Map<number, PsRow>
  export interface MacHost { kind: 'terminal' | 'iterm' | 'app'; bundle: string; tty?: string }
  export function hostOf(tree: Map<number, PsRow>, pid: number): MacHost | null
  export function focusMacWindow(pid: number, run?: Runner): Promise<FocusWindowResult>
  // focus.ts
  export function focusTerminalWindow(pid: number, platform?: NodeJS.Platform): Promise<FocusWindowResult>  // win32 → focusProcessWindow, darwin → focusMacWindow, khác → 'unsupported'
  // shared
  export type FocusWindowResult = 'ok' | 'notFound' | 'ambiguous' | 'failed' | 'unsupported' | 'appOnly' | 'denied'
  ```
  Script AppleScript là hằng trong `focus-mac.ts`. `argv` item 1 = `/dev/<tty>`. Script in ra `ok` hoặc `notFound`.

- [ ] **Step 1: Test lỗi.**
  - `parsePsTree` (với `comm` có dấu cách: `/Applications/IntelliJ IDEA.app/Contents/MacOS/idea`).
  - `hostOf` với fixture thật `claude(ttys003) → /bin/zsh → /Applications/WebStorm.app/Contents/MacOS/webstorm` → `{kind:'app', bundle:'/Applications/WebStorm.app', tty:'ttys003'}`.
  - Terminal.app → `kind:'terminal'`; iTerm2 → `kind:'iterm'`.
  - `hostOf returns null without an .app ancestor` (`claude → bun`).
  - tty `??` → `tty` undefined.
  - `focusMacWindow`:
    - Terminal + tty → runner nhận `('osascript', ['-e', SCRIPT, '/dev/ttys003'])` và stdout `ok` → `ok`.
    - App khác → `('open', ['-a', bundle])` → `appOnly`.
    - stderr chứa `-1743` → `denied`.
    - Không có host → `notFound` (không gọi runner lần hai).
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Implement.** Monitor default `focusWindow: (pid) => focusTerminalWindow(pid)`. Kiểm tra lại các chỗ web hiện `jumpError` để `appOnly` không bị coi là lỗi.
- [ ] **Step 4:** Chạy test focused + toàn bộ suite + typecheck → PASS.
- [ ] **Step 5:** Commit `feat(collector): focus the terminal tab on macOS`.

### Task 4: C2b phía collector, backend toast Electron

**Files:**
- Modify: `packages/shared/src/notify.ts` (`ToastMessage`, `parseToastMessage`)
- Create: `apps/collector/src/toast-electron.ts`
- Modify: `apps/collector/src/config.ts:48`, `apps/collector/src/index.ts:52` (truyền deps)
- Test: `apps/collector/test/toast-electron.test.ts`, `apps/collector/test/units.test.ts` (config)

**Interfaces:**
- Produces:
  ```ts
  // shared notify.ts
  export type ToastMessage =
    | { type: 'toast.show'; tag: string; title: string; body: string; persistent: boolean; focus: { t: string; k: string }; snooze?: { t: string; k: string; m: number; label: string } }
    | { type: 'toast.hide'; tag: string }
  export function parseToastMessage(data: unknown): ToastMessage | null   // tag 1..200, string fields, m số nguyên > 0
  // collector
  export function electronToastDeps(post: (msg: ToastMessage) => void, now?: () => number): ToastDeps
  // config: thêm `toastBackend: 'powershell' | 'electron' | null` (null = unsupported); `toast` giữ nghĩa supported
  ```
  `focus.t/k` tách từ `ToastContent.url` (`/focus?k=&t=`), `snooze.*` tách từ `snoozeUrl`. URL không parse được thì trả `show` → `false`.

- [ ] **Step 1: Test lỗi.**
  - `parseToastMessage` nhận message hợp lệ và từ chối các message thiếu, sai kiểu hoặc tag dài 201 ký tự.
  - `electronToastDeps.show` post đúng message (kèm `snooze` khi có `snoozeUrl`); `hide` post `toast.hide`.
  - `config enables toast only for win32 or the electron backend`: dùng `loadConfig` với env và platform giả lập. Nếu `loadConfig` chưa nhận platform thì thêm tham số `platform = process.platform`.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Implement.** Trong `index.ts`: nếu `config.toastBackend === 'electron'` và có `process.parentPort` thì `new Toaster({...}, { ...defaultToastDeps, ...electronToastDeps((m) => parentPort.postMessage(m)) })`. Nếu thiếu `parentPort` thì coi như unsupported.
- [ ] **Step 4:** Chạy test focused + toàn bộ suite + typecheck → PASS.
- [ ] **Step 5:** Commit `feat(collector): route system notifications to the desktop app on macOS`.

### Task 5: C2b phía desktop, `notifier.ts`

**Files:**
- Create: `apps/desktop/src/notifier.ts`
- Modify: `apps/desktop/src/collector-host.ts` (option `onMessage`, `child.on('message', …)`), `apps/desktop/src/main.ts` (env `CCM_TOAST_BACKEND` trên darwin, nối notifier)
- Modify: `apps/web/src/i18n/{en,vi}.ts`: các nhãn "Windows toast" trong SettingsMenu viết trung tính ("System notifications" / "Thông báo hệ thống")

**Interfaces:**
- Consumes: `parseToastMessage`, `ToastMessage` (Task 4); `POST /focus {t,k}` → `{ result }` (đã có); `GET /snooze?k&t&m` (đã có).
- Produces:
  ```ts
  export interface Notifier { handle(data: unknown): void; closeAll(): void }
  export function createNotifier(opts: { port: number; onFallback: (terminalId: string) => void }): Notifier
  // CollectorHostOptions += onMessage?: (data: unknown) => void
  ```
  Click: `fetch(POST /focus)`; nếu `result` ∉ {`ok`, `appOnly`} → `onFallback(t)`. Main làm `showMain()` + `mainWindow.loadURL(`${ORIGIN}/?focus=${encodeURIComponent(t)}`)`. Action → `fetch(GET /snooze?…)`. `closeAll()` khi quit.

- [ ] **Step 1:** Implement. Notifier chạy trong Electron runtime nên không có unit test; phần kiểm tra message đã được test ở Task 4.
- [ ] **Step 2:** `npm run typecheck` sạch.
- [ ] **Step 3: Kiểm thủ công** (controller cùng người dùng): `npm run desktop`, gây ra một session `waiting` → thông báo hiện. Bấm vào thì tới đúng tab Terminal, hoặc WebStorm được đưa lên trước. Thử nút Snooze nếu Task 1 xác nhận action hiện được (nếu không thì bỏ `actions`). Đóng app thì không còn thông báo nào treo.
- [ ] **Step 4:** Commit `feat(desktop): show native macOS notifications that open the right terminal`.

### Task 6: C3, launcher và chọn thư mục trên macOS

**Files:**
- Modify: `apps/collector/src/launcher.ts`, `apps/collector/src/folder-pick.ts`, `apps/collector/src/monitor.ts` (`MonitorDeps.launch`, `openFavorite`), `apps/collector/src/server.ts:335`, `apps/collector/src/index.ts` (route `favorite.open`), `packages/shared/src/types.ts` (`TerminalApp`, `favorite.open.terminalApp?`, `launch.failed` error codes)
- Modify: `apps/web/src/stores/ui.ts` (`launchTerminal`, localStorage `ccm.launchTerminal`), `apps/web/src/stores/connection.ts:315` (`openFavorite` gửi kèm `ui.launchTerminal`), `apps/web/src/components/SettingsMenu.vue` (mục "Mở session bằng", chỉ khi `isMac`), `apps/web/src/i18n/{en,vi}.ts` (`settings.launchTerminal*`, `activity.launchError.{denied,notInstalled,failed}`, `favorites.pickError.unsupported` trung tính)
- Test: `apps/collector/test/units.test.ts` (launcher, folder-pick), `apps/collector/test/monitor.test.ts`, `apps/collector/test/hardening.test.ts`, `apps/web/src/stores/stores.test.ts`

**Interfaces:**
- Consumes: `Runner`, `runCommand`, `parseOsaError` (Task 3).
- Produces:
  ```ts
  export type TerminalApp = 'terminal' | 'iterm'                       // shared
  export function launchArgs(app: TerminalApp, dir: string, mode: LaunchMode): string[]   // ['-e', SCRIPT, dir, cmd]; cmd ∈ {'claude','claude --continue'}
  export async function launchClaude(dir: string, mode: LaunchMode, spawner?: Spawner, terminalApp?: TerminalApp, platform?: NodeJS.Platform, run?: Runner): Promise<void>
  // darwin: run('osascript', launchArgs(...)); code ≠ 0 → throw new LaunchError(parseOsaError(stderr))
  export class LaunchError extends Error { constructor(readonly code: 'denied' | 'notInstalled' | 'failed') }
  export function pickFolder(platform?: NodeJS.Platform, run?: Runner): Promise<{ result: FolderPickResult; dir?: string }>
  // MonitorDeps.launch?: (dir, mode, terminalApp?) => Promise<void>; Monitor.openFavorite(dir, mode, terminalApp?)
  // launch.failed data.error: LaunchError.code khi có, ngược lại 'failed' (Windows giữ như cũ)
  ```

- [ ] **Step 1: Test lỗi.**
  - `launchArgs keeps the dir as a separate argv item`: dir `/tmp/a b'c$(x)` nằm nguyên ở `args[2]`, và script chứa `quoted form of`.
  - `continue` → cmd `claude --continue`.
  - `launchClaude` trên darwin với runner giả: stderr `-1743` → `LaunchError('denied')`; `Can't get application "iTerm"` → `notInstalled`.
  - `pickFolder` trên darwin: stdout `/Users/x/p/\n` → `{ ok, dir: '/Users/x/p' }`; `-128` → `cancelled`.
  - `monitor.test.ts`: `favorite.open` có `terminalApp: 'iterm'` truyền xuống `deps.launch`.
  - `hardening.test.ts`: `terminalApp: 'warp'` thì message đi qua nhưng không còn field đó.
  - `stores.test.ts`: `ui.launchTerminal` mặc định `terminal`, lưu và đọc lại được.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3: Implement.** Đường Windows giữ nguyên (`spawner` dùng cho win32; `run` cho darwin).
- [ ] **Step 4:** Chạy test focused + toàn bộ suite + typecheck → PASS.
- [ ] **Step 5: Kiểm thủ công:** từ dashboard, mở session bằng Terminal.app, rồi bằng iTerm2, với thư mục `a b'c` (đã đánh dấu sao). Bấm Browse rồi chọn một thư mục. Thử Cancel.
- [ ] **Step 6:** Commit `feat: launch sessions and pick folders on macOS`.

### Task 7: Tài liệu + code index + kiểm thử tổng

**Files:**
- Modify: `docs/claude-code-integration.md` §7b (bảng nền tảng), §11k (thông báo native, quyền Automation, kết quả Task 1/5/6)
- Modify: `.code_index/{collector,web,desktop,protocol,_meta}.md`

- [ ] **Step 1:** Cập nhật docs và code index theo các module mới (`osascript.ts`, `focus-mac.ts`, `toast-electron.ts`, `notifier.ts`, `lib/wait.ts`) và các message/kiểu mới.
- [ ] **Step 2:** `npm run typecheck`, `npm test` → chỉ còn lỗi đã biết.
- [ ] **Step 3: Kiểm thủ công theo tiêu chí §1 của spec** trên app desktop: thông báo → đúng tab; Jump từ SessionCard/WaitingQueue cho Terminal/iTerm2/WebStorm; nhãn "Cần duyệt: Bash" / "Đang hỏi bạn"; launch; Browse.
- [ ] **Step 4:** Commit `docs: macOS notifications and parity`.
