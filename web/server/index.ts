import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, openDb } from './db.ts'
import { mediaClient } from './media.ts'
import { createApp } from './app.ts'

const config = loadConfig()
const db = openDb(join(config.data_dir, 'app.db'))
const { app, sweep, recover } = createApp({ db, origin: config.public_origin, media: mediaClient(config.media_socket) })

// En producción el mismo proceso sirve el frontend compilado; en desarrollo lo sirve Vite.
const dist = join(import.meta.dirname, '../dist')
if (existsSync(dist)) {
  const index = readFileSync(join(dist, 'index.html'), 'utf8')
  app.use('/assets/*', serveStatic({ root: dist }))
  app.get('*', (c) => c.html(index))
}

await recover()
setInterval(() => sweep().catch(console.error), 5000)

// Solo localhost: hacia afuera publica playit.gg, nunca este puerto.
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (i) =>
  console.log(`ps5-remote-web en http://127.0.0.1:${i.port} (origen público: ${config.public_origin})`))
