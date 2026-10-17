// v40 Flutter widget preview: a .dart file of a pubspec project gets the toolbar toggle; the panel lists its @Preview functions
// and (v55) the widget classes of the open file.
// Never runs flutter: Start is not clicked.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-fwp-')))
const A = path.join(DIR, 'lib', 'a.dart')

function fixture() {
  fs.mkdirSync(path.join(DIR, 'lib', 'widgets'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'pubspec.yaml'), 'name: fwp_demo\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\n')
  fs.writeFileSync(A, [
    "import 'package:flutter/widget_previews.dart';",
    "import 'package:flutter/material.dart';",
    '',
    "@Preview(name: 'Primary button')",
    "Widget primaryButton() => const Text('hi');",
    '',
    '@Preview()',
    'Widget needsTitle(String title) => Text(title);',
    '',
    'class Banner2 extends StatelessWidget {',
    '  const Banner2({super.key});',
    '  @override',
    "  Widget build(BuildContext context) => const Text('b');",
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(DIR, 'lib', 'widgets', 'card.dart'), [
    "import 'package:flutter/widget_previews.dart';",
    "import 'package:flutter/material.dart';",
    '',
    'class InfoCard extends StatelessWidget {',
    '  @Preview()',
    '  const InfoCard({super.key});',
    '  @override',
    '  Widget build(BuildContext context) => const Card();',
    '}',
    '',
    'class Tag extends StatelessWidget {',
    '  const Tag({super.key});',
    '  @override',
    '  Widget build(BuildContext context) => const SizedBox();',
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(DIR, 'README.md'), '# not dart\n')
}

const entries = `[...document.querySelectorAll('[data-fwp-entry]')].map((b) => b.dataset.fwpEntry)`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.fwp.open')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)

  check('preload exposes the fwp bridge', await evaluate(`typeof window.ccmDesktop.fwpScan === 'function' && typeof window.ccmDesktop.onFwpState === 'function'`))
  const scan = await evaluate(`window.ccmDesktop.fwpScan(${JSON.stringify(A)})`)
  check('scan finds the pubspec root, three @Preview entries and two widget classes', scan.flutter && scan.root?.toLowerCase() === DIR.toLowerCase() && scan.entries.length === 5 && scan.entries.filter((e) => e.kind === 'class').length === 2, JSON.stringify(scan).slice(0, 300))
  const outside = await evaluate(`window.ccmDesktop.fwpScan(${JSON.stringify(os.homedir())})`)
  check('scan outside the allowed folders finds nothing', !outside.flutter && outside.root === null, JSON.stringify(outside))
  const idle = await evaluate(`window.ccmDesktop.fwpGet()`)
  check('nothing runs until Start', idle?.state === 'idle', JSON.stringify(idle))

  await evaluate(`${W}.openFile(${JSON.stringify(path.join(DIR, 'README.md'))})`)
  await waitFor(`!!document.querySelector('[data-kind=file] [data-file-show-diff], [data-kind=file] [role=document]')`, 8000, 'readme').catch(() => {})
  await sleep(500)
  check('no toggle on a non-Dart file', await evaluate(`!document.querySelector('[data-fwp-toggle]')`))

  await evaluate(`${W}.openFile(${JSON.stringify(A)})`)
  await waitFor(`!!document.querySelector('[data-fwp-toggle]')`, 8000, 'toggle').catch(() => {})
  check('a .dart file of a Flutter project shows the toggle', await evaluate(`!!document.querySelector('[data-fwp-toggle]')`))
  check('panel stays closed until toggled', await evaluate(`!document.querySelector('[data-fwp-panel]')`))
  await evaluate(`document.querySelector('[data-fwp-toggle]').click()`)
  await waitFor(`${entries}.length === 4`, 10000, 'entries').catch(() => {})
  const list = await evaluate(entries)
  check('panel lists this file first (classes too), then other @Preview only', JSON.stringify(list) === JSON.stringify(['lib/a.dart#primaryButton', 'lib/a.dart#needsTitle', 'lib/a.dart#Banner2', 'lib/widgets/card.dart#InfoCard']), JSON.stringify(list))
  check('widget class of this file is pickable', await evaluate(`!document.querySelector('[data-fwp-entry="lib/a.dart#Banner2"]').disabled`))
  check('groups: this file / elsewhere', await evaluate(`!!document.querySelector('[data-fwp-group=here]') && !!document.querySelector('[data-fwp-group=other]')`))
  check('entry with required params is disabled with its reason', await evaluate(`(() => { const b = document.querySelector('[data-fwp-entry="lib/a.dart#needsTitle"]'); return b.disabled && !!b.querySelector('[data-fwp-skipped]') })()`))
  check('label from name:', await evaluate(`document.querySelector('[data-fwp-entry="lib/a.dart#primaryButton"]').textContent.includes('Primary button')`))
  check('status shows icon + text', await evaluate(`(() => { const s = document.querySelector('[data-fwp-state]'); return !!s.querySelector('svg') && s.textContent.trim().length > 0 })()`))
  check('toggle state persists', await evaluate(`localStorage.getItem('ccm.fwp.open') === '1' && document.querySelector('[data-fwp-toggle]').getAttribute('aria-pressed') === 'true'`))

  await evaluate(`document.querySelector('[data-fwp-entry="lib/a.dart#primaryButton"]').click()`)
  await sleep(400)
  check('picking an entry before Start marks it current', await evaluate(`document.querySelector('[data-fwp-entry="lib/a.dart#primaryButton"]').getAttribute('aria-current') === 'true'`))
  check('no host written without Start', !fs.existsSync(path.join(DIR, '.dart_tool', 'ccm_preview', 'main.dart')))
  check('no horizontal overflow', await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
  await shot('fwp-01-panel')

  // The panel holds the device trackers: let the real list land first so it does not replace the fake one mid-check.
  await waitFor(`${S}.get('run').devicesLoaded`, 8000, 'devices listed').catch(() => {})
  await evaluate(`${S}.get('run').devices = [{ id: 'emu-a', name: 'Emu A', platform: 'android-x64', emulator: true, state: 'ready', source: 'flutter' }, { id: 'emu-b', name: 'Emu B', platform: 'android-x64', emulator: true, state: 'ready', source: 'flutter' }]`)
  await waitFor(`!!document.querySelector('[data-fwp-device]')`, 3000, 'device picker').catch(() => {})
  check('device picker lists the mobile devices', await evaluate(`!!document.querySelector('[data-fwp-device]')`))
  check('device choice is per project, no global key', await evaluate(`localStorage.getItem('ccm.fwp.device') === null`))

  fs.appendFileSync(A, "@Preview(name: 'Added')\nWidget added() => const Text('new');\n")
  await waitFor(`${entries}.includes('lib/a.dart#added')`, 8000, 'rescan on save').catch(() => {})
  check('saving the file rescans the list', await evaluate(`${entries}.includes('lib/a.dart#added')`))

  await evaluate(`document.querySelector('[data-fwp-toggle]').click()`)
  await sleep(300)
  check('toggle closes the panel', await evaluate(`!document.querySelector('[data-fwp-panel]')`))
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('fwp-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-flutter-preview.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
