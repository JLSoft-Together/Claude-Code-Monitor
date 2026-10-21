# v61 — Devices tab: escrcpy multi-device ADB connection logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port escrcpy's multi-device ADB connection logic (USB + Wi-Fi connect / pair / disconnect, USB→Wi-Fi switch, remembered devices with alias + auto-connect, QR pairing, mDNS discover, multi-select batch connect/disconnect/remove) into Orrery as a new header tab **Devices**.

**Architecture:** escrcpy runs `@devicefarmer/adbkit` inside each window's preload; Orrery's preload is sandboxed, so the logic moves into the Electron main process as `apps/desktop/src/devices/*` (a `DeviceManager` driving the `adb` CLI through the existing `Spawner`, never a shell), exposed over `ccm:dev-*` IPC behind `isAppFrame`, mirrored by a Pinia store and a `DevicesView`. The device tracker reuses the Run feature's `adb track-devices` code, extracted into a generic `createAdbWatch`. Run's device picker sees Wi-Fi devices with no coupling, because both talk to the same adb server.

**Tech Stack:** Electron main (Node, TS), Vue 3 + Pinia + vue-i18n + Tailwind + lucide-vue-next, Vitest (desktop: node; web: happy-dom + @vue/test-utils), `qrcode@1.5.4` (new web dependency, exact pin).

**Spec:** this plan + the owner's answers (2026-10-21): header tab "Devices"; scope = connect/pair/disconnect + tcpip, history + auto-connect + alias, QR + mDNS discover, multi-select batch; mDNS via `adb mdns services` (no bonjour); adb from the existing SDK resolution (no bundled adb). Reference source: `src/escrcpy/desktop/electron/middleware/adb/index.js`, `.../adb/helpers/scanner/index.js`, `src/escrcpy/desktop/src/views/device/**`, `src/escrcpy/desktop/src/store/device/**`, `src/escrcpy/packages/shared/src/device.ts`.

## Context

Orrery already lists Android devices, but only for the Run pane (`apps/desktop/src/run/android/devices.ts`: `adb track-devices -l`, held only while a Run pane is open). It cannot connect a phone over Wi-Fi, so wireless devices never show up in the Run picker unless the owner types `adb connect` in a terminal. escrcpy (vendored at `src/escrcpy`, Apache-2.0) has a mature multi-device flow. This plan ports its logic (not its code: no adbkit, no electron-store) and fixes six escrcpy gaps on the way:
1. The tracker ignores the `change` event (unauthorized → device never refreshes).
2. The tracker is not restarted after the adb server dies.
3. `adb devices -l` is parsed by token position (breaks without `usb:`).
4. QR pairing accepts any pairing service instead of the one it advertised.
5. Pair does not connect afterwards.
6. `sheller` builds an unquoted cmd.exe string.

## Global Constraints

- Desktop only: every web entry point is behind `hasDevices` (bridge present); the collector is untouched.
- adb path: `findAdbTools` order = Settings `androidSdk` → `ANDROID_HOME` → `ANDROID_SDK_ROOT` → `defaultSdkDir()` → PATH. Never bundle adb.
- Spawn adb only through `Spawner` with an args array; never `shell: true`; reject any argument starting with `-` that came from the page.
- Page-supplied values are validated in `ipc.ts`:
  - id: `/^[A-Za-z0-9_.:@%\[\]-]{1,128}$/`
  - id arrays: at most 50 entries
  - pair code: `/^\d{6}$/`
  - alias: a trimmed string of at most 64 chars, or null
  - address: via `parseAddress`
- Results use the shape `{ ok: true, detail? } | { ok: false, error: DevErrorCode, detail? }`; the UI maps `error` to i18n `devices.error.<code>`; `cancelled` stays silent.
- History file: `<DATA_DIR>/adb-devices.json`, written with tmp + rename (LayoutStore pattern), at most 200 entries (drop oldest `lastSeen`).
  - `unauthorized` devices are never saved.
  - History is written only when the set of ready device ids, or an alias, changes. A list event that changes nothing does not write.
- Batch operations run at most 5 adb commands at once (escrcpy `concurrencyLimit` default).
- Timeouts (ms):
  - `connect` 15 000, `pair` 20 000, other adb commands 10 000.
  - QR: wait for the pairing service 60 000, wait for the connect service 30 000; mDNS poll every 1 000.
  - USB→Wi-Fi: wait 1 000 between `tcpip` and `connect`.
- Ports: default Wi-Fi port 5555 (`tcpip 5555`); a valid port is 1–65535.
- QR payload exactly `WIFI:T:ADB;S:<name>;P:<password>;;`. Values:
  - `name` = `orrery-` + 8 lowercase hex chars from `crypto.randomBytes(4)`.
  - `password` = 6 digits from `crypto.randomInt(0, 1e6)`, zero-padded.
- Auto-connect: on app ready, once per app run, only when `autoConnect` is on (default true) AND history holds at least one Wi-Fi id. It runs `adb connect` for each and does not start a tracker.
- Device tracker lifetime: runs only while at least one window holds the Devices view (`ccm:dev-hold`), released on window destroy / main-frame navigation (Run `ownerOf` pattern); stopped (`sync`) on quit.
- Removing history rows asks a native confirm first (main `confirmBox`, warning, default Cancel). Disconnect needs no confirm.
- UI rules (CLAUDE.md):
  - All strings go through vue-i18n `en` + `vi`; desktop native strings go in `apps/desktop/src/strings.ts` `en` + `vi`.
  - Status = icon + text + color (lifecycle status colours only); colours come from theme tokens only.
  - No horizontal page scroll; long ids truncate with a `title` tooltip.
  - The QR tile alone is black-on-white (needed for scanning).
  - Before UI work, load the skills `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max`.
- No new desktop dependencies. Web adds exactly `qrcode@1.5.4` and `@types/qrcode@1.5.5` (dev). If `npm install` reports a different `@types/qrcode` latest 1.5.x, pin that exact version instead.
- Naming: planning doc `.planning/PLAN-v61-adb-devices.md`; i18n module `apps/web/src/i18n/devices-v61.ts`; commits use gitmoji (repo history).

## Review Focus

1. **adb not found / adb server fails to start.**
   - Expected: the view shows "adb not found" with a hint to set the Android SDK in Settings, and every action returns `adb-missing`. Nothing throws or hangs.
   - Covered by Task 5 test `snapshot reports adb:null and actions return adb-missing`.
