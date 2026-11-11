import { CheckSquare, Clock, FileText, Home, Layers, type LucideIcon, Play, Plus, Receipt, Search, Settings, Square, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Ctx, MISSION_STATUS, useApp, api, dMed, dur, mc, norm, parseDuration, parseQuick, today, type AppCtx, type QuickMode, type Row } from './lib'
import { FormModal, Modal, Seg } from './ui'
import Dashboard from './pages/Dashboard'
import { MissionList, MissionPage } from './pages/Mission'
import Timesheet from './pages/Timesheet'
import Meetings from './pages/Meetings'
import Actions from './pages/Actions'
import { Billing, InvoicePage } from './pages/Billing'
import { Clients, SettingsPage } from './pages/Admin'

const NAV: [string, string, LucideIcon, string][] = [
  ['/', 'Tableau de bord', Home, 't'],
  ['/heures', 'Heures', Clock, 'h'],
  ['/reunions', 'Réunions', FileText, 'r'],
  ['/actions', 'Actions', CheckSquare, 'a'],
  ['/facturation', 'Facturation', Receipt, 'f'],
  ['/missions', 'Missions', Layers, 'm'],
]

export default function App() {
  const nav = useNavigate()
  const loc = useLocation()
  const [missions, setMissions] = useState<Row[]>([])
  const [timer, setTimer] = useState<Row | null>(null)
  const [version, setVersion] = useState(0)
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([])
  const [quick, setQuick] = useState<{ mode: QuickMode; preset: Row } | null>(null)
  const [palette, setPalette] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [newMeeting, setNewMeeting] = useState(false)
  const [help, setHelp] = useState(false)

  const changed = useCallback(() => setVersion((v) => v + 1), [])
  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  const run = useCallback(async <T,>(p: Promise<T>, okText?: string) => {
    try {
      const r = await p
      if (okText) toast(okText)
      changed()
      return r
    } catch (e: any) {
      toast(e.message, 'error')
      return undefined
    }
  }, [toast, changed])

  useEffect(() => {
    api('/missions').then(setMissions).catch((e) => toast(e.message, 'error'))
    api('/timer').then(setTimer).catch(() => {})
  }, [version, toast])
  // Le chrono peut être démarré depuis Claude (MCP) : on resynchronise régulièrement et au retour sur l'onglet.
  useEffect(() => {
    const sync = () => document.visibilityState === 'visible' && api('/timer').then(setTimer).catch(() => {})
    const i = setInterval(sync, 60_000)
    document.addEventListener('visibilitychange', sync)
    return () => (clearInterval(i), document.removeEventListener('visibilitychange', sync))
  }, [])

  const currentMission = Number(loc.pathname.match(/^\/missions\/(\d+)/)?.[1]) || undefined
  const openQuick = useCallback((mode: QuickMode = 'temps', preset: Row = {}) => setQuick({ mode, preset: { mission_id: currentMission, ...preset } }), [currentMission])
  const ctx: AppCtx = useMemo(() => ({ missions, timer, version, changed, toast, run, openQuick, openPalette: () => setPalette(true) }), [missions, timer, version, changed, toast, run, openQuick])

  const active = missions.filter((m) => m.status === 'en_cours')
  const others = missions.filter((m) => m.status === 'en_pause' || m.status === 'prospect')

  // Raccourcis clavier (désactivés quand un champ a le focus ou qu'une fenêtre est ouverte).
  const pendingG = useRef(0)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return e.preventDefault(), setPalette((p) => !p)
      const el = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest?.('input,textarea,select,[contenteditable],[role=dialog]')) return
      if (quick || palette || stopping || newMeeting || help) return
      const k = e.key.toLowerCase()
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0
        const target = NAV.find((n) => n[3] === k)
        if (target) return e.preventDefault(), nav(target[0])
      }
      if (k === 'g') return void (pendingG.current = Date.now())
      const map: Record<string, () => void> = {
        t: () => openQuick('temps'),
        s: () => (timer ? setStopping(true) : openQuick('chrono')),
        a: () => openQuick('action'),
        j: () => openQuick('journal'),
        r: () => setNewMeeting(true),
        '/': () => setPalette(true),
        '?': () => setHelp(true),
      }
      if (map[k]) return e.preventDefault(), map[k]()
      if (/^[1-9]$/.test(k) && active[+k - 1]) nav(`/missions/${active[+k - 1].id}`)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [quick, palette, stopping, newMeeting, help, timer, active, nav, openQuick])

  if (loc.pathname.startsWith('/factures/')) {
    return <Ctx.Provider value={ctx}><Routes><Route path="/factures/:id" element={<InvoicePage />} /></Routes></Ctx.Provider>
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-dvh md:pl-[224px]">
        {/* Barre latérale */}
        <aside className="fixed inset-y-0 left-0 hidden w-[224px] flex-col gap-4 overflow-y-auto border-r border-line bg-surface p-3 md:flex">
          <NavLink to="/" className="flex items-baseline gap-2 px-2 pt-1">
            <b className="font-serif text-xl">Le Fil</b><span className="meta">missions</span>
          </NavLink>
          <nav className="flex flex-col gap-px">
            {NAV.map(([to, label, Icon, key]) => (
              <NavLink key={to} to={to} end={to === '/'} className="nav-link" title={`g puis ${key}`}><Icon size={15} /> {label}</NavLink>
            ))}
          </nav>
          <div>
            <p className="title-block mb-1.5 px-2">En cours</p>
            <nav className="flex flex-col gap-px">
              {active.map((m, i) => (
                <NavLink key={m.id} to={`/missions/${m.id}`} className="nav-link" style={mc(m.color)}>
                  <i className="dot" /> <span className="truncate">{m.client_name}<span className="font-normal opacity-70"> · {m.name}</span></span>
                  {i < 9 && <span className="kbd">{i + 1}</span>}
                </NavLink>
              ))}
              {!active.length && <NavLink to="/missions" className="nav-link"><Plus size={15} /> Créer une mission</NavLink>}
            </nav>
          </div>
          {others.length > 0 && (
            <div>
              <p className="title-block mb-1.5 px-2">En pause · prospects</p>
              <nav className="flex flex-col gap-px">
                {others.map((m) => (
                  <NavLink key={m.id} to={`/missions/${m.id}`} className="nav-link" style={mc(m.color)}>
                    <i className="dot opacity-50" /> <span className="truncate">{m.client_name}<span className="font-normal opacity-70"> · {MISSION_STATUS[m.status].toLowerCase()}</span></span>
                  </NavLink>
                ))}
              </nav>
            </div>
          )}
          <nav className="mt-auto flex flex-col gap-px">
            <NavLink to="/clients" className="nav-link"><Users size={15} /> Clients & contacts</NavLink>
            <NavLink to="/reglages" className="nav-link"><Settings size={15} /> Réglages</NavLink>
            <button className="nav-link" onClick={() => setHelp(true)}><span className="kbd !ml-0">?</span> Raccourcis</button>
          </nav>
        </aside>

        {/* Barre haute */}
        <header className="no-print sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-paper/95 px-3 backdrop-blur md:px-6">
          <button className="hidden h-[30px] min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-sm text-ink-3 hover:border-line-strong md:flex md:max-w-sm" onClick={() => setPalette(true)}>
            <Search size={14} /> <span className="flex-1 truncate">Chercher ou lancer une commande…</span> <span className="kbd">Ctrl K</span>
          </button>
          <b className="font-serif text-lg md:hidden">Le Fil</b>
          <span className="flex-1" />
          <TimerWidget timer={timer} onStop={() => setStopping(true)} onStart={() => openQuick('chrono')} />
          <button className="btn btn-primary hidden md:inline-flex" onClick={() => openQuick('temps')}><Plus size={15} /> Saisir du temps <span className="kbd !border-paper/40 !bg-transparent !text-paper">T</span></button>
        </header>

        <main className="mx-auto max-w-[1240px] px-3 pb-24 pt-5 md:px-6 md:pb-10">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/missions" element={<MissionList />} />
            <Route path="/missions/:id" element={<MissionPage />} />
            <Route path="/heures" element={<Timesheet />} />
            <Route path="/reunions" element={<Meetings />} />
            <Route path="/reunions/:id" element={<Meetings />} />
            <Route path="/actions" element={<Actions />} />
            <Route path="/facturation" element={<Billing />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/reglages" element={<SettingsPage />} />
            <Route path="*" element={<p className="empty">Page introuvable.</p>} />
          </Routes>
        </main>

        {/* Onglets bas (mobile) */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line-strong bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          {([['/', 'Accueil', Home], ['/missions', 'Missions', Layers]] as const).map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex h-14 flex-col items-center justify-center gap-0.5 text-2xs ${isActive ? 'font-semibold text-ink' : 'text-ink-3'}`}><Icon size={18} />{label}</NavLink>
          ))}
          <button className="flex h-14 flex-col items-center justify-center" onClick={() => openQuick('temps')} aria-label="Saisir du temps">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-paper"><Plus size={20} /></span>
          </button>
          <NavLink to="/actions" className={({ isActive }) => `flex h-14 flex-col items-center justify-center gap-0.5 text-2xs ${isActive ? 'font-semibold text-ink' : 'text-ink-3'}`}><CheckSquare size={18} />Actions</NavLink>
          <button className="flex h-14 flex-col items-center justify-center gap-0.5 text-2xs text-ink-3" onClick={() => setPalette(true)}><Search size={18} />Chercher</button>
        </nav>

        {quick && <QuickModal key={quick.mode} mode={quick.mode} preset={quick.preset} onClose={() => setQuick(null)} onMode={(mode) => setQuick({ ...quick, mode })} />}
        {palette && <Palette onClose={() => setPalette(false)} actions={{ meeting: () => setNewMeeting(true), stop: () => setStopping(true), help: () => setHelp(true) }} />}
        {stopping && timer && <StopModal timer={timer} onClose={() => setStopping(false)} />}
        {newMeeting && <NewMeetingModal missionId={currentMission} onClose={() => setNewMeeting(false)} />}
        {help && <HelpModal onClose={() => setHelp(false)} />}

        <div className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 md:bottom-6" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast pointer-events-auto ${t.kind === 'error' ? '!bg-late !text-surface' : ''}`}>{t.text}</div>)}
        </div>
      </div>
    </Ctx.Provider>
  )
}

