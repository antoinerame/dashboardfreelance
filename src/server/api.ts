// API REST consommée par l'interface web. Aucune logique ici : tout passe par core.ts.
import { Hono } from 'hono'
import type { Core } from './core.js'
import { AppError, parsePeriod } from './util.js'

export function createApi(core: Core, info: { mcpToken: string; backupNow: () => Promise<string> }) {
  const api = new Hono()
  const id = (c: any) => Number(c.req.param('id'))
  const body = async (c: any) => (await c.req.json().catch(() => ({}))) as Record<string, any>
  const q = (c: any) => c.req.query() as Record<string, string>
  const num = (v?: string) => (v ? Number(v) : undefined)

  api.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message }, err.status as any)
    const msg = String((err as Error).message || err)
    if (/UNIQUE constraint/.test(msg)) return c.json({ error: 'Cette valeur existe déjà (doublon).' }, 409)
    if (/CHECK constraint|FOREIGN KEY|NOT NULL/.test(msg)) return c.json({ error: 'Valeur invalide : ' + msg }, 400)
    console.error(err)
    return c.json({ error: 'Erreur interne : ' + msg }, 500)
  })

  api.get('/dashboard', (c) => c.json(core.dashboard()))
  api.get('/search', (c) => c.json(core.search(q(c).q || '')))
  api.get('/export', (c) => {
    c.header('Content-Disposition', `attachment; filename="suivi-freelance-${new Date().toISOString().slice(0, 10)}.json"`)
    return c.json(core.exportAll())
  })
  api.post('/backup', async (c) => c.json({ file: await info.backupNow() }))

  api.get('/settings', (c) => c.json({ settings: core.getSettings(), mcp_token: info.mcpToken }))
  api.put('/settings', async (c) => c.json({ settings: core.setSettings(await body(c)), mcp_token: info.mcpToken }))

  // Clients & contacts
  api.get('/clients', (c) => c.json(core.listClients()))
  api.post('/clients', async (c) => c.json(core.createClient(await body(c))))
  api.patch('/clients/:id', async (c) => c.json(core.updateClient(id(c), await body(c))))
  api.delete('/clients/:id', (c) => (core.deleteClient(id(c)), c.json({ ok: true })))
  api.post('/contacts', async (c) => c.json(core.createContact(await body(c))))
  api.patch('/contacts/:id', async (c) => c.json(core.updateContact(id(c), await body(c))))
  api.delete('/contacts/:id', (c) => (core.deleteContact(id(c)), c.json({ ok: true })))

  // Missions & chantiers
  api.get('/missions', (c) => c.json(core.listMissions().map((m) => ({ ...m, chantiers: core.listChantiers(m.id) }))))
  api.post('/missions', async (c) => c.json(core.createMission(await body(c))))
  api.get('/missions/:id', (c) => c.json(core.missionOverview(id(c))))
  api.patch('/missions/:id', async (c) => c.json(core.updateMission(id(c), await body(c))))
  api.delete('/missions/:id', (c) => (core.deleteMission(id(c)), c.json({ ok: true })))
  api.get('/missions/:id/chantiers', (c) => c.json(core.listChantiers(id(c))))
  api.post('/chantiers', async (c) => c.json(core.createChantier(await body(c))))
  api.patch('/chantiers/:id', async (c) => c.json(core.updateChantier(id(c), await body(c))))
  api.delete('/chantiers/:id', (c) => (core.deleteChantier(id(c)), c.json({ ok: true })))

  // Temps
  const period = (c: any) => {
    const p = q(c)
    if (p.from && p.to) return { from: p.from, to: p.to }
    const r = parsePeriod(p.period)
    return { from: r.from, to: r.to }
  }
  api.get('/time', (c) => c.json(core.timesheet({ ...period(c), mission_id: num(q(c).mission_id) })))
  api.get('/time/export', (c) => {
    const format = q(c).format === 'csv' ? 'csv' : 'md'
    const p = period(c)
    const text = core.exportTimesheet({ ...p, mission_id: num(q(c).mission_id) }, format)
    c.header('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="feuille-de-temps-${p.from}_${p.to}.${format}"`)
    return c.body(text)
  })
  api.post('/time', async (c) => c.json(core.logTime(await body(c))))
  api.patch('/time/:id', async (c) => c.json(core.updateTime(id(c), await body(c))))
  api.delete('/time/:id', (c) => (core.deleteTime(id(c)), c.json({ ok: true })))

  // Chrono
  api.get('/timer', (c) => c.json(core.getTimer()))
  api.post('/timer/start', async (c) => c.json(core.startTimer(await body(c))))
  api.post('/timer/stop', async (c) => c.json(core.stopTimer(await body(c))))
  api.patch('/timer', async (c) => c.json(core.updateTimer(await body(c))))
  api.delete('/timer', (c) => (core.cancelTimer(), c.json({ ok: true })))

  // Réunions
  api.get('/meetings', (c) => c.json(core.listMeetings({ mission_id: num(q(c).mission_id) })))
  api.post('/meetings', async (c) => c.json(core.createMeeting(await body(c))))
  api.get('/meetings/:id', (c) => c.json(core.getMeeting(id(c))))
  api.patch('/meetings/:id', async (c) => c.json(core.updateMeeting(id(c), await body(c))))
  api.delete('/meetings/:id', (c) => (core.deleteMeeting(id(c)), c.json({ ok: true })))

  // Actions
  api.get('/actions', (c) => {
    const p = q(c)
    return c.json(core.listActions({ mission_id: num(p.mission_id), owner: p.owner, status: p.status }))
  })
  api.post('/actions', async (c) => c.json(core.createAction(await body(c))))
  api.patch('/actions/:id', async (c) => c.json(core.updateAction(id(c), await body(c))))
  api.delete('/actions/:id', (c) => (core.deleteAction(id(c)), c.json({ ok: true })))

  // Journal
  api.get('/logs', (c) => c.json(core.listLogs({ mission_id: num(q(c).mission_id) })))
  api.post('/logs', async (c) => c.json(core.addLog(await body(c))))
  api.delete('/logs/:id', (c) => (core.deleteLog(id(c)), c.json({ ok: true })))

  // Facturation
  api.get('/invoices', (c) => c.json({ invoices: core.listInvoices(), revenue: core.revenue(q(c).year) }))
  api.get('/invoices/preview', (c) => {
    const p = q(c)
    return c.json(core.previewInvoice({ mission_id: Number(p.mission_id), from: p.from, to: p.to, issued_date: p.issued_date || undefined }))
  })
  api.post('/invoices', async (c) => c.json(core.createInvoice(await body(c))))
  api.get('/invoices/:id', (c) => c.json(core.getInvoice(id(c))))
  api.patch('/invoices/:id', async (c) => c.json(core.updateInvoice(id(c), await body(c))))
  api.delete('/invoices/:id', (c) => (core.deleteInvoice(id(c)), c.json({ ok: true })))

  api.get('/activity', (c) => c.json(core.recentActivity({ ...period(c), mission_id: num(q(c).mission_id) })))

  return api
}
