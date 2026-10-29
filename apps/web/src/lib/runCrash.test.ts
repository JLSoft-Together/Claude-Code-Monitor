import { describe, expect, it } from 'vitest'
import type { RunLogLine } from '@ccm/shared'
import { crashBlocks, crashPrompt, fileIndex, frameFile, groupCrashes, redactLine } from './runCrash'

const logcat = (text: string, tag = 'AndroidRuntime', level: RunLogLine['level'] = 'E', at = 1000): RunLogLine => ({ stream: 'logcat', level, tag, text, at })
const app = (text: string, at = 2000): RunLogLine => ({ stream: 'app', text, at })

const FATAL = [
  logcat('Sending token=abc123 to user@example.com', 'NetClient', 'D'),
  logcat('FATAL EXCEPTION: main'),
  logcat('Process: com.example.shop, PID: 12345'),
  logcat('java.lang.RuntimeException: Unable to start activity ComponentInfo{com.example.shop/com.example.shop.ui.MainActivity}: java.lang.IllegalStateException: cart missing'),
  logcat('\tat android.app.ActivityThread.performLaunchActivity(ActivityThread.java:3449)'),
  logcat('\tat android.os.Handler.dispatchMessage(Handler.java:106)'),
  logcat('Caused by: java.lang.IllegalStateException: cart missing'),
  logcat('\tat com.example.shop.ui.MainActivity.onCreate(MainActivity.kt:42)'),
  logcat('\tat com.example.shop.cart.CartRepo$load$1.invoke(CartRepo.kt:17)'),
  logcat('\tat android.app.Activity.performCreate(Activity.java:8000)'),
  logcat('\t... 11 more'),
  logcat('Sending signal. PID: 12345 SIG: 9', 'Process', 'I'),
]

const FLUTTER = [
  app('Reloaded 1 of 512 libraries'),
  app('══╡ EXCEPTION CAUGHT BY WIDGETS LIBRARY ╞═══════════════════════════════════════════════════════════'),
  app('The following _Exception was thrown building HomePage(dirty, state: _HomePageState#1a2b3):'),
  app('Exception: boom'),
  app(''),
  app('The relevant error-causing widget was:'),
  app('  HomePage HomePage:file:///C:/work/shop/lib/main.dart:20:13'),
  app(''),
  app('When the exception was thrown, this was the stack:'),
  app('#0      _HomePageState.build (package:shop/home/home_page.dart:105:5)'),
  app('#1      StatefulElement.build (package:flutter/src/widgets/framework.dart:5592:27)'),
  app('(elided 2 frames from dart:async)'),
  app(''),
  app('════════════════════════════════════════════════════════════════════════════════════════════════════'),
  app('next line'),
]

const UNHANDLED = [
  app('I/flutter (12345): [ERROR:flutter/runtime/dart_vm_initializer.cc(41)] Unhandled Exception: Bad state: no element'),
  app('#0      ListBase.first (dart:collection/list.dart:167:5)'),
  app('#1      loadOrders (package:shop/orders/orders.dart:12:3)'),
  app('<asynchronous suspension>'),
  app('Done'),
]

describe('crashBlocks', () => {
  it('reads an Android FATAL EXCEPTION with causes, frames and lines before', () => {
    const [b, ...rest] = crashBlocks(FATAL)
    expect(rest).toEqual([])
    expect(b!.kind).toBe('android')
    expect(b!.exception).toBe('java.lang.RuntimeException')
    expect(b!.causes).toEqual([{ exception: 'java.lang.IllegalStateException', message: 'cart missing' }])
    expect(b!.frames.map((f) => f.symbol)).toEqual([
      'android.app.ActivityThread.performLaunchActivity',
      'android.os.Handler.dispatchMessage',
      'com.example.shop.ui.MainActivity.onCreate',
      'com.example.shop.cart.CartRepo$load$1.invoke',
      'android.app.Activity.performCreate',
    ])
    expect(b!.frames[2]).toMatchObject({ file: 'MainActivity.kt', line: 42, pkgPath: 'com/example/shop/ui' })
    expect(b!.before).toEqual(['NetClient: Sending token=abc123 to user@example.com'])
    expect(b!.lines).toHaveLength(10)
  })

  it('parses raw threadtime / brief lines without a tag field', () => {
    const raw = [
      app('10-29 12:03:41.123 12345 12345 E AndroidRuntime: FATAL EXCEPTION: main'),
      app('10-29 12:03:41.123 12345 12345 E AndroidRuntime: java.lang.NullPointerException'),
      app('E/AndroidRuntime(12345): \tat com.example.shop.App.onCreate(App.java:9)'),
    ]
    const [b] = crashBlocks(raw)
    expect(b).toMatchObject({ kind: 'android', exception: 'java.lang.NullPointerException', message: '' })
    expect(b!.frames).toHaveLength(1)
  })

  it('reads an ANR', () => {
    const [b] = crashBlocks([
      logcat('ANR in com.example.shop (com.example.shop/.ui.MainActivity)', 'ActivityManager'),
      logcat('PID: 12345', 'ActivityManager'),
      logcat('Reason: Input dispatching timed out', 'ActivityManager'),
      logcat('other', 'Choreographer', 'I'),
    ])
    expect(b).toMatchObject({ kind: 'anr', exception: 'ANR in com.example.shop', message: 'Input dispatching timed out' })
    expect(b!.lines).toHaveLength(3)
  })

  it('reads a Flutter EXCEPTION CAUGHT BY block up to its closing rule', () => {
    const [b, ...rest] = crashBlocks(FLUTTER)
    expect(rest).toEqual([])
    expect(b).toMatchObject({ kind: 'flutter', exception: '_Exception', message: 'Exception: boom' })
    expect(b!.frames.map((f) => [f.dartPackage, f.file, f.line, f.col])).toEqual([
      ['shop', 'home/home_page.dart', 105, 5],
      ['flutter', 'src/widgets/framework.dart', 5592, 27],
    ])
    expect(b!.lines.at(-1)).toMatch(/^═+$/)
  })

  it('reads an unhandled Dart exception with its frames', () => {
    const [b] = crashBlocks(UNHANDLED)
    expect(b).toMatchObject({ kind: 'flutter', exception: 'Bad state', message: 'no element' })
    expect(b!.frames.map((f) => f.symbol)).toEqual(['ListBase.first', 'loadOrders'])
    expect(b!.lines).toHaveLength(4)
  })

  it('finds nothing in ordinary output', () => {
    expect(crashBlocks([app('Exception handling is fine'), logcat('All good', 'MyTag', 'I')])).toEqual([])
  })
})

