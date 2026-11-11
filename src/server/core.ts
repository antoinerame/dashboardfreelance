// Couche métier unique, partagée par l'API web et le serveur MCP.
import type Database from 'better-sqlite3'
import {
  AppError, addDays, fmtDuration, isDate, localDate, monthRange, norm, nowIso, parseDuration, slugify, today,
  weekRange, weekday,
} from './util.js'

type Row = Record<string, any>

const COLS: Record<string, string[]> = {
  clients: ['name', 'contact_name', 'email', 'billing_address', 'siret', 'notes'],
  contacts: ['client_id', 'name', 'role', 'email', 'phone', 'notes'],
  missions: [
    'client_id', 'name', 'status', 'billing_type', 'rate_type', 'rate', 'hours_per_day', 'fixed_price',
    'budget_hours', 'budget_amount', 'start_date', 'end_date', 'color', 'description',
  ],
  chantiers: ['mission_id', 'name', 'status', 'position'],
  time_entries: ['mission_id', 'chantier_id', 'date', 'minutes', 'description', 'billable'],
  meetings: ['mission_id', 'date', 'time', 'title', 'participants', 'agenda', 'notes', 'decisions', 'summary'],
  actions: ['mission_id', 'description', 'owner', 'owner_name', 'due_date', 'status', 'meeting_id'],
  logs: ['mission_id', 'ts', 'text'],
  invoices: ['number', 'amount', 'issued_date', 'due_date', 'sent_date', 'paid_date', 'notes'],
}

export const SETTINGS_DEFAULTS: Record<string, string> = {
  owner_name: '',
  owner_address: '',
  owner_siret: '',
  owner_email: '',
  owner_iban: '',
  micro_ceiling: '77700',
  vat_mention: 'TVA non applicable, art. 293 B du CGI',
  payment_terms: 'Paiement à 30 jours',
  invoice_prefix: 'F-',
  invoice_line_label: 'Prestations de conseil et développement IA — {mois}',
  due_days: '30',
  due_end_of_month: '1',
  vat_exemption: 'Franchise en base de TVA (art. 293 B du CGI)',
}

export const STATUS_LABELS: Record<string, string> = {
  prospect: 'Prospect', en_cours: 'En cours', en_pause: 'En pause', terminee: 'Terminée',
  a_faire: 'À faire', en_attente: 'En attente', fait: 'Fait',
  a_facturer: 'À facturer', facture: 'Facturé', paye: 'Payé',
}

