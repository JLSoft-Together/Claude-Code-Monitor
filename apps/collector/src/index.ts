import path from 'node:path'
import { TIMELINE_DIR, TimelineRecorder } from '@ccm/habblaud/server/history/timeline'
import { NameStore } from '@ccm/habblaud/server/model/names'
import { busyCounts, parseDeviceUsed, type BusyMessage, type MonitorEvent } from '@ccm/shared'
import { defaultProcReader } from './resources/procs'
import { defaultPortTable } from './resources/ports'
import { fixturePortTable, fixtureProcReader } from './resources/fixture'
import { ResourceSampler } from './resources/sampler'
import { OfficeHub } from './office/hub'
import { OfficeModel } from './office/model'
import { useEnglishOffice } from './office/locale'
import { AliasStore, MAX_NOTE_LENGTH } from './aliases'
import { firstStartToday } from './daystart'
import { loadConfig } from './config'
import { FavoriteStore } from './favorites'
import { LimitHistory } from './forecast'
import { SessionHistory } from './history'
import { StatusTimeline } from './timeline'
import { JsonFile } from './json-file'
import { SnoozeStore } from './snooze'
import { defaultToastDeps, Toaster } from './toast'
import { electronToastDeps } from './toast-electron'
import { Monitor } from './monitor'
import { RepoRoots } from './repo'
import { ResponseTracker } from './response'
import { isPortInUse, PORT_IN_USE_EXIT, startServer } from './server'
import { MonitorStore } from './store'
import { UsageIndex } from './usage'
import { openFolder } from './opener'
import { PromptSearcher } from './prompt-search'
import { CodexMonitor } from './codex/monitor'
import { listCodexProcesses } from './codex/processes'
import { isPidAlive } from './process'
import { SENSITIVE_FILE, SensitiveWatch } from './sensitive/watch'