2. **The same phone on USB and Wi-Fi at once, and a history row whose id is online again.**
   - Expected: two separate online rows (USB serial, `ip:port`) and no duplicate history row.
   - The Wi-Fi button shows only on USB `ready` rows; Disconnect shows only on online Wi-Fi rows.
   - Covered by Task 5 test `merge keeps usb and wifi rows and hides history duplicates`.
3. **`adb connect` to an unreachable IP hangs.**
   - Expected: after 15 s the child is killed and the result is `timeout`; the row's busy state clears.
   - Covered by Task 3 test `connect times out and kills the child`.
4. **Batch over more than 5 ids with mixed outcomes.**
   - Expected: at most 5 concurrent adb children, one failure does not abort the rest, and results come back per id in input order.
   - Covered by Task 5 test `connectMany caps concurrency at 5 and returns per-id results`.
5. **QR flow cancelled, or the window closed mid-pairing; mDNS unavailable.**
   - Expected: polling stops at once with no stray `adb mdns` children, and the page gets status `cancelled`.
   - `adb mdns check` reporting unavailable yields `mdns-unavailable` before any QR is shown.
   - Covered by Task 6 tests `cancel stops polling` and `mdns unavailable fails fast`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/shared/src/devices.ts` (new, exported from `packages/shared/src/index.ts`) | `AdbDevice`, `AdbState`, `AdbTransport`, `AdbMdnsService`, `DevResult`, `DevErrorCode`, `DevSnapshot`, `DevEvent`, `QrStatus`, `DevBatchResult` |
| `apps/desktop/src/devices/parse.ts` (new) | Pure parsers: device rows, mDNS services, connect / pair / disconnect output, `wlan0` IP, address parsing, Wi-Fi id detection |
| `apps/desktop/src/run/android/adbWatch.ts` (new) | Generic `adb track-devices -l` watcher with restart → poll fallback (extracted from `createAdbDevices`) |
| `apps/desktop/src/run/android/devices.ts` (modify) | `createAdbDevices` delegates tracking to `createAdbWatch`; `findTools` exported as `findAdbTools` |
| `apps/desktop/src/run/parse.ts:131-151` (modify) | `parseAdbDevices` built on `parseAdbDeviceRows` (output unchanged) |
| `apps/desktop/src/devices/adb.ts` (new) | `createAdbCommands`: connect, pair, disconnect, tcpip, wlanIp, mdnsCheck, mdnsServices |
| `apps/desktop/src/devices/history.ts` (new) | `DeviceHistory` JSON store (aliases, remembered devices, autoConnect) |
| `apps/desktop/src/devices/manager.ts` (new) | `DeviceManager`: merge live + history, holds, all actions, batch limiter, auto-connect, QR sessions |
| `apps/desktop/src/devices/qr.ts` (new) | `qrPayload`, `runQrPairing` polling state machine |
| `apps/desktop/src/devices/ipc.ts` (new) | `registerDevicesIpc` (channels, validation, owners) |
| `apps/desktop/src/main.ts:869-914`, quit path at `:140`/`:172` (modify) | Build `DeviceManager`, register IPC, start auto-connect, stop on quit |
| `apps/desktop/src/preload.ts` (modify) | `dev*` methods + `onDevEvent` |
| `apps/desktop/src/strings.ts` (modify) | `devRemoveTitle`, `devRemoveDetail`, `devRemoveConfirm` (en + vi) |
| `apps/web/src/lib/devices.ts` (new) | `DevicesBridge`, `hasDevices`, typed wrappers with fallbacks (lib/github.ts pattern) |
| `apps/web/src/stores/devices.ts` (new) | `useDevicesStore` |
| `apps/web/src/components/devices/DevicesView.vue`, `DeviceRow.vue`, `DeviceQrPopover.vue`, `DeviceConnectBar.vue` (new) | UI |
| `apps/web/src/stores/ui.ts:9-22`, `App.vue:33,120`, `components/AppHeader.vue:29`, `components/CommandPalette.vue:136` (modify) | Register view `'devices'` |
| `apps/web/src/i18n/devices-v61.ts` (new), `i18n/en.ts`, `i18n/vi.ts` (modify) | Strings |
| `apps/desktop/e2e/fixtures/run-fakes/adb.js` (modify), `apps/desktop/e2e/devices.cjs` (new) | E2E |
| `docs/claude-code-integration.md` (new §11aa), `.code_index/{_meta,desktop,web,protocol}.md`, `CLAUDE.md` "What this is", `.planning/PLAN-v61-adb-devices.md` | Docs |

---

### Task 1: Shared types + ADB output parsers

**Files:**
- Create: `packages/shared/src/devices.ts`, `apps/desktop/src/devices/parse.ts`
- Modify: `packages/shared/src/index.ts` (re-export), `apps/desktop/src/run/parse.ts:131-151`
- Test: `apps/desktop/test/devices-parse.test.ts`; existing `apps/desktop/test/run-parse.test.ts` must stay green

**Interfaces:**
- Produces (shared):
  ```ts
  export type AdbState = 'ready' | 'unauthorized' | 'offline' | 'authorizing' | 'recovery' | 'sideload' | 'bootloader' | 'no-permissions' | 'unknown'
  export type AdbTransport = 'usb' | 'wifi' | 'emulator'
  export interface AdbDevice {
    id: string; state: AdbState; transport: AdbTransport
    model: string | null; product: string | null; device: string | null; transportId: string | null
    alias: string | null; name: string /* alias ?? model ?? id */
    online: boolean /* false = remembered, not currently listed */; lastSeen: number | null
  }
  export interface AdbMdnsService { name: string; kind: 'pairing' | 'connect' | 'legacy'; host: string; port: number }
  export type DevErrorCode = 'denied' | 'invalid' | 'adb-missing' | 'connect-failed' | 'pair-failed' | 'not-connected' | 'no-ip' | 'tcpip-failed' | 'timeout' | 'mdns-unavailable' | 'no-devices' | 'cancelled'
  export type DevResult = { ok: true; detail?: string } | { ok: false; error: DevErrorCode; detail?: string }
  export interface DevBatchResult { id: string; result: DevResult }
  export interface DevSnapshot { adb: string | null; devices: AdbDevice[]; autoConnect: boolean }
  export type QrStatus = 'waiting' | 'pairing' | 'connecting' | 'connected' | 'failed' | 'timeout' | 'cancelled'
  export type DevEvent = { type: 'devices'; devices: AdbDevice[] } | { type: 'qr'; id: string; status: QrStatus; detail?: string }
  ```
- Produces (desktop `devices/parse.ts`):
  - `interface AdbDeviceRow { id; state: AdbState; model; product; device; transportId; usb: string | null }`
  - `parseAdbDeviceRows(out: string): AdbDeviceRow[]`
  - `isWifiId(id: string): boolean`
  - `transportOf(row: AdbDeviceRow): AdbTransport`
  - `parseMdnsServices(out: string): AdbMdnsService[]`
  - `parseConnect(out: string): DevResult`
  - `parsePair(out: string): DevResult`
  - `parseDisconnect(out: string): DevResult`
  - `parseWlanIp(out: string): string | null`
  - `parseAddress(input: string): { target: string; host: string | null; port: number | null } | null`
  - `addressKey(host: string, port: number): string`

- [ ] **Step 1: Write the failing tests** in `devices-parse.test.ts`, using this `adb devices -l` fixture verbatim:
  ```
  List of devices attached
  R58M123ABC             device usb:1-1 product:beyond1qltexx model:SM_G973F device:beyond1q transport_id:3
  192.168.1.5:5555       device product:sunfish model:Pixel_4a device:sunfish transport_id:4
  adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp device product:panther model:Pixel_7 device:panther transport_id:5
  emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
  0123456789ABCDEF       unauthorized usb:1-2 transport_id:6
  192.168.1.9:5555       offline transport_id:7
  ZY22ABC                no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:8
  XYZ                    recovery usb:1-4 transport_id:9
  QWE                    weird-state transport_id:10
  ```
  Tests and assertions:
  - `parses every state with key:value fields`:
    - The fixture yields 9 rows.
    - Row 0 is `{ id:'R58M123ABC', state:'ready', model:'SM G973F', product:'beyond1qltexx', device:'beyond1q', transportId:'3', usb:'1-1' }`.
    - Row 1 has `usb === null` and `model === 'Pixel 4a'`.
    - Row 6 has `state === 'no-permissions'` and `usb === '1-3'`.
    - Row 7 has `state === 'recovery'`; row 8 has `state === 'unknown'`.
  - `detects transport`: `transportOf` gives `usb`, `wifi`, `wifi`, `emulator`, `usb` for rows 0–4. `isWifiId('192.168.1.9:5555')` and `isWifiId('adb-X._adb-tls-connect._tcp')` are true; `isWifiId('R58M123ABC')` is false.
  - `parses mdns services`: the input
    ```
    List of discovered mdns services
    adb-R58M123ABC-AbCdEf	_adb-tls-connect._tcp	192.168.1.5:37123
    orrery-1a2b3c4d	_adb-tls-pairing._tcp.	192.168.1.5:40211
    adb-ZZZ	_adb._tcp	192.168.1.20:5555
    ```
    yields `[{name:'adb-R58M123ABC-AbCdEf',kind:'connect',host:'192.168.1.5',port:37123},{name:'orrery-1a2b3c4d',kind:'pairing',host:'192.168.1.5',port:40211},{name:'adb-ZZZ',kind:'legacy',host:'192.168.1.20',port:5555}]`. A malformed line is skipped.
  - `parses connect output`:
    - `'connected to 192.168.1.5:5555'` and `'already connected to 192.168.1.5:5555'` give `{ok:true}`.
    - `"failed to connect to '192.168.1.5:5555': Connection refused"`, `'cannot connect to 192.168.1.5:5555: No connection could be made because the target machine actively refused it. (10061)'` and `'failed to authenticate to 192.168.1.5:5555'` each give `{ok:false,error:'connect-failed',detail:<the trimmed line>}`.
    - Empty output gives `connect-failed`.
  - `parses pair output`: `'Successfully paired to 192.168.1.5:40211 [guid=adb-R58M123ABC-AbCdEf]'` gives `{ok:true}`; `'Failed: Wrong password or connection was dropped.'` gives `{ok:false,error:'pair-failed',detail:…}`.
  - `parses disconnect output`: `'disconnected 192.168.1.5:5555'` gives ok; `"error: no such device '192.168.1.5:5555'"` gives `not-connected`.
  - `parses wlan ip`: `'    inet 192.168.1.5/24 brd 192.168.1.255 scope global wlan0'` gives `'192.168.1.5'`; `''` gives `null`.
  - `parses addresses`:
    - `'192.168.1.5'` gives `{target:'192.168.1.5:5555',host:'192.168.1.5',port:5555}`.
    - `'192.168.1.5:37123'` gives port 37123.
    - `'[fe80::1]:5555'` gives `target:'[fe80::1]:5555'`.
    - `'adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp'` gives `{target:<same>,host:null,port:null}`.
    - `'phone.local:5555'` is accepted.
    - Each of `''`, `'-s x'`, `'1.2.3.4:0'`, `'1.2.3.4:65536'`, `'a b'` and `'1.2.3.4;calc'` gives `null`.
    - `addressKey('[FE80::1]', 5555) === 'fe80::1:5555'`.

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-parse.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the types and parsers.
  - Row regex: `^(\S+)\s+(no permissions|\S+)(.*)$`.
  - Fields come from `/\b(usb|product|model|device|transport_id):(\S+)/g`, with `_` → space for `model` only.
  - State map: `device→ready`, `unauthorized`, `offline`, `authorizing`, `recovery`, `sideload`, `bootloader`, `no permissions→no-permissions`, anything else → `unknown`.
  - Skip the `List of devices attached` header and blank lines.
  - Wi-Fi = id contains `:` or `._adb-tls-connect._tcp`.
  - Emulator = id starts with `emulator-`.
  - mDNS kind comes from the service type with the trailing `.` stripped: `_adb-tls-pairing._tcp` → pairing, `_adb-tls-connect._tcp` → connect, `_adb._tcp` → legacy.
- [ ] **Step 4: Rewrite `parseAdbDevices`** (`run/parse.ts`) as `parseAdbDeviceRows(out).filter(r => r.state === 'ready' || r.state === 'unauthorized' || r.state === 'offline')`, mapped to the existing `RunDevice` fields (name = model ?? id).
- [ ] **Step 5: Run** `npm test -w @ccm/desktop -- test/devices-parse.test.ts test/run-parse.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `✨ Parse adb device rows, mDNS services and connect output`

