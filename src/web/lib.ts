import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'

export type Row = Record<string, any>
export const TZ = 'Europe/Paris'

// ───────────── API ─────────────
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`)
  return data as T
}

// ───────────── État global ─────────────
export type QuickMode = 'temps' | 'chrono' | 'action' | 'journal'
export interface AppCtx {
  missions: Row[]
  timer: Row | null
  version: number
  /** À appeler après toute écriture : recharge missions, chrono et toutes les vues. */
  changed: () => void
  toast: (text: string, kind?: 'ok' | 'error') => void
  openQuick: (mode?: QuickMode, preset?: Row) => void
  openPalette: () => void
  /** Exécute une écriture : toast d'erreur si elle échoue, rafraîchit sinon. */
  run: <T>(p: Promise<T>, okText?: string) => Promise<T | undefined>
}
export const Ctx = createContext<AppCtx>(null as any)
export const useApp = () => useContext(Ctx)

export function useData<T = any>(path: string | null): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const { version } = useApp()
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true })
  const [tick, setTick] = useState(0)
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    if (last.current !== path) setState((s) => ({ ...s, loading: true, data: undefined }))
    last.current = path
    api<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState((s) => ({ ...s, error: e.message, loading: false })))
    return () => {
      alive = false
    }
  }, [path, version, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data: state.data, error: state.error, loading: state.loading, reload }
}

// ───────────── Dates ─────────────
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ })
export const today = () => dayFmt.format(new Date())
export const localDate = (iso: string) => dayFmt.format(new Date(iso))
const utc = (d: string) => new Date(d + 'T00:00:00Z')
export function addDays(d: string, n: number): string {
  const x = utc(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
export const weekday = (d: string) => utc(d).getUTCDay() || 7
export const weekStart = (d: string) => addDays(d, 1 - weekday(d))
export function monthBounds(d: string): [string, string] {
  const [y, m] = d.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return [`${d.slice(0, 7)}-01`, `${d.slice(0, 7)}-${String(last).padStart(2, '0')}`]
}
const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...o })
const fShort = f({ weekday: 'short', day: 'numeric' })
const fMed = f({ day: 'numeric', month: 'short' })
const fLong = f({ weekday: 'long', day: 'numeric', month: 'long' })
const fFull = f({ day: 'numeric', month: 'long', year: 'numeric' })
const fMonth = f({ month: 'long', year: 'numeric' })
export const dShort = (d: string) => fShort.format(utc(d))
export const dLong = (d: string) => fLong.format(utc(d))
export const dFull = (d: string) => fFull.format(utc(d))
export const dMonth = (d: string) => fMonth.format(utc(d))
export function dMed(d?: string | null): string {
  if (!d) return ''
  const s = fMed.format(utc(d))
  return d.slice(0, 4) === today().slice(0, 4) ? s : `${s} ${d.slice(0, 4)}`
}
/** « aujourd’hui », « hier », « dans 3 j », « il y a 5 j »… */
export function dRel(d?: string | null): string {
  if (!d) return ''
  const n = Math.round((utc(d).getTime() - utc(today()).getTime()) / 86400000)
  if (n === 0) return 'aujourd’hui'
  if (n === 1) return 'demain'
  if (n === -1) return 'hier'
  if (n > 1 && n <= 14) return `dans ${n} j`
  if (n < -1 && n >= -30) return `il y a ${-n} j`
  return dMed(d)
}
const fTime = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
export const tsTime = (iso: string) => fTime.format(new Date(iso))
export const tsLabel = (iso: string) => `${dMed(localDate(iso))} · ${tsTime(iso)}`

// ───────────── Formats ─────────────
export function dur(min: number): string {
  const m = Math.round(Math.abs(min))
  return `${min < 0 ? '−' : ''}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
export const hoursDec = (min: number) => (min / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
export const euro = (n: number, digits = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n || 0)
export const days = (min: number, hpd = 7) => (min / 60 / (hpd || 7)).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' j'
export const mc = (color?: number) => ({ ['--mc' as any]: `var(--m${color || 8})` }) as CSSProperties

export const MISSION_STATUS: Row = { prospect: 'Prospect', en_cours: 'En cours', en_pause: 'En pause', terminee: 'Terminée' }
export const ACTION_STATUS: Row = { a_faire: 'À faire', en_cours: 'En cours', en_attente: 'En attente', fait: 'Fait' }
export const TIME_STATUS: Row = { a_facturer: 'À facturer', facture: 'Facturé', paye: 'Payé' }

export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export function parseDuration(input: string, hpd = 7): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '')
  let m: RegExpMatchArray | null
  let min: number | null = null
  if ((m = s.match(/^(\d+(?:\.\d+)?)j$/))) min = parseFloat(m[1]) * hpd * 60
  else if ((m = s.match(/^(\d+)(?:h|:)(\d{1,2})$/))) min = parseInt(m[1]) * 60 + parseInt(m[2])
  else if ((m = s.match(/^(\d+(?:\.\d+)?)h?$/))) min = parseFloat(m[1]) * 60
  else if ((m = s.match(/^(\d+)(?:m|min|mn)$/))) min = parseFloat(m[1])
  return min && min > 0 && min <= 1440 ? Math.round(min) : null
}