async function main(): Promise<void> {
  useEnglishOffice()
  const config = loadConfig()
  if (!config.appKey && !config.dev) {
    console.error('[collector] Orrery runs inside its desktop app: npm run desktop (UI work: npm run dev).')
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
  const sensitive = new SensitiveWatch({ claudeRoot: config.claudeRoot, rootOf: (cwd) => store.projectRoot(cwd) }, path.join(config.dataDir, SENSITIVE_FILE))
  await sensitive.load()
  sensitive.onChange = (settings) => store.setSensitive(settings)
  store.setSensitive(sensitive.settings)
  monitor.contextHints.sensitive = sensitive
  const usage = new UsageIndex(path.join(config.claudeRoot, 'projects'), path.join(config.dataDir, 'usage-index.json'), store)
  monitor.onProjectFile = (file) => usage.notify(file)
  const promptSearch = new PromptSearcher(path.join(config.claudeRoot, 'projects'), { openFolder })
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
  store.subscribe((message) => {
    for (const e of message.events) if (e.type === 'activity' && e.payload.kind === 'sensitive') toaster.observeSensitive(e.payload)
  })
  // v76 R6: desktop main decides (enabled, machine idle, rate limit); the collector only reports episodes.
  if (hostPort) toaster.onPhone = (m) => hostPort.postMessage(m)
  // The desktop app keeps the machine awake while something works (v76 R3); only changes cross the port.
  let lastBusy = ''
  const postBusy = () => {
    if (!hostPort) return
    const busy: BusyMessage = { type: 'busy', ...busyCounts(store.terminalList(), store.agentList(), store.jobList()) }
    const key = `${busy.agents}:${busy.jobs}`
    if (key === lastBusy) return
    lastBusy = key
    hostPort.postMessage(busy)
  }
  store.subscribe(postBusy)
  postBusy()
  void toaster.refreshHealth().then(() => store.setNotify(toaster.settings()))
  const toastTimer = setInterval(() => {
    observe()
    toaster.checkLoops(store.toolEvents())
  }, 15_000)
  toastTimer.unref()

  let windows = 0
  const resFixture = process.env.CCM_RES_FIXTURE || null
  const portTable = resFixture ? fixturePortTable(resFixture) : defaultPortTable()
  const sampler = new ResourceSampler({
    reader: resFixture ? fixtureProcReader(resFixture) : defaultProcReader(),
    ...(portTable ? { ports: portTable } : {}),
    terminals: () => store.terminalList(),
    agents: () => store.agentList(),
    jobs: () => store.jobList(),
    idleMinutes: () => toaster.idleMinutes,
    lastDeviceCallAt: () => monitor.lastDeviceCallAt(),
    conflicts: () => monitor.portConflicts(),
    onReport: (report) => {
      store.setResources(report)
      toaster.observeIdle(report)
      // The desktop app checks kill requests against the newest report (pid + creation time).
      hostPort?.postMessage({ type: 'resources', report })
    },
  })
  const syncSampler = () => sampler.setActive(windows > 0 || toaster.idleWatch)
  syncSampler()

  // Listen first: the dashboard opens at once and sessions arrive as the first pass publishes them.
  store.setLoading(true)
  let officeHub: OfficeHub | null = null
  const officeReplies = new Map<string, (event: MonitorEvent) => void>()
  const server = await startServer({
    timelineDir: path.join(config.dataDir, TIMELINE_DIR),
    host: config.host,
    port: config.port,
    webDist: config.webDist,
    devOriginPorts: config.devOriginPorts,
    appKey: config.appKey,
    store,
    onClientCount: (count) => {
      windows = count
      syncSampler()
    },
    onClientClose: (clientId) => {
      toaster.dropClient(clientId)
      promptSearch.dropClient(clientId)
      officeReplies.delete(String(clientId))
      officeHub?.dropClient(String(clientId))
    },
    onFocusRun: async (terminalId, key) => {
      if (!toaster.accepts(key)) return null
      if (!store.getTerminal(terminalId)) return 'notFound'
      toaster.hideFor(terminalId)
      return monitor.focusWindow(terminalId, () => undefined)
    },
    onSnoozeLink: (terminalId, key, minutes) => {
      const terminal = store.getTerminal(terminalId)
      if (!toaster.accepts(key) || !terminal || !snoozes.set(terminal, minutes)) return false
      store.setSnoozes(snoozes.all())
      toaster.hideFor(terminalId)
      return true
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
        case 'office.subscribe':
          if (message.on) officeReplies.set(String(ctx.clientId), ctx.reply)
          else officeReplies.delete(String(ctx.clientId))
          officeHub?.subscribe(String(ctx.clientId), message.on)
          break
        case 'toolSpans.get':
          monitor.sendToolSpans(ctx.reply, message.terminalId, message.since)
          break
        case 'timeline.get':
          monitor.sendTimeline(ctx.reply)
          break
        case 'heatmap.get':
          ctx.reply({ type: 'heatmap.data', payload: usage.heatmap(28) })
          break
        case 'toolstats.get':
          ctx.reply({ type: 'toolstats.data', payload: usage.toolStats(message.days, message.project) })
          break
        case 'promptSearch.start':
          void promptSearch.start(ctx.clientId, message, ctx.reply)
          break
        case 'promptSearch.cancel':
          promptSearch.cancel(ctx.clientId, message.searchId)
          break
        case 'promptSearch.open':
          void promptSearch.open(ctx.clientId, message.searchId, message.sessionId, ctx.reply)
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
          toaster.update({ toast: message.toast, kinds: message.kinds, quiet: message.quiet, stuckMinutes: message.stuckMinutes, idleMinutes: message.idleMinutes })
          store.setNotify(toaster.settings())
          syncSampler()
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
        case 'sensitive.update':
          sensitive.update({ groups: message.groups, globs: message.globs, ignore: message.ignore })
          break
        case 'sensitive.ignore':
          sensitive.ignore(message.project, message.rule, message.on)
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
  console.log(`[collector] watching ${config.claudeRoot}${config.codex ? ` + ${config.codexHome}` : ''}`)
  console.log(`[collector] data dir ${config.dataDir}`)
  console.log(`[collector] dashboard http://${config.host}:${config.port}  websocket ws://${config.host}:${config.port}/ws`)

  const officeNames = new NameStore(path.join(config.dataDir, 'office-names.json'))
  officeNames.load()
  const recorder = new TimelineRecorder({ dir: path.join(config.dataDir, TIMELINE_DIR) })
  recorder.start()
  let closing = false
  let usageStarted = false
  const shutdown = () => {
    if (closing) return
    closing = true
    clearInterval(toastTimer)
    sampler.stop()
    monitor.stop()
    officeHub?.stop()
    recorder.stop()
    officeNames.flush()
    server.close()
    void Promise.all([
      toaster.clear(),
      toaster.flush(),
      snoozes.flush(),
      sensitive.flush(),
      usageStarted ? usage.stop() : undefined,
      response.save(),
      limitHistory.save(),
      codexLimitHistory.save(),
      history.save(),
      timeline.save(),
      dismissedJobs.flush(),
    ]).finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Electron utilityProcess (desktop app) receives no signals on Windows; the host asks over parentPort instead.
  const { parentPort } = process as NodeJS.Process & { parentPort?: { on(event: 'message', fn: (e: { data: unknown }) => void): void } }
  parentPort?.on('message', (e) => {
    if (e.data === 'shutdown') return shutdown()
    const used = parseDeviceUsed(e.data)
    if (used) sampler.deviceUsed(used)
  })

  await monitor.start()
  store.setLoading(false)
  if (!closing) {
    // meta.version: the collector does not know the app version, so it stays empty.
    officeHub = new OfficeHub({
      store,
      model: new OfficeModel({ names: officeNames, version: '' }),
      recorder,
      send: (clientId, message) => {
        const reply = officeReplies.get(clientId)
        const event = message.events[0]
        if (reply && event) reply(event)
      },
    })
    officeHub.start()
    for (const id of officeReplies.keys()) officeHub.subscribe(id, true)
  }
  if (closing) return
  await monitor.codex?.start()
  if (closing) return
  await usage.start()
  usageStarted = true
}

process.on('unhandledRejection', (err: unknown) => {
  console.error('[collector] unhandled rejection:', err instanceof Error ? err.message : err)
})
// State after an uncaught exception is unknown; the desktop host restarts the collector.
process.on('uncaughtException', (err: Error) => {
  console.error('[collector] uncaught exception:', err.stack ?? err.message)
  process.exit(1)
})

main().catch((err: unknown) => {
  if (isPortInUse(err)) {
    const port = loadConfig().port
    console.error(
      `[collector] port ${port} is already in use (another Orrery, or another app: 4317 is also the OpenTelemetry OTLP/gRPC default). Quit it or set CCM_PORT.`,
    )
    process.exit(PORT_IN_USE_EXIT)
  }
  console.error('[collector] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
