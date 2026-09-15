import { serve } from '@hono/node-server'
import { app } from './app.js'

const port = Number(process.env.PORT ?? 5179)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535')
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  console.log(`LookGit v1.0.0 — http://localhost:${info.port}`)
})