### Task 2: Extract a reusable `adb track-devices` watcher

**Files:**
- Create: `apps/desktop/src/run/android/adbWatch.ts`
- Modify: `apps/desktop/src/run/android/devices.ts:64-217`
- Test: `apps/desktop/test/adb-watch.test.ts`; existing `apps/desktop/test/run-android-runner.test.ts` (adb device-service block ~337–397) must stay green

**Interfaces:**
- Consumes: `parseAdbDeviceRows` (Task 1), `readAdbFrames`, `collect`, `Spawner`, `killTree`.
- Produces:
  - `interface AdbWatchOpts<T> { spawn: Spawner; cwd: string; adb: () => Promise<string | null>; parse: (body: string) => T[]; timing?: Partial<{ firstListMs: number; pollMs: number; restartWindowMs: number; maxRestarts: number }> }`
  - `interface AdbWatch<T> { list(): Promise<T[]>; onChange(cb: (items: T[]) => void): () => void; stop(sync?: boolean): void }`
  - `function createAdbWatch<T>(opts: AdbWatchOpts<T>): AdbWatch<T>`
  - `export async function findAdbTools(opts: { androidSdk: string | null; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; home: string }, deps?: EnvDeps): Promise<{ adb: string | null; emulator: string | null }>` (the current private `findTools`, renamed and exported; `createAdbDevices` passes `opts.settings.androidSdk`)

