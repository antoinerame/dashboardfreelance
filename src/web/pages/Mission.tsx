import { Copy, Pencil, Play, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MISSION_STATUS, TIME_STATUS, addDays, api, copy, dMed, dRel, days, dur, euro, mc, today, tsLabel, useApp, useData, type Row } from '../lib'
import { ActionModal, ActionRow, Empty, FormModal, Md, Meter, PageHead, State, TimeModal, type Field } from '../ui'

const STATUS_BADGE: Row = { en_cours: 'badge-ok', en_pause: 'badge-warn', prospect: 'badge-accent', terminee: '' }

function missionFields(clients: Row[], creating: boolean): Field[] {
  return [
    { name: 'client_id', label: 'Client', type: 'select', options: [...clients.map((c) => [c.id, c.name] as [number, string]), ['', '＋ Nouveau client…']], half: true },
    { name: 'client_name', label: 'Nouveau client (si absent de la liste)', half: true, placeholder: 'TOBAM' },
    { name: 'name', label: 'Intitulé de la mission', required: true, placeholder: 'IA & outils internes' },
    { name: 'status', label: 'Statut', type: 'select', options: Object.entries(MISSION_STATUS) as [string, string][], half: true },
    { name: 'billing_type', label: 'Facturation', type: 'select', options: [['temps', 'Au temps passé'], ['forfait', 'Au forfait']], half: true },
    { name: 'rate', label: 'Taux (€ HT)', type: 'number', half: true, placeholder: '650' },
    { name: 'rate_type', label: 'Unité du taux', type: 'select', options: [['jour', 'par jour (TJM)'], ['heure', 'par heure']], half: true },
    { name: 'hours_per_day', label: 'Heures par jour', type: 'number', half: true },
    { name: 'fixed_price', label: 'Montant du forfait (€)', type: 'number', half: true },
    { name: 'budget_days', label: 'Budget (jours)', type: 'number', half: true, hint: 'Laisse vide si pas de budget' },
    { name: 'budget_amount', label: 'ou budget (€)', type: 'number', half: true },
    { name: 'start_date', label: 'Début', type: 'date', half: true },
    { name: 'end_date', label: 'Fin prévue', type: 'date', half: true },
    { name: 'color', label: 'Couleur', type: 'select', options: ['Encre', 'Sarcelle', 'Ocre', 'Terre cuite', 'Prune', 'Olive', 'Framboise', 'Ardoise'].map((n, i) => [i + 1, n]), half: true },
    ...(creating ? [{ name: 'chantiers', label: 'Chantiers (séparés par des virgules)', placeholder: 'Chatbot RLM, Pipeline Pilot, Outils Biz Dev' } as Field] : []),
    { name: 'description', label: 'Description / contexte', type: 'textarea' },
  ]
}

export function MissionModal({ mission, onClose }: { mission?: Row; onClose: () => void }) {
  const { changed } = useApp()
  const nav = useNavigate()
  const [clients, setClients] = useState<Row[] | null>(null)
  useEffect(() => { api('/clients').then(setClients) }, [])
  if (!clients) return null
  const hpd = mission?.hours_per_day || 7
  return (
    <FormModal
      title={mission ? 'Modifier la mission' : 'Nouvelle mission'}
      fields={missionFields(clients, !mission)}
      initial={mission ? { ...mission, budget_days: mission.budget_hours ? mission.budget_hours / hpd : '' } : { client_id: clients[0]?.id ?? '', status: 'en_cours', billing_type: 'temps', rate_type: 'jour', hours_per_day: 7 }}
      onClose={onClose}
      onSubmit={async (v) => {
        const body: Row = { ...v, budget_hours: v.budget_days ? v.budget_days * (v.hours_per_day || 7) : null, client_id: v.client_id ? Number(v.client_id) : undefined }
        if (!body.client_id && !body.client_name) throw new Error('Choisis un client ou saisis le nom d’un nouveau client.')
        if (body.client_id) delete body.client_name
        if (!mission) body.chantiers = String(v.chantiers || '').split(',').map((s) => s.trim()).filter(Boolean)
        const m = await api(mission ? `/missions/${mission.id}` : '/missions', { method: mission ? 'PATCH' : 'POST', body })
        changed()
        if (!mission) nav(`/missions/${m.id}`)
      }}
      onDelete={mission ? async () => { await api(`/missions/${mission.id}`, { method: 'DELETE' }); changed(); nav('/missions') } : undefined}
    />
  )
}

