import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ACTION_STATUS, api, dMed, dRel, mc, renderMd, today, useApp, type Row } from './lib'

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-overlay p-0 sm:p-6 sm:pt-[9vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} min-h-full sm:min-h-0 bg-surface sm:rounded-xl sm:border border-line-strong shadow-pop`}>
        <div className="card-head">
          <b className="font-serif text-lg">{title}</b>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export interface Field {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'checkbox'
  options?: [string | number, string][]
  placeholder?: string
  half?: boolean
  required?: boolean
  hint?: string
  mono?: boolean
}

export function FormModal({ title, fields, initial, onSubmit, onClose, onDelete, submitLabel = 'Enregistrer' }: {
  title: string; fields: Field[]; initial?: Row; onSubmit: (values: Row) => Promise<unknown>; onClose: () => void; onDelete?: () => Promise<unknown>; submitLabel?: string
}) {
  const [v, setV] = useState<Row>(() => ({ ...initial }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const first = useRef<HTMLFormElement>(null)
  useEffect(() => {
    first.current?.querySelector<HTMLElement>('input,select,textarea')?.focus()
  }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const out: Row = {}
      for (const f of fields) {
        const val = v[f.name]
        out[f.name] = f.type === 'number' ? (val === '' || val == null ? null : Number(val)) : f.type === 'checkbox' ? !!val : val ?? ''
      }
      await onSubmit(out)
      onClose()
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form ref={first} onSubmit={submit} className="grid grid-cols-2 gap-x-3 gap-y-3">
        {err && <div className="banner-error col-span-2">{err}</div>}
        {fields.map((f) => {
          const common = { id: 'f-' + f.name, required: f.required, placeholder: f.placeholder, value: v[f.name] ?? '', onChange: (e: any) => setV({ ...v, [f.name]: e.target.value }) }
          return (
            <div key={f.name} className={f.half ? 'col-span-1' : 'col-span-2'}>
              {f.type === 'checkbox' ? (
                <label className="flex h-[30px] items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} /> {f.label}
                </label>
              ) : (
                <>
                  <label className="label" htmlFor={common.id}>{f.label}</label>
                  {f.type === 'select' ? (
                    <select className="select" {...common}>{f.options!.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}</select>
                  ) : f.type === 'textarea' ? (
                    <textarea className={`textarea ${f.mono ? 'textarea-notes' : ''}`} {...common} />
                  ) : (
                    <input className="input" type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} {...common} />
                  )}
                  {f.hint && <p className="meta mt-1">{f.hint}</p>}
                </>
              )}
            </div>
          )
        })}
        <div className="col-span-2 mt-1 flex items-center gap-2">
          {onDelete && (
            <button type="button" className="btn btn-danger" onClick={async () => {
              if (!confirm('Supprimer définitivement ?')) return
              try { await onDelete(); onClose() } catch (e: any) { setErr(e.message) }
            }}>Supprimer</button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

export const Chip = ({ m, link = true }: { m: { mission_id?: number; id?: number; mission_name?: string; name?: string; mission_color?: number; color?: number; client_name?: string }; link?: boolean }) => {
  const inner = (
    <span className="chip-mission max-w-full" style={mc(m.mission_color ?? m.color)} title={`${m.client_name} – ${m.mission_name ?? m.name}`}>
      <i className="dot" /> <span className="truncate">{m.client_name}</span>
    </span>
  )
  return link ? <Link to={`/missions/${m.mission_id ?? m.id}`} className="min-w-0">{inner}</Link> : inner
}

export function Meter({ pct, color, mark }: { pct: number; color?: number; mark?: number }) {
  const cls = pct >= 1 ? 'meter-late' : pct >= 0.8 ? 'meter-warn' : ''
  return (
    <div className={`meter ${cls}`} style={color ? mc(color) : undefined} role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
      {mark != null && mark > 0 && mark < 1 && <i className="absolute top-0 h-full w-px bg-ink" style={{ left: `${mark * 100}%` }} title="Attendu à date" />}
    </div>
  )
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-md border border-line-strong p-0.5" role="tablist">
      {options.map(([val, label]) => (
        <button key={val} role="tab" aria-selected={val === value} onClick={() => onChange(val)}
          className={`h-6 rounded-sm px-2 text-xs font-medium ${val === value ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-sunken'}`}>{label}</button>
      ))}
    </div>
  )
}

export function State({ q, children, rows = 4 }: { q: { data: any; error: string | null; loading: boolean; reload: () => void }; children: (data: any) => ReactNode; rows?: number }) {
  if (q.error && !q.data) return <div className="banner-error">{q.error} <button className="btn btn-sm ml-auto" onClick={q.reload}>Réessayer</button></div>
  if (!q.data) return <div className="space-y-2 p-1" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-7" style={{ width: `${90 - i * 12}%` }} />)}</div>
  return <>{children(q.data)}</>
}