- [ ] **Step 1: Write the failing tests.** Copy the local `fakeSpawn` / `frame()` helpers from `run-android-runner.test.ts:14-80`.
  - `publishes a state change inside the same device set`: send frame `'R58\tunauthorized\n'`, then `'R58\tdevice\n'`. `onChange` fires twice and the last state is `'ready'` (escrcpy gap 1).
  - `restarts the tracker then falls back to polling`: the tracker exits 4 times within the window. `track-devices` is spawned exactly 3+1 times, then `devices -l` is polled at `pollMs`.
  - `list resolves [] after firstListMs when adb is missing`: `adb: async () => null` gives `[]`.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/adb-watch.test.ts`. Expected: FAIL.
- [ ] **Step 3: Move** the tracker / poll / publish / first-list code from `createAdbDevices` into `createAdbWatch`, parameterised by `parse` and `adb`. `createAdbDevices` keeps `emulators` / `launchEmulator` and delegates `list` / `onChange` / `stop` to `createAdbWatch({ parse: parseAdbDevices, adb: async () => (await getTools()).adb, … })`.
- [ ] **Step 4: Run** `npm test -w @ccm/desktop -- test/adb-watch.test.ts test/run-android-runner.test.ts test/run-sessions.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `♻️ Extract the adb track-devices watcher for reuse`

### Task 3: adb command wrapper

**Files:**
- Create: `apps/desktop/src/devices/adb.ts`
- Test: `apps/desktop/test/devices-adb.test.ts`

**Interfaces:**
- Consumes: `collect` (`run/android/devices.ts`), parsers (Task 1).
- Produces:
  - `interface AdbCommandsOpts { spawn: Spawner; cwd: string; adb: () => Promise<string | null>; timing?: Partial<{ connectMs: number; pairMs: number; cmdMs: number }> }`
  - `interface AdbCommands { connect(target: string): Promise<DevResult>; pair(hostPort: string, code: string): Promise<DevResult>; disconnect(id: string): Promise<DevResult>; tcpip(id: string, port: number): Promise<DevResult>; wlanIp(id: string): Promise<string | null>; mdnsCheck(): Promise<boolean>; mdnsServices(): Promise<AdbMdnsService[]> }`
  - `function createAdbCommands(opts: AdbCommandsOpts): AdbCommands`
- Exact argv:

  | Call | argv |
  |---|---|
  | connect | `['connect', target]` |
  | pair | `['pair', hostPort, code]` |
  | disconnect | `['disconnect', id]` |
  | tcpip | `['-s', id, 'tcpip', String(port)]` (ok when exit 0 and output lacks `error`) |
  | wlanIp | `['-s', id, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0']` |
  | mdnsCheck | `['mdns', 'check']` (false when exit ≠ 0 or output matches `/unavailable/i`) |
  | mdnsServices | `['mdns', 'services']` |

- [ ] **Step 1: Write the failing tests.**
  - `passes argv without a shell`: the spawn spec has `file === '/sdk/platform-tools/adb'` and `args` equal to the exact arrays above.
  - `connect times out and kills the child`: the fake child never exits. With `connectMs: 50` the result is `{ok:false,error:'timeout'}` and `killTree` was called.
  - `adb missing`: every call returns `adb-missing` (or `null` / `false` / `[]` for wlanIp / mdnsCheck / mdnsServices) and nothing is spawned.
  - `mdnsCheck false on unavailable`: output `'ERROR: mdns daemon unavailable'` gives `false`.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-adb.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `collect`. A `code === null` with the timer fired maps to `timeout`. Pass the output through the Task 1 parsers.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `✨ Wrap adb connect, pair, tcpip and mdns commands`

### Task 4: Device history store

**Files:**
- Create: `apps/desktop/src/devices/history.ts`
- Test: `apps/desktop/test/devices-history.test.ts`

**Interfaces:**
- Produces:
  - `export const DEVICES_FILE = 'adb-devices.json'`
  - `interface HistoryEntry { alias: string | null; model: string | null; wifi: boolean; lastSeen: number }`
  - `class DeviceHistory` with:
    - `constructor(file: string)` loads leniently: malformed entries are dropped, an unreadable file gives an empty store with `autoConnect: true`.
    - `all(): Record<string, HistoryEntry>`
    - `seen(rows: AdbDeviceRow[], now: number): void` records `ready` rows only and writes only if the id set or a model changed.
    - `setAlias(id: string, alias: string | null): void`
    - `remove(ids: string[]): void`
    - `wifiIds(): string[]`
    - `autoConnect: boolean` getter + `setAutoConnect(on: boolean): void`
  - On-disk shape: `{ version: 1, autoConnect: boolean, devices: Record<string, HistoryEntry> }`.

- [ ] **Step 1: Write the failing tests** (temp dir per test).
  - `remembers ready devices only`: rows ready + unauthorized give only the ready id. The wifi flag comes from `isWifiId`.
  - `skips writes when nothing changed`: calling `seen` twice with the same rows writes the file once (compare mtime, or spy on `writeFileSync` via `vi.spyOn(fs, …)`).
  - `caps at 200 by oldest lastSeen`.
  - `alias trims, max 64, empty → null`.
  - `survives a corrupt file`: a file containing `{nope` gives `all()` equal to `{}` and `autoConnect === true`.
  - `round-trips through disk`.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-history.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write synchronously with tmp + rename (`layouts.ts:186-196` pattern); a write error keeps the store in memory only.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `✨ Remember ADB devices, aliases and auto-connect`

### Task 5: DeviceManager

