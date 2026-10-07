import { loadConfig } from './config'
import { Monitor } from './monitor'
import { startServer } from './server'
import { MonitorStore } from './store'

async function main(): Promise<void> {
  const config = loadConfig()
  const store = new MonitorStore({ activityLimit: config.activityLimit, batchMs: config.batchMs })
  const monitor = new Monitor(config, store)

  await monitor.start()
  const server = await startServer({ host: config.host, port: config.port, webDist: config.webDist, store })

  console.log(`[collector] watching ${config.claudeRoot}`)
  console.log(`[collector] dashboard http://${config.host}:${config.port}  websocket ws://${config.host}:${config.port}/ws`)

  const shutdown = () => {
    monitor.stop()
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error('[collector] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