export function Md({ src, className = '' }: { src?: string | null; className?: string }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    let alive = true
    renderMd(src || '').then((h) => alive && setHtml(h))
    return () => { alive = false }
  }, [src])
  return <div className={`prose-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export const Empty = ({ children }: { children: ReactNode }) => <p className="empty">{children}</p>

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <h1 className="title-page">{title}</h1>
        {sub && <p className="meta mt-1">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  )
}

/** Case d'action : vide = à faire, à moitié = en cours, pointillée = en attente, pleine = fait. */
export function ActionCheck({ a }: { a: Row }) {
  const { run } = useApp()
  const done = a.status === 'fait'
  return (
    <button
      aria-label={done ? 'Rouvrir' : 'Marquer fait'} title={`${ACTION_STATUS[a.status]} — cliquer pour ${done ? 'rouvrir' : 'marquer fait'}`}
      onClick={(e) => { e.stopPropagation(); run(api(`/actions/${a.id}`, { method: 'PATCH', body: { status: done ? 'a_faire' : 'fait' } }), done ? undefined : 'Action terminée') }}
      className={`relative mt-[3px] grid h-4 w-4 flex-none place-items-center overflow-hidden rounded-sm border ${a.status === 'en_attente' ? 'border-dashed' : ''} ${done ? 'border-ok bg-ok text-surface' : 'border-ink-3 hover:border-accent'}`}>
      {done && <Check size={12} strokeWidth={3} />}
      {a.status === 'en_cours' && <i className="absolute inset-y-0 left-0 w-1/2 bg-ink-3" />}
    </button>
  )
}

export function ActionRow({ a, showMission = true, onEdit }: { a: Row; showMission?: boolean; onEdit?: (a: Row) => void }) {
  const late = a.status !== 'fait' && a.due_date && a.due_date < today()
  return (
    <div className="group flex items-start gap-2.5 border-b border-line px-1 py-1.5 last:border-0">
      <ActionCheck a={a} />
      <button className="min-w-0 flex-1 text-left" onClick={() => onEdit?.(a)}>
        <span className={a.status === 'fait' ? 'text-ink-3 line-through' : ''}>{a.description}</span>
        <span className="meta ml-2 whitespace-nowrap">
          {a.owner === 'client' && <span className="badge badge-outline mr-1.5">{a.owner_name || 'Client'}</span>}
          {a.status === 'en_attente' && 'en attente · '}
          {a.status === 'en_cours' && 'en cours · '}
          {a.meeting_title && <span title={`Issue de la réunion « ${a.meeting_title} »`}>↳ {a.meeting_title}</span>}
        </span>
      </button>
      {showMission && <Chip m={a} />}
      {a.due_date && <span className={`num w-20 flex-none text-right text-xs ${late ? 'font-semibold text-late' : 'text-ink-3'}`} title={dMed(a.due_date)}>{dRel(a.due_date)}</span>}
    </div>
  )
}

export function actionFields(missions: Row[], withMission = true): Field[] {
  return [
    ...(withMission ? [{ name: 'mission_id', label: 'Mission', type: 'select', options: missions.map((m) => [m.id, `${m.client_name} – ${m.name}`]) } as Field] : []),
    { name: 'description', label: 'Action', required: true },
    { name: 'owner', label: 'Responsable', type: 'select', options: [['moi', 'Moi'], ['client', 'Le client']], half: true },
    { name: 'owner_name', label: 'Nom (si client)', placeholder: 'Axel', half: true },
    { name: 'due_date', label: 'Échéance', type: 'date', half: true },
    { name: 'status', label: 'Statut', type: 'select', options: Object.entries(ACTION_STATUS) as [string, string][], half: true },
  ]
}

export function ActionModal({ action, onClose, missionId }: { action?: Row; onClose: () => void; missionId?: number }) {
  const { missions, run } = useApp()
  const list = missions.filter((m) => m.status !== 'terminee' || m.id === action?.mission_id)
  return (
    <FormModal
      title={action ? 'Modifier l’action' : 'Nouvelle action'}
      fields={actionFields(list)}
      initial={action || { mission_id: missionId ?? list[0]?.id, owner: 'moi', status: 'a_faire' }}
      onClose={onClose}
      onSubmit={async (v) => { await api(action ? `/actions/${action.id}` : '/actions', { method: action ? 'PATCH' : 'POST', body: v }); run(Promise.resolve()) }}
      onDelete={action ? async () => { await api(`/actions/${action.id}`, { method: 'DELETE' }); run(Promise.resolve()) } : undefined}
    />
  )
}

export function TimeModal({ entry, onClose }: { entry: Row; onClose: () => void }) {
  const { missions, run } = useApp()
  const m = missions.find((x) => x.id === entry.mission_id)
  const locked = !!entry.invoice_id
  return (
    <FormModal
      title={locked ? `Entrée facturée (${entry.invoice_number})` : 'Modifier l’entrée de temps'}
      fields={[
        ...(locked ? [] : [
          { name: 'date', label: 'Date', type: 'date', half: true, required: true },
          { name: 'duration', label: 'Durée', half: true, required: true, hint: '1h30, 45m, 2.5, 0.5j' },
          { name: 'chantier_id', label: 'Chantier', type: 'select', options: [['', '— Sans chantier —'], ...(m?.chantiers || []).map((c: Row) => [c.id, c.name])] },
        ] as Field[]),
        { name: 'description', label: 'Description', type: 'textarea' },
        ...(locked ? [] : [{ name: 'billable', label: 'Facturable', type: 'checkbox' } as Field]),
      ]}
      initial={{ ...entry, duration: `${Math.floor(entry.minutes / 60)}h${String(entry.minutes % 60).padStart(2, '0')}`, chantier_id: entry.chantier_id ?? '', billable: !!entry.billable }}
      onClose={onClose}
      onSubmit={async (v) => { await api(`/time/${entry.id}`, { method: 'PATCH', body: v }); run(Promise.resolve()) }}
      onDelete={locked ? undefined : async () => { await api(`/time/${entry.id}`, { method: 'DELETE' }); run(Promise.resolve()) }}
    />
  )
}