**Files:**
- Create: `apps/desktop/src/devices/manager.ts`
- Test: `apps/desktop/test/devices-manager.test.ts`

**Interfaces:**
- Consumes: `createAdbWatch` + `findAdbTools` (Task 2), `createAdbCommands` (Task 3), `DeviceHistory` (Task 4), parsers (Task 1).
- Produces:
  ```ts
  interface DeviceManagerDeps {
    spawn: Spawner; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; home: string
    getSettings: () => { androidSdk: string | null }
    history: DeviceHistory
    broadcast: (e: DevEvent) => void
    confirmRemove: (ids: string[]) => Promise<boolean>
    timing?: Partial<{ wifiSwitchMs: number; batchLimit: number; connectMs: number; pairMs: number; cmdMs: number; qrPairWaitMs: number; qrConnectWaitMs: number; mdnsPollMs: number }>
    /** Test seam for Task 3 commands / Task 2 watch. */
    commands?: AdbCommands
  }
  class DeviceManager {
    constructor(deps: DeviceManagerDeps)
    snapshot(): Promise<DevSnapshot>
    hold(owner: string, on: boolean): Promise<void>
    releaseOwner(prefix: string): void
    connect(address: string): Promise<DevResult>
    pair(address: string, code: string): Promise<DevResult>
    disconnect(ids: string[]): Promise<DevBatchResult[]>
    connectMany(ids: string[]): Promise<DevBatchResult[]>
    toWifi(id: string): Promise<DevResult>
    remove(ids: string[]): Promise<DevResult>
    setAlias(id: string, alias: string | null): DevResult
    setAutoConnect(on: boolean): DevResult
    discover(): Promise<DevBatchResult[] | DevResult>
    autoConnectOnce(): Promise<void>
    stop(sync?: boolean): void
  }
  // exported for tests
  function mergeDevices(live: AdbDeviceRow[], history: Record<string, HistoryEntry>): AdbDevice[]
  function mapLimit<I, O>(items: I[], limit: number, fn: (i: I) => Promise<O>): Promise<O[]>
  ```
- Behaviour decisions:
  - **adb path.** Resolved through `findAdbTools({ androidSdk: getSettings().androidSdk, env, platform, home })` on every `hold(on)`. When the path differs from the running watch's, the watch is stopped and recreated.
  - **merge.**
    - Live rows map to `AdbDevice` with `online: true`.
    - Every history id not live becomes `{ state: 'offline', online: false, transport: wifi ? 'wifi' : 'usb' }` with the model from history.
    - `alias` comes from history and `name = alias ?? model ?? id`.
    - Sort: online first. Within online, by state `ready, unauthorized, authorizing, no-permissions, recovery, sideload, bootloader, unknown, offline`, then by `name.localeCompare`.
  - **every live update.** Call `history.seen(rows, Date.now())`, then broadcast `{type:'devices'}`.
  - **connect.**
    - `parseAddress` returning null gives `invalid`.
    - On success the ids already on the watch are re-listed. No sleep: the tracker pushes on its own.
  - **pair.**
    - `parseAddress` must yield a host and port, and the code must match `/^\d{6}$/`; otherwise `invalid`.
    - After `ok`, look for an mDNS `connect` service with the same host and connect to it.
    - If there is none, return `{ok:true, detail:'paired'}`; the UI then asks for the connect port (escrcpy gap 6).
  - **toWifi.** Run `wlanIp(id)`; null gives `no-ip`. Then `tcpip(id, 5555)`, wait `wifiSwitchMs` (1000), and `connect(`${ip}:5555`)`.
  - **disconnect / connectMany.** Use `mapLimit(ids, 5, …)`. `disconnect` only for online Wi-Fi ids; anything else gives `not-connected`.
  - **remove.** Only offline ids are removed. Ask `confirmRemove(ids)`; false gives `cancelled`. Then `history.remove` and broadcast.
  - **discover.**
    - `mdnsCheck()` false gives `mdns-unavailable`.
    - Otherwise take `connect` + `legacy` services.
    - Drop a service whose `addressKey(host, port)` matches an online id, or whose `${name}._adb-tls-connect._tcp` is an online id.
    - None left gives `no-devices`; otherwise return `connectMany(targets)`.
  - **autoConnectOnce.** Runs once per instance, only when `history.autoConnect` is on and `wifiIds()` is non-empty. It runs `mapLimit(wifiIds, 5, connect)`, ignores the results and broadcasts nothing itself (the tracker, if held, will).
  - **adb missing.** `snapshot()` gives `{adb:null, devices: merge([], history)}`, and every action gives `adb-missing`.

- [ ] **Step 1: Write the failing tests.** Inject fake `commands` and a fake watch via `spawn` (fakeSpawn routes as in Task 2).
  - `merge keeps usb and wifi rows and hides history duplicates`:
    - Live `R58M123ABC` (usb, ready) and `192.168.1.5:5555` (wifi, ready); history has `192.168.1.5:5555` (alias `'Lab'`) and `192.168.1.9:5555`.
    - Result is 3 rows, in order: Lab (`online`), the SM G973F USB row, `192.168.1.9:5555` (`online:false`, `state:'offline'`).
  - `snapshot reports adb:null and actions return adb-missing`.
  - `connect rejects bad addresses without spawning`: `'-s x'` gives `invalid` and zero spawns.
  - `pair then connects through mdns`: the fake mDNS has a connect service on the same host port 37123. `connect('192.168.1.5:37123')` is called.
  - `pair without mdns returns paired`.
  - `toWifi runs ip, tcpip, then connect`: the call order is `wlanIp`, `tcpip(id,5555)`, `connect('192.168.1.5:5555')`.
  - `connectMany caps concurrency at 5 and returns per-id results`: 12 ids, fake connect resolves after a tick and id #3 fails. Max in-flight is 5, the results length is 12 in input order, and #3 is `connect-failed`.
  - `remove asks confirm and keeps online ids`: confirm false gives `cancelled`, and history is unchanged.
  - `discover skips connected devices`.
  - `autoConnectOnce runs once and only with wifi history`.
  - `tracker restarts on sdk change`: `getSettings` returns a new SDK whose adb exists, and the next `hold(on)` kills the old tracker child.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-manager.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `DeviceManager`, `mergeDevices`, `mapLimit`. Holds use a `Set<string>` of owner keys, as in RunManager `hold` / `releaseOwner`, and the watch stops when the set empties.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `✨ Manage multiple ADB devices over USB and Wi-Fi`

### Task 6: QR pairing