describe('groupCrashes', () => {
  it('folds repeats and keeps the newest first', () => {
    const again = FATAL.map((l) => ({ ...l, at: 5000 }))
    const groups = groupCrashes(crashBlocks([...FATAL, ...UNHANDLED, ...again]))
    expect(groups.map((g) => g.count)).toEqual([2, 1])
    expect(groups[0]).toMatchObject({ firstAt: 1000 })
    expect(groups[0]!.block.at).toBe(5000)
  })
})

describe('frameFile', () => {
  const index = fileIndex([
    'app/src/main/java/com/example/shop/ui/MainActivity.kt',
    'app/src/main/java/com/example/shop/data/CartRepo.kt',
    'app/build/generated/source/MainActivity.kt',
    'lib/home/home_page.dart',
    'lib/orders/orders.dart',
    'lib/main.dart',
  ])
  const root = 'C:\\work\\shop'

  it('maps JVM frames by package path, else a unique file name; framework frames never', () => {
    const [b] = crashBlocks(FATAL)
    expect(b!.frames.map((f) => frameFile(f, index, root))).toEqual([
      null,
      null,
      'app/src/main/java/com/example/shop/ui/MainActivity.kt',
      'app/src/main/java/com/example/shop/data/CartRepo.kt',
      null,
    ])
  })

  it('maps package: Dart frames to lib/ and skips flutter / dart:', () => {
    const [b] = crashBlocks(FLUTTER)
    expect(b!.frames.map((f) => frameFile(f, index, root))).toEqual(['lib/home/home_page.dart', null])
    const [u] = crashBlocks(UNHANDLED)
    expect(u!.frames.map((f) => frameFile(f, index, root))).toEqual([null, 'lib/orders/orders.dart'])
  })

  it('maps file:// Dart frames inside the root', () => {
    const [b] = crashBlocks([app('[ERROR:flutter/runtime/dart_vm_initializer.cc(41)] Unhandled Exception: oops'), app('#0      main (file:///C:/work/shop/lib/main.dart:7:3)')])
    expect(frameFile(b!.frames[0]!, index, root)).toBe('lib/main.dart')
  })
})

describe('redactLine / crashPrompt', () => {
  it('masks tokens, emails, hex and base64', () => {
    const out = redactLine('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc mail bob@corp.io key 0123456789abcdef0123456789abcdef blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0123+/== api_key=xyz')
    expect(out).not.toMatch(/eyJ|bob@corp|0123456789abcdef|QUJDREVG|xyz/)
    expect(out).toContain('[email]')
  })

  it('builds a short bundle with own frames and redacted lines before', () => {
    const [g] = groupCrashes(crashBlocks([...FATAL, ...FATAL.map((l) => ({ ...l, at: 9000 }))]))
    const [b] = crashBlocks(FATAL)
    const own = [{ frame: b!.frames[2]!, path: 'C:\\work\\shop\\app\\src\\main\\java\\com\\example\\shop\\ui\\MainActivity.kt' }]
    const text = crashPrompt(g!, own, () => '@app/src/main/java/com/example/shop/ui/MainActivity.kt')
    expect(text).toMatch(/^App crash \(Android FATAL EXCEPTION\) at \d\d:\d\d:\d\d ×2:/)
    expect(text).toContain('Caused by: java.lang.IllegalStateException: cart missing')
    expect(text).toContain('- com.example.shop.ui.MainActivity.onCreate @app/src/main/java/com/example/shop/ui/MainActivity.kt:42')
    expect(text).not.toContain('user@example.com')
    expect(text).not.toContain('abc123')
    expect(text.endsWith('\n')).toBe(false)
    expect(text.length).toBeLessThanOrEqual(4096)
  })

  it('falls back to the top frames when none is in the project', () => {
    const [g] = groupCrashes(crashBlocks(UNHANDLED))
    const text = crashPrompt(g!, [], (p) => `@${p}`)
    expect(text).toContain('Top frames:')
    expect(text).toContain('#0      ListBase.first'.replace(/\s+/g, ' '))
  })
})
