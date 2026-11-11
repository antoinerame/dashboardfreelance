// Dates, durées et normalisation de texte.
// Règle : les jours sont des dates locales (heure de Paris) au format AAAA-MM-JJ,
// les horodatages (created_at, journal, chrono) sont stockés en UTC (ISO 8601).

export const TZ = process.env.APP_TZ || 'Europe/Paris'

export class AppError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ })

/** Date locale (Paris) AAAA-MM-JJ d'un instant donné. */
export function localDate(d: Date = new Date()): string {
  return dayFmt.format(d)
}
export const today = () => localDate()
export const nowIso = () => new Date().toISOString()

export function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'))
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 1 = lundi … 7 = dimanche */
export function weekday(date: string): number {
  const wd = new Date(date + 'T00:00:00Z').getUTCDay()
  return wd === 0 ? 7 : wd
}

export function weekRange(date: string = today()): [string, string] {
  const start = addDays(date, 1 - weekday(date))
  return [start, addDays(start, 6)]
}

export function monthRange(date: string = today()): [string, string] {
  const [y, m] = date.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return [`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]
}

/**
 * Interprète une période : « semaine », « semaine_derniere », « mois », « mois_dernier »,
 * « annee », « tout », « 2026-02 », « 2026 », « 2026-02-01..2026-02-28 » ou une date seule.
 */
export function parsePeriod(input?: string | null): { from: string; to: string; label: string } {
  const p = norm(input || 'mois').replace(/\s+/g, '_')
  const t = today()
  if (['semaine', 'cette_semaine', 'week'].includes(p)) {
    const [from, to] = weekRange(t)
    return { from, to, label: `semaine du ${from}` }
  }
  if (['semaine_derniere', 'semaine_precedente', 'last_week'].includes(p)) {
    const [from, to] = weekRange(addDays(t, -7))
    return { from, to, label: `semaine du ${from}` }
  }
  if (['mois', 'ce_mois', 'month'].includes(p)) {
    const [from, to] = monthRange(t)
    return { from, to, label: from.slice(0, 7) }
  }
  if (['mois_dernier', 'mois_precedent', 'last_month'].includes(p)) {
    const [from, to] = monthRange(addDays(monthRange(t)[0], -1))
    return { from, to, label: from.slice(0, 7) }
  }
  if (['annee', 'cette_annee', 'year'].includes(p)) {
    const y = t.slice(0, 4)
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: y }
  }
  if (['tout', 'all'].includes(p)) return { from: '0000-01-01', to: '9999-12-31', label: 'tout' }
  if (/^\d{4}$/.test(p)) return { from: `${p}-01-01`, to: `${p}-12-31`, label: p }
  if (/^\d{4}-\d{2}$/.test(p)) {
    const [from, to] = monthRange(p + '-01')
    return { from, to, label: p }
  }
  const range = p.match(/^(\d{4}-\d{2}-\d{2})(?:\.\.|_?(?:\/|a|au|to)_?)(\d{4}-\d{2}-\d{2})$/)
  if (range && isDate(range[1]) && isDate(range[2])) {
    return { from: range[1], to: range[2], label: `${range[1]} → ${range[2]}` }
  }
  if (isDate(p)) return { from: p, to: p, label: p }
  throw new AppError(
    `Période non comprise : « ${input} ». Exemples : semaine, semaine_derniere, mois, mois_dernier, annee, 2026-02, 2026-02-01..2026-02-28.`,
  )
}

/**
 * Convertit une durée en minutes. Accepte un nombre (heures décimales) ou un texte :
 * « 1h30 », « 1:30 », « 90m », « 90 min », « 1.5 », « 1,5h », « 0.5j » (jours).
 */
export function parseDuration(input: unknown, hoursPerDay = 7): number {
  if (typeof input === 'number') {
    if (!isFinite(input) || input <= 0) throw new AppError('La durée doit être positive.')
    return Math.round(input * 60)
  }
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, '')
  let min: number | null = null
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d+(?:\.\d+)?)(?:j|jour|jours|d)$/))) min = parseFloat(m[1]) * hoursPerDay * 60
  else if ((m = s.match(/^(\d+)(?:h|:)(\d{1,2})(?:m|min)?$/))) min = parseInt(m[1]) * 60 + parseInt(m[2])
  else if ((m = s.match(/^(\d+(?:\.\d+)?)(?:h|heure|heures)?$/))) min = parseFloat(m[1]) * 60
  else if ((m = s.match(/^(\d+(?:\.\d+)?)(?:m|min|mn|minutes?)$/))) min = parseFloat(m[1])
  if (min === null || !isFinite(min) || min <= 0) {
    throw new AppError(`Durée non comprise : « ${input} ». Exemples : 1h30, 45m, 2.5, 0.5j.`)
  }
  return Math.round(min)
}

export function fmtDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const abs = Math.abs(Math.round(minutes))
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${h}h${String(m).padStart(2, '0')}`
}

export function fmtEuro(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
}

/** Minuscules, sans accents : pour les comparaisons et la recherche. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function slugify(s: string): string {
  return norm(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