**Files:**
- Create: `apps/desktop/src/devices/qr.ts`
- Modify: `apps/desktop/src/devices/manager.ts` (add `qrStart`, `qrCancel`, cancel all on `stop` / `releaseOwner`)
- Test: `apps/desktop/test/devices-qr.test.ts`

**Interfaces:**
- Produces:
  - `function qrPayload(name: string, password: string): string` returns `WIFI:T:ADB;S:${name};P:${password};;`
  - `function newQrSecret(): { name: string; password: string }`
  - `function runQrPairing(o: { cmds: AdbCommands; name: string; password: string; signal: AbortSignal; onStatus: (s: QrStatus, detail?: string) => void; lastPortFor: (host: string) => number | null; timing: { pairWaitMs: number; connectWaitMs: number; pollMs: number } }): Promise<DevResult>`
  - `DeviceManager.qrStart(owner: string): Promise<{ id: string; payload: string } | DevResult>`, where `id` = `name`. It returns `mdns-unavailable` without starting when `mdnsCheck()` is false.
  - `DeviceManager.qrCancel(id: string): DevResult`. Status changes are broadcast as `{type:'qr', id, status}`.
- State machine:
  1. `waiting`: poll `mdnsServices()` every `pollMs` for a `pairing` service whose `name === name`. Ignore other names (escrcpy gap 4).
  2. `pairing`: run `pair(`${host}:${port}`, password)`. A failure ends in `failed` with the detail.
  3. `connecting`: poll for a `connect` service with the same host, up to `connectWaitMs`. Otherwise try `lastPortFor(host)` (history Wi-Fi id on that host with a port ≠ 5555), then 5555. Then `connect`.
  4. End in `connected` / `failed` / `timeout`. Aborting at any point emits `cancelled` and resolves `{ok:false,error:'cancelled'}`.

- [ ] **Step 1: Write the failing tests** (fake timers + fake `AdbCommands`).
  - `payload format`: `qrPayload('orrery-1a2b3c4d','012345') === 'WIFI:T:ADB;S:orrery-1a2b3c4d;P:012345;;'`. `newQrSecret()` matches `/^orrery-[0-9a-f]{8}$/` and `/^\d{6}$/`.
  - `pairs only with its own service name`: the first poll returns `studio-xyz` pairing, the second also returns `orrery-…`. `pair` is called once, with the `orrery-…` port.
  - `connects via mdns connect service`. The status sequence is `waiting, pairing, connecting, connected`.
  - `falls back to the remembered port, then 5555`.
  - `times out after pairWaitMs` with status `timeout`.
  - `cancel stops polling`: abort after 2 polls, advance timers 10 s. No more `mdnsServices` calls and the status is `cancelled`.
  - `mdns unavailable fails fast` (manager): `qrStart` returns `{ok:false,error:'mdns-unavailable'}`.
  - `window release cancels its QR session` (manager): `releaseOwner(owner)` aborts the session.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-qr.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each session gets its own AbortController, keyed by `id`, with the owner recorded so `releaseOwner` can cancel it.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `✨ Pair Android 11+ devices by QR code over adb mdns`

### Task 7: IPC, preload, main wiring, native confirm

**Files:**
- Create: `apps/desktop/src/devices/ipc.ts`
- Modify:
  - `apps/desktop/src/main.ts` (after `runManager` at ~912; quit path beside `disposeRun` at ~140/172)
  - `apps/desktop/src/preload.ts`
  - `apps/desktop/src/strings.ts`
- Test: `apps/desktop/test/devices-ipc.test.ts` (fake `ipcMain` like `test/github-accounts.test.ts`)

**Interfaces:**
- Produces: `function registerDevicesIpc(deps: { ipcMain: IpcMain; isAppFrame: (e: IpcMainInvokeEvent) => boolean; manager: DeviceManager }): () => void`.
- Channels (invoke) → manager, with web names in brackets:

  | Channel | Arguments | Manager call | Web method |
  |---|---|---|---|
  | `ccm:dev-snapshot` | — | `snapshot` | `devSnapshot` |
  | `ccm:dev-hold` | `on: boolean` | `hold(ownerOf(event,'view'), on)` | `devHold` |
  | `ccm:dev-connect` | `address: string` | `connect` | `devConnect` |
  | `ccm:dev-pair` | `address, code` | `pair` | `devPair` |
  | `ccm:dev-disconnect` | `ids` | `disconnect` | `devDisconnect` |
  | `ccm:dev-connect-many` | `ids` | `connectMany` | `devConnectMany` |
  | `ccm:dev-to-wifi` | `id` | `toWifi` | `devToWifi` |
  | `ccm:dev-remove` | `ids` | `remove` | `devRemove` |
  | `ccm:dev-alias` | `id, alias` | `setAlias` | `devAlias` |
  | `ccm:dev-auto-connect` | `on` | `setAutoConnect` | `devAutoConnect` |
  | `ccm:dev-discover` | — | `discover` | `devDiscover` |
  | `ccm:dev-qr-start` | — | `qrStart(ownerOf(event,'qr'))` | `devQrStart` |
  | `ccm:dev-qr-cancel` | `id` | `qrCancel` | `devQrCancel` |

  - Push channel `ccm:dev-event` (DevEvent); preload exposes it as `onDevEvent(handler) => unsubscribe` using `subscribe`.
  - A non-app frame or failed validation returns `{ok:false,error:'denied'}` (`[]` for batch, `null` for snapshot).
- Main wiring:
  - `new DeviceManager({ spawn: defaultSpawner, env: process.env, platform: process.platform, home: os.homedir(), getSettings: () => ({ androidSdk: runManager?.getSettings().androidSdk ?? null }), history: new DeviceHistory(path.join(DATA_DIR, DEVICES_FILE)), broadcast: (e) => every window .send('ccm:dev-event', e), confirmRemove })`.
  - `confirmRemove` is `confirmBox(mainWindow, { type:'warning', message: t.devRemoveTitle(ids.length), detail: t.devRemoveDetail(ids), buttons:[t.devRemoveConfirm, t.quitCancel], defaultId:1, cancelId:1, noLink:true })`.
  - Then `void devices.autoConnectOnce()`. On quit: `devices.stop(true)` and dispose the IPC.
- Strings:
  - en: `devRemoveTitle: (n) => n === 1 ? 'Forget this device?' : \`Forget ${n} devices?\``, `devRemoveDetail: (ids) => ids.join('\n') + '\n\nOrrery stops listing and auto-connecting them. Nothing on the devices changes.'`, `devRemoveConfirm: 'Forget'`.
  - vi: `'Quên thiết bị này?'` / `` `Quên ${n} thiết bị?` ``, `'\n\nOrrery sẽ không hiện và tự kết nối các thiết bị này nữa. Không có gì trên thiết bị bị thay đổi.'`, `'Quên'`.

