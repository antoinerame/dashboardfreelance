import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ACTION_STATUS, addDays, api, dRel, mc, today, useApp, useData, weekStart, type Row } from '../lib'
import { ActionModal, ActionRow, Chip, Empty, PageHead, Seg, State } from '../ui'

export default function Actions() {
  const { missions, run } = useApp()
  const [owner, setOwner] = useState<'moi' | 'client' | 'tous'>('moi')
  const [status, setStatus] = useState<'ouvertes' | 'toutes'>('ouvertes')
  const [mission, setMission] = useState<number | null>(null)
  const [view, setView] = useState<'liste' | 'kanban'>(() => (localStorage.getItem('actions-vue') as any) || 'liste')
  const [edit, setEdit] = useState<Row | 'new' | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const kanban = view === 'kanban'
  const q = useData<Row[]>(`/actions?status=${kanban ? 'toutes' : status}${owner !== 'tous' ? `&owner=${owner}` : ''}${mission ? `&mission_id=${mission}` : ''}`)

  const t = today()
  const endWeek = addDays(weekStart(t), 6)
  const groups = (list: Row[]): [string, Row[], string][] => {
    const open = list.filter((a) => a.status !== 'fait')
    return [
      ['En retard', open.filter((a) => a.due_date && a.due_date < t), 'text-late'],
      ['Cette semaine', open.filter((a) => a.due_date && a.due_date >= t && a.due_date <= endWeek), ''],
      ['Plus tard', open.filter((a) => a.due_date && a.due_date > endWeek), ''],
      ['Sans échéance', open.filter((a) => !a.due_date), ''],
      ['Terminées', list.filter((a) => a.status === 'fait').sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 60), 'text-ink-3'],
    ]
  }

  return (
    <>
      <PageHead title="Actions" sub="Ce qui reste à faire, et ce que j’attends des clients">
        <Seg value={owner} onChange={setOwner} options={[['moi', 'À moi'], ['client', 'Côté client'], ['tous', 'Toutes']]} />
        {!kanban && <Seg value={status} onChange={setStatus} options={[['ouvertes', 'Ouvertes'], ['toutes', 'Avec terminées']]} />}
        <Seg value={view} onChange={(v) => (localStorage.setItem('actions-vue', v), setView(v))} options={[['liste', 'Liste'], ['kanban', 'Kanban']]} />
        <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={15} /> Action <span className="kbd !border-paper/40 !bg-transparent !text-paper">A</span></button>
      </PageHead>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button className={`badge ${mission === null ? '!bg-ink !text-paper' : 'badge-outline'}`} onClick={() => setMission(null)}>Toutes les missions</button>
        {missions.filter((m) => m.open_actions > 0 || m.id === mission).map((m) => (
          <button key={m.id} style={mc(m.color)} className={`chip-mission ${mission === m.id ? 'outline outline-2 outline-ink' : ''}`} onClick={() => setMission(mission === m.id ? null : m.id)}><i className="dot" />{m.client_name} <span className="num text-ink-3">{m.open_actions}</span></button>
        ))}
      </div>

      <State q={q} rows={8}>
        {(list: Row[]) => kanban ? (
          <div className="grid gap-3 md:grid-cols-4">
            {Object.entries(ACTION_STATUS).map(([st, label]) => {
              const col = list.filter((a) => a.status === st).slice(0, st === 'fait' ? 15 : 200)
              return (
                <section key={st} className="card min-h-40 bg-sunken/40" onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (drag) run(api(`/actions/${drag}`, { method: 'PATCH', body: { status: st } })); setDrag(null) }}>
                  <div className="card-head"><span className="title-block">{label}</span><span className="num text-xs text-ink-3">{col.length}</span></div>
                  <div className="space-y-2 p-2">
                    {col.map((a) => (
                      <article key={a.id} draggable onDragStart={() => setDrag(a.id)} onClick={() => setEdit(a)} className="card cursor-grab p-2.5 shadow-raise active:cursor-grabbing">
                        <p className={st === 'fait' ? 'text-ink-3 line-through' : ''}>{a.description}</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Chip m={a} link={false} />{a.owner === 'client' && <span className="badge badge-outline">{a.owner_name || 'Client'}</span>}
                          {a.due_date && <span className={`num ml-auto text-xs ${st !== 'fait' && a.due_date < t ? 'font-semibold text-late' : 'text-ink-3'}`}>{dRel(a.due_date)}</span>}
                        </div>
                        <select className="select mt-2 !h-6 !text-xs md:hidden" value={a.status} onClick={(e) => e.stopPropagation()} onChange={(e) => run(api(`/actions/${a.id}`, { method: 'PATCH', body: { status: e.target.value } }))} aria-label="Statut">
                          {Object.entries(ACTION_STATUS).map(([k, l]) => <option key={k} value={k}>{l as string}</option>)}
                        </select>
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="card card-body">
            {groups(list).filter(([, items]) => items.length).map(([label, items, cls]) => (
              <div key={label} className="mb-4 last:mb-0">
                <h2 className={`mb-1 font-serif text-lg font-semibold ${cls}`}>{label} <span className="num text-sm font-normal text-ink-3">{items.length}</span></h2>
                {items.map((a) => <ActionRow key={a.id} a={a} onEdit={setEdit} />)}
              </div>
            ))}
            {!list.length && <Empty>{owner === 'moi' ? 'Rien à faire de ton côté. ' : 'Aucune action. '}A pour en créer une.</Empty>}
          </div>
        )}
      </State>
      {edit && <ActionModal action={edit === 'new' ? undefined : edit} missionId={mission ?? undefined} onClose={() => setEdit(null)} />}
    </>
  )
}
