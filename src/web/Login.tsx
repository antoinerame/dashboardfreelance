import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api } from './lib'

interface Me { authRequired: boolean; authed: boolean }

/** Affiche la page de connexion tant que la session n'est pas ouverte. */
export default function Gate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const load = useCallback(() => { api<Me>('/me').then(setMe).catch(() => setMe({ authRequired: true, authed: false })) }, [])
  useEffect(() => {
    load()
    window.addEventListener('lefil:logout', load)
    return () => window.removeEventListener('lefil:logout', load)
  }, [load])
  if (!me) return null
  if (!me.authed) return <Login onDone={load} />
  return <>{children}</>
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try { await api('/login', { body: { password } }); onDone() }
    catch (err: any) { setError(err.message); setBusy(false) }
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-paper p-4">
      <form className="card w-full max-w-[340px]" onSubmit={submit}>
        <div className="card-body space-y-4 p-6">
          <div>
            <div className="flex items-baseline gap-2"><b className="font-serif text-2xl">Le Fil</b><span className="meta">missions</span></div>
            <p className="meta mt-1">Heures, réunions, actions et facturation.</p>
          </div>
          <hr className="rule" />
          <div>
            <label className="label" htmlFor="pw">Mot de passe</label>
            <input id="pw" className="input w-full" type="password" autoFocus autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
            {error && <p className="field-error">{error}</p>}
          </div>
          <button className="btn btn-primary w-full justify-center" disabled={busy || !password}>{busy ? 'Connexion…' : 'Entrer'}</button>
        </div>
      </form>
    </main>
  )
}