- [ ] **Step 1: Write the failing tests.**
  - `denies non-app frames`: every channel returns the denied shape and the manager is not called.
  - `validates input`:
    - `ccm:dev-pair` with code `'12345'` is denied.
    - `ccm:dev-disconnect` with 51 ids is denied.
    - `ccm:dev-alias` with a 65-char alias is denied.
    - `ccm:dev-to-wifi` with `'-s'` is denied.
  - `releases holds and QR sessions when the sender is destroyed`: emitting `destroyed` on the fake sender calls `manager.releaseOwner('<id>:')`.
  - `dispose removes every handler`.
- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/devices-ipc.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `ipc.ts`, then the preload lines, strings, and main wiring.
- [ ] **Step 4: Run** `npm test -w @ccm/desktop` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5: Commit** `✨ Expose ADB device management over desktop IPC`

### Task 8: Web bridge + Pinia store

**Files:**
- Create: `apps/web/src/lib/devices.ts`, `apps/web/src/stores/devices.ts`
- Test: `apps/web/src/stores/devices.test.ts` (mock `../lib/devices` as `stores/run.test.ts:5-23` does with `vi.hoisted`)

**Interfaces:**
- Consumes: the bridge method names from Task 7, the shared types from Task 1.
- Produces:
  - `lib/devices.ts`: `export const hasDevices: boolean` (true when `typeof bridge?.devSnapshot === 'function'`), plus one wrapper per bridge method with an unavailable fallback (`{ok:false,error:'denied'}`, `[]`, `null`).
  - `useDevicesStore`:
    - State: `devices: AdbDevice[]`, `adbFound: boolean`, `autoConnect: boolean`, `loaded: boolean`, `busy: Set<string>` (row id or `'connect'`/`'discover'`), `selected: Set<string>`, `qr: { id: string; payload: string; status: QrStatus; detail?: string } | null`, `lastError: { code: DevErrorCode; detail?: string } | null`.
    - Actions: `open()`, `close()`, `connect(address)`, `pair(address, code)`, `disconnect(ids)`, `connectMany(ids)`, `toWifi(id)`, `remove(ids)`, `setAlias(id, alias)`, `setAutoConnect(on)`, `discover()`, `startQr()`, `cancelQr()`, `toggle(id)`, `selectAll(on)`.
    - Getters: `selectedRows`, `selectedOnlineWifi` (Disconnect enabled), `selectedOfflineWifi` (Connect enabled), `selectedOffline` (Remove enabled).
  - `open()` subscribes `onDevEvent` once, calls `devHold(true)` and `devSnapshot()`. `close()` calls `devHold(false)`.
  - Every action adds its key to `busy` and removes it in `finally`. A failed `DevResult` sets `lastError` unless the code is `cancelled`.
  - A `devices` event replaces the list and prunes `selected` ids that are gone.

- [ ] **Step 1: Write the failing tests.**
  - `open holds and loads the snapshot`.
  - `devices event replaces the list and prunes selection`.
  - `busy clears after a failing connect and lastError is set`.
  - `cancelled results never set lastError`.
  - `qr events update only the matching session`.
  - `selection getters gate batch actions`: online wifi + offline usb selected gives `selectedOnlineWifi.length === 1`, `selectedOffline.length === 1`, `selectedOfflineWifi.length === 0`.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/stores/devices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `✨ Add the devices store and desktop bridge`

### Task 9: Devices tab UI

Load `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max` first. Follow `.planning/COLOR-SYSTEM.md` and the macOS HIG spec in `.planning/AUDIT-v18-deck-reference.md` §4.

**Files:**
- Create: `apps/web/src/components/devices/{DevicesView,DeviceConnectBar,DeviceRow,DeviceQrPopover}.vue`, `apps/web/src/i18n/devices-v61.ts`
- Modify:
  - `apps/web/src/stores/ui.ts:9-22`: add `'devices'` to `View`; `initialView` keeps `'devices'` only when `hasDevices`.
  - `App.vue:33,120`: async `DevicesView` behind `ui.view === 'devices' && hasDevices`.
  - `AppHeader.vue:29`: tab `{ id:'devices', label: t('nav.devices'), icon: Smartphone }`.
  - `CommandPalette.vue:136`: `c:devices` → `palette.goDevices`.
  - `i18n/en.ts`, `i18n/vi.ts`: spread `devicesV61` and add `nav.devices`, `palette.goDevices`.
  - `apps/web/package.json`: add `qrcode` + `@types/qrcode`.
- Test: `apps/web/src/components/devices/DevicesView.test.ts` (@vue/test-utils + the mocked store bridge); `apps/web/src/i18n/messages.test.ts` (en/vi key parity) stays green

**Layout decisions:**
- **`DeviceConnectBar`:** one row containing
  - an address input (placeholder `192.168.1.5:5555`; datalist of remembered Wi-Fi ids);
  - a collapsible pair-code input (6 digits, `inputmode="numeric"`), with its open state kept in `localStorage` `ccm.devices.pairOpen` (try/catch);
  - a primary Connect button that runs `pair` when a code is filled, otherwise `connect`. A `detail:'paired'` result clears the code and focuses the address with hint `devices.connect.pairedHint`;
  - a QR button (opens `DeviceQrPopover`), a Discover button and a Connect-remembered button (`connectMany` over offline Wi-Fi rows);
  - an Auto-connect toggle.
- **`DeviceRow`:** columns are checkbox, status icon + text, name, id, transport badge and actions.
  - Status uses lucide icons with status-token colours: ready = `CircleCheck` / success token, unauthorized = `ShieldAlert` / warning token plus the hint `devices.state.unauthorizedHint` ("Accept the USB debugging prompt on the phone"), offline = `CircleOff` / muted ink, others = `CircleHelp`.
  - Name uses an inline alias editor (Enter saves, Esc cancels, empty clears).
  - Id is mono, truncated, with `title`.
  - Transport badge: `usb` / `wifi` / `emulator`.
  - Actions per state: USB ready → Wi-Fi (`toWifi`); online Wi-Fi → Disconnect; offline Wi-Fi → Reconnect; offline → Forget.
