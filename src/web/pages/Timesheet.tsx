import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDays, copy, dLong, dMed, dMonth, dShort, days, dur, euro, mc, monthBounds, today, useApp, useData, weekStart, type Row } from '../lib'
import { Empty, PageHead, Seg, State, TimeModal } from '../ui'

export default function Timesheet() {
  const { missions, openQuick, toast } = useApp()
  const [sp] = useSearchParams()
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(sp.get('date') || today())
  const [mission, setMission] = useState<number | null>(Number(sp.get('mission')) || null)
  const [entry, setEntry] = useState<Row | null>(null)

  const [from, to] = view === 'week' ? [weekStart(anchor), addDays(weekStart(anchor), 6)] : monthBounds(anchor)
  const qs = `from=${from}&to=${to}${mission ? `&mission_id=${mission}` : ''}`
  const q = useData(`/time?${qs}`)
  const move = (dir: number) => setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : addDays(dir > 0 ? to : from, dir))
  const dayList: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dayList.push(d)

  return (
    <>
      <PageHead title="Heures" sub={view === 'week' ? `Semaine du ${dMed(from)} au ${dMed(to)}` : <span className="first-letter:uppercase">{dMonth(from)}</span>}>
        <Seg value={view} onChange={setView} options={[['week', 'Semaine'], ['month', 'Mois']]} />
        <div className="flex">
          <button className="btn btn-icon rounded-r-none" onClick={() => move(-1)} aria-label="Précédent"><ChevronLeft size={15} /></button>
          <button className="btn rounded-none border-x-0" onClick={() => setAnchor(today())}>Aujourd’hui</button>
          <button className="btn btn-icon rounded-l-none" onClick={() => move(1)} aria-label="Suivant"><ChevronRight size={15} /></button>
        </div>
        <a className="btn" href={`/api/time/export?format=csv&${qs}`}><Download size={14} /> CSV</a>
        <a className="btn" href={`/api/time/export?format=md&${qs}`}><Download size={14} /> Markdown</a>
        <button className="btn" onClick={async () => { const t = await fetch(`/api/time/export?format=md&${qs}`).then((r) => r.text()); toast((await copy(t)) ? 'Feuille de temps copiée (Markdown)' : 'Copie impossible', 'ok') }}>Copier</button>
        <button className="btn btn-primary" onClick={() => openQuick('temps', mission ? { mission_id: mission } : {})}><Plus size={15} /> Temps</button>
      </PageHead>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button className={`badge ${mission === null ? '!bg-ink !text-paper' : 'badge-outline'}`} onClick={() => setMission(null)}>Toutes</button>
        {missions.filter((m) => m.status !== 'terminee' || m.id === mission).map((m) => (
          <button key={m.id} style={mc(m.color)} className={`chip-mission ${mission === m.id ? 'outline outline-2 outline-ink' : ''}`} onClick={() => setMission(mission === m.id ? null : m.id)}><i className="dot" />{m.client_name}</button>
        ))}
      </div>

      <State q={q} rows={8}>
        {(ts) => {
          const byDay = (d: string) => ts.entries.filter((e: Row) => e.date === d)
          const sum = (list: Row[]) => list.reduce((s, e) => s + e.minutes, 0)
          return (
            <div className="space-y-4">
              <section className="card flex flex-wrap items-end gap-x-8 gap-y-2 px-4 py-3">
                <div><p className="title-block">Total</p><p className="num text-xl font-semibold">{dur(ts.total_minutes)}</p></div>
                <div><p className="title-block">Facturable</p><p className="num text-xl font-semibold">{dur(ts.billable_minutes)}</p></div>
                <div><p className="title-block">Montant HT</p><p className="num text-xl font-semibold">{euro(ts.amount)}</p></div>
                <div className="flex min-w-[200px] flex-1 flex-wrap gap-x-5 gap-y-1">
                  {ts.by_mission.map((bm: Row) => (
                    <div key={bm.mission_id} style={mc(bm.color)} className="text-sm">
                      <i className="dot mr-1.5" /><b>{bm.client_name}</b> <span className="num">{dur(bm.minutes)}</span>
                      <p className="meta">{bm.chantiers.map((c: Row) => `${c.name} ${dur(c.minutes)}`).join(' · ')}</p>
                    </div>
                  ))}
                </div>
              </section>

              {view === 'week' ? (
                <section className="card divide-y divide-line">
                  {dayList.map((d) => {
                    const list = byDay(d)
                    const weekend = dayList.indexOf(d) > 4
                    if (weekend && !list.length) return null
                    return (
                      <div key={d} className="grid gap-x-4 px-3.5 py-2.5 sm:grid-cols-[150px_1fr]">
                        <div className="flex items-baseline justify-between gap-2 sm:block">
                          <p className={`font-semibold first-letter:uppercase ${d === today() ? 'text-accent' : ''}`}>{dLong(d).replace(/ \S+$/, '')}</p>
                          <p className="num text-sm text-ink-2">{list.length ? dur(sum(list)) : '—'}</p>
                        </div>
                        <div>
                          {list.map((e: Row) => (
                            <button key={e.id} onClick={() => setEntry(e)} style={mc(e.mission_color)} className="flex w-full items-baseline gap-2.5 rounded-sm px-1 py-1 text-left hover:bg-sunken">
                              <i className="dot translate-y-[-1px]" /><span className="num w-14 flex-none text-sm">{dur(e.minutes)}</span>
                              <span className="w-36 flex-none truncate text-sm text-ink-2">{e.client_name}{e.chantier_name && ` · ${e.chantier_name}`}</span>
                              <span className="min-w-0 flex-1 truncate">{e.description || <span className="text-ink-3">—</span>}</span>
                              {!e.billable && <span className="badge badge-outline">NF</span>}{e.status !== 'a_facturer' && <span className={`badge ${e.status === 'paye' ? 'badge-ok' : 'badge-warn'}`}>{e.invoice_number}</span>}
                            </button>
                          ))}
                          <button className="meta px-1 py-1 hover:text-ink" onClick={() => openQuick('temps', { date: d, ...(mission ? { mission_id: mission } : {}) })}>+ Saisir</button>
                        </div>
                      </div>
                    )
                  })}
                </section>
              ) : (
                <section className="card overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-line-strong">{['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d) => <span key={d} className="title-block px-2 py-1.5">{d}</span>)}</div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: (new Date(from + 'T00:00:00Z').getUTCDay() || 7) - 1 }, (_, i) => <div key={i} className="border-b border-r border-line bg-sunken/40" />)}
                    {dayList.map((d) => {
                      const list = byDay(d)
                      const groups = new Map<number, { color: number; min: number; name: string }>()
                      for (const e of list) groups.set(e.mission_id, { color: e.mission_color, name: e.client_name, min: (groups.get(e.mission_id)?.min || 0) + e.minutes })
                      return (
                        <button key={d} onClick={() => (setAnchor(d), setView('week'))} className={`min-h-[72px] border-b border-r border-line p-1.5 text-left hover:bg-sunken/60 ${d === today() ? 'bg-accent-soft' : ''}`}>
                          <span className="flex items-baseline justify-between"><span className="num text-xs text-ink-3">{+d.slice(8)}</span>{list.length > 0 && <b className="num text-xs">{dur(sum(list))}</b>}</span>
                          {[...groups.values()].map((g, i) => <span key={i} className="mt-0.5 flex items-center gap-1 truncate text-2xs" style={mc(g.color)}><i className="dot !h-1.5 !w-1.5" /><span className="hidden truncate sm:inline">{g.name}</span> <span className="num">{dur(g.min)}</span></span>)}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )}
              {!ts.entries.length && view === 'month' && <Empty>Aucune heure sur ce mois.</Empty>}
              {ts.by_mission.length > 0 && (
                <p className="meta">{ts.by_mission.map((bm: Row) => { const m = missions.find((x) => x.id === bm.mission_id); return `${bm.client_name} : ${days(bm.billable_minutes, m?.hours_per_day)} facturables${bm.amount ? ` = ${euro(bm.amount)}` : ''}` }).join(' · ')} · <span title={dShort(from)}>cliquer une entrée pour la modifier</span></p>
              )}
            </div>
          )
        }}
      </State>
      {entry && <TimeModal entry={entry} onClose={() => setEntry(null)} />}
    </>
  )
}
