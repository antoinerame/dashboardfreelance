import { Clock, Copy, Eye, Pencil, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, copy, dFull, dMed, dRel, mc, today, useApp, useData, type Row } from '../lib'
import { ActionModal, ActionRow, Chip, Empty, Md, PageHead, State } from '../ui'

export default function Meetings() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { missions, run } = useApp()
  const [filter, setFilter] = useState<number | null>(null)
  const list = useData<Row[]>('/meetings')
  const creating = useRef(false)

  // /reunions?nouvelle=<mission> : crée la réunion et l'ouvre directement.
  useEffect(() => {
    const mid = Number(sp.get('nouvelle'))
    if (!mid || creating.current) return
    creating.current = true
    api(`/actions?mission_id=${mid}`)
      .then((acts: Row[]) => api('/meetings', { body: { mission_id: mid, date: today(), agenda: acts.map((a) => `- ${a.description}${a.owner === 'client' ? ` (${a.owner_name || 'client'})` : ''}`).join('\n') } }))
      .then((r) => { run(Promise.resolve()); nav(`/reunions/${r.id}`, { replace: true }) })
      .finally(() => { creating.current = false })
  }, [sp, nav, run])

  const shown = (list.data || []).filter((r) => !filter || r.mission_id === filter)
  return (
    <>
      <PageHead title="Réunions" sub="Notes, décisions et comptes rendus">
        <select className="select !w-auto" value={filter ?? ''} onChange={(e) => setFilter(Number(e.target.value) || null)} aria-label="Filtrer par mission">
          <option value="">Toutes les missions</option>
          {missions.map((m) => <option key={m.id} value={m.id}>{m.client_name} – {m.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))}><Plus size={15} /> Réunion <span className="kbd !border-paper/40 !bg-transparent !text-paper">R</span></button>
      </PageHead>
      <div className="grid items-start gap-4 lg:grid-cols-[300px_1fr]">
        <section className={`card overflow-hidden ${id ? 'hidden lg:block' : ''}`}>
          <State q={list}>
            {() => shown.length ? shown.map((r) => (
              <Link key={r.id} to={`/reunions/${r.id}`} style={mc(r.mission_color)} className={`block border-b border-line px-3 py-2 last:border-0 ${Number(id) === r.id ? 'bg-accent-soft' : 'hover:bg-sunken/50'}`}>
                <div className="flex items-baseline gap-2"><b className="min-w-0 flex-1 truncate">{r.title}</b><span className="meta flex-none">{dMed(r.date)}</span></div>
                <div className="mt-0.5 flex items-center gap-2"><i className="dot" /><span className="meta truncate">{r.client_name}{r.participants && ` · ${r.participants}`}</span>{!r.summary && r.notes && <span className="badge badge-warn ml-auto">CR</span>}</div>
              </Link>
            )) : <Empty>Aucune réunion — R pour en créer une.</Empty>}
          </State>
        </section>
        {id ? <Editor key={id} id={Number(id)} /> : <div className="card hidden lg:block"><Empty>Choisis une réunion dans la liste, ou crées-en une avec R.</Empty></div>}
      </div>
    </>
  )
}

