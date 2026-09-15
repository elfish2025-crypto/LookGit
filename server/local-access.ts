import type { MiddlewareHandler } from 'hono'

/** Limit browser access to this loopback app, including Vite's local dev proxy. */
export function localAccess(port: number): MiddlewareHandler {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`])
  const origins = new Set([...hosts, 'localhost:5178', '127.0.0.1:5178'].map(host => `http://${host}`))
  return async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host
    const origin = c.req.header('origin')
    if (!hosts.has(host) || (origin !== undefined && !origins.has(origin)) || c.req.header('sec-fetch-site') === 'cross-site') {
      return c.json({ error: 'Only local LookGit access is allowed' }, 403)
    }
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Frame-Options', 'DENY')
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
    await next()
  }
}