function elapsed(timer: Row) {
  return Math.max(0, Math.floor((Date.now() - Date.parse(timer.started_at)) / 60000))
}

function TimerWidget({ timer, onStop, onStart }: { timer: Row | null; onStop: () => void; onStart: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!timer) return
    const i = setInterval(() => tick((x) => x + 1), 15_000)
    return () => clearInterval(i)
  }, [timer])
  if (!timer) return <button className="btn" onClick={onStart} title="Démarrer le chrono (S)"><Play size={14} /> <span className="hidden sm:inline">Chrono</span></button>
  const min = elapsed(timer)
  return (
    <div className="flex h-[30px] min-w-0 items-center gap-2 rounded-md border border-line-strong bg-surface pl-2.5 pr-1" style={mc(timer.mission_color)}>
      <i className="pulse flex-none" />
      <b className={`num text-sm ${min > 240 ? 'text-warn' : ''}`} title={min > 240 ? 'Plus de 4 h : toujours en cours ?' : undefined}>{dur(min)}</b>
      <span className="hidden min-w-0 truncate text-xs text-ink-2 sm:block">{timer.client_name}{timer.chantier_name ? ` · ${timer.chantier_name}` : ''}</span>
      <button className="btn btn-sm btn-danger" onClick={onStop} title="Arrêter (S)"><Square size={11} fill="currentColor" /> Stop</button>
    </div>
  )
}

