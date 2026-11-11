import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addDays, api, dFull, dMed, days, dur, euro, mc, monthBounds, today, useApp, useData, type Row } from '../lib'
import { Chip, Empty, FormModal, Meter, PageHead, State } from '../ui'

export function Billing() {
  const { missions, run } = useApp()
  const billable = missions.filter((m) => m.unbilled_minutes > 0 || m.status === 'en_cours')
  const lastMonth = monthBounds(addDays(monthBounds(today())[0], -1))
  const [missionId, setMissionId] = useState<number | ''>('')
  const [from, setFrom] = useState(lastMonth[0])
  const [to, setTo] = useState(lastMonth[1])
  const [edit, setEdit] = useState<Row | null>(null)
  const mid = missionId || billable.find((m) => m.unbilled_minutes > 0)?.id || billable[0]?.id
  const pv = useData(mid ? `/invoices/preview?mission_id=${mid}&from=${from}&to=${to}` : null)
  const inv = useData('/invoices')
  const preset = (r: [string, string]) => (setFrom(r[0]), setTo(r[1]))

  return (
    <>
      <PageHead title="Facturation" sub="Période → récapitulatif → facture" />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <section className="card">
          <div className="card-head flex-wrap">
            <span className="title-block">Préparer une facture</span>
            <div className="flex gap-1.5">
              <button className="btn btn-sm" onClick={() => preset(lastMonth)}>Mois dernier</button>
              <button className="btn btn-sm" onClick={() => preset(monthBounds(today()))}>Ce mois</button>
              <button className="btn btn-sm" onClick={() => preset(['2000-01-01', today()])}>Tout le non-facturé</button>
            </div>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_150px_150px]">
              <label className="col-span-2 sm:col-span-1"><span className="label">Mission</span>
                <select className="select" value={mid ?? ''} onChange={(e) => setMissionId(Number(e.target.value))}>
                  {billable.map((m) => <option key={m.id} value={m.id}>{m.client_name} – {m.name}{m.unbilled_minutes ? ` (${dur(m.unbilled_minutes)} à facturer)` : ''}</option>)}
                </select>
              </label>
              <label><span className="label">Du</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label><span className="label">Au</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            {mid ? (
              <State q={pv}>
                {(p) => (
                  <div className="mt-4">
                    {p.entries.length ? (
                      <>
                        <table className="table-dense">
                          <thead><tr><th>Prestation</th><th className="num">Temps</th><th className="num">Quantité</th><th className="num">Taux</th><th className="num">Montant HT</th></tr></thead>
                          <tbody>{p.lines.map((l: Row) => <tr key={l.label}><td>{l.label}</td><td className="num">{dur(l.minutes)}</td><td className="num">{l.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} {l.unit}{l.quantity > 1 ? 's' : ''}</td><td className="num">{euro(l.rate)}</td><td className="num">{euro(l.amount, 2)}</td></tr>)}</tbody>
                          <tfoot><tr><td>Total · {p.entries.length} entrée{p.entries.length > 1 ? "s" : ""}</td><td className="num">{dur(p.minutes)}</td><td className="num">{days(p.minutes, p.mission.hours_per_day)}</td><td /><td className="num">{euro(p.amount, 2)}</td></tr></tfoot>
                        </table>
                        <details className="mt-3"><summary className="meta cursor-pointer">Détail des entrées ({p.entries.length})</summary>
                          <ul className="mt-2 space-y-0.5 text-sm">{p.entries.map((e: Row) => <li key={e.id} className="flex gap-3"><span className="num w-16 text-xs text-ink-3">{dMed(e.date)}</span><span className="num w-14">{dur(e.minutes)}</span><span className="w-32 truncate text-ink-2">{e.chantier_name || '—'}</span><span className="min-w-0 flex-1 truncate">{e.description}</span></li>)}</ul>
                        </details>
                        {p.mission.billing_type === 'temps' && !p.mission.rate && <p className="banner-error mt-3">Aucun taux sur cette mission : renseigne le TJM pour calculer le montant.</p>}
                      </>
                    ) : <Empty>Aucune heure facturable non facturée sur cette période{p.mission.billing_type === 'forfait' && ' (mission au forfait : tu peux créer une facture d’un montant libre)'}.</Empty>}
                    <div className="mt-3 flex justify-end">
                      <button className="btn btn-primary" disabled={!p.entries.length && p.mission.billing_type !== 'forfait'}
                        onClick={() => setEdit({ _new: true, mission_id: mid, from, to, amount: p.amount || p.mission.fixed_price || '', issued_date: today() })}>Créer la facture…</button>
                    </div>
                  </div>
                )}
              </State>
            ) : <Empty>Crée d’abord une mission.</Empty>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><span className="title-block">Chiffre d’affaires {inv.data?.revenue.year}</span></div>
          <div className="card-body">
            <State q={inv} rows={3}>
              {({ revenue: r }) => (
                <>
                  <p className="num text-3xl font-semibold">{euro(r.paid)}</p>
                  <p className="meta">encaissés{r.ceiling > 0 && <> sur un plafond de {euro(r.ceiling)}</>}</p>
                  {r.ceiling > 0 && <div className="mt-3"><Meter pct={r.paid / r.ceiling} /><p className="meta mt-1.5">{Math.round((r.paid / r.ceiling) * 100)} % du plafond micro-entrepreneur · reste {euro(r.ceiling - r.paid)}</p></div>}
                  <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                    <div className="flex justify-between"><dt className="text-ink-2">Facturé, en attente de paiement</dt><dd className="num">{euro(r.pending)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-2">Travaillé, pas encore facturé</dt><dd className="num">{euro(r.unbilled)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt>Projection</dt><dd className="num">{euro(r.paid + r.pending + r.unbilled)}</dd></div>
                  </dl>
                  <p className="meta mt-3">Plafond et seuil de franchise de TVA à vérifier chaque année (réglages).</p>
                </>
              )}
            </State>
          </div>
        </section>
      </div>

      <section className="card mt-4 overflow-x-auto">
        <div className="card-head"><span className="title-block">Factures</span></div>
        <State q={inv}>
          {({ invoices }) => invoices.length ? (
            <table className="table-dense">
              <thead><tr><th>N°</th><th>Mission</th><th>Période</th><th className="num">Temps</th><th className="num">Montant HT</th><th>Émise</th><th>État</th><th /></tr></thead>
              <tbody>
                {invoices.map((i: Row) => {
                  const lateDays = i.sent_date && !i.paid_date ? Math.round((Date.parse(today()) - Date.parse(i.sent_date)) / 86400000) : 0
                  return (
                    <tr key={i.id} style={mc(i.mission_color)}>
                      <td><Link to={`/factures/${i.id}`} className="font-semibold underline">{i.number}</Link></td>
                      <td><Chip m={i} /></td><td className="whitespace-nowrap">{dMed(i.period_start)} → {dMed(i.period_end)}</td>
                      <td className="num">{dur(i.minutes)}</td><td className="num">{euro(i.amount, 2)}</td><td className="whitespace-nowrap">{dMed(i.issued_date)}</td>
                      <td>{i.paid_date ? <span className="badge badge-ok">Payée {dMed(i.paid_date)}</span> : i.sent_date ? <span className={`badge ${lateDays > 30 ? 'badge-late' : 'badge-warn'}`}>Envoyée · J+{lateDays}</span> : <span className="badge">Brouillon</span>}</td>
                      <td className="whitespace-nowrap text-right">
                        {!i.sent_date && <button className="btn btn-sm mr-1" onClick={() => run(api(`/invoices/${i.id}`, { method: 'PATCH', body: { sent_date: today() } }), 'Marquée envoyée')}>Envoyée</button>}
                        {!i.paid_date && <button className="btn btn-sm mr-1" onClick={() => run(api(`/invoices/${i.id}`, { method: 'PATCH', body: { paid_date: today(), sent_date: i.sent_date || today() } }), 'Marquée payée')}>Payée</button>}
                        <button className="btn btn-sm btn-ghost" onClick={() => setEdit(i)}>Modifier</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <Empty>Aucune facture pour l’instant.</Empty>}
        </State>
      </section>

      {edit && (edit._new ? (
        <FormModal title="Créer la facture" submitLabel="Créer" onClose={() => setEdit(null)} initial={edit}
          fields={[
            { name: 'number', label: 'Numéro', half: true, placeholder: 'automatique (AAAA-NNN)' },
            { name: 'issued_date', label: 'Date d’émission', type: 'date', half: true },
            { name: 'amount', label: 'Montant HT (€)', type: 'number', half: true },
            { name: 'notes', label: 'Notes (bon de commande, référence…)', type: 'textarea' },
          ]}
          onSubmit={async (v) => { await api('/invoices', { body: { ...v, mission_id: edit.mission_id, from: edit.from, to: edit.to } }); run(Promise.resolve(), 'Facture créée : les heures sont marquées « facturé »') }} />
      ) : (
        <FormModal title={`Facture ${edit.number}`} onClose={() => setEdit(null)} initial={edit}
          fields={[
            { name: 'number', label: 'Numéro', half: true, required: true }, { name: 'amount', label: 'Montant HT (€)', type: 'number', half: true },
            { name: 'issued_date', label: 'Émise le', type: 'date', half: true }, { name: 'sent_date', label: 'Envoyée le', type: 'date', half: true },
            { name: 'paid_date', label: 'Payée le', type: 'date', half: true }, { name: 'notes', label: 'Notes', type: 'textarea' },
          ]}
          onSubmit={async (v) => { await api(`/invoices/${edit.id}`, { method: 'PATCH', body: v }); run(Promise.resolve()) }}
          onDelete={async () => { await api(`/invoices/${edit.id}`, { method: 'DELETE' }); run(Promise.resolve(), 'Facture supprimée : les heures redeviennent « à facturer »') }} />
      ))}
    </>
  )
}

/** Facture imprimable (Ctrl+P → PDF). */
export function InvoicePage() {
  const { id } = useParams()
  const q = useData(`/invoices/${id}`)
  return (
    <div className="mx-auto max-w-[820px] p-4">
      <div className="no-print mb-4 flex items-center gap-2">
        <Link to="/facturation" className="btn btn-ghost">← Facturation</Link><span className="flex-1" />
        <button className="btn btn-primary" onClick={() => window.print()}><Printer size={14} /> Imprimer / PDF</button>
      </div>
      <State q={q} rows={10}>
        {(i) => {
          const s = i.settings
          const missing = !s.owner_name || !s.owner_siret
          return (
            <>
              {missing && <p className="banner-error no-print mb-3">Renseigne ton nom, ton adresse et ton SIRET dans les <Link className="underline" to="/reglages">réglages</Link> : ce sont des mentions obligatoires.</p>}
              <article className="print-page card bg-surface p-10 text-[13px] leading-relaxed">
                <header className="flex justify-between gap-6">
                  <div>
                    <p className="font-serif text-xl font-semibold">{s.owner_name || 'Votre nom'}</p>
                    <p className="whitespace-pre-line text-ink-2">{s.owner_address}</p>
                    {s.owner_siret && <p className="text-ink-2">SIRET : {s.owner_siret}</p>}
                    {s.owner_email && <p className="text-ink-2">{s.owner_email}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-2xl font-semibold">Facture {i.number}</p>
                    <p>Émise le {dFull(i.issued_date)}</p>
                    <p className="text-ink-2">Prestations du {dFull(i.period_start)} au {dFull(i.period_end)}</p>
                  </div>
                </header>
                <section className="mt-8 ml-auto w-1/2">
                  <p className="title-block">Destinataire</p>
                  <p className="font-semibold">{i.client.name}</p>
                  <p className="whitespace-pre-line">{i.client.billing_address}</p>
                  {i.client.siret && <p>SIRET : {i.client.siret}</p>}
                </section>
                <p className="mt-8"><b>Objet :</b> {i.mission.name}</p>
                <table className="table-dense mt-3">
                  <thead><tr><th>Désignation</th><th className="num">Quantité</th><th className="num">Prix unitaire HT</th><th className="num">Montant HT</th></tr></thead>
                  <tbody>
                    {i.lines.length && i.mission.billing_type === 'temps' ? i.lines.map((l: Row) => (
                      <tr key={l.label}><td>{l.label}</td><td className="num">{l.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} {l.unit}{l.quantity > 1 ? 's' : ''}</td><td className="num">{euro(l.rate, 2)}</td><td className="num">{euro(l.amount, 2)}</td></tr>
                    )) : <tr><td>{i.mission.name}{i.notes ? ` — ${i.notes}` : ''}</td><td className="num">1</td><td className="num">{euro(i.amount, 2)}</td><td className="num">{euro(i.amount, 2)}</td></tr>}
                  </tbody>
                  <tfoot><tr><td colSpan={3}>Total HT</td><td className="num">{euro(i.amount, 2)}</td></tr><tr><td colSpan={3} className="!border-0 font-normal">{s.vat_mention}</td><td className="num !border-0">Net à payer : {euro(i.amount, 2)}</td></tr></tfoot>
                </table>
                {Math.abs(i.lines.reduce((x: number, l: Row) => x + l.amount, 0) - i.amount) > 0.01 && i.mission.billing_type === 'temps' && <p className="no-print banner-error mt-3">Le montant de la facture ({euro(i.amount, 2)}) diffère de la somme des lignes : il a été saisi à la main.</p>}
                <footer className="mt-10 space-y-1 text-ink-2">
                  {i.notes && i.mission.billing_type === 'temps' && <p>{i.notes}</p>}
                  <p>{s.payment_terms}</p>
                  {s.owner_iban && <p>IBAN : {s.owner_iban}</p>}
                  <p className="text-xs">En cas de retard de paiement : pénalités au taux légal en vigueur et indemnité forfaitaire de 40 € pour frais de recouvrement.</p>
                </footer>
              </article>
            </>
          )
        }}
      </State>
    </div>
  )
}
