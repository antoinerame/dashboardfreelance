import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data')
export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'))

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT, email TEXT, billing_address TEXT, siret TEXT, notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, role TEXT, email TEXT, phone TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'en_cours' CHECK (status IN ('prospect','en_cours','en_pause','terminee')),
  billing_type TEXT NOT NULL DEFAULT 'temps' CHECK (billing_type IN ('temps','forfait')),
  rate_type TEXT NOT NULL DEFAULT 'jour' CHECK (rate_type IN ('jour','heure')),
  rate REAL,               -- TJM ou taux horaire (€ HT)
  hours_per_day REAL NOT NULL DEFAULT 7,
  fixed_price REAL,        -- montant du forfait
  budget_hours REAL,       -- budget en heures (optionnel)
  budget_amount REAL,      -- budget en euros (optionnel)
  start_date TEXT, end_date TEXT,
  color INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chantiers (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','termine')),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  issued_date TEXT NOT NULL, sent_date TEXT, paid_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  chantier_id INTEGER REFERENCES chantiers(id) ON DELETE SET NULL,
  date TEXT NOT NULL,            -- jour local (Paris)
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  description TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'a_facturer' CHECK (status IN ('a_facturer','facture','paye')),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_time_mission ON time_entries(mission_id, date);
CREATE TABLE IF NOT EXISTS timer (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  chantier_id INTEGER REFERENCES chantiers(id) ON DELETE SET NULL,
  description TEXT,
  started_at TEXT NOT NULL       -- UTC
);
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  date TEXT NOT NULL, time TEXT,
  title TEXT NOT NULL,
  participants TEXT, agenda TEXT, notes TEXT, decisions TEXT, summary TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'moi' CHECK (owner IN ('moi','client')),
  owner_name TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','en_attente','fait')),
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,              -- UTC
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`

export function openDb(file?: string): Database.Database {
  if (!file) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    file = path.join(DATA_DIR, 'suivi.db')
  }
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

/** Sauvegarde cohérente de la base (API de backup SQLite), puis purge des plus anciennes. */
export async function backup(db: Database.Database, keep = 30): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const dest = path.join(BACKUP_DIR, `suivi-${stamp}.db`)
  await db.backup(dest)
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^suivi-.*\.db$/.test(f))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(BACKUP_DIR, f))
  return dest
}
