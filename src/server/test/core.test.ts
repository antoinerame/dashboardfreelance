import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCore } from '../core.js'
import { openDb } from '../db.js'
import { addDays, fmtDuration, parseDuration, parsePeriod, today, weekRange } from '../util.js'

const mk = () => createCore(openDb(':memory:'))

test('durées', () => {
  assert.equal(parseDuration('1h30'), 90)
  assert.equal(parseDuration('1:30'), 90)
  assert.equal(parseDuration('45m'), 45)
  assert.equal(parseDuration('90 min'), 90)
  assert.equal(parseDuration('1,5'), 90)
  assert.equal(parseDuration('2h'), 120)
  assert.equal(parseDuration('0.5j', 7), 210)
  assert.equal(parseDuration(1.25), 75)
  assert.throws(() => parseDuration('bientôt'))
  assert.equal(fmtDuration(95), '1h35')
})

test('périodes', () => {
  assert.deepEqual(weekRange('2026-11-11'), ['2026-11-09', '2026-11-15'])
  assert.deepEqual(weekRange('2026-11-15'), ['2026-11-09', '2026-11-15'])
  const p = parsePeriod('2026-02')
  assert.equal(p.from, '2026-02-01')
  assert.equal(p.to, '2026-02-28')
  assert.equal(parsePeriod('2026-02-01..2026-02-10').to, '2026-02-10')
  assert.throws(() => parsePeriod('un jour'))
})

test('mission, temps, facture', () => {
  const core = mk()
  const m = core.createMission({ client_name: 'TOBAM', name: 'IA & outils', rate: 700, rate_type: 'jour', chantiers: ['Chatbot RLM', 'Pipeline Pilot'], budget_hours: 70 })
  assert.equal(core.resolveMission('tobam').id, m.id)
  assert.equal(core.resolveMission('').id, m.id)
  assert.throws(() => core.resolveMission('inconnu'))
  const ch = core.resolveChantier(m, 'chatbot')!
  assert.equal(ch.name, 'Chatbot RLM')
  assert.throws(() => core.resolveChantier(m, 'nimp'))
  assert.equal(core.resolveChantier(m, 'Nouveau', true)!.name, 'Nouveau')

  const t = today()
  core.logTime({ mission_id: m.id, chantier_id: ch.id, duration: '3h30', description: 'Atelier prompts', date: t })
  core.logTime({ mission_id: m.id, duration: '3h30', date: t })
  core.logTime({ mission_id: m.id, duration: '1h', date: t, billable: false })
  const fresh = core.getMission(m.id)
  assert.equal(fresh.total_minutes, 480)
  assert.equal(fresh.unbilled_minutes, 420)
  assert.equal(fresh.unbilled_amount, 700)
  assert.equal(Math.round(fresh.budget.used), 8)

  const inv = core.createInvoice({ mission_id: m.id, from: addDays(t, -5), to: t })
  assert.equal(inv.amount, 700)
  assert.equal(inv.entries.length, 2)
  assert.match(inv.number, /^\d{4}-001$/)
  assert.equal(core.getMission(m.id).unbilled_minutes, 0)
  assert.throws(() => core.deleteTime(inv.entries[0].id))
  core.updateInvoice(inv.id, { paid_date: t })
  assert.equal(core.getTime(inv.entries[0].id).status, 'paye')
  assert.equal(core.revenue().paid, 700)
  core.deleteInvoice(inv.id)
  assert.equal(core.getMission(m.id).unbilled_minutes, 420)
})

test('chrono', () => {
  const core = mk()
  const m = core.createMission({ client_name: 'A', name: 'B' })
  core.startTimer({ mission_id: m.id, started_at: new Date(Date.now() - 50 * 60000).toISOString(), description: 'x' })
  assert.equal(core.getTimer()!.elapsed_minutes, 50)
  const { stopped } = core.startTimer({ mission_id: m.id })
  assert.equal(stopped!.minutes, 50)
  core.cancelTimer()
  assert.equal(core.getTimer(), null)
  assert.throws(() => core.stopTimer())
})

test('réunions, actions, journal, recherche', () => {
  const core = mk()
  const m = core.createMission({ client_name: 'TOBAM', name: 'IA' })
  const r = core.createMeeting({ mission_id: m.id, title: 'Point hebdo', notes: 'Accès frwks64 perdu, à redemander à Axel', actions: [{ description: 'Redemander l’accès', owner: 'client', owner_name: 'Axel', due_date: addDays(today(), -1) }] })
  assert.equal(r.actions.length, 1)
  core.addLog({ mission_id: m.id, text: 'Livré la v2 du pipeline' })
  assert.equal(core.search('acces FRWKS64')[0].type, 'reunion')
  assert.equal(core.search('livre pipeline')[0].type, 'journal')
  const d = core.dashboard()
  assert.equal(d.late_actions.length, 1)
  const a = core.updateAction(r.actions[0].id, { status: 'fait' })
  assert.ok(a.done_at)
  assert.equal(core.listActions({ status: 'ouvertes' }).length, 0)
  const act = core.recentActivity({ from: addDays(today(), -6), to: today() })
  assert.equal(act.meetings.length, 1)
  assert.equal(act.actions_done.length, 1)
  assert.equal(act.logs.length, 1)
  assert.ok(core.exportAll().meetings.length === 1)
})
