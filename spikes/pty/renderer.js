const $ = (id) => document.getElementById(id)
const SID_KEY = 'ccm.spike.sid'

const term = new Terminal({
  allowProposedApi: true,
  cursorBlink: true,
  fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.25,
  cursorStyle: 'bar',
  smoothScrollDuration: 0,
  scrollback: 5000,
  theme: { background: '#14161a', foreground: '#d6d9de', cursor: '#5b8cff', selectionBackground: '#33456b' },
})
const fit = new FitAddon.FitAddon()
term.loadAddon(fit)
// Graphemes (not unicode11): Vietnamese NFD text from Claude/Ink otherwise drifts the cursor.
term.loadAddon(new UnicodeGraphemesAddon.UnicodeGraphemesAddon())
term.unicode.activeVersion = '15-graphemes'
term.open($('term'))
try {
  const webgl = new WebglAddon.WebglAddon()
  webgl.onContextLoss(() => webgl.dispose())
  term.loadAddon(webgl)
  $('renderer').textContent = 'renderer webgl'
} catch (e) {
  $('renderer').textContent = 'renderer dom (' + e.message + ')'
}
fit.fit()

let ws = null
let pendingKeyAt = 0
const samples = []
const encoder = new TextEncoder()

function log(text) {
  $('log').textContent = text
  $('log').title = text
}

function setState(text, cls = '') {
  $('state').textContent = text
  $('state').className = cls
}

function sendInput(text) {
  if (!ws || ws.readyState !== 1) return
  if (!pendingKeyAt) pendingKeyAt = performance.now()
  ws.send(encoder.encode(text))
}

function recordLatency() {
  if (!pendingKeyAt) return
  samples.push(performance.now() - pendingKeyAt)
  pendingKeyAt = 0
  if (samples.length > 50) samples.shift()
  const sorted = [...samples].sort((a, b) => a - b)
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1)
  $('latency').textContent = `key→echo p50 ${p(0.5)} ms · p95 ${p(0.95)} ms (n=${sorted.length})`
}

term.onData(sendInput)
term.onBinary((data) => {
  if (ws && ws.readyState === 1) ws.send(Uint8Array.from(data, (c) => c.charCodeAt(0)))
})
term.onResize(({ cols, rows }) => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'resize', cols, rows })))
new ResizeObserver(() => fit.fit()).observe($('term'))

// Claude Code reads clipboard images itself on Ctrl+V, so forward the raw key when the clipboard holds an image.
term.attachCustomKeyEventHandler((e) => {
  if (e.type !== 'keydown') return true
  const key = e.key.toLowerCase()
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey) {
    sendInput('\x1b\r')
    return false
  }
  if (e.ctrlKey && !e.altKey && key === 'c' && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection())
    term.clearSelection()
    return false
  }
  if (e.ctrlKey && !e.altKey && key === 'v') {
    e.preventDefault()
    pasteFromClipboard(e.shiftKey)
    return false
  }
  return true
})

async function pasteFromClipboard(forceText) {
  try {
    if (!forceText) {
      const items = await navigator.clipboard.read()
      if (items.some((it) => it.types.some((t) => t.startsWith('image/')))) {
        log('paste: image → raw ^V')
        sendInput('\x16')
        return
      }
    }
    const text = await navigator.clipboard.readText()
    if (text) term.paste(text)
    log(`paste: text ${text.length} chars`)
  } catch (err) {
    log('paste failed: ' + err.message)
  }
}

const textarea = term.textarea
textarea.addEventListener('compositionstart', () => log('IME compositionstart'))
textarea.addEventListener('compositionupdate', (e) => log('IME update: ' + e.data))
textarea.addEventListener('compositionend', (e) => log('IME end: ' + JSON.stringify(e.data)))

async function connect(onOpen) {
  const cfg = await window.spike.config()
  $('info').textContent = `Electron ${cfg.electron} · ${cfg.platform}`
  ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/pty`, ['ccm.pty.' + cfg.token])
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => onOpen(ws)
  ws.onclose = (e) => setState(`socket closed ${e.code}`, 'bad')
  ws.onerror = () => setState('socket error', 'bad')
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') {
      recordLatency()
      term.write(new Uint8Array(ev.data))
      return
    }
    const msg = JSON.parse(ev.data)
    if (msg.t === 'ready') {
      sessionStorage.setItem(SID_KEY, msg.id)
      setState(`${msg.preset}${msg.pid ? ` pid ${msg.pid}` : ''}${msg.replay ? ' (reattached)' : ''}`, 'ok')
      ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }))
      term.focus()
    } else if (msg.t === 'pid') {
      setState(`${$('state').textContent.replace(/ pid \d+/, '')} pid ${msg.pid}`, 'ok')
    } else if (msg.t === 'exit') {
      setState(`exited ${msg.code}`, msg.code === 0 ? '' : 'bad')
      sessionStorage.removeItem(SID_KEY)
    } else if (msg.t === 'gone') {
      sessionStorage.removeItem(SID_KEY)
      setState('previous session gone')
    }
  }
}

$('spawn').onclick = () => {
  ws?.close()
  term.reset()
  connect((s) => s.send(JSON.stringify({ t: 'spawn', preset: $('preset').value, cols: term.cols, rows: term.rows })))
}
$('kill').onclick = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'kill' }))
$('reload').onclick = () => location.reload()

const previous = sessionStorage.getItem(SID_KEY)
if (previous) connect((s) => s.send(JSON.stringify({ t: 'attach', id: previous })))