export function createCore(db: Database.Database) {
  // ───────────────────────── helpers génériques ─────────────────────────
  const all = (sql: string, params: any = {}): Row[] => db.prepare(sql).all(params) as Row[]
  const one = (sql: string, params: any = {}): Row | undefined => db.prepare(sql).get(params) as Row | undefined

  function pick(table: string, data: Row): Row {
    const out: Row = {}
    for (const c of COLS[table]) {
      let v = data[c]
      if (v === undefined) continue
      if (typeof v === 'boolean') v = v ? 1 : 0
      if (typeof v === 'string') v = v.trim() === '' ? null : v.trim()
      out[c] = v
    }
    return out
  }
  function insert(table: string, data: Row, extra: Row = {}): number {
    const row = { ...pick(table, data), ...extra }
    const keys = Object.keys(row)
    const info = db
      .prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`)
      .run(row)
    return Number(info.lastInsertRowid)
  }
  function update(table: string, id: number, data: Row, extra: Row = {}): void {
    const row = { ...pick(table, data), ...extra }
    const keys = Object.keys(row)
    if (!keys.length) return
    const info = db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...row, id })
    if (!info.changes) throw new AppError('Élément introuvable.', 404)
  }
  function remove(table: string, id: number): void {
    const info = db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
    if (!info.changes) throw new AppError('Élément introuvable.', 404)
  }
  function need(table: string, id: unknown, label: string): Row {
    const row = one(`SELECT * FROM ${table} WHERE id=?`, Number(id))
    if (!row) throw new AppError(`${label} introuvable (id ${id}).`, 404)
    return row
  }
  function checkDate(v: unknown, label: string, required = false): void {
    if (v === undefined || v === null || v === '') {
      if (required) throw new AppError(`${label} : date requise (AAAA-MM-JJ).`)
      return
    }
    if (!isDate(v)) throw new AppError(`${label} : date invalide « ${v} » (format attendu AAAA-MM-JJ).`)
  }

  // ───────────────────────── réglages ─────────────────────────
  function getSettings(): Record<string, string> {
    const out = { ...SETTINGS_DEFAULTS }
    for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value ?? ''
    return out
  }
  function setSettings(values: Row): Record<string, string> {
    const stmt = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    for (const [k, v] of Object.entries(values)) if (k in SETTINGS_DEFAULTS) stmt.run(k, String(v ?? ''))
    return getSettings()
  }

  // ───────────────────────── clients & contacts ─────────────────────────
  function listClients(): Row[] {
    const contacts = all('SELECT * FROM contacts ORDER BY name')
    return all(
      `SELECT c.*, (SELECT COUNT(*) FROM missions m WHERE m.client_id=c.id) AS mission_count FROM clients c ORDER BY c.name`,
    ).map((c) => ({ ...c, contacts: contacts.filter((x) => x.client_id === c.id) }))
  }
  function createClient(data: Row): Row {
    if (!data.name?.trim()) throw new AppError('Le nom du client est requis.')
    return need('clients', insert('clients', data, { created_at: nowIso() }), 'Client')
  }
  function updateClient(id: number, data: Row): Row {
    update('clients', id, data)
    return need('clients', id, 'Client')
  }
  function deleteClient(id: number): void {
    if (one('SELECT 1 FROM missions WHERE client_id=?', id)) {
      throw new AppError('Ce client a des missions : supprime-les ou réaffecte-les d’abord.')
    }
    remove('clients', id)
  }
  function findOrCreateClient(name: string): Row {
    const n = norm(name)
    const found = all('SELECT * FROM clients').find((c) => norm(c.name) === n)
    return found || createClient({ name })
  }
  function createContact(data: Row): Row {
    need('clients', data.client_id, 'Client')
    if (!data.name?.trim()) throw new AppError('Le nom du contact est requis.')
    return need('contacts', insert('contacts', data), 'Contact')
  }
  function updateContact(id: number, data: Row): Row {
    update('contacts', id, data)
    return need('contacts', id, 'Contact')
  }

  // ───────────────────────── missions ─────────────────────────
  function amountFor(minutes: number, m: Row): number {
    if (m.billing_type !== 'temps' || !m.rate) return 0
    const hours = minutes / 60
    const raw = m.rate_type === 'jour' ? (hours / (m.hours_per_day || 7)) * m.rate : hours * m.rate
    return Math.round(raw * 100) / 100
  }

  function decorateMission(m: Row): Row {
    const consumedAmount = amountFor(m.billable_minutes || 0, m)
    let budget: Row | null = null
    if (m.budget_hours) {
      const used = (m.total_minutes || 0) / 60
      budget = { unit: 'heures', total: m.budget_hours, used, remaining: m.budget_hours - used, pct: used / m.budget_hours }
    } else if (m.budget_amount && m.billing_type === 'temps') {
      budget = {
        unit: 'euros', total: m.budget_amount, used: consumedAmount, remaining: m.budget_amount - consumedAmount,
        pct: consumedAmount / m.budget_amount,
      }
    }
    return {
      ...m,
      unbilled_amount: amountFor(m.unbilled_minutes || 0, m),
      consumed_amount: consumedAmount,
      budget,
    }
  }

  const MISSION_SQL = `
    SELECT m.*, c.name AS client_name,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.mission_id=m.id) AS total_minutes,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.mission_id=m.id AND t.billable=1) AS billable_minutes,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.mission_id=m.id AND t.date BETWEEN @ws AND @we) AS week_minutes,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.mission_id=m.id AND t.date BETWEEN @ms AND @me) AS month_minutes,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.mission_id=m.id AND t.billable=1 AND t.status='a_facturer') AS unbilled_minutes,
      (SELECT MAX(date) FROM time_entries t WHERE t.mission_id=m.id) AS last_entry_date,
      (SELECT COUNT(*) FROM actions a WHERE a.mission_id=m.id AND a.status!='fait') AS open_actions,
      (SELECT COUNT(*) FROM actions a WHERE a.mission_id=m.id AND a.status!='fait' AND a.due_date < @today) AS late_actions
    FROM missions m JOIN clients c ON c.id=m.client_id`
  const ranges = () => {
    const t = today()
    const [ws, we] = weekRange(t)
    const [ms, me] = monthRange(t)
    return { ws, we, ms, me, today: t }
  }

  function listMissions(filter: { status?: string } = {}): Row[] {
    const rows = all(
      `${MISSION_SQL} ORDER BY CASE m.status WHEN 'en_cours' THEN 0 WHEN 'en_pause' THEN 1 WHEN 'prospect' THEN 2 ELSE 3 END, m.name`,
      ranges(),
    ).map(decorateMission)
    return filter.status ? rows.filter((m) => m.status === filter.status) : rows
  }
  function getMission(id: number): Row {
    const m = one(`${MISSION_SQL} WHERE m.id=@id`, { ...ranges(), id: Number(id) })
    if (!m) throw new AppError(`Mission introuvable (id ${id}).`, 404)
    return decorateMission(m)
  }

  function createMission(data: Row): Row {
    if (!data.name?.trim()) throw new AppError('L’intitulé de la mission est requis.')
    let clientId = data.client_id
    if (!clientId && data.client_name) clientId = findOrCreateClient(data.client_name).id
    const client = need('clients', clientId, 'Client')
    checkDate(data.start_date, 'Date de début')
    checkDate(data.end_date, 'Date de fin')
    const base = slugify(`${client.name}-${data.name}`) || 'mission'
    let slug = base
    for (let i = 2; one('SELECT 1 FROM missions WHERE slug=?', slug); i++) slug = `${base}-${i}`
    const count = one('SELECT COUNT(*) AS n FROM missions')!.n as number
    const now = nowIso()
    const id = insert(
      'missions',
      { ...data, client_id: client.id, color: data.color ?? (count % 8) + 1 },
      { slug, created_at: now, updated_at: now },
    )
    for (const [i, name] of (data.chantiers || []).entries()) {
      if (String(name).trim()) insert('chantiers', { mission_id: id, name: String(name), position: i })
    }
    return getMission(id)
  }
  function updateMission(id: number, data: Row): Row {
    checkDate(data.start_date, 'Date de début')
    checkDate(data.end_date, 'Date de fin')
    update('missions', id, data, { updated_at: nowIso() })
    return getMission(id)
  }
  function deleteMission(id: number): void {
    if (one('SELECT 1 FROM invoices WHERE mission_id=?', id)) {
      throw new AppError('Cette mission a des factures : passe-la plutôt en « terminée ».')
    }
    remove('missions', id)
  }

  /** Retrouve une mission par id, slug, ou nom approximatif (« tobam », « chatbot »…). */
  function resolveMission(ref: unknown): Row {
    const missions = listMissions()
    if (!missions.length) throw new AppError('Aucune mission n’existe encore. Crée-en une avec create_mission.')
    const raw = String(ref ?? '').trim()
    if (!raw) {
      const active = missions.filter((m) => m.status === 'en_cours')
      if (active.length === 1) return active[0]
      throw new AppError(`Précise la mission. Missions : ${missions.map((m) => `« ${m.client_name} – ${m.name} »`).join(', ')}.`)
    }
    if (/^\d+$/.test(raw)) {
      const m = missions.find((x) => x.id === Number(raw))
      if (m) return m
    }
    const q = norm(raw)
    const label = (m: Row) => norm(`${m.client_name} ${m.name}`)
    let hits = missions.filter((m) => m.slug === slugify(raw) || norm(m.name) === q || label(m) === q)
    if (!hits.length) {
      const tokens = q.split(/[\s\-–_]+/).filter(Boolean)
      hits = missions.filter((m) => tokens.every((t) => label(m).includes(t)))
    }
    if (hits.length > 1) {
      const active = hits.filter((m) => m.status === 'en_cours')
      if (active.length === 1) hits = active
    }
    if (hits.length === 1) return hits[0]
    const list = (hits.length ? hits : missions).map((m) => `« ${m.client_name} – ${m.name} » (id ${m.id})`).join(', ')
    throw new AppError(
      hits.length ? `Plusieurs missions correspondent à « ${raw} » : ${list}.` : `Aucune mission ne correspond à « ${raw} ». Missions : ${list}.`,
    )
  }

  // ───────────────────────── chantiers ─────────────────────────
  function listChantiers(missionId: number): Row[] {
    return all(
      `SELECT ch.*,
         (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.chantier_id=ch.id) AS total_minutes,
         (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.chantier_id=ch.id AND t.date BETWEEN @ms AND @me) AS month_minutes
       FROM chantiers ch WHERE ch.mission_id=@id ORDER BY ch.status, ch.position, ch.id`,
      { id: missionId, ms: ranges().ms, me: ranges().me },
    )
  }
  function createChantier(data: Row): Row {
    need('missions', data.mission_id, 'Mission')
    if (!data.name?.trim()) throw new AppError('Le nom du chantier est requis.')
    const pos = one('SELECT COALESCE(MAX(position),-1)+1 AS p FROM chantiers WHERE mission_id=?', data.mission_id)!.p
    return need('chantiers', insert('chantiers', { position: pos, ...data }), 'Chantier')
  }
  function updateChantier(id: number, data: Row): Row {
    update('chantiers', id, { ...data, mission_id: undefined })
    return need('chantiers', id, 'Chantier')
  }
  function resolveChantier(mission: Row, ref: unknown, createIfMissing = false): Row | null {
    const raw = String(ref ?? '').trim()
    if (!raw) return null
    const list = all('SELECT * FROM chantiers WHERE mission_id=? ORDER BY position', mission.id)
    if (/^\d+$/.test(raw)) {
      const c = list.find((x) => x.id === Number(raw))
      if (c) return c
    }
    const q = norm(raw)
    let hits = list.filter((c) => norm(c.name) === q)
    if (!hits.length) {
      const tokens = q.split(/\s+/)
      hits = list.filter((c) => tokens.every((t) => norm(c.name).includes(t)))
    }
    if (hits.length === 1) return hits[0]
    if (!hits.length && createIfMissing) return createChantier({ mission_id: mission.id, name: raw })
    const names = list.map((c) => `« ${c.name} »`).join(', ') || 'aucun'
    throw new AppError(
      hits.length
        ? `Plusieurs chantiers correspondent à « ${raw} » : ${hits.map((c) => `« ${c.name} »`).join(', ')}.`
        : `Chantier « ${raw} » inconnu pour cette mission. Chantiers existants : ${names}. Passe creer_chantier=true pour le créer.`,
    )
  }

  // ───────────────────────── temps ─────────────────────────
  const TIME_SQL = `
    SELECT t.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name, ch.name AS chantier_name,
           i.number AS invoice_number
    FROM time_entries t
    JOIN missions m ON m.id=t.mission_id JOIN clients c ON c.id=m.client_id
    LEFT JOIN chantiers ch ON ch.id=t.chantier_id LEFT JOIN invoices i ON i.id=t.invoice_id`

  function listTime(f: { from?: string; to?: string; mission_id?: number; status?: string; limit?: number } = {}): Row[] {
    const where: string[] = []
    const p: Row = {}
    if (f.from) (where.push('t.date >= @from'), (p.from = f.from))
    if (f.to) (where.push('t.date <= @to'), (p.to = f.to))
    if (f.mission_id) (where.push('t.mission_id = @mission_id'), (p.mission_id = Number(f.mission_id)))
    if (f.status) (where.push('t.status = @status'), (p.status = f.status))
    return all(
      `${TIME_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.date DESC, t.id DESC ${f.limit ? 'LIMIT ' + Number(f.limit) : ''}`,
      p,
    )
  }
  const getTime = (id: number) => {
    const r = one(`${TIME_SQL} WHERE t.id=?`, Number(id))
    if (!r) throw new AppError('Entrée de temps introuvable.', 404)
    return r
  }

  function checkChantier(missionId: number, chantierId: unknown): number | null {
    if (chantierId === undefined || chantierId === null || chantierId === '') return null
    const ch = need('chantiers', chantierId, 'Chantier')
    if (ch.mission_id !== Number(missionId)) throw new AppError('Ce chantier n’appartient pas à cette mission.')
    return ch.id
  }

  function logTime(data: Row): Row {
    const mission = need('missions', data.mission_id, 'Mission')
    const minutes = data.minutes ? Math.round(Number(data.minutes)) : parseDuration(data.duration, mission.hours_per_day)
    if (!(minutes > 0)) throw new AppError('La durée doit être positive.')
    if (minutes > 24 * 60) throw new AppError('Une entrée ne peut pas dépasser 24 h. Découpe-la sur plusieurs jours.')
    const date = data.date || today()
    checkDate(date, 'Date', true)
    const id = insert(
      'time_entries',
      {
        ...data, date, minutes,
        chantier_id: checkChantier(mission.id, data.chantier_id),
        billable: data.billable ?? true,
      },
      { created_at: nowIso() },
    )
    return getTime(id)
  }
  function updateTime(id: number, data: Row): Row {
    const cur = getTime(id)
    const patch: Row = { ...data }
    if (cur.invoice_id && ['minutes', 'duration', 'mission_id', 'billable', 'date'].some((k) => data[k] !== undefined)) {
      throw new AppError(`Cette entrée est rattachée à la facture ${cur.invoice_number} : seule la description peut changer.`)
    }
    const missionId = Number(data.mission_id ?? cur.mission_id)
    const mission = need('missions', missionId, 'Mission')
    if (data.duration !== undefined) patch.minutes = parseDuration(data.duration, mission.hours_per_day)
    if (patch.minutes !== undefined && !(Number(patch.minutes) > 0)) throw new AppError('La durée doit être positive.')
    checkDate(data.date, 'Date')
    if (data.chantier_id !== undefined) patch.chantier_id = checkChantier(missionId, data.chantier_id)
    else if (data.mission_id !== undefined && missionId !== cur.mission_id) patch.chantier_id = null
    update('time_entries', id, patch)
    if (patch.chantier_id === null) db.prepare('UPDATE time_entries SET chantier_id=NULL WHERE id=?').run(id)
    return getTime(id)
  }
  function deleteTime(id: number): void {
    const cur = getTime(id)
    if (cur.invoice_id) throw new AppError(`Cette entrée est rattachée à la facture ${cur.invoice_number}.`)
    remove('time_entries', id)
  }

  /** Feuille de temps agrégée d'une période. */
  function timesheet(f: { from: string; to: string; mission_id?: number }): Row {
    const entries = listTime(f).reverse()
    const missions = new Map<number, Row>()
    for (const m of listMissions()) missions.set(m.id, m)
    let total = 0
    let billable = 0
    let amount = 0
    const byMission = new Map<number, Row>()
    for (const e of entries) {
      total += e.minutes
      const m = missions.get(e.mission_id)!
      let bm = byMission.get(e.mission_id)
      if (!bm) {
        bm = { mission_id: m.id, mission_name: m.name, client_name: m.client_name, color: m.color, minutes: 0, billable_minutes: 0, amount: 0, chantiers: new Map() }
        byMission.set(m.id, bm)
      }
      bm.minutes += e.minutes
      if (e.billable) {
        billable += e.minutes
        bm.billable_minutes += e.minutes
      }
      const key = e.chantier_name || 'Sans chantier'
      bm.chantiers.set(key, (bm.chantiers.get(key) || 0) + e.minutes)
    }
    const by_mission = [...byMission.values()].map((bm) => {
      bm.amount = amountFor(bm.billable_minutes, missions.get(bm.mission_id)!)
      amount += bm.amount
      return { ...bm, chantiers: [...bm.chantiers.entries()].map(([name, minutes]) => ({ name, minutes })) }
    })
    return { from: f.from, to: f.to, total_minutes: total, billable_minutes: billable, amount, by_mission, entries }
  }

  function exportTimesheet(f: { from: string; to: string; mission_id?: number }, format: string): string {
    const ts = timesheet(f)
    if (norm(format) === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = ['Date;Client;Mission;Chantier;Durée (h);Durée;Description;Facturable;Statut']
      for (const e of ts.entries) {
        lines.push(
          [
            e.date, esc(e.client_name), esc(e.mission_name), esc(e.chantier_name),
            (e.minutes / 60).toFixed(2).replace('.', ','), fmtDuration(e.minutes), esc(e.description),
            e.billable ? 'oui' : 'non', STATUS_LABELS[e.status],
          ].join(';'),
        )
      }
      return '﻿' + lines.join('\r\n') + '\r\n'
    }
    const out: string[] = [`# Feuille de temps — ${f.from} → ${f.to}`, '']
    for (const bm of ts.by_mission) {
      const m = getMission(bm.mission_id)
      out.push(`## ${bm.client_name} – ${bm.mission_name}`, '', '| Date | Chantier | Durée | Description |', '|---|---|---|---|')
      for (const e of ts.entries.filter((x: Row) => x.mission_id === bm.mission_id)) {
        out.push(
          `| ${e.date} | ${e.chantier_name || '—'} | ${fmtDuration(e.minutes)} | ${(e.description || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')}${e.billable ? '' : ' *(non facturable)*'} |`,
        )
      }
      out.push('', '**Par chantier** : ' + bm.chantiers.map((c: Row) => `${c.name} ${fmtDuration(c.minutes)}`).join(' · '))
      const days = bm.billable_minutes / 60 / (m.hours_per_day || 7)
      out.push(
        `**Total** : ${fmtDuration(bm.minutes)} dont ${fmtDuration(bm.billable_minutes)} facturables` +
          (m.rate_type === 'jour' ? ` (${days.toFixed(2).replace('.', ',')} j)` : '') +
          (bm.amount ? ` — ${bm.amount.toFixed(2).replace('.', ',')} € HT` : ''),
        '',
      )
    }
    if (!ts.by_mission.length) out.push('_Aucune entrée sur la période._')
    return out.join('\n')
  }

  // ───────────────────────── chrono ─────────────────────────
  function getTimer(): Row | null {
    const t = one(
      `SELECT t.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name, ch.name AS chantier_name
       FROM timer t JOIN missions m ON m.id=t.mission_id JOIN clients c ON c.id=m.client_id
       LEFT JOIN chantiers ch ON ch.id=t.chantier_id WHERE t.id=1`,
    )
    if (!t) return null
    return { ...t, elapsed_minutes: Math.max(0, Math.round((Date.now() - Date.parse(t.started_at)) / 60000)) }
  }
  function stopTimer(data: Row = {}): Row {
    const t = getTimer()
    if (!t) throw new AppError('Aucun chrono en cours.')
    const startedAt = new Date(t.started_at)
    // L'entrée est datée du jour (heure de Paris) où le chrono a démarré, même s'il passe minuit.
    const minutes = Math.min(24 * 60, Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60000)))
    const tx = db.transaction(() => {
      const entry = logTime({
        mission_id: t.mission_id,
        chantier_id: t.chantier_id,
        date: localDate(startedAt),
        minutes: data.minutes ? Number(data.minutes) : minutes,
        description: data.description ?? t.description,
        billable: data.billable ?? true,
      })
      db.prepare('DELETE FROM timer').run()
      return entry
    })
    return tx()
  }
  function startTimer(data: Row): { timer: Row; stopped: Row | null } {
    const mission = need('missions', data.mission_id, 'Mission')
    const chantierId = checkChantier(mission.id, data.chantier_id)
    const stopped = getTimer() ? stopTimer() : null
    const startedAt = data.started_at && !isNaN(Date.parse(data.started_at)) ? new Date(data.started_at).toISOString() : nowIso()
    db.prepare('INSERT INTO timer (id, mission_id, chantier_id, description, started_at) VALUES (1,?,?,?,?)').run(
      mission.id, chantierId, data.description?.trim() || null, startedAt,
    )
    return { timer: getTimer()!, stopped }
  }
  function updateTimer(data: Row): Row {
    const t = getTimer()
    if (!t) throw new AppError('Aucun chrono en cours.')
    if (data.description !== undefined) db.prepare('UPDATE timer SET description=? WHERE id=1').run(data.description || null)
    if (data.chantier_id !== undefined) {
      db.prepare('UPDATE timer SET chantier_id=? WHERE id=1').run(checkChantier(t.mission_id, data.chantier_id))
    }
    return getTimer()!
  }
  function cancelTimer(): void {
    db.prepare('DELETE FROM timer').run()
  }

  // ───────────────────────── réunions ─────────────────────────
  const MEETING_SQL = `
    SELECT r.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name,
      (SELECT COUNT(*) FROM actions a WHERE a.meeting_id=r.id) AS action_count
    FROM meetings r JOIN missions m ON m.id=r.mission_id JOIN clients c ON c.id=m.client_id`
  function listMeetings(f: { mission_id?: number; limit?: number } = {}): Row[] {
    return all(
      `${MEETING_SQL} ${f.mission_id ? 'WHERE r.mission_id=@mission_id' : ''} ORDER BY r.date DESC, COALESCE(r.time,'') DESC, r.id DESC LIMIT @limit`,
      { ...(f.mission_id ? { mission_id: Number(f.mission_id) } : {}), limit: f.limit || 500 },
    )
  }
  function getMeeting(id: number): Row {
    const r = one(`${MEETING_SQL} WHERE r.id=?`, Number(id))
    if (!r) throw new AppError(`Réunion introuvable (id ${id}).`, 404)
    return { ...r, actions: all('SELECT * FROM actions WHERE meeting_id=? ORDER BY id', r.id) }
  }
  function createMeeting(data: Row): Row {
    need('missions', data.mission_id, 'Mission')
    const date = data.date || today()
    checkDate(date, 'Date', true)
    const now = nowIso()
    const title = data.title?.trim() || `Réunion du ${date}`
    const id = insert('meetings', { ...data, date, title }, { created_at: now, updated_at: now })
    for (const a of data.actions || []) {
      const desc = typeof a === 'string' ? a : a?.description
      if (desc?.trim()) createAction({ ...(typeof a === 'string' ? {} : a), description: desc, mission_id: data.mission_id, meeting_id: id })
    }
    return getMeeting(id)
  }
  function updateMeeting(id: number, data: Row): Row {
    checkDate(data.date, 'Date')
    update('meetings', id, { ...data, mission_id: undefined }, { updated_at: nowIso() })
    return getMeeting(id)
  }

  // ───────────────────────── actions ─────────────────────────
  const ACTION_SQL = `
    SELECT a.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name, r.title AS meeting_title
    FROM actions a JOIN missions m ON m.id=a.mission_id JOIN clients c ON c.id=m.client_id
    LEFT JOIN meetings r ON r.id=a.meeting_id`
  function listActions(f: { mission_id?: number; owner?: string; status?: string } = {}): Row[] {
    const where: string[] = []
    const p: Row = {}
    if (f.mission_id) (where.push('a.mission_id=@mission_id'), (p.mission_id = Number(f.mission_id)))
    if (f.owner) (where.push('a.owner=@owner'), (p.owner = f.owner))
    if (f.status === 'ouvertes' || !f.status) where.push("a.status != 'fait'")
    else if (f.status !== 'toutes') (where.push('a.status=@status'), (p.status = f.status))
    return all(
      `${ACTION_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (a.status='fait'), (a.due_date IS NULL), a.due_date, a.id ${f.status === 'toutes' || f.status === 'fait' ? 'LIMIT 500' : ''}`,
      p,
    )
  }
  const getAction = (id: number) => {
    const r = one(`${ACTION_SQL} WHERE a.id=?`, Number(id))
    if (!r) throw new AppError(`Action introuvable (id ${id}).`, 404)
    return r
  }
  function createAction(data: Row): Row {
    need('missions', data.mission_id, 'Mission')
    if (!data.description?.trim()) throw new AppError('La description de l’action est requise.')
    checkDate(data.due_date, 'Échéance')
    const status = data.status || 'a_faire'
    const id = insert('actions', { ...data, status }, { created_at: nowIso(), done_at: status === 'fait' ? nowIso() : null })
    return getAction(id)
  }
  function updateAction(id: number, data: Row): Row {
    const cur = getAction(id)
    checkDate(data.due_date, 'Échéance')
    const extra: Row = {}
    if (data.status && data.status !== cur.status) extra.done_at = data.status === 'fait' ? nowIso() : null
    update('actions', id, data, extra)
    if (data.due_date === null || data.due_date === '') db.prepare('UPDATE actions SET due_date=NULL WHERE id=?').run(id)
    return getAction(id)
  }

  // ───────────────────────── journal ─────────────────────────
  function listLogs(f: { mission_id?: number; limit?: number } = {}): Row[] {
    return all(
      `SELECT l.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name
       FROM logs l JOIN missions m ON m.id=l.mission_id JOIN clients c ON c.id=m.client_id
       ${f.mission_id ? 'WHERE l.mission_id=@mission_id' : ''} ORDER BY l.ts DESC, l.id DESC LIMIT @limit`,
      { ...(f.mission_id ? { mission_id: Number(f.mission_id) } : {}), limit: f.limit || 200 },
    )
  }
  function addLog(data: Row): Row {
    need('missions', data.mission_id, 'Mission')
    if (!data.text?.trim()) throw new AppError('Le texte du journal est requis.')
    let ts = nowIso()
    if (data.ts && !isNaN(Date.parse(data.ts))) ts = new Date(isDate(data.ts) ? data.ts + 'T12:00:00Z' : data.ts).toISOString()
    return need('logs', insert('logs', { ...data, ts }), 'Ligne de journal')
  }

  // ───────────────────────── factures ─────────────────────────
  const INVOICE_SQL = `
    SELECT i.*, m.name AS mission_name, m.color AS mission_color, c.name AS client_name,
      (SELECT COALESCE(SUM(minutes),0) FROM time_entries t WHERE t.invoice_id=i.id) AS minutes
    FROM invoices i JOIN missions m ON m.id=i.mission_id JOIN clients c ON c.id=m.client_id`
  const listInvoices = () => all(`${INVOICE_SQL} ORDER BY i.issued_date DESC, i.id DESC`)

  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
  const monthLabel = (ym: string) => { const m = MONTHS[Number(ym.slice(5, 7)) - 1]; return m[0].toUpperCase() + m.slice(1) + ' ' + ym.slice(0, 4) }
  const round2 = (n: number) => Math.round(n * 100) / 100
  /** Lignes de facture : une par mois (comme sur les factures Qonto), avec le détail par chantier. */
  function invoiceLines(entries: Row[], mission: Row): Row[] {
    const template = getSettings().invoice_line_label || '{mission} — {mois}'
    const months = new Map<string, Row[]>()
    for (const e of entries) months.set(e.date.slice(0, 7), [...(months.get(e.date.slice(0, 7)) || []), e])
    return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ym, es]) => {
      const minutes = es.reduce((x, e) => x + e.minutes, 0)
      const byChantier = new Map<string, number>()
      for (const e of es) byChantier.set(e.chantier_name || 'Divers', (byChantier.get(e.chantier_name || 'Divers') || 0) + e.minutes)
      return {
        month: ym,
        label: template.replace('{mois}', monthLabel(ym)).replace('{mission}', mission.name).replace('{client}', mission.client_name || ''),
        details: [...byChantier.entries()].sort((a, b) => b[1] - a[1]).map(([n, mn]) => `${n} : ${fmtDuration(mn)}`).join(' · '),
        minutes,
        quantity: round2(mission.rate_type === 'jour' ? minutes / 60 / (mission.hours_per_day || 7) : minutes / 60),
        unit: mission.rate_type === 'jour' ? 'jour' : 'heure',
        rate: mission.rate || 0,
        amount: round2(amountFor(minutes, mission)),
      }
    })
  }
  /** Échéance selon les réglages : N jours, puis fin de mois si demandé (30 jours fin de mois : 18/03 → 30/04). */
  function dueDateFor(issued: string): string {
    const st = getSettings()
    let d = addDays(issued, Number(st.due_days) || 0)
    if (st.due_end_of_month === '1') d = monthRange(d)[1]
    return d
  }
  /** Récapitulatif de ce qui serait facturé sur une période (sans rien modifier), avec les champs à saisir dans Qonto. */
  function previewInvoice(f: { mission_id: number; from: string; to: string; issued_date?: string }): Row {
    const mission = getMission(f.mission_id)
    checkDate(f.from, 'Début de période', true)
    checkDate(f.to, 'Fin de période', true)
    const entries = listTime({ ...f, status: 'a_facturer' }).filter((e) => e.billable).reverse()
    const minutes = entries.reduce((s, e) => s + e.minutes, 0)
    const lines = invoiceLines(entries, mission)
    const amount = round2(lines.reduce((s, l) => s + l.amount, 0))
    const issued = f.issued_date || today()
    const exec_from = entries.length ? entries[0].date : f.from
    const exec_to = entries.length ? entries[entries.length - 1].date : f.to
    return {
      mission, client: need('clients', mission.client_id, 'Client'), from: f.from, to: f.to, entries, minutes, lines, amount,
      exec_from, exec_to, issued_date: issued, due_date: dueDateFor(issued), next_number: nextInvoiceNumber(issued), settings: getSettings(),
    }
  }
  /** Numéro suivant : préfixe des réglages + année + compteur (F-2026-001, F-2026-002…). */
  function nextInvoiceNumber(issued: string): string {
    const year = issued.slice(0, 4)
    const nums = all('SELECT number FROM invoices').map((r) => String(r.number))
      .filter((n) => n.includes(year)).map((n) => parseInt(n.match(/(\d+)\s*$/)?.[1] ?? ''))
      .filter((n) => !isNaN(n) && n < 10000)
    return `${getSettings().invoice_prefix ?? ''}${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
  }
  function createInvoice(data: Row): Row {
    const pv = previewInvoice({ mission_id: data.mission_id, from: data.from, to: data.to, issued_date: data.issued_date })
    const issued = data.issued_date || today()
    checkDate(issued, 'Date d’émission', true)
    for (const k of ['due_date', 'sent_date', 'paid_date']) checkDate(data[k], 'Date')
    const amount = data.amount !== undefined && data.amount !== null && data.amount !== '' ? Number(data.amount) : pv.amount
    if (!pv.entries.length && !(amount > 0)) throw new AppError('Aucune heure à facturer sur cette période.')
    const tx = db.transaction(() => {
      const id = insert(
        'invoices',
        {
          number: data.number?.trim() || nextInvoiceNumber(issued), amount, issued_date: issued, notes: data.notes,
          due_date: data.due_date || dueDateFor(issued),
          // Une facture payée a forcément été envoyée.
          sent_date: data.sent_date || data.paid_date || null, paid_date: data.paid_date || null,
        },
        // Période d'exécution : celle saisie, sauf bornes « tout le non-facturé » remplacées par les dates réelles des heures.
        { mission_id: pv.mission.id, period_start: data.from > '2000-01-01' ? data.from : pv.exec_from, period_end: data.to < today() ? data.to : pv.exec_to, created_at: nowIso() },
      )
      const stmt = db.prepare(`UPDATE time_entries SET invoice_id=?, status='${data.paid_date ? 'paye' : 'facture'}' WHERE id=?`)
      for (const e of pv.entries) stmt.run(id, e.id)
      return id
    })
    return getInvoice(tx())
  }
  function getInvoice(id: number): Row {
    const inv = one(`${INVOICE_SQL} WHERE i.id=?`, Number(id))
    if (!inv) throw new AppError('Facture introuvable.', 404)
    const mission = getMission(inv.mission_id)
    const entries = all(`${TIME_SQL} WHERE t.invoice_id=? ORDER BY t.date, t.id`, inv.id)
    return {
      ...inv, mission, client: need('clients', mission.client_id, 'Client'), entries,
      lines: invoiceLines(entries, mission), settings: getSettings(), due_date: inv.due_date || dueDateFor(inv.issued_date),
    }
  }
  function updateInvoice(id: number, data: Row): Row {
    for (const k of ['issued_date', 'sent_date', 'paid_date']) checkDate(data[k], 'Date')
    const tx = db.transaction(() => {
      update('invoices', id, data)
      for (const k of ['due_date', 'sent_date', 'paid_date']) {
        if (data[k] === null || data[k] === '') db.prepare(`UPDATE invoices SET ${k}=NULL WHERE id=?`).run(id)
      }
      const inv = need('invoices', id, 'Facture')
      db.prepare('UPDATE time_entries SET status=? WHERE invoice_id=?').run(inv.paid_date ? 'paye' : 'facture', id)
    })
    tx()
    return getInvoice(id)
  }
  function deleteInvoice(id: number): void {
    const tx = db.transaction(() => {
      db.prepare("UPDATE time_entries SET status='a_facturer', invoice_id=NULL WHERE invoice_id=?").run(id)
      remove('invoices', id)
    })
    tx()
  }
  function revenue(year: string = today().slice(0, 4)): Row {
    const r = one(
      `SELECT COALESCE(SUM(CASE WHEN paid_date LIKE @y THEN amount END),0) AS paid,
              COALESCE(SUM(CASE WHEN paid_date IS NULL THEN amount END),0) AS pending,
              COALESCE(SUM(CASE WHEN issued_date LIKE @y THEN amount END),0) AS invoiced
       FROM invoices`,
      { y: `${year}-%` },
    )!
    const unbilled = listMissions().reduce((s, m) => s + m.unbilled_amount, 0)
    return { year, ...r, unbilled, ceiling: Number(getSettings().micro_ceiling) || 0 }
  }

  // ───────────────────────── vues composées ─────────────────────────
  function missingDays(): string[] {
    const first = one('SELECT MIN(date) AS d FROM time_entries')?.d
    if (!first) return []
    const out: string[] = []
    let d = addDays(today(), -1)
    for (let checked = 0; checked < 5 && d >= first; d = addDays(d, -1)) {
      if (weekday(d) > 5) continue
      checked++
      if (!one('SELECT 1 FROM time_entries WHERE date=?', d)) out.push(d)
    }
    return out.reverse()
  }

  function dashboard(): Row {
    const r = ranges()
    const missions = listMissions()
    const active = missions.filter((m) => m.status === 'en_cours' || m.week_minutes || m.month_minutes || m.unbilled_minutes)
    const openActions = listActions({ status: 'ouvertes' })
    const soon = addDays(r.today, 14)
    return {
      today: r.today,
      week: { from: r.ws, to: r.we, minutes: missions.reduce((s, m) => s + m.week_minutes, 0) },
      month: { from: r.ms, to: r.me, minutes: missions.reduce((s, m) => s + m.month_minutes, 0) },
      week_days: all(
        `SELECT t.date, t.mission_id, m.color, SUM(t.minutes) AS minutes FROM time_entries t JOIN missions m ON m.id=t.mission_id
         WHERE t.date BETWEEN @ws AND @we GROUP BY t.date, t.mission_id`,
        { ws: r.ws, we: r.we },
      ),
      missions: active,
      unbilled: {
        minutes: missions.reduce((s, m) => s + m.unbilled_minutes, 0),
        amount: missions.reduce((s, m) => s + m.unbilled_amount, 0),
      },
      late_actions: openActions.filter((a) => a.due_date && a.due_date < r.today),
      upcoming_actions: openActions.filter((a) => a.due_date && a.due_date >= r.today && a.due_date <= soon),
      my_open_actions: openActions.filter((a) => a.owner === 'moi').length,
      waiting_client: openActions.filter((a) => a.owner === 'client'),
      recent_meetings: listMeetings({ limit: 5 }),
      recent_logs: listLogs({ limit: 8 }),
      missing_days: missingDays(),
      timer: getTimer(),
      revenue: revenue(),
    }
  }

  /** Tout ce qu'il faut pour « reprendre le fil » d'une mission. */
  function missionOverview(id: number): Row {
    const mission = getMission(id)
    const t = today()
    const weeks: Row[] = []
    const [thisMonday] = weekRange(t)
    for (let i = 11; i >= 0; i--) weeks.push({ start: addDays(thisMonday, -7 * i), minutes: 0 })
    for (const e of all('SELECT date, minutes FROM time_entries WHERE mission_id=? AND date>=?', [mission.id, weeks[0].start])) {
      const w = weeks.find((x) => e.date >= x.start && e.date <= addDays(x.start, 6))
      if (w) w.minutes += e.minutes
    }
    const chantiers = listChantiers(mission.id)
    const noChantier = one('SELECT COALESCE(SUM(minutes),0) AS n FROM time_entries WHERE mission_id=? AND chantier_id IS NULL', mission.id)!.n
    const meetings = listMeetings({ mission_id: mission.id, limit: 30 })
    return {
      mission,
      client: need('clients', mission.client_id, 'Client'),
      contacts: all('SELECT * FROM contacts WHERE client_id=? ORDER BY name', mission.client_id),
      chantiers,
      no_chantier_minutes: noChantier,
      last_meeting: meetings[0] ? getMeeting(meetings[0].id) : null,
      meetings,
      open_actions: listActions({ mission_id: mission.id, status: 'ouvertes' }),
      done_actions: all(`${ACTION_SQL} WHERE a.mission_id=? AND a.status='fait' ORDER BY a.done_at DESC LIMIT 8`, mission.id),
      logs: listLogs({ mission_id: mission.id, limit: 50 }),
      recent_time: listTime({ mission_id: mission.id, limit: 40 }),
      weeks,
      invoices: all(`${INVOICE_SQL} WHERE i.mission_id=? ORDER BY i.issued_date DESC`, mission.id),
    }
  }

  /** Activité des N derniers jours (ou d'une période), pour les rapports et les points client. */
  function recentActivity(f: { from: string; to: string; mission_id?: number }): Row {
    const inMission = (r: Row) => !f.mission_id || r.mission_id === Number(f.mission_id)
    const fromTs = f.from + 'T00:00:00.000Z'
    const toTs = addDays(f.to, 1) + 'T23:59:59.999Z'
    const inDay = (ts: string | null) => !!ts && localDate(new Date(ts)) >= f.from && localDate(new Date(ts)) <= f.to
    return {
      from: f.from, to: f.to,
      timesheet: timesheet(f),
      meetings: listMeetings({ mission_id: f.mission_id }).filter((r) => r.date >= f.from && r.date <= f.to).reverse(),
      actions_done: all(`${ACTION_SQL} WHERE a.done_at BETWEEN ? AND ? ORDER BY a.done_at`, [fromTs, toTs]).filter(
        (a) => inMission(a) && inDay(a.done_at),
      ),
      actions_created: all(`${ACTION_SQL} WHERE a.created_at BETWEEN ? AND ? ORDER BY a.created_at`, [fromTs, toTs]).filter(
        (a) => inMission(a) && inDay(a.created_at),
      ),
      logs: listLogs({ mission_id: f.mission_id, limit: 2000 }).filter((l) => inDay(l.ts)).reverse(),
    }
  }

  // ───────────────────────── recherche ─────────────────────────
  /** Normalise caractère par caractère pour garder les mêmes positions que le texte d'origine. */
  function normSameLen(s: string): string {
    let out = ''
    for (const ch of s) {
      const n = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      out += n.length === ch.length ? n : ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch
    }
    return out
  }
  function search(query: string, limit = 40): Row[] {
    const tokens = norm(query).split(/\s+/).filter(Boolean)
    if (!tokens.length) return []
    const j = `JOIN missions m ON m.id=x.mission_id JOIN clients c ON c.id=m.client_id`
    const cols = `x.id, x.mission_id, m.name AS mission_name, m.color AS mission_color, c.name AS client_name`
    const sources: [string, string][] = [
      ['reunion', `SELECT ${cols}, x.date AS date, x.title AS title,
         COALESCE(x.participants,'')||'\n'||COALESCE(x.agenda,'')||'\n'||COALESCE(x.summary,'')||'\n'||COALESCE(x.decisions,'')||'\n'||COALESCE(x.notes,'') AS body
         FROM meetings x ${j}`],
      ['action', `SELECT ${cols}, COALESCE(x.due_date, substr(x.created_at,1,10)) AS date, x.description AS title,
         CASE x.status WHEN 'fait' THEN 'Fait' ELSE 'Ouverte' END || COALESCE(' · '||x.owner_name,'') AS body FROM actions x ${j}`],
      ['journal', `SELECT ${cols}, substr(x.ts,1,10) AS date, x.text AS title, '' AS body FROM logs x ${j}`],
      ['temps', `SELECT ${cols}, x.date AS date, COALESCE(x.description,'') AS title, '' AS body FROM time_entries x ${j}
         WHERE x.description IS NOT NULL`],
      ['mission', `SELECT x.id, x.id AS mission_id, x.name AS mission_name, x.color AS mission_color, c.name AS client_name,
         substr(x.updated_at,1,10) AS date, c.name||' – '||x.name AS title, COALESCE(x.description,'') AS body
         FROM missions x JOIN clients c ON c.id=x.client_id`],
    ]
    const results: Row[] = []
    for (const [type, sql] of sources) {
      for (const r of all(sql)) {
        const title = String(r.title || '')
        const body = String(r.body || '')
        const nt = normSameLen(title)
        const nb = normSameLen(body)
        if (!tokens.every((t) => nt.includes(t) || nb.includes(t))) continue
        let snippet = ''
        const pos = Math.min(...tokens.map((t) => nb.indexOf(t)).filter((i) => i >= 0), Infinity)
        if (pos !== Infinity) {
          const start = Math.max(0, pos - 60)
          snippet = (start > 0 ? '…' : '') + body.slice(start, pos + 140).replace(/\s+/g, ' ').trim() + (pos + 140 < body.length ? '…' : '')
        }
        const score = tokens.filter((t) => nt.includes(t)).length
        results.push({ type, id: r.id, mission_id: r.mission_id, mission_name: r.mission_name, mission_color: r.mission_color, client_name: r.client_name, date: r.date, title: title.slice(0, 200), snippet, score })
      }
    }
    return results.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date))).slice(0, limit)
  }

  // ───────────────────────── export complet ─────────────────────────
  function exportAll(): Row {
    const out: Row = { exported_at: nowIso(), version: 1 }
    for (const t of ['clients', 'contacts', 'missions', 'chantiers', 'time_entries', 'meetings', 'actions', 'logs', 'invoices', 'settings']) {
      out[t] = all(`SELECT * FROM ${t}`)
    }
    return out
  }

  return {
    db, amountFor,
    getSettings, setSettings,
    listClients, createClient, updateClient, deleteClient, findOrCreateClient,
    createContact, updateContact, deleteContact: (id: number) => remove('contacts', id),
    listMissions, getMission, createMission, updateMission, deleteMission, resolveMission, missionOverview,
    listChantiers, createChantier, updateChantier, deleteChantier: (id: number) => remove('chantiers', id), resolveChantier,
    listTime, getTime, logTime, updateTime, deleteTime, timesheet, exportTimesheet,
    getTimer, startTimer, stopTimer, updateTimer, cancelTimer,
    listMeetings, getMeeting, createMeeting, updateMeeting, deleteMeeting: (id: number) => remove('meetings', id),
    listActions, getAction, createAction, updateAction, deleteAction: (id: number) => remove('actions', id),
    listLogs, addLog, deleteLog: (id: number) => remove('logs', id),
    listInvoices, previewInvoice, createInvoice, nextInvoiceNumber, getInvoice, updateInvoice, deleteInvoice, revenue,
    dashboard, recentActivity, search, exportAll,
  }
}

export type Core = ReturnType<typeof createCore>