function Editor({ id }: { id: number }) {
  const q = useData<Row>(`/meetings/${id}`)
  const { run, toast, openQuick, changed } = useApp()
  const nav = useNavigate()
  const [v, setV] = useState<Row | null>(null)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)
  const [action, setAction] = useState<Row | null>(null)
  const [actText, setActText] = useState('')
  const saved = useRef<Row | null>(null)

  useEffect(() => {
    if (q.data && !dirty) { setV(q.data); saved.current = q.data }
  }, [q.data]) // eslint-disable-line

  const set = (k: string, val: string) => { setV((x) => ({ ...x!, [k]: val })); setDirty(true) }
  const save = async (extra: Row = {}) => {
    if (!v) return
    const body = { title: v.title, date: v.date, time: v.time, participants: v.participants, agenda: v.agenda, notes: v.notes, decisions: v.decisions, summary: v.summary, ...extra }
    try {
      await api(`/meetings/${id}`, { method: 'PATCH', body })
      setDirty(false)
      changed()
    } catch (e: any) { toast(e.message, 'error') }
  }
  // Enregistrement automatique 1,2 s après la dernière frappe.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save(), 1200)
    return () => clearTimeout(t)
  }, [v, dirty]) // eslint-disable-line

  if (!v) return <div className="card card-body"><State q={q}>{() => null}</State></div>

  /** « - [ ] » ou « >> » → action ; « !! » → décision. Les lignes extraites restent dans les notes. */
  const extract = async () => {
    const lines = String(v.notes || '').split('\n')
    const acts = lines.map((l) => l.match(/^\s*(?:[-*]\s*\[ \]|>>)\s*(.+)$/)?.[1]).filter(Boolean) as string[]
    const decs = lines.map((l) => l.match(/^\s*(?:[-*]\s*)?!!\s*(.+)$/)?.[1]).filter(Boolean) as string[]
    const existing = new Set((q.data?.actions || []).map((a: Row) => a.description.trim()))
    const fresh = acts.filter((a) => !existing.has(a.trim()))
    const curDec = String(v.decisions || '')
    const newDec = decs.filter((d) => !curDec.includes(d))
    if (!fresh.length && !newDec.length) return toast('Rien à extraire : écris « - [ ] chose à faire » ou « !! décision » dans les notes.')
    for (const d of fresh) await api('/actions', { body: { mission_id: v.mission_id, meeting_id: id, description: d, owner: 'moi' } })
    await save(newDec.length ? { decisions: [curDec.trim(), ...newDec.map((d) => `- ${d}`)].filter(Boolean).join('\n') } : {})
    if (newDec.length) setV((x) => ({ ...x!, decisions: [curDec.trim(), ...newDec.map((d) => `- ${d}`)].filter(Boolean).join('\n') }))
    toast(`${fresh.length} action(s) et ${newDec.length} décision(s) extraites`)
    changed()
  }
  const report = () => [`# ${v.title} — ${dFull(v.date)}`, v.participants && `Participants : ${v.participants}`, v.summary && `## Compte rendu\n${v.summary}`, v.decisions && `## Décisions\n${v.decisions}`,
    q.data?.actions?.length && '## Actions\n' + q.data.actions.map((a: Row) => `- ${a.description} — ${a.owner === 'moi' ? 'moi' : a.owner_name || 'client'}${a.due_date ? `, pour le ${dMed(a.due_date)}` : ''}`).join('\n')].filter(Boolean).join('\n\n')
  const ta = (k: string, label: string, ph: string, rows: number, mono = false) => (
    <div>
      <label className="title-block mb-1 block" htmlFor={`m-${k}`}>{label}</label>
      {preview ? (v[k] ? <Md src={v[k]} className="rounded-md border border-line px-3 py-2" /> : <p className="meta">—</p>)
        : <textarea id={`m-${k}`} className={`textarea ${mono ? 'textarea-notes' : ''}`} rows={rows} placeholder={ph} value={v[k] || ''} onChange={(e) => set(k, e.target.value)} />}
    </div>
  )

  return (
    <section className="card min-w-0">
      <div className="card-head flex-wrap">
        <Link to="/reunions" className="btn btn-sm btn-ghost lg:hidden">← Liste</Link>
        <Chip m={v} />
        <span className="meta flex-1">{dirty ? 'Enregistrement…' : `Enregistré · ${dRel(v.date)}`}</span>
        <button className="btn btn-sm" onClick={() => setPreview(!preview)}>{preview ? <><Pencil size={12} /> Éditer</> : <><Eye size={12} /> Aperçu</>}</button>
        <button className="btn btn-sm" onClick={async () => toast((await copy(report())) ? 'Compte rendu copié (Markdown)' : 'Copie impossible')}><Copy size={12} /> Copier le CR</button>
        <button className="btn btn-sm" onClick={() => openQuick('temps', { mission_id: v.mission_id, date: v.date, text: `1h Réunion : ${v.title}` })} title="Créer l’entrée de temps correspondante"><Clock size={12} /> Temps</button>
        <button className="btn btn-sm btn-ghost btn-danger" aria-label="Supprimer" onClick={() => confirm('Supprimer cette réunion ?') && run(api(`/meetings/${id}`, { method: 'DELETE' })).then(() => nav('/reunions'))}><Trash2 size={12} /></button>
      </div>
      <div className="card-body space-y-3">
        <input className="w-full bg-transparent font-serif text-2xl font-semibold outline-none placeholder:text-ink-3" value={v.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="Titre de la réunion" aria-label="Titre" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[150px_110px_1fr]">
          <input type="date" className="input" value={v.date || ''} onChange={(e) => set('date', e.target.value)} aria-label="Date" />
          <input type="time" className="input" value={v.time || ''} onChange={(e) => set('time', e.target.value)} aria-label="Heure" />
          <input className="input col-span-2 sm:col-span-1" value={v.participants || ''} onChange={(e) => set('participants', e.target.value)} placeholder="Participants (Axel, …)" aria-label="Participants" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            {ta('agenda', 'Ordre du jour', 'Points à aborder', 3)}
            {ta('notes', 'Notes brutes', 'Prends tes notes ici, en Markdown.\n- [ ] ou >> en début de ligne = action\n!! en début de ligne = décision', 16, true)}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" onClick={extract}><Wand2 size={12} /> Extraire actions et décisions</button>
              <button className="btn btn-sm" title="Copie une consigne à coller dans Claude (connecté au serveur MCP) : il lira les notes et écrira le compte rendu dans cette réunion."
                onClick={async () => toast((await copy(`Lis la réunion ${id} avec get_meeting, puis rédige un compte rendu structuré (contexte, points abordés, décisions, prochaines étapes) et enregistre-le avec update_meeting (champs compte_rendu et decisions). Crée avec add_action les actions qui manquent, rattachées à la réunion ${id}.`)) ? 'Consigne copiée : colle-la dans Claude' : 'Copie impossible')}>
                <Sparkles size={12} /> Compte rendu par Claude
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {ta('decisions', 'Décisions', '- Une décision par ligne', 5)}
            <div>
              <p className="title-block mb-1">Actions issues de la réunion</p>
              {(q.data?.actions || []).map((a: Row) => <ActionRow key={a.id} a={{ ...a, meeting_title: null }} showMission={false} onEdit={setAction} />)}
              <form onSubmit={(e) => { e.preventDefault(); if (actText.trim()) run(api('/actions', { body: { mission_id: v.mission_id, meeting_id: id, description: actText, owner: 'moi' } })).then(() => setActText('')) }}>
                <input className="input-line" placeholder="+ Ajouter une action" value={actText} onChange={(e) => setActText(e.target.value)} />
              </form>
            </div>
            {ta('summary', 'Compte rendu', 'Compte rendu structuré (rédigé à la main ou par Claude)', 10)}
          </div>
        </div>
      </div>
      {action && <ActionModal action={action} onClose={() => setAction(null)} />}
    </section>
  )
}