// ───────────── Saisie en langage libre ─────────────
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
export interface Parsed {
  mission?: Row
  chantier?: Row
  minutes?: number
  date?: string
  billable: boolean
  text: string
}
/**
 * « tobam rlm 1h30 atelier prompts hier » → mission, chantier, durée, date, description.
 * `future` : les jours nommés désignent le prochain (échéance) plutôt que le dernier (temps passé).
 */
export function parseQuick(input: string, missions: Row[], opts: { duration?: boolean; future?: boolean } = {}): Parsed {
  let tokens = input.trim().split(/\s+/).filter(Boolean)
  const out: Parsed = { billable: true, text: '' }
  const t = today()
  const take = (i: number, n = 1) => tokens.splice(i, n)

  for (let i = 0; i < tokens.length; i++) {
    const k = norm(tokens[i])
    let date: string | undefined
    if (k === 'hier') date = addDays(t, -1)
    else if (k === 'avant-hier') date = addDays(t, -2)
    else if (k === 'demain') date = addDays(t, 1)
    else if (k === "aujourd'hui" || k === 'aujourd’hui' || k === 'auj') date = t
    else if (WEEKDAYS.includes(k)) {
      const target = WEEKDAYS.indexOf(k) + 1
      const diff = target - weekday(t)
      date = opts.future ? addDays(t, diff <= 0 ? diff + 7 : diff) : addDays(t, diff > 0 ? diff - 7 : diff)
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(k)) date = k
    else {
      const m = k.match(/^(\d{1,2})\/(\d{1,2})$/)
      if (m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
        date = `${t.slice(0, 4)}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
        if (opts.future && date < t) date = `${+t.slice(0, 4) + 1}${date.slice(4)}`
      }
    }
    if (date && !out.date) {
      out.date = date
      take(i--)
    } else if (k === 'nf' || k === '!nf') {
      out.billable = false
      take(i--)
    }
  }

  // Mission : les premiers mots, comparés au client et à l'intitulé.
  const open = missions.filter((m) => m.status !== 'terminee')
  const label = (m: Row) => norm(`${m.client_name} ${m.name}`).split(/[\s\-–&,/]+/)
  const matchMission = (word: string) => {
    const k = norm(word)
    if (k.length < 2) return []
    return open.filter((m) => label(m).some((w) => w.startsWith(k)))
  }
  if (tokens.length) {
    let hits = matchMission(tokens[0])
    let used = hits.length ? 1 : 0
    while (hits.length > 1 && used < tokens.length) {
      const next = matchMission(tokens[used]).filter((m) => hits.includes(m))
      if (!next.length) break
      hits = next
      used++
    }
    if (hits.length > 1) hits = hits.filter((m) => m.status === 'en_cours').slice(0, 1)
    if (hits.length === 1) {
      out.mission = hits[0]
      take(0, used)
    }
  }
  if (!out.mission && open.filter((m) => m.status === 'en_cours').length === 1) out.mission = open.find((m) => m.status === 'en_cours')

  if (opts.duration) {
    const i = tokens.findIndex((x) => /\d/.test(x) && parseDuration(x, out.mission?.hours_per_day) !== null && /[hmj:.,]|^\d+$/.test(x))
    if (i >= 0) out.minutes = parseDuration(take(i)[0], out.mission?.hours_per_day)!
  }

  // Chantier : le mot suivant, s'il correspond à un chantier de la mission.
  if (out.mission && tokens.length) {
    const chs: Row[] = (out.mission.chantiers || []).filter((c: Row) => c.status === 'actif')
    const k = norm(tokens[0])
    const words = (c: Row) => norm(c.name).split(/[\s\-–&,/]+/)
    const initials = (c: Row) => words(c).map((w) => w[0]).join('')
    const hits = k.length >= 2 ? chs.filter((c) => words(c).some((w) => w.startsWith(k)) || initials(c) === k) : []
    if (hits.length === 1) {
      out.chantier = hits[0]
      take(0)
    }
  }
  out.text = tokens.join(' ')
  return out
}

/** Markdown → HTML (le HTML brut est neutralisé avant rendu). */
export async function renderMd(src: string): Promise<string> {
  const { marked } = await import('marked')
  const html = await marked.parse(String(src || '').replace(/</g, '&lt;'), { breaks: true, gfm: true })
  return html.replace(/href="\s*javascript:[^"]*"/gi, 'href="#"')
}

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
