import { createServer } from 'node:http'
import { pino } from 'pino'
import { loadConfig } from './config.ts'
import { runConnection, type ConnectionHealth } from './runner.ts'

const logger = pino({ level: 'info' })
const shutdown = new AbortController()
process.once('SIGTERM', () => shutdown.abort())
process.once('SIGINT', () => shutdown.abort())
try {
  const config = await loadConfig(
    process.env.MOTIF_CONNECTOR_CONFIG ?? '/config/connector.json'
  )
  const connections: Record<string, ConnectionHealth> = {}
  const configured = config.connections.map(connection => {
    const health: ConnectionHealth = {
      state: 'connecting',
      forwarded: 0,
      returned: 0,
      quarantined: 0,
      reconnects: 0,
      lastConfirmedAt: null,
    }
    connections[connection.id] = health
    return { connection, health }
  })
  const server = createServer((request, response) => {
    const ready = Object.values(connections).every(
      connection => connection.state === 'ready'
    )
    if (request.url !== '/health' && request.url !== '/ready') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(request.url === '/ready' && !ready ? 503 : 200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify({ ready, connections }))
  })
  server.listen(config.healthPort, '0.0.0.0')
  const running = configured.map(({ connection, health }) =>
    runConnection(connection, config, health, logger, shutdown.signal)
  )
  await Promise.all(running)
  server.close()
} catch {
  logger.fatal(
    'Connector configuration or startup failed; inspect configuration and mounted secret files'
  )
  shutdown.abort()
  process.exitCode = 1
}