function StopModal({ timer, onClose }: { timer: Row; onClose: () => void }) {
  const { run } = useApp()
  const min = Math.max(1, elapsed(timer))
  const rounded = Math.max(15, Math.round(min / 15) * 15)
  const fmt = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
  return (
    <FormModal
      title={`Arrêter le chrono — ${timer.client_name}`}
      submitLabel="Enregistrer le temps"
      fields={[
        { name: 'duration', label: 'Durée', half: true, required: true, hint: `Écoulé : ${fmt(min)} · arrondi au quart d’heure : ${fmt(rounded)}` },
        { name: 'billable', label: 'Facturable', type: 'checkbox', half: true },
        { name: 'description', label: 'Qu’as-tu fait ?', type: 'textarea' },
      ]}
      initial={{ duration: fmt(rounded), description: timer.description || '', billable: true }}
      onClose={onClose}
      onDelete={async () => { await api('/timer', { method: 'DELETE' }); run(Promise.resolve(), 'Chrono annulé') }}
      onSubmit={async (v) => {
        const minutes = parseDuration(v.duration)
        if (!minutes) throw new Error('Durée non comprise (ex. 1h30, 45m).')
        await api('/timer/stop', { body: { minutes, description: v.description, billable: v.billable } })
        run(Promise.resolve(), `${fmt(minutes)} enregistrés`)
      }}
    />
  )
}