export function MissionList() {
  const { missions } = useApp()
  const [sp, setSp] = useSearchParams()
  const [creating, setCreating] = useState(sp.get('nouvelle') === '1')
  return (
    <>
      <PageHead title="Missions" sub={`${missions.filter((m) => m.status === 'en_cours').length} en cours · ${missions.length} au total`}>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> Nouvelle mission</button>
      </PageHead>
      <div className="card overflow-x-auto">
        <table className="table-dense">
          <thead><tr><th>Mission</th><th>Statut</th><th className="num">Semaine</th><th className="num">Mois</th><th className="num">Total</th><th className="num">Non facturé</th><th>Budget</th><th className="num">Actions</th></tr></thead>
          <tbody>
            {missions.map((m) => (
              <tr key={m.id} style={mc(m.color)}>
                <td><Link to={`/missions/${m.id}`} className="flex items-center gap-2"><i className="dot" /><b>{m.client_name}</b> <span className="text-ink-2">{m.name}</span></Link></td>
                <td><span className={`badge ${STATUS_BADGE[m.status]}`}>{MISSION_STATUS[m.status]}</span></td>
                <td className="num">{dur(m.week_minutes)}</td><td className="num">{dur(m.month_minutes)}</td><td className="num">{dur(m.total_minutes)}</td>
                <td className="num">{m.unbilled_minutes ? `${dur(m.unbilled_minutes)}${m.unbilled_amount ? ' · ' + euro(m.unbilled_amount) : ''}` : '—'}</td>
                <td className="w-40">{m.budget ? <div className="flex items-center gap-2"><div className="flex-1"><Meter pct={m.budget.pct} color={m.color} /></div><span className="num text-xs">{Math.round(m.budget.pct * 100)} %</span></div> : <span className="text-ink-3">—</span>}</td>
                <td className="num">{m.open_actions}{m.late_actions > 0 && <span className="badge badge-late ml-1.5">{m.late_actions} en retard</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!missions.length && <Empty>Aucune mission pour l’instant. Crée la première pour commencer à suivre tes heures.</Empty>}
      </div>
      {creating && <MissionModal onClose={() => (setCreating(false), setSp({}))} />}
    </>
  )
}

const TABS: [string, string][] = [['heures', 'Chantiers & heures'], ['reunions', 'Réunions'], ['journal', 'Journal'], ['actions', 'Actions'], ['factures', 'Factures'], ['infos', 'Infos']]

export function MissionPage() {
  const { id } = useParams()
  const q = useData(`/missions/${id}`)
  const { openQuick, run, timer } = useApp()
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('onglet') || 'heures'
  const [editing, setEditing] = useState(false)
  const [action, setAction] = useState<Row | 'new' | null>(null)
  const [entry, setEntry] = useState<Row | null>(null)
  const [logText, setLogText] = useState('')
  const [actText, setActText] = useState('')
  const [chName, setChName] = useState('')
  const nav = useNavigate()

  return (
    <State q={q} rows={10}>
      {(o) => {
        const m: Row = o.mission
        const hpd = m.hours_per_day || 7
        const b = m.budget
        const fmtB = (v: number) => (b?.unit === 'heures' ? `${days(v * 60, hpd)}` : euro(v))
        const recent = o.weeks.slice(-4).reduce((s: number, w: Row) => s + w.minutes, 0) / 4 / 60 // h / semaine
        const exhaust = b && b.unit === 'heures' && recent > 0 && b.remaining > 0 ? addDays(today(), Math.round((b.remaining / recent) * 7)) : null
        const expected = m.start_date && m.end_date && m.end_date > m.start_date ? (Date.parse(today()) - Date.parse(m.start_date)) / (Date.parse(m.end_date) - Date.parse(m.start_date)) : undefined
        const lm: Row | null = o.last_meeting
        const lastEntry = o.recent_time[0]
        const addLog = (e: React.FormEvent) => { e.preventDefault(); if (logText.trim()) run(api('/logs', { body: { mission_id: m.id, text: logText } })).then(() => setLogText('')) }
        const addAct = (e: React.FormEvent) => { e.preventDefault(); if (actText.trim()) run(api('/actions', { body: { mission_id: m.id, description: actText, owner: 'moi' } })).then(() => setActText('')) }
        const summary = () => [
          `# ${m.client_name} – ${m.name} — point au ${dMed(today())}`,
          `Heures : ${dur(m.week_minutes)} cette semaine, ${dur(m.month_minutes)} ce mois, ${dur(m.total_minutes)} au total.` + (b ? ` Budget : ${fmtB(b.used)} consommés sur ${fmtB(b.total)} (${Math.round(b.pct * 100)} %).` : ''),
          lm ? `## Dernière réunion — ${lm.title} (${dMed(lm.date)})\n${lm.decisions ? '**Décisions**\n' + lm.decisions : lm.summary || ''}` : '',
          o.open_actions.length ? '## Actions ouvertes\n' + o.open_actions.map((a: Row) => `- ${a.description} (${a.owner === 'moi' ? 'moi' : a.owner_name || 'client'}${a.due_date ? ', ' + dMed(a.due_date) : ''})`).join('\n') : '',
          o.logs.length ? '## Derniers événements\n' + o.logs.slice(0, 6).map((l: Row) => `- ${dMed(l.ts.slice(0, 10))} — ${l.text}`).join('\n') : '',
        ].filter(Boolean).join('\n\n')
        const maxWeek = Math.max(60, ...o.weeks.map((w: Row) => w.minutes))
        const totalCh = Math.max(1, m.total_minutes)

        return (
          <div style={mc(m.color)}>
            <PageHead
              title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><i className="dot !h-3 !w-3" />{m.client_name} <span className="font-normal text-ink-2">{m.name}</span><span className={`badge ${STATUS_BADGE[m.status]} font-sans`}>{MISSION_STATUS[m.status]}</span></span>}
              sub={<>{m.billing_type === 'forfait' ? `Forfait${m.fixed_price ? ' ' + euro(m.fixed_price) : ''}` : m.rate ? `${euro(m.rate)} / ${m.rate_type}` : 'Taux non renseigné'}{m.start_date && ` · depuis le ${dMed(m.start_date)}`}{m.end_date && ` · fin prévue ${dMed(m.end_date)}`}</>}>
              {!timer && <button className="btn" onClick={() => openQuick('chrono', { mission_id: m.id })}><Play size={14} /> Chrono</button>}
              <button className="btn" onClick={() => nav(`/reunions?nouvelle=${m.id}`)}><Plus size={14} /> Réunion</button>
              <button className="btn btn-primary" onClick={() => openQuick('temps', { mission_id: m.id })}><Plus size={14} /> Temps</button>
              <button className="btn btn-icon btn-ghost" onClick={() => setEditing(true)} aria-label="Modifier la mission"><Pencil size={15} /></button>
            </PageHead>

            {/* Bandeau budget */}
            <section className="card mb-4 grid grid-cols-2 items-end gap-x-7 gap-y-3 px-4 py-3 sm:flex sm:flex-wrap">
              <Stat label="Cette semaine" value={dur(m.week_minutes)} />
              <Stat label="Ce mois" value={dur(m.month_minutes)} />
              <Stat label="Total" value={dur(m.total_minutes)} sub={days(m.total_minutes, hpd)} />
              <Stat label="Non facturé" value={m.unbilled_amount ? euro(m.unbilled_amount) : dur(m.unbilled_minutes)} sub={m.unbilled_amount ? dur(m.unbilled_minutes) : undefined} />
              {b ? (
                <div className="col-span-2 min-w-[220px] flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                    <span className="title-block">Budget</span>
                    <span className="num">{fmtB(b.used)} / {fmtB(b.total)} · reste <b className={b.remaining < 0 ? 'text-late' : ''}>{fmtB(b.remaining)}</b></span>
                  </div>
                  <Meter pct={b.pct} color={m.color} mark={expected} />
                  <p className="meta mt-1.5">{recent > 0 ? `Rythme : ${recent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h/sem. sur 4 semaines` : 'Aucune heure sur les 4 dernières semaines'}{exhaust && ` · épuisé vers le ${dMed(exhaust)}`}{b.pct >= 0.8 && b.pct < 1 && ' · ⚠ plus de 80 % consommé'}{b.pct >= 1 && ' · ⚠ budget dépassé'}</p>
                </div>
              ) : (
                <div className="col-span-2 flex flex-1 items-end gap-[3px] self-stretch" title="Heures par semaine, 12 dernières semaines">
                  {o.weeks.map((w: Row) => <i key={w.start} className="block flex-1 rounded-t-xs" style={{ height: `${Math.max(4, (w.minutes / maxWeek) * 44)}px`, background: w.minutes ? 'var(--mc)' : 'var(--sunken)' }} title={`Semaine du ${dMed(w.start)} : ${dur(w.minutes)}`} />)}
                </div>
              )}
            </section>

            {/* Reprendre le fil */}
            <section className="mb-5 overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Reprendre le fil">
              <div className="flex items-center gap-3 border-b border-line-strong bg-sunken px-3.5 py-2">
                <b className="font-serif text-lg">Reprendre le fil</b>
                <span className="meta hidden flex-1 truncate sm:block">{lastEntry ? `dernière saisie ${dRel(lastEntry.date)}` : 'aucune heure saisie'}{lm && ` · dernier échange ${dRel(lm.date)}`}</span>
                <span className="flex-1 sm:hidden" />
                <button className="btn btn-sm btn-ghost" onClick={async () => run(copy(summary()).then((ok) => { if (!ok) throw new Error('Copie impossible') }), 'Résumé copié (Markdown)')}><Copy size={12} /> Copier le résumé</button>
              </div>
              <div className="grid divide-y divide-line lg:grid-cols-[1.15fr_1fr_1.15fr] lg:divide-x lg:divide-y-0">
                <div className="p-3.5">
                  <p className="title-block mb-2">Dernière réunion</p>
                  {lm ? (
                    <>
                      <Link to={`/reunions/${lm.id}`} className="font-semibold hover:underline">{lm.title}</Link>
                      <p className="meta">{dMed(lm.date)} ({dRel(lm.date)}){lm.participants && ` · ${lm.participants}`}</p>
                      {lm.decisions ? <><p className="title-block mb-1 mt-3">Décisions</p><Md src={lm.decisions} /></>
                        : lm.summary ? <Md src={lm.summary} className="mt-2 line-clamp-[10]" />
                        : lm.notes ? <><p className="badge badge-warn mt-2">Compte rendu à rédiger</p><Md src={lm.notes} className="mt-2 line-clamp-6 text-ink-2" /></>
                        : <p className="meta mt-2">Pas encore de notes.</p>}
                    </>
                  ) : <p className="meta">Aucune réunion enregistrée.</p>}
                </div>
                <div className="p-3.5">
                  <p className="title-block mb-1">Journal</p>
                  <form onSubmit={addLog}><input className="input-line" placeholder="+ Noter un événement (livraison, blocage…)" value={logText} onChange={(e) => setLogText(e.target.value)} /></form>
                  <ul className="mt-2 space-y-1.5">
                    {o.logs.slice(0, 6).map((l: Row) => <li key={l.id} className="text-sm"><span className="num mr-2 text-xs text-ink-3">{dMed(l.ts.slice(0, 10))}</span>{l.text}</li>)}
                  </ul>
                </div>
                <div className="p-3.5">
                  <p className="title-block mb-1">Actions ouvertes · {o.open_actions.length}</p>
                  <form onSubmit={addAct}><input className="input-line" placeholder="+ Ajouter une action" value={actText} onChange={(e) => setActText(e.target.value)} /></form>
                  <div className="mt-1">{o.open_actions.slice(0, 8).map((a: Row) => <ActionRow key={a.id} a={a} showMission={false} onEdit={setAction} />)}</div>
                  {o.open_actions.length > 8 && <button className="meta mt-1 underline" onClick={() => setSp({ onglet: 'actions' })}>+ {o.open_actions.length - 8} autres</button>}
                </div>
              </div>
            </section>

            {/* Onglets */}
            <div className="mb-3 flex overflow-x-auto border-b border-line" role="tablist">
              {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setSp({ onglet: k }, { replace: true })}>{label}</button>)}
            </div>

            {tab === 'heures' && (
              <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                <section className="card self-start">
                  <div className="card-head"><span className="title-block">Chantiers</span></div>
                  <div className="card-body space-y-3">
                    {[...o.chantiers, ...(o.no_chantier_minutes ? [{ id: 0, name: 'Sans chantier', total_minutes: o.no_chantier_minutes, status: 'actif', month_minutes: null }] : [])].map((c: Row) => (
                      <div key={c.id} className={c.status === 'termine' ? 'opacity-60' : ''}>
                        <div className="mb-1 flex items-baseline gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-medium">{c.name}{c.status === 'termine' && ' (terminé)'}</span>
                          <span className="num">{dur(c.total_minutes)}</span><span className="num w-10 text-right text-xs text-ink-3">{Math.round((c.total_minutes / totalCh) * 100)} %</span>
                        </div>
                        <div className="meter"><span style={{ width: `${(c.total_minutes / totalCh) * 100}%` }} /></div>
                        {c.id > 0 && (
                          <p className="meta mt-1 flex gap-3">{c.month_minutes > 0 && <span>{dur(c.month_minutes)} ce mois</span>}
                            <button className="underline" onClick={() => { const name = prompt('Renommer le chantier', c.name); if (name?.trim()) run(api(`/chantiers/${c.id}`, { method: 'PATCH', body: { name } })) }}>renommer</button>
                            <button className="underline" onClick={() => run(api(`/chantiers/${c.id}`, { method: 'PATCH', body: { status: c.status === 'actif' ? 'termine' : 'actif' } }))}>{c.status === 'actif' ? 'terminer' : 'rouvrir'}</button>
                            {!c.total_minutes && <button className="underline" onClick={() => run(api(`/chantiers/${c.id}`, { method: 'DELETE' }))}>supprimer</button>}
                          </p>
                        )}
                      </div>
                    ))}
                    <form onSubmit={(e) => { e.preventDefault(); if (chName.trim()) run(api('/chantiers', { body: { mission_id: m.id, name: chName } })).then(() => setChName('')) }}>
                      <input className="input-line" placeholder="+ Ajouter un chantier" value={chName} onChange={(e) => setChName(e.target.value)} />
                    </form>
                  </div>
                </section>
                <section className="card overflow-x-auto">
                  <div className="card-head"><span className="title-block">Dernières heures</span><Link to={`/heures?mission=${m.id}`} className="btn btn-sm btn-ghost">Feuille de temps →</Link></div>
                  <TimeTable entries={o.recent_time} onEdit={setEntry} />
                </section>
              </div>
            )}

            {tab === 'reunions' && (
              <section className="card">
                {o.meetings.map((r: Row) => (
                  <Link key={r.id} to={`/reunions/${r.id}`} className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-sunken/40">
                    <span className="num w-24 text-xs text-ink-3">{dMed(r.date)}</span><b className="min-w-0 flex-1">{r.title}</b>
                    {r.participants && <span className="meta">{r.participants}</span>}
                    {r.action_count > 0 && <span className="badge">{r.action_count} action{r.action_count > 1 ? 's' : ''}</span>}
                    {!r.summary && r.notes && <span className="badge badge-warn">CR à rédiger</span>}
                    {r.decisions && <p className="meta line-clamp-2 w-full sm:pl-[108px]">{r.decisions.replace(/^[-*]\s*/gm, '').replace(/\n+/g, ' · ')}</p>}
                  </Link>
                ))}
                {!o.meetings.length && <Empty>Aucune réunion sur cette mission — R pour en créer une.</Empty>}
              </section>
            )}

            {tab === 'journal' && (
              <section className="card card-body">
                <form onSubmit={addLog} className="mb-2"><input className="input-line" placeholder="+ Noter un événement" value={logText} onChange={(e) => setLogText(e.target.value)} /></form>
                {o.logs.map((l: Row) => (
                  <div key={l.id} className="group flex items-baseline gap-3 border-b border-line py-1.5 last:border-0">
                    <span className="num w-28 flex-none text-xs text-ink-3">{tsLabel(l.ts)}</span><span className="min-w-0 flex-1">{l.text}</span>
                    <button className="meta underline opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => confirm('Supprimer cette ligne ?') && run(api(`/logs/${l.id}`, { method: 'DELETE' }))}>supprimer</button>
                  </div>
                ))}
                {!o.logs.length && <Empty>Journal vide. Note ici les livraisons, blocages et événements : précieux pour les rapports d’activité.</Empty>}
              </section>
            )}

            {tab === 'actions' && (
              <section className="card card-body">
                <div className="mb-1 flex items-center"><span className="title-block flex-1">Ouvertes · {o.open_actions.length}</span><button className="btn btn-sm" onClick={() => setAction('new')}><Plus size={12} /> Action</button></div>
                {o.open_actions.map((a: Row) => <ActionRow key={a.id} a={a} showMission={false} onEdit={setAction} />)}
                {!o.open_actions.length && <Empty>Aucune action ouverte.</Empty>}
                {o.done_actions.length > 0 && <p className="title-block mb-1 mt-4">Récemment terminées</p>}
                {o.done_actions.map((a: Row) => <ActionRow key={a.id} a={a} showMission={false} onEdit={setAction} />)}
              </section>
            )}

            {tab === 'factures' && (
              <section className="card overflow-x-auto">
                <table className="table-dense">
                  <thead><tr><th>N°</th><th>Période</th><th className="num">Temps</th><th className="num">Montant HT</th><th>État</th></tr></thead>
                  <tbody>{o.invoices.map((i: Row) => (
                    <tr key={i.id}><td><Link className="underline" to={`/factures/${i.id}`}>{i.number}</Link></td><td>{dMed(i.period_start)} → {dMed(i.period_end)}</td><td className="num">{dur(i.minutes)}</td><td className="num">{euro(i.amount, 2)}</td>
                      <td>{i.paid_date ? <span className="badge badge-ok">Payée {dMed(i.paid_date)}</span> : i.sent_date ? <span className="badge badge-warn">Envoyée {dMed(i.sent_date)}</span> : <span className="badge">Brouillon</span>}</td></tr>
                  ))}</tbody>
                </table>
                {!o.invoices.length && <Empty>Aucune facture. <Link className="underline" to="/facturation">Préparer une facture →</Link></Empty>}
              </section>
            )}

            {tab === 'infos' && (
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="card card-body">
                  <div className="mb-2 flex items-center"><span className="title-block flex-1">Contexte</span><button className="btn btn-sm" onClick={() => setEditing(true)}>Modifier</button></div>
                  {m.description ? <Md src={m.description} /> : <p className="meta">Pas de description.</p>}
                </section>
                <section className="card card-body">
                  <div className="mb-2 flex items-center"><span className="title-block flex-1">Client & contacts</span><Link to="/clients" className="btn btn-sm">Gérer</Link></div>
                  <b>{o.client.name}</b>
                  {o.client.billing_address && <p className="meta whitespace-pre-line">{o.client.billing_address}</p>}
                  <ul className="mt-2 space-y-1">{o.contacts.map((c: Row) => <li key={c.id} className="text-sm"><b>{c.name}</b>{c.role && <span className="text-ink-2"> — {c.role}</span>}{c.email && <a className="meta ml-2 underline" href={`mailto:${c.email}`}>{c.email}</a>}{c.phone && <span className="meta ml-2">{c.phone}</span>}</li>)}</ul>
                  {!o.contacts.length && <p className="meta mt-1">Aucun contact.</p>}
                </section>
              </div>
            )}

            {editing && <MissionModal mission={m} onClose={() => setEditing(false)} />}
            {action && <ActionModal action={action === 'new' ? undefined : action} missionId={m.id} onClose={() => setAction(null)} />}
            {entry && <TimeModal entry={entry} onClose={() => setEntry(null)} />}
          </div>
        )
      }}
    </State>
  )
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div><p className="title-block">{label}</p><p className="num text-xl font-semibold">{value}</p>{sub && <p className="meta num">{sub}</p>}</div>
)

export function TimeTable({ entries, onEdit, showMission }: { entries: Row[]; onEdit: (e: Row) => void; showMission?: boolean }) {
  if (!entries.length) return <Empty>Aucune heure — T pour saisir.</Empty>
  return (
    <table className="table-dense">
      <thead><tr><th>Date</th>{showMission && <th>Mission</th>}<th>Chantier</th><th>Description</th><th className="num">Durée</th><th>État</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.id} className="cursor-pointer" onClick={() => onEdit(e)} style={mc(e.mission_color)}>
            <td className="num whitespace-nowrap text-xs">{dMed(e.date)}</td>
            {showMission && <td className="whitespace-nowrap"><i className="dot mr-1.5" />{e.client_name}</td>}
            <td className="whitespace-nowrap text-ink-2">{e.chantier_name || '—'}</td>
            <td className="min-w-[160px]">{e.description || <span className="text-ink-3">—</span>}</td>
            <td className="num whitespace-nowrap">{dur(e.minutes)}</td>
            <td>{!e.billable ? <span className="badge badge-outline">Non fact.</span> : <span className={`badge ${e.status === 'paye' ? 'badge-ok' : e.status === 'facture' ? 'badge-warn' : ''}`}>{TIME_STATUS[e.status]}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