- **Batch bar:** appears when `selected.size > 0`, with Connect, Disconnect and Forget, each disabled by the store getters.
- **`DeviceQrPopover`:** renders `QRCode.toString(payload, { type: 'svg', margin: 1 })` with `v-html` on a white tile (the payload is generated in main and contains only `[A-Za-z0-9;:=-]`). Shows the status text `devices.qr.<status>`. Cancel calls `cancelQr()`; closing the popover also cancels.
- **Empty states:** `adbFound === false` → "adb not found" + button opening Settings (`ui.settingsOpen = true`); no devices → "Connect a phone by USB or enter its Wi-Fi address".
- **Errors:** `lastError` shows inline under the bar, from `devices.error.<code>`, with `detail` in mono.
- **Lifecycle:** `onMounted(store.open)`, `onBeforeUnmount(store.close)`.
- **i18n keys** (en + vi, same keys): `devices.title`, `devices.connect.{address,placeholder,pairCode,pairToggle,connect,pairedHint,remembered,autoConnect}`, `devices.qr.{button,title,help,waiting,pairing,connecting,connected,failed,timeout,cancelled}`, `devices.discover`, `devices.state.{ready,unauthorized,offline,authorizing,recovery,sideload,bootloader,no-permissions,unknown,unauthorizedHint}`, `devices.transport.{usb,wifi,emulator}`, `devices.action.{toWifi,disconnect,reconnect,forget,rename}`, `devices.batch.{selected,connect,disconnect,forget}`, `devices.empty.{noAdb,openSettings,none}`, `devices.error.{denied,invalid,adb-missing,connect-failed,pair-failed,not-connected,no-ip,tcpip-failed,timeout,mdns-unavailable,no-devices}`.
  - The vi copy is written in natural Vietnamese, not machine-literal. Examples: `devices.qr.help` = "Trên điện thoại: Tuỳ chọn nhà phát triển → Gỡ lỗi không dây → Ghép nối thiết bị bằng mã QR"; `devices.error.mdns-unavailable` = "adb không bật mDNS. Cập nhật platform-tools (≥ 31) rồi thử lại."

- [ ] **Step 1: Write the failing component tests.**
  - `shows adb missing state`.
  - `connect button calls pair when a code is filled`.
  - `row actions follow state`: a USB ready row shows `toWifi` and not `disconnect`; an offline Wi-Fi row shows `reconnect` + `forget`.
  - `status shows icon and text`: the unauthorized row contains the text `devices.state.unauthorized` and an svg.
  - `batch bar appears with selection`.
- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/components/devices/DevicesView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the components, the view registration, i18n and the dependency (`npm install -w @ccm/web qrcode@1.5.4` + `@types/qrcode@1.5.5 -D`, exact pins in package.json).
- [ ] **Step 4: Run** `npm test -w @ccm/web` and `npm run typecheck`. Expected: PASS, including `messages.test.ts`.
- [ ] **Step 5: Commit** `💄 Add the Devices tab for multi-device ADB`

### Task 10: E2E, docs, index

**Files:**
- Modify: `apps/desktop/e2e/fixtures/run-fakes/adb.js` (add `connect`, `disconnect`, `pair`, `tcpip`, `mdns check|services`, `shell ip …`; `track-devices` emits the connected Wi-Fi id after `connect`)
- Create: `apps/desktop/e2e/devices.cjs` (pattern: `e2e/run-pane.cjs`)
- Docs:
  - `docs/claude-code-integration.md`: new `## 11aa. Devices tab: wireless ADB (v61, desktop only, 2026-10-21)`. It covers:
    - the exact adb commands and verified output lines;
    - that `adb connect` exits 0 on failure;
    - that mDNS needs platform-tools ≥ 31 and that an adb server started without mDNS lists nothing until restarted;
    - the history file;
    - the deviation note that escrcpy's adbkit-in-preload became main-process CLI.
  - `.code_index/_meta.md` (one line), `desktop.md` (devices module + IPC table), `web.md` (store + view), `protocol.md` (shared types).
  - `CLAUDE.md` "What this is": one sentence "Since v61 a Devices tab connects Android devices over USB / Wi-Fi (pair code, QR, mDNS discover, remembered devices with auto-connect) through the SDK's adb (`.planning/PLAN-v61-adb-devices.md`)."
  - Copy this plan to `.planning/PLAN-v61-adb-devices.md`.

- [ ] **Step 1: Write the E2E test** `devices.cjs`:
  1. Open the Devices tab and expect the USB fake device row with "Ready".
  2. Type `192.168.1.5:5555` and press Connect; the Wi-Fi row appears.
  3. Select it and press Disconnect; it becomes an offline remembered row.
  4. Forget triggers the native confirm. Use the e2e confirm stub that `e2e/github-accounts.cjs` uses (check that script for the existing auto-answer and reuse it), then the row is gone.
- [ ] **Step 2: Build and run** `npm run build -w @ccm/web && npm run build -w @ccm/desktop && npm run e2e -w @ccm/desktop -- devices`. Expected: PASS. If the runner takes a script name differently, follow `apps/desktop/package.json`'s `e2e` script.
- [ ] **Step 3: Write the docs / index / CLAUDE.md / `.planning` copy.**
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all green.
- [ ] **Step 5: Commit** `📝 Document the Devices tab and add its E2E`

---

## Verification (end to end, manual, Windows)

1. Run `npm run desktop`, then open the Devices tab. With a phone on USB and debugging allowed, the row shows Ready / usb. Revoking authorisation turns the row Unauthorized within about 1 s (tracker change event).
2. Press **Wi-Fi** on the USB row; a second row `192.168.x.x:5555` appears. Unplug the USB cable and the Wi-Fi row stays. Open a Run pane: the RunBar device menu lists the Wi-Fi device.
3. Phone Developer options → Wireless debugging → *Pair with QR code*. Press QR in Orrery and scan: the status goes waiting → pairing → connecting → connected, then the row appears.
4. Discover with a second phone on Wireless debugging: it connects; already connected phones are skipped.
5. Restart the app with Auto-connect on: remembered Wi-Fi devices reconnect without opening the tab, and they show in Run.
6. Select 3 rows, then Disconnect, then Forget. The native confirm lists the ids; after confirming they disappear and `%LOCALAPPDATA%\ccm\adb-devices.json` no longer has them.
7. Set the Android SDK path to an empty folder in Settings: the tab shows "adb not found".

## Execution

Recommended: **Subagent-driven** (superpowers:subagent-driven-development). There are 10 tasks, and Tasks 2–8 each consume the exact interfaces of the one before. A reviewer gate per task catches signature drift before it spreads into the IPC and the UI.
