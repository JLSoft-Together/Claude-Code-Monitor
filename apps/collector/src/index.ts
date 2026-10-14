import path from 'node:path'
import { AliasStore, MAX_NOTE_LENGTH } from './aliases'
import { firstStartToday } from './daystart'
import { loadConfig } from './config'
import { FavoriteStore } from './favorites'
import { LimitHistory } from './forecast'
import { SessionHistory } from './history'
import { StatusTimeline } from './timeline'
import { JsonFile } from './json-file'
import { SnoozeStore } from './snooze'
import { defaultToastDeps, TEXT, Toaster } from './toast'
import { electronToastDeps } from './toast-electron'
import { Monitor } from './monitor'
import { RepoRoots } from './repo'
import { ResponseTracker } from './response'
import { isCollectorAt, isPortInUse, PORT_IN_USE_EXIT, startServer } from './server'
import { MonitorStore } from './store'
import { UsageIndex } from './usage'
import { CodexMonitor } from './codex/monitor'
import { listCodexProcesses } from './codex/processes'
import { isPidAlive } from './process'

async function main(): Promise<void> {
  const config = loadConfig()
  if (!config.appKey && !config.dev) {
    console.error('[collector] Agent Monitor runs inside its desktop app: npm run desktop (UI work: npm run dev).')
    process.exit(1)
  }
  const store = new MonitorStore({ activityLimit: config.activityLimit, batchMs: config.batchMs })
  store.statusLineCommand = config.statusLineCommand
  store.dayStartedAt = await firstStartToday(path.join(config.dataDir, 'day-start.json'))
  const aliases = new AliasStore(path.join(config.dataDir, 'aliases.json'))
  await aliases.load()
  const favorites = new FavoriteStore(path.join(config.dataDir, 'favorites.json'))
  await favorites.load()
  const response = new ResponseTracker(path.join(config.dataDir, 'response-stats.json'))
  await response.load()
  const limitHistory = new LimitHistory(path.join(config.dataDir, 'limit-history.json'))
  await limitHistory.load()
  const history = new SessionHistory(path.join(config.dataDir, 'history.json'))
  await history.load()
  const timeline = new StatusTimeline(path.join(config.dataDir, 'timeline.json'))
  await timeline.load()
  const notes = new AliasStore(path.join(config.dataDir, 'notes.json'), MAX_NOTE_LENGTH)
  await notes.load()
  const dismissedJobs = new JsonFile(path.join(config.dataDir, 'dismissed-jobs.json'), 500)
  const monitor = new Monitor(config, store, undefined, aliases, favorites, response, { limitHistory, history, timeline, notes, dismissedJobs })
  const codexLimitHistory = new LimitHistory(path.join(config.dataDir, 'codex-limit-history.json'))
  await codexLimitHistory.load()
  if (config.codex) {
    monitor.codex = new CodexMonitor(
      { codexHome: config.codexHome, staleTtlMs: config.staleTtlMs, reconcileMs: config.reconcileMs, verifyMs: config.processVerifyMs, verifyProcesses: config.verifyProcesses },
      store,
      () => monitor.claudeTargets(),
      { listProcesses: () => listCodexProcesses(), isPidAlive, now: () => Date.now() },
      codexLimitHistory,
    )
  }
  const usage = new UsageIndex(path.join(config.claudeRoot, 'projects'), path.join(config.dataDir, 'usage-index.json'), store)
  monitor.onProjectFile = (file) => usage.notify(file)
  const repoRoots = new RepoRoots()
  store.onNewProjects = (dirs) => {
    void Promise.all(dirs.map(async (d) => [d, await repoRoots.resolve(d)] as const)).then((pairs) =>
      store.setProjectRoots(Object.fromEntries(pairs)),
    )
  }

  const snoozes = new SnoozeStore(path.join(config.dataDir, 'snooze.json'))
  await snoozes.load()
  store.setSnoozes(snoozes.all())
  const hostPort = (process as unknown as { parentPort?: { postMessage: (msg: unknown) => void } }).parentPort
  const electronToast = config.toastBackend === 'electron' && hostPort !== undefined
  const toaster = new Toaster(
    { supported: config.toast && (config.toastBackend !== 'electron' || electronToast), port: config.port, file: path.join(config.dataDir, 'notify.json'), link: config.toastLink },
    electronToast ? { ...defaultToastDeps, ...electronToastDeps((m) => hostPort.postMessage(m)) } : defaultToastDeps,
  )
  await toaster.load()
  toaster.snoozed = (t) => snoozes.isSnoozed(t)
  store.setNotify(toaster.settings())
  const observe = () => {
    if (snoozes.prune(store.terminalList())) store.setSnoozes(snoozes.all())
    toaster.observe({ terminals: store.terminalList(), jobs: store.jobList(), limits: store.currentLimits(), contextPct: (id) => store.contextPct(id), toolOf: (id) => store.currentToolOf(id) })
  }
  store.subscribe(observe)
  void toaster.refreshHealth().then(() => store.setNotify(toaster.settings()))
  const toastTimer = setInterval(() => {
    observe()
    toaster.checkLoops(store.toolEvents())
  }, 15_000)
  toastTimer.unref()

  await monitor.start()
  await monitor.codex?.start()
  const server = await startServer({
    host: config.host,
    port: config.port,
    webDist: config.webDist,
    devOriginPorts: config.devOriginPorts,
    appKey: config.appKey,
    store,
    onClientClose: (clientId) => toaster.dropClient(clientId),
    onFocusRun: async (terminalId, key) => {
      if (!toaster.accepts(key)) return null
      if (!store.getTerminal(terminalId)) return 'notFound'
      toaster.hideFor(terminalId)
      return monitor.focusWindow(terminalId, () => undefined)
    },
    onSnoozeLink: (terminalId, key, minutes) => {
      const terminal = store.getTerminal(terminalId)
      if (!toaster.accepts(key) || !terminal || !snoozes.set(terminal, minutes)) return null
      store.setSnoozes(snoozes.all())
      toaster.hideFor(terminalId)
      return TEXT[toaster.locale].page.snoozed(minutes)
    },
    onClientMessage: (message, ctx) => {
      switch (message.type) {
        case 'terminal.alias':
          monitor.setAlias(message.terminalId, message.alias)
          break
        case 'favorite.toggle':
          monitor.toggleFavorite(message.terminalId)
          break
        case 'favorite.rename':
          monitor.renameFavorite(message.dir, message.label)
          break
        case 'favorite.remove':
          monitor.removeFavorite(message.dir)
          break
        case 'favorite.reorder':
          monitor.reorderFavorites(message.dirs)
          break
        case 'favorite.add':
          void monitor.addFavorite(message.dir, message.label)
          break
        case 'folder.pick':
          void monitor.pickFolder(message.requestId, ctx.reply)
          break
        case 'history.get':
          monitor.sendHistory(ctx.reply)
          break
        case 'toolSpans.get':
          monitor.sendToolSpans(ctx.reply, message.terminalId, message.since)
          break
        case 'timeline.get':
          monitor.sendTimeline(ctx.reply)
          break
        case 'terminal.focusWindow':
          void monitor.focusWindow(message.terminalId, ctx.reply)
          break
        case 'terminal.open':
          void monitor.openFolder(message.terminalId, message.app, ctx.reply)
          break
        case 'diagnostics.get':
          ctx.reply({ type: 'diagnostics.data', payload: { ...monitor.diagnostics(), usage: usage.scanInfo(), clients: ctx.clients } })
          break
        case 'terminal.dismiss':
          monitor.dismissEnded(message.terminalId)
          break
        case 'job.dismiss':
          monitor.dismissJobs(message.jobId)
          break
        case 'job.stop':
          void monitor.stopJob(message.jobId)
          break
        case 'favorite.open':
          void monitor.openFavorite(message.dir, message.mode, message.terminalApp)
          break
        case 'client.presence':
          toaster.setPresence(ctx.clientId, message.attentive, message.locale)
          break
        case 'notify.update':
          toaster.update({ toast: message.toast, kinds: message.kinds, quiet: message.quiet, stuckMinutes: message.stuckMinutes })
          store.setNotify(toaster.settings())
          break
        case 'notify.test':
          void toaster.test().then((r) => {
            store.setNotify(toaster.settings())
            ctx.reply({ type: 'notify.testResult', payload: r })
          })
          break
        case 'terminal.note':
          monitor.setNote(message.terminalId, message.note)
          break
        case 'terminal.snooze': {
          const terminal = store.getTerminal(message.terminalId)
          if (!terminal || !snoozes.set(terminal, message.minutes)) break
          store.setSnoozes(snoozes.all())
          if (snoozes.isSnoozed(terminal)) toaster.hideFor(terminal.id)
          break
        }
        default:
          break
      }
    },
  })
  await usage.start()

  console.log(`[collector] watching ${config.claudeRoot}${config.codex ? ` + ${config.codexHome}` : ''}`)
  console.log(`[collector] data dir ${config.dataDir}`)
  console.log(`[collector] dashboard http://${config.host}:${config.port}  websocket ws://${config.host}:${config.port}/ws`)

  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    clearInterval(toastTimer)
    monitor.stop()
    server.close()
    void Promise.all([toaster.clear(), usage.stop(), response.save(), limitHistory.save(), codexLimitHistory.save(), history.save(), timeline.save(), dismissedJobs.flush()]).finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Electron utilityProcess (desktop app) receives no signals on Windows; the host asks over parentPort instead.
  const { parentPort } = process as NodeJS.Process & { parentPort?: { on(event: 'message', fn: (e: { data: unknown }) => void): void } }
  parentPort?.on('message', (e) => {
    if (e.data === 'shutdown') shutdown()
  })
}

process.on('unhandledRejection', (err: unknown) => {
  console.error('[collector] unhandled rejection:', err instanceof Error ? err.message : err)
})
process.on('uncaughtException', (err: Error) => {
  console.error('[collector] uncaught exception:', err.message)
})

main().catch(async (err: unknown) => {
  if (isPortInUse(err)) {
    const port = loadConfig().port
    console.error(
      (await isCollectorAt(port))
        ? `[collector] Agent Monitor is already running on port ${port}. Quit it first, or set CCM_PORT to run both.`
        : `[collector] port ${port} is already in use by another app (4317 is also the OpenTelemetry OTLP/gRPC default). Stop the other app or set CCM_PORT.`,
    )
    process.exit(PORT_IN_USE_EXIT)
  }
  console.error('[collector] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
