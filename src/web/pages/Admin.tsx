import { Download, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, copy, useApp, useData, type Row } from '../lib'
import { Empty, FormModal, PageHead, Seg, State, type Field } from '../ui'

const CLIENT_FIELDS: Field[] = [
  { name: 'name', label: 'Nom', required: true },
  { name: 'contact_name', label: 'Contact principal', half: true }, { name: 'email', label: 'Courriel', half: true },
  { name: 'billing_address', label: 'Adresse de facturation', type: 'textarea' },
  { name: 'siret', label: 'SIRET', half: true }, { name: 'notes', label: 'Notes', type: 'textarea' },
]
const CONTACT_FIELDS: Field[] = [
  { name: 'name', label: 'Nom', required: true, half: true }, { name: 'role', label: 'Rôle', half: true, placeholder: 'Responsable data' },
  { name: 'email', label: 'Courriel', half: true }, { name: 'phone', label: 'Téléphone', half: true }, { name: 'notes', label: 'Notes', type: 'textarea' },
]

export function Clients() {
  const q = useData<Row[]>('/clients')
  const { changed } = useApp()
  const [client, setClient] = useState<Row | 'new' | null>(null)
  const [contact, setContact] = useState<Row | null>(null)
  const save = (path: string, cur?: Row) => async (v: Row) => { await api(cur?.id ? `${path}/${cur.id}` : path, { method: cur?.id ? 'PATCH' : 'POST', body: { ...cur, ...v } }); changed() }
  const del = (path: string, id: number) => async () => { await api(`${path}/${id}`, { method: 'DELETE' }); changed() }
  return (
    <>
      <PageHead title="Clients & contacts"><button className="btn btn-primary" onClick={() => setClient('new')}><Plus size={15} /> Client</button></PageHead>
      <State q={q}>
        {(list: Row[]) => list.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((c) => (
              <section key={c.id} className="card">
                <div className="card-head"><b className="font-serif text-lg">{c.name}</b><span className="meta flex-1">{c.mission_count} mission{c.mission_count > 1 ? 's' : ''}</span><button className="btn btn-sm" onClick={() => setClient(c)}>Modifier</button></div>
                <div className="card-body">
                  {(c.billing_address || c.siret) && <p className="meta mb-2 whitespace-pre-line">{c.billing_address}{c.siret && `\nSIRET ${c.siret}`}</p>}
                  {c.notes && <p className="mb-2 text-sm text-ink-2">{c.notes}</p>}
                  <p className="title-block mb-1">Contacts</p>
                  {c.contacts.map((p: Row) => (
                    <button key={p.id} className="flex w-full flex-wrap items-baseline gap-x-2 border-b border-line py-1.5 text-left last:border-0 hover:bg-sunken/50" onClick={() => setContact(p)}>
                      <b>{p.name}</b>{p.role && <span className="text-ink-2">{p.role}</span>}<span className="meta ml-auto">{[p.email, p.phone].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                  <button className="meta mt-1.5 underline" onClick={() => setContact({ client_id: c.id })}>+ Ajouter un contact</button>
                </div>
              </section>
            ))}
          </div>
        ) : <div className="card"><Empty>Aucun client. Ils sont créés avec la première mission, ou ici.</Empty></div>}
      </State>
      {client && <FormModal title={client === 'new' ? 'Nouveau client' : client.name} fields={CLIENT_FIELDS} initial={client === 'new' ? {} : client} onClose={() => setClient(null)}
        onSubmit={save('/clients', client === 'new' ? undefined : client)} onDelete={client !== 'new' ? del('/clients', client.id) : undefined} />}
      {contact && <FormModal title={contact.id ? contact.name : 'Nouveau contact'} fields={CONTACT_FIELDS} initial={contact} onClose={() => setContact(null)}
        onSubmit={save('/contacts', contact)} onDelete={contact.id ? del('/contacts', contact.id) : undefined} />}
    </>
  )
}

const SETTING_FIELDS: [string, string, string?][] = [
  ['owner_name', 'Nom / raison sociale (sur les factures)'], ['owner_siret', 'SIRET'], ['owner_email', 'Courriel'], ['owner_iban', 'IBAN'],
  ['micro_ceiling', 'Plafond de CA micro-entrepreneur (€)', 'À vérifier chaque année selon ton activité. 0 pour masquer la jauge.'],
  ['payment_terms', 'Conditions de paiement'], ['vat_mention', 'Mention de TVA'],
  ['vat_exemption', 'Nature de l’exonération de TVA (Qonto)'],
  ['invoice_prefix', 'Préfixe des numéros de facture', 'Ex. « F- » pour F-2026-001.'],
  ['invoice_line_label', 'Titre des lignes de facture', 'Une ligne par mois. {mois} → « Mars 2026 » ; aussi {mission} et {client}.'],
  ['due_days', 'Délai de paiement (jours)'],
  ['due_end_of_month', 'Échéance en fin de mois', '1 = oui (30 jours fin de mois : émise le 18/03 → échéance le 30/04), 0 = non.'],
]

export function SettingsPage() {
  const q = useData('/settings')
  const { toast, changed } = useApp()
  const [v, setV] = useState<Row | null>(null)
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => (localStorage.getItem('theme') as any) || 'auto')
  useEffect(() => { if (q.data && !v) setV(q.data.settings) }, [q.data]) // eslint-disable-line
  const applyTheme = (t: 'auto' | 'light' | 'dark') => {
    setTheme(t)
    if (t === 'auto') { localStorage.removeItem('theme'); delete document.documentElement.dataset.theme } else { localStorage.setItem('theme', t); document.documentElement.dataset.theme = t }
  }
  const url = `${location.origin}/mcp`
  const token = q.data?.mcp_token || ''
  const cmd = `claude mcp add --transport http suivi-freelance ${url} --header "Authorization: Bearer ${token}"`
  const cp = async (t: string, what: string) => toast((await copy(t)) ? `${what} copié` : 'Copie impossible')

  return (
    <>
      <PageHead title="Réglages" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="card">
          <div className="card-head"><span className="title-block">Identité & facturation</span></div>
          <form className="card-body space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await api('/settings', { method: 'PUT', body: v }); toast('Réglages enregistrés'); changed() } catch (err: any) { toast(err.message, 'error') } }}>
            {v ? (
              <>
                {SETTING_FIELDS.slice(0, 1).map(([k, label]) => <label key={k} className="block"><span className="label">{label}</span><input className="input" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>)}
                <label className="block"><span className="label">Adresse</span><textarea className="textarea !min-h-16" value={v.owner_address || ''} onChange={(e) => setV({ ...v, owner_address: e.target.value })} /></label>
                {SETTING_FIELDS.slice(1).map(([k, label, hint]) => <label key={k} className="block"><span className="label">{label}</span><input className="input" value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{hint && <span className="meta mt-1 block">{hint}</span>}</label>)}
                <button className="btn btn-primary">Enregistrer</button>
              </>
            ) : <State q={q}>{() => null}</State>}
          </form>
        </section>

        <div className="space-y-4">
          <section className="card">
            <div className="card-head"><span className="title-block">Connecter Claude (MCP)</span></div>
            <div className="card-body space-y-3 text-sm">
              <p className="text-ink-2">Une fois connecté, dis simplement à Claude « j’ai passé 2 h sur le chatbot TOBAM » ou « où j’en suis sur TOBAM ? » : il écrit et lit ici.</p>
              <div><span className="label">Adresse du serveur</span><div className="flex gap-2"><input className="input num" readOnly value={url} /><button className="btn" onClick={() => cp(url, 'Adresse')}>Copier</button></div></div>
              <div><span className="label">Jeton (en-tête Authorization: Bearer)</span><div className="flex gap-2"><input className="input num" readOnly type="password" value={token} /><button className="btn" onClick={() => cp(token, 'Jeton')}>Copier</button></div></div>
              <div><span className="label">Claude Code</span><div className="flex gap-2"><input className="input num" readOnly value={cmd.replace(token, '•••')} /><button className="btn" onClick={() => cp(cmd, 'Commande')}>Copier</button></div></div>
              <div><span className="label">Connecteur claude.ai / Claude Desktop (adresse avec jeton intégré)</span><div className="flex gap-2"><input className="input num" readOnly value={`${url}/•••`} /><button className="btn" onClick={() => cp(`${url}/${token}`, 'Adresse')}>Copier</button></div>
                <p className="meta mt-1">claude.ai doit pouvoir joindre le serveur : il faut alors une adresse publique en HTTPS (Cloudflare Tunnel, Tailscale Funnel). Garde cette adresse secrète.</p></div>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><span className="title-block">Apparence</span></div>
            <div className="card-body"><Seg value={theme} onChange={applyTheme} options={[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']]} /></div>
          </section>
          <section className="card">
            <div className="card-head"><span className="title-block">Données</span></div>
            <div className="card-body space-y-2 text-sm">
              <p className="text-ink-2">Tes données restent à toi : export complet en JSON à tout moment. Une sauvegarde de la base est faite chaque nuit dans le volume de sauvegardes.</p>
              <div className="flex flex-wrap gap-2">
                <a className="btn" href="/api/export"><Download size={14} /> Export complet (JSON)</a>
                <button className="btn" onClick={async () => { try { const r = await api('/backup', { method: 'POST' }); toast(`Sauvegarde : ${r.file}`) } catch (e: any) { toast(e.message, 'error') } }}>Sauvegarder maintenant</button>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-head"><span className="title-block">Session</span></div>
            <div className="card-body"><button className="btn" onClick={async () => { await api('/logout', { method: 'POST' }).catch(() => {}); window.location.href = '/' }}>Se déconnecter</button></div>
          </section>
        </div>
      </div>
    </>
  )
}
