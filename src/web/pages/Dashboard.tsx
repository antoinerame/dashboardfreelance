import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, dLong, dMed, dRel, dShort, dur, euro, mc, today, tsLabel, useApp, useData, weekday, type Row } from '../lib'
import { ActionModal, ActionRow, Chip, Empty, Meter, PageHead, Seg, State } from '../ui'

export default function Dashboard() {
  const q = useData('/dashboard')
  const { openQuick, missions } = useApp()
  const [scope, setScope] = useState<'week' | 'month'>('week')
  const [edit, setEdit] = useState<Row | null>(null)

  if (q.data && !missions.length) {
    return (
      <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
        <h1 className="title-page">Bienvenue</h1>
        <p className="mt-2 text-ink-2">Crée ta première mission pour commencer à suivre tes heures, tes réunions et tes actions.</p>
        <Link to="/missions?nouvelle=1" className="btn btn-primary mt-5">Créer une mission</Link>
      </div>
    )
  }

  return (
    <>
      <PageHead title={<span className="first-letter:uppercase">{dLong(today())}</span>} sub="Où j’en suis, toutes missions confondues" />
      <State q={q} rows={8}>
        {(d) => {
          const t = d.today as string
          const daysList = Array.from({ length: 7 }, (_, i) => addDays(d.week.from, i)).filter((x) => weekday(x) <= 5 || d.week_days.some((w: Row) => w.date === x))
          const max = Math.max(8 * 60, ...daysList.map((x) => d.week_days.filter((w: Row) => w.date === x).reduce((s: number, w: Row) => s + w.minutes, 0)))
          const rev = d.revenue
          const byMission = [...d.missions].filter((m: Row) => (scope === 'week' ? m.week_minutes : m.month_minutes) > 0).sort((a: Row, b: Row) => (scope === 'week' ? b.week_minutes - a.week_minutes : b.month_minutes - a.month_minutes))
          const scopeMax = Math.max(1, ...byMission.map((m: Row) => (scope === 'week' ? m.week_minutes : m.month_minutes)))
          return (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
                {/* Semaine */}
                <section className="card overflow-hidden">
                  <div className="card-head">
                    <span className="title-block">Cette semaine</span>
                    <span className="text-sm"><b className="num">{dur(d.week.minutes)}</b> <span className="meta">· mois <span className="num">{dur(d.month.minutes)}</span></span></span>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${daysList.length}, minmax(0, 1fr))` }}>
                    {daysList.map((day) => {
                      const parts: Row[] = d.week_days.filter((w: Row) => w.date === day)
                      const total = parts.reduce((s, w) => s + w.minutes, 0)
                      const miss = d.missing_days.includes(day)
                      const isToday = day === t
                      const running = isToday && d.timer
                      return (
                        <div key={day} className="flex min-w-0 flex-col gap-1.5 border-r border-line px-2 py-2.5 last:border-0 sm:px-3">
                          <span className={`meta truncate ${isToday ? '!font-semibold !text-accent' : miss ? '!text-late' : ''}`}>{dShort(day)}{isToday && ' · auj.'}</span>
                          <button onClick={() => openQuick('temps', { date: day })} title="Saisir du temps ce jour"
                            className={`flex h-[84px] flex-col-reverse overflow-hidden rounded-sm ${miss ? 'day-miss items-center justify-center text-xs' : 'bg-sunken/50 hover:bg-sunken'}`}>
                            {miss && !total ? 'Rien saisi' : parts.map((w) => <i key={w.mission_id} style={{ ...mc(w.color), height: `${(w.minutes / max) * 100}%`, background: 'var(--mc)' }} className="block w-full border-t border-surface first:border-0" />)}
                            {running && <i className="block w-full animate-pulse opacity-40" style={{ ...mc(d.timer.mission_color), height: `${Math.min(100, (d.timer.elapsed_minutes / max) * 100)}%`, background: 'var(--mc)' }} title="Chrono en cours" />}
                          </button>
                          {total ? <b className="num text-sm">{dur(total)}</b> : miss ? <button className="num text-left text-sm text-late" onClick={() => openQuick('temps', { date: day })}>+ Saisir</button> : <span className="num text-sm text-ink-3">—</span>}
                        </div>
                      )
                    })}
                  </div>
                  {d.missing_days.filter((x: string) => x < d.week.from).length > 0 && (
                    <p className="border-t border-line px-3.5 py-2 text-xs text-late">
                      Rien saisi non plus : {d.missing_days.filter((x: string) => x < d.week.from).map((x: string) => (
                        <button key={x} className="mr-2 underline" onClick={() => openQuick('temps', { date: x })}>{dShort(x)}</button>
                      ))}
                    </p>
                  )}
                </section>

                {/* À facturer */}
                <section className="card">
                  <div className="card-head"><span className="title-block">À facturer</span><Link to="/facturation" className="btn btn-sm btn-ghost">Facturer →</Link></div>
                  <div className="card-body">
                    <p className="num text-3xl font-semibold">{euro(d.unbilled.amount)}</p>
                    <p className="meta">{dur(d.unbilled.minutes)} facturables non facturées</p>
                    <ul className="mt-3 space-y-1">
                      {d.missions.filter((m: Row) => m.unbilled_minutes > 0).map((m: Row) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm"><Chip m={m} /><span className="flex-1" /><span className="num text-ink-2">{dur(m.unbilled_minutes)}</span><span className="num w-20 text-right">{m.unbilled_amount ? euro(m.unbilled_amount) : 'forfait'}</span></li>
                      ))}
                    </ul>
                    {rev.ceiling > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <div className="mb-1.5 flex justify-between text-xs"><span className="text-ink-2">CA encaissé {rev.year}</span><span className="num">{euro(rev.paid)} / {euro(rev.ceiling)}</span></div>
                        <Meter pct={rev.paid / rev.ceiling} />
                        {rev.pending > 0 && <p className="meta mt-1.5">+ {euro(rev.pending)} facturés en attente de paiement</p>}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {/* Actions */}
                <section className="card">
                  <div className="card-head"><span className="title-block">Actions & échéances</span><Link to="/actions" className="btn btn-sm btn-ghost">{d.my_open_actions} à moi →</Link></div>
                  <div className="card-body !py-2">
                    {d.late_actions.length > 0 && <p className="badge badge-late mb-1 mt-1">En retard · {d.late_actions.length}</p>}
                    {d.late_actions.map((a: Row) => <ActionRow key={a.id} a={a} onEdit={setEdit} />)}
                    {d.upcoming_actions.length > 0 && <p className="badge mb-1 mt-2">14 prochains jours</p>}
                    {d.upcoming_actions.map((a: Row) => <ActionRow key={a.id} a={a} onEdit={setEdit} />)}
                    {!d.late_actions.length && !d.upcoming_actions.length && <Empty>Aucune échéance proche — <button className="underline" onClick={() => openQuick('action')}>A pour créer une action</button>.</Empty>}
                    {d.waiting_client.length > 0 && (
                      <p className="meta mt-2 border-t border-line pt-2">En attente côté client : {d.waiting_client.length} — {d.waiting_client.slice(0, 2).map((a: Row) => a.description).join(' ; ')}{d.waiting_client.length > 2 && '…'}</p>
                    )}
                  </div>
                </section>

                {/* Réunions */}
                <section className="card">
                  <div className="card-head"><span className="title-block">Dernières réunions</span><Link to="/reunions" className="btn btn-sm btn-ghost">Toutes →</Link></div>
                  <div className="card-body !py-1">
                    {d.recent_meetings.map((r: Row) => (
                      <Link key={r.id} to={`/reunions/${r.id}`} className="block border-b border-line py-2 last:border-0 hover:bg-sunken/40">
                        <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{r.title}</b><span className="meta flex-none">{dRel(r.date)}</span></div>
                        <div className="mt-0.5 flex items-center gap-2"><Chip m={r} link={false} />{r.action_count > 0 && <span className="meta">{r.action_count} action{r.action_count > 1 ? 's' : ''}</span>}{!r.summary && r.notes && <span className="badge badge-warn">CR à rédiger</span>}</div>
                        {(r.decisions || r.summary) && <p className="meta mt-1 line-clamp-2">{(r.decisions || r.summary).replace(/^[-*]\s*/gm, '').replace(/\n+/g, ' · ')}</p>}
                      </Link>
                    ))}
                    {!d.recent_meetings.length && <Empty>Aucune réunion — R pour en créer une.</Empty>}
                  </div>
                </section>

                {/* Heures par mission */}
                <section className="card">
                  <div className="card-head"><span className="title-block">Heures par mission</span><Seg value={scope} onChange={setScope} options={[['week', 'Semaine'], ['month', 'Mois']]} /></div>
                  <div className="card-body space-y-3">
                    {byMission.map((m: Row) => {
                      const v = scope === 'week' ? m.week_minutes : m.month_minutes
                      return (
                        <Link key={m.id} to={`/missions/${m.id}`} className="block" style={mc(m.color)}>
                          <div className="mb-1 flex items-baseline gap-2 text-sm"><span className="min-w-0 flex-1 truncate"><b>{m.client_name}</b> <span className="text-ink-3">{m.name}</span></span><span className="num">{dur(v)}</span></div>
                          <div className="meter"><span style={{ width: `${(v / scopeMax) * 100}%` }} /></div>
                          {m.budget && <p className="meta mt-1">Budget : {Math.round(m.budget.pct * 100)} % consommé{m.budget.pct >= 0.8 && <span className={`badge ml-1.5 ${m.budget.pct >= 1 ? 'badge-late' : 'badge-warn'}`}>{m.budget.pct >= 1 ? 'dépassé' : 'bientôt épuisé'}</span>}</p>}
                        </Link>
                      )
                    })}
                    {!byMission.length && <Empty>Aucune heure {scope === 'week' ? 'cette semaine' : 'ce mois'} — T pour saisir.</Empty>}
                  </div>
                </section>
              </div>

              {d.recent_logs.length > 0 && (
                <section className="card">
                  <div className="card-head"><span className="title-block">Journal récent</span></div>
                  <div className="card-body !py-1">
                    {d.recent_logs.map((l: Row) => (
                      <div key={l.id} className="flex items-baseline gap-3 border-b border-line py-1.5 last:border-0">
                        <span className="num w-28 flex-none text-xs text-ink-3">{tsLabel(l.ts)}</span><span className="min-w-0 flex-1">{l.text}</span><Chip m={l} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )
        }}
      </State>
      {edit && <ActionModal action={edit} onClose={() => setEdit(null)} />}
    </>
  )
}
