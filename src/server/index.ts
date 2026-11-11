import { getRequestListener } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createApi } from './api.js'
import { createCore } from './core.js'
import { DATA_DIR, backup, openDb } from './db.js'
import { createMcpServer } from './mcp.js'

const PORT = Number(process.env.PORT || 3000)
const WEB_DIR = path.resolve(process.env.WEB_DIR || './dist/web')

const db = openDb()
const core = createCore(db)

// ── Jeton MCP : variable d'environnement, sinon généré une fois et conservé dans le volume de données.
function loadMcpToken(): string {
  if (process.env.MCP_TOKEN) return process.env.MCP_TOKEN
  const file = path.join(DATA_DIR, 'mcp-token.txt')
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  const token = crypto.randomBytes(24).toString('base64url')
  fs.writeFileSync(file, token + '\n', { mode: 0o600 })
  return token
}
const MCP_TOKEN = loadMcpToken()

// ── Sauvegarde quotidienne (et une au démarrage s'il n'y en a pas eu depuis 24 h).
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 30)
let lastBackup = 0
const backupNow = async () => {
  const file = await backup(db, BACKUP_KEEP)
  lastBackup = Date.now()
  return file
}
const backupHour = Number(process.env.BACKUP_HOUR ?? 3)
setInterval(() => {
  const due = Date.now() - lastBackup > 23 * 3600_000 && new Date().getHours() === backupHour
  if (due) backupNow().then((f) => console.log('Sauvegarde :', f)).catch((e) => console.error('Sauvegarde échouée :', e))
}, 10 * 60_000).unref()
backupNow().then((f) => console.log('Sauvegarde de démarrage :', f)).catch((e) => console.error('Sauvegarde échouée :', e))

// ── Application web
const app = new Hono()
app.get('/healthz', (c) => c.json({ ok: true }))
// ── Connexion : page de login dans l'interface, puis cookie de session (90 jours). Sans APP_PASSWORD, accès libre.
const APP_PASSWORD = process.env.APP_PASSWORD || ''
const COOKIE = 'lefil_session'
const sessionValue = () => crypto.createHmac('sha256', APP_PASSWORD).update('lefil-session-v1').digest('hex')
const safeEqual = (a: string, b: string) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest())
const isAuthed = (c: any) => {
  if (!APP_PASSWORD) return true
  const v = getCookie(c, COOKIE)
  return !!v && safeEqual(v, sessionValue())
}
// Anti force brute : 8 essais ratés → 5 minutes de blocage par IP.
const fails = new Map<string, { n: number; until: number }>()
const clientIp = (c: any) => (c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || c.req.header('x-forwarded-for')?.split(',')[0] || 'x').trim()
app.get('/api/me', (c) => c.json({ authRequired: !!APP_PASSWORD, authed: isAuthed(c) }))
app.post('/api/login', async (c) => {
  const ip = clientIp(c)
  const f = fails.get(ip)
  if (f && f.until > Date.now()) return c.json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' }, 429)
  const body = await c.req.json().catch(() => ({}))
  const password = typeof body?.password === 'string' ? body.password : ''
  if (APP_PASSWORD && !safeEqual(password, APP_PASSWORD)) {
    const n = (f?.n ?? 0) + 1
    fails.set(ip, { n, until: n >= 8 ? Date.now() + 5 * 60_000 : 0 })
    return c.json({ error: 'Mot de passe incorrect.' }, 401)
  }
  fails.delete(ip)
  if (APP_PASSWORD) {
    const secure = c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:'
    setCookie(c, COOKIE, sessionValue(), { path: '/', httpOnly: true, sameSite: 'Lax', secure, maxAge: 60 * 60 * 24 * 90 })
  }
  return c.json({ ok: true })
})
app.post('/api/logout', (c) => {
  deleteCookie(c, COOKIE, { path: '/' })
  return c.json({ ok: true })
})
app.use('/api/*', async (c, next) => {
  if (isAuthed(c)) return next()
  return c.json({ error: 'Non connecté.' }, 401)
})
app.route('/api', createApi(core, { mcpToken: MCP_TOKEN, backupNow }))
app.all('/api/*', (c) => c.json({ error: 'Route inconnue.' }, 404))
app.use('*', serveStatic({ root: path.relative(process.cwd(), WEB_DIR) || '.' }))
app.get('*', (c) => {
  const index = path.join(WEB_DIR, 'index.html')
  return fs.existsSync(index) ? c.html(fs.readFileSync(index, 'utf8')) : c.text('Interface non construite : lance « npm run build ».', 503)
})
const webListener = getRequestListener(app.fetch)

// ── MCP (Streamable HTTP, sans état) : /mcp avec « Authorization: Bearer <jeton> », ou /mcp/<jeton>.
function tokenOk(given: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(MCP_TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse, pathToken: string) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!tokenOk(pathToken || bearer)) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Jeton MCP manquant ou invalide.' }, id: null }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Méthode non autorisée.' }, id: null }))
    return
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'JSON invalide.' }, id: null }))
    return
  }
  const server = createMcpServer(core)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

http
  .createServer((req, res) => {
    const m = (req.url || '').match(/^\/mcp(?:\/([^/?]+))?\/?(?:\?.*)?$/)
    if (m) {
      handleMcp(req, res, m[1] ? decodeURIComponent(m[1]) : '').catch((e) => {
        console.error('MCP :', e)
        if (!res.headersSent) res.writeHead(500).end()
      })
    } else webListener(req, res)
  })
  .listen(PORT, () => {
    console.log(`Suivi freelance : http://localhost:${PORT}  ·  MCP : http://localhost:${PORT}/mcp`)
    if (!process.env.APP_PASSWORD) console.log('APP_PASSWORD non défini : interface sans mot de passe (à garder derrière Tailscale / Cloudflare Access).')
  })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    db.close()
    process.exit(0)
  })
}