const MODES: [QuickMode, string][] = [['temps', 'Temps'], ['chrono', 'Chrono'], ['action', 'Action'], ['journal', 'Journal']]
const HINTS: Record<QuickMode, string> = {
  temps: 'tobam rlm 1h30 atelier prompts hier',
  chrono: 'tobam pipeline revue du code',
  action: 'tobam relancer Axel pour les accès vendredi',
  journal: 'tobam livré la v2 du pipeline',
}

function QuickModal({ mode, preset, onClose, onMode }: { mode: QuickMode; preset: Row; onClose: () => void; onMode: (m: QuickMode) => void }) {
  const { missions, run } = useApp()
  const [text, setText] = useState<string>(preset.text || '')
  const [ov, setOv] = useState<Row>(() => ({ ...(preset.mission_id ? { mission_id: preset.mission_id } : {}), ...(preset.date ? { date: preset.date } : {}) }))
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [mode])

  const open = missions.filter((m) => m.status !== 'terminee')
  const forced = ov.mission_id ? missions.find((m) => m.id === Number(ov.mission_id)) : undefined
  // Si la mission est imposée (page mission, correction manuelle), on n'analyse pas son nom dans le texte.
  const p = parseQuick(text, forced ? [forced] : open, { duration: mode === 'temps', future: mode === 'action' })
  const mission = forced || p.mission
  const chantiers: Row[] = (mission?.chantiers || []).filter((c: Row) => c.status === 'actif')
  const chantierId = ov.chantier_id !== undefined ? ov.chantier_id : p.chantier?.id ?? ''
  const date = ov.date || p.date || (mode === 'action' ? '' : today())
  const ready = !!mission && (mode !== 'temps' || !!p.minutes) && (mode === 'temps' || mode === 'chrono' || !!p.text)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mission) return setErr('Mission non reconnue : commence par son nom ou choisis-la ci-dessous.')
    if (mode === 'temps' && !p.minutes) return setErr('Indique une durée : 1h30, 45m, 2.5 ou 0.5j.')
    if ((mode === 'action' || mode === 'journal') && !p.text) return setErr('Écris le texte après le nom de la mission.')
    const cid = chantierId === '' ? null : Number(chantierId)
    const label = `${mission.client_name}${cid ? ' · ' + chantiers.find((c) => c.id === cid)?.name : ''}`
    const call =
      mode === 'temps' ? api('/time', { body: { mission_id: mission.id, chantier_id: cid, minutes: p.minutes, date, description: p.text, billable: p.billable } })
      : mode === 'chrono' ? api('/timer/start', { body: { mission_id: mission.id, chantier_id: cid, description: p.text } })
      : mode === 'action' ? api('/actions', { body: { mission_id: mission.id, description: p.text, due_date: date || null, owner: 'moi' } })
      : api('/logs', { body: { mission_id: mission.id, text: p.text, ts: date !== today() ? date : undefined } })
    const ok = { temps: `${dur(p.minutes || 0)} sur ${label}`, chrono: `Chrono démarré sur ${label}`, action: 'Action créée', journal: 'Ajouté au journal' }[mode]
    const r = await run(call, ok)
    if (r !== undefined) onClose()
  }

  return (
    <Modal title="Saisie rapide" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Seg value={mode} onChange={onMode} options={MODES} />
        <input ref={input} className="input !h-10 !text-base" value={text} onChange={(e) => (setText(e.target.value), setErr(''))} placeholder={HINTS[mode]} aria-label="Saisie en langage libre" autoComplete="off" />
        {err && <p className="field-error">{err}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 sm:col-span-1"><span className="label">Mission</span>
            <select className="select" value={mission?.id ?? ''} onChange={(e) => setOv({ ...ov, mission_id: e.target.value ? Number(e.target.value) : undefined, chantier_id: undefined })} aria-invalid={!mission}>
              <option value="">— à préciser —</option>
              {open.map((m) => <option key={m.id} value={m.id}>{m.client_name} – {m.name}</option>)}
            </select>
          </label>
          {(mode === 'temps' || mode === 'chrono') && (
            <label className="col-span-2 sm:col-span-1"><span className="label">Chantier</span>
              <select className="select" value={chantierId} onChange={(e) => setOv({ ...ov, chantier_id: e.target.value })}>
                <option value="">— aucun —</option>
                {chantiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {mode === 'temps' && (
            <div><span className="label">Durée</span><div className={`num flex h-[30px] items-center rounded-md px-2 ${p.minutes ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-3'}`}>{p.minutes ? dur(p.minutes) : '—'}</div></div>
          )}
          {mode !== 'chrono' && (
            <label><span className="label">{mode === 'action' ? 'Échéance' : 'Date'}</span>
              <input type="date" className="input" value={date} onChange={(e) => setOv({ ...ov, date: e.target.value })} />
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="meta min-w-0 flex-1 truncate">
            {p.text ? <>« {p.text} »{mode === 'temps' && !p.billable && ' · non facturable'}</> : mode === 'temps' ? <>Mission, chantier, durée, puis description. « nf » = non facturable, « hier », « lundi », « 12/11 ».</> : <>Mission, puis le texte{mode === 'action' ? ' ; « vendredi » ou « 20/11 » fixe l’échéance.' : '.'}</>}
          </p>
          <button className="btn btn-primary" disabled={!ready}>{mode === 'chrono' ? 'Démarrer' : 'Enregistrer'} <span className="kbd !border-paper/40 !bg-transparent !text-paper">↵</span></button>
        </div>
      </form>
    </Modal>
  )
}

function NewMeetingModal({ missionId, onClose }: { missionId?: number; onClose: () => void }) {
  const { missions, run } = useApp()
  const nav = useNavigate()
  const open = missions.filter((m) => m.status !== 'terminee')
  return (
    <FormModal
      title="Nouvelle réunion" submitLabel="Créer et ouvrir"
      fields={[
        { name: 'mission_id', label: 'Mission', type: 'select', options: open.map((m) => [m.id, `${m.client_name} – ${m.name}`]) },
        { name: 'title', label: 'Titre', placeholder: 'Point hebdo' },
        { name: 'date', label: 'Date', type: 'date', half: true },
        { name: 'time', label: 'Heure', type: 'time', half: true },
        { name: 'participants', label: 'Participants', placeholder: 'Axel, …' },
        { name: 'prefill', label: 'Préremplir l’ordre du jour avec les actions ouvertes', type: 'checkbox' },
      ]}
      initial={{ mission_id: missionId ?? open[0]?.id, date: today(), prefill: true }}
      onClose={onClose}
      onSubmit={async (v) => {
        let agenda = ''
        if (v.prefill) {
          const acts: Row[] = await api(`/actions?mission_id=${v.mission_id}`)
          agenda = acts.map((a) => `- ${a.description}${a.owner === 'client' ? ` (${a.owner_name || 'client'})` : ''}`).join('\n')
        }
        const r = await api('/meetings', { body: { ...v, agenda } })
        run(Promise.resolve())
        nav(`/reunions/${r.id}`)
      }}
    />
  )
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl K', 'Palette : recherche et commandes'], ['T', 'Saisir du temps'], ['S', 'Démarrer / arrêter le chrono'], ['A', 'Nouvelle action'],
    ['J', 'Ligne de journal'], ['R', 'Nouvelle réunion'], ['g puis t h r a f m', 'Tableau de bord, heures, réunions, actions, facturation, missions'],
    ['1 … 9', 'Ouvrir une mission en cours'], ['Échap', 'Fermer'],
  ]
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
      <table className="table-dense"><tbody>{rows.map(([k, v]) => <tr key={k}><td className="w-40"><span className="kbd">{k}</span></td><td>{v}</td></tr>)}</tbody></table>
      <p className="meta mt-3">Saisie rapide : « tobam rlm 1h30 atelier prompts hier » → mission, chantier, durée, description, date.</p>
    </Modal>
  )
}

const TYPE_LABEL: Row = { reunion: 'Réunion', action: 'Action', journal: 'Journal', temps: 'Heures', mission: 'Mission' }

function Palette({ onClose, actions }: { onClose: () => void; actions: { meeting: () => void; stop: () => void; help: () => void } }) {
  const { missions, timer, openQuick } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Row[]>([])
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (q.trim().length < 2) return setResults([])
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => {}), 160)
    return () => clearTimeout(t)
  }, [q])

  const items = useMemo(() => {
    const go = (to: string) => () => nav(to)
    const cmds: { group: string; label: string; hint?: string; sub?: string; color?: number; run: () => void }[] = [
      { group: 'Commandes', label: 'Saisir du temps', hint: 'T', run: () => openQuick('temps') },
      { group: 'Commandes', label: timer ? 'Arrêter le chrono' : 'Démarrer le chrono', hint: 'S', run: () => (timer ? actions.stop() : openQuick('chrono')) },
      { group: 'Commandes', label: 'Nouvelle action', hint: 'A', run: () => openQuick('action') },
      { group: 'Commandes', label: 'Ligne de journal', hint: 'J', run: () => openQuick('journal') },
      { group: 'Commandes', label: 'Nouvelle réunion', hint: 'R', run: actions.meeting },
      ...missions.map((m) => ({ group: 'Missions', label: `${m.client_name} – ${m.name}`, sub: MISSION_STATUS[m.status], color: m.color, run: go(`/missions/${m.id}`) })),
      ...NAV.map(([to, label]) => ({ group: 'Aller à', label, run: go(to) })),
      { group: 'Aller à', label: 'Clients & contacts', run: go('/clients') },
      { group: 'Aller à', label: 'Réglages', run: go('/reglages') },
      { group: 'Aller à', label: 'Raccourcis clavier', hint: '?', run: actions.help },
    ]
    const k = norm(q)
    const filtered = k ? cmds.filter((c) => k.split(/\s+/).every((t) => norm(c.label).includes(t))) : cmds
    const found = results.map((r) => ({
      group: 'Résultats', label: r.title || '(sans texte)', sub: `${TYPE_LABEL[r.type]} · ${r.client_name} · ${dMed(r.date)}`, snippet: r.snippet as string, color: r.mission_color as number,
      run: go(r.type === 'reunion' ? `/reunions/${r.id}` : r.type === 'temps' ? `/heures?date=${r.date}` : `/missions/${r.mission_id}${r.type === 'journal' ? '?onglet=journal' : r.type === 'action' ? '?onglet=actions' : ''}`),
    }))
    return [...filtered, ...found] as (typeof cmds[number] & { snippet?: string })[]
  }, [q, results, missions, timer, nav, openQuick, actions])

  useEffect(() => setSel(0), [q])
  useEffect(() => list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }), [sel])
  const choose = (i: number) => { const it = items[i]; if (it) { onClose(); it.run() } }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-overlay sm:p-6 sm:pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Palette de commandes" className="flex h-full w-full flex-col overflow-hidden border-line-strong bg-surface shadow-pop sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-xl sm:border">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={16} className="text-ink-3" />
          <input autoFocus className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3" placeholder="Chercher dans les notes, actions, journal… ou lancer une commande" value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), choose(sel))
              else if (e.key === 'Escape') onClose()
            }} />
          <button className="kbd" onClick={onClose}>Échap</button>
        </div>
        <div ref={list} className="flex-1 overflow-y-auto p-1.5">
          {items.map((it, i) => (
            <div key={i}>
              {(i === 0 || items[i - 1].group !== it.group) && <p className="title-block px-2 pb-1 pt-2">{it.group}</p>}
              <button aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => choose(i)} style={it.color ? mc(it.color) : undefined}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left ${i === sel ? 'bg-accent-soft' : ''}`}>
                {it.color ? <i className="dot mt-1.5" /> : <span className="w-2" />}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2">{it.label}</span>
                  {it.snippet && <span className="meta line-clamp-2">{it.snippet}</span>}
                </span>
                {it.sub && <span className="meta flex-none">{it.sub}</span>}
                {it.hint && <span className="kbd">{it.hint}</span>}
              </button>
            </div>
          ))}
          {!items.length && <p className="empty">Aucun résultat pour « {q} ».</p>}
        </div>
      </div>
    </div>
  )
}
