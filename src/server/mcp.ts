// Serveur MCP : Claude lit et écrit dans le suivi via la même couche métier que le site.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { STATUS_LABELS, type Core } from './core.js'
import { addDays, fmtDuration, fmtEuro, localDate, parsePeriod, today, TZ } from './util.js'

type Row = Record<string, any>

const missionArg = z
  .string()
  .describe('Mission : nom approximatif du client ou de la mission (ex. « tobam »), ou son id. Voir list_missions.')
const missionOpt = missionArg.optional()

const hm = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const due = (a: Row) => {
  if (!a.due_date) return ''
  const late = a.status !== 'fait' && a.due_date < today()
  return ` — échéance ${a.due_date}${late ? ' ⚠ EN RETARD' : ''}`
}
const actionLine = (a: Row, withMission = false) =>
  `- [#${a.id}] ${a.description} (${a.owner === 'moi' ? 'moi' : a.owner_name || 'client'}, ${STATUS_LABELS[a.status]})${due(a)}${withMission ? ` · ${a.client_name} – ${a.mission_name}` : ''}`
const title = (m: Row) => `${m.client_name} – ${m.name}`

function fmtMeeting(r: Row, full: boolean): string {
  const out = [`### Réunion #${r.id} — ${r.date}${r.time ? ' ' + r.time : ''} — ${r.title}`]
  if (r.participants) out.push(`Participants : ${r.participants}`)
  if (r.agenda) out.push(`Ordre du jour : ${r.agenda}`)
  if (r.summary) out.push(`**Compte rendu**\n${r.summary}`)
  if (r.decisions) out.push(`**Décisions**\n${r.decisions}`)
  if (r.notes && (full || !r.summary)) out.push(`**Notes brutes**\n${full ? r.notes : r.notes.slice(0, 600) + (r.notes.length > 600 ? '…' : '')}`)
  if (r.actions?.length) out.push('**Actions issues de la réunion**\n' + r.actions.map((a: Row) => `- [#${a.id}] ${a.description} (${STATUS_LABELS[a.status]})`).join('\n'))
  return out.join('\n')
}


const fr = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '—')
const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
function qontoSheet(p: Row, st: Row): string {
  const out = [
    `Période d’exécution : du ${fr(p.exec_from)} au ${fr(p.exec_to)}`,
    `Date d’émission : ${fr(p.issued_date)}`,
    `Date d’échéance : ${fr(p.due_date)}`,
  ]
  p.lines.forEach((l: Row, i: number) => {
    out.push(
      `\n**Article ${i + 1}**`,
      `- Titre : ${l.label}`,
      `- Détails (optionnel) : ${l.details}`,
      `- Quantité : ${qty(l.quantity)} · Unité : ${l.unit}${l.quantity > 1 ? 's' : ''} (${fmtDuration(l.minutes)})`,
      `- Prix unitaire HT : ${qty(l.rate)} € · TVA : 0 % · Total HT : ${fmtEuro(l.amount)}`,
      `- Nature de l’exonération : ${st.vat_exemption}`,
    )
  })
  out.push(`\n**Total HT : ${fmtEuro(p.amount)}** (TVA 0 €, TTC = HT)`)
  return out.join('\n')
}

export function createMcpServer(core: Core): McpServer {
  const server = new McpServer(
    { name: 'suivi-freelance', version: '1.0.0' },
    {
      instructions:
        "Suivi des missions freelance de l'utilisateur : heures, chantiers, réunions, actions, journal, facturation. " +
        'Une mission appartient à un client et se découpe en chantiers. Désigne une mission par un nom approximatif (« tobam ») ; ' +
        "en cas de doute, appelle list_missions. Pour reprendre le fil d'une mission, commence par get_mission_status. " +
        'Les durées acceptent « 1h30 », « 45m », « 2.5 » (heures) ou « 0.5j » (jours). Les dates sont au format AAAA-MM-JJ, en heure de Paris ; ' +
        "sans date, c'est aujourd'hui. N'invente jamais d'heures ni de décisions : écris seulement ce que l'utilisateur a dit. " +
        "Facturation : les factures sont faites dans Qonto. prepare_invoice donne les champs à saisir dans Qonto ; une fois la facture faite, " +
        "record_invoice l'enregistre ici (numéro Qonto) et passe les heures en « facturé » (ou « payé »). update_invoice la marque payée ensuite.",
    },
  )

  const tool = (name: string, description: string, shape: z.ZodRawShape, readOnly: boolean, fn: (a: any) => string) =>
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { readOnlyHint: readOnly, openWorldHint: false } },
      async (args: any) => {
        try {
          return { content: [{ type: 'text' as const, text: fn(args) }] }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `Erreur : ${(e as Error).message}` }], isError: true }
        }
      },
    )

  // ───────────── lecture ─────────────
  tool(
    'list_missions',
    'Liste toutes les missions (client, statut, chantiers, heures de la semaine et du mois, heures non facturées). À appeler quand on ne sait pas de quelle mission il s’agit.',
    {},
    true,
    () => {
      const ms = core.listMissions()
      if (!ms.length) return 'Aucune mission. Crée-en une avec create_mission.'
      return ms
        .map((m) => {
          const ch = core.listChantiers(m.id).filter((c) => c.status === 'actif').map((c) => c.name)
          return `- [id ${m.id}] **${title(m)}** — ${STATUS_LABELS[m.status]} · semaine ${fmtDuration(m.week_minutes)} · mois ${fmtDuration(m.month_minutes)} · non facturé ${fmtDuration(m.unbilled_minutes)} · ${m.open_actions} action(s) ouverte(s)${ch.length ? `\n  Chantiers : ${ch.join(', ')}` : ''}`
        })
        .join('\n')
    },
  )

  tool(
    'get_mission_status',
    'Résumé complet d’une mission pour « reprendre le fil » : statut, budget consommé, heures par chantier, dernières réunions avec décisions, actions ouvertes, dernières lignes du journal. À utiliser pour répondre à « où j’en suis sur X ? » ou avant un point client.',
    { mission: missionArg },
    true,
    ({ mission }) => {
      const o = core.missionOverview(core.resolveMission(mission).id)
      const m = o.mission
      const out = [`# ${title(m)} (id ${m.id}) — ${STATUS_LABELS[m.status]}`]
      if (m.description) out.push(m.description)
      const fact =
        m.billing_type === 'forfait'
          ? `Forfait${m.fixed_price ? ' ' + fmtEuro(m.fixed_price) : ''}`
          : `Au temps passé${m.rate ? ` — ${fmtEuro(m.rate)} / ${m.rate_type}` : ''}`
      out.push(`${fact}${m.start_date ? ` · début ${m.start_date}` : ''}${m.end_date ? ` · fin prévue ${m.end_date}` : ''}`)
      out.push(
        `**Heures** : semaine ${fmtDuration(m.week_minutes)} · mois ${fmtDuration(m.month_minutes)} · total ${fmtDuration(m.total_minutes)} · non facturé ${fmtDuration(m.unbilled_minutes)}${m.unbilled_amount ? ` (${fmtEuro(m.unbilled_amount)})` : ''}`,
      )
      if (m.budget) {
        const b = m.budget
        const f = (v: number) => (b.unit === 'heures' ? fmtDuration(v * 60) : fmtEuro(v))
        out.push(`**Budget** : ${f(b.used)} consommés sur ${f(b.total)} (${Math.round(b.pct * 100)} %), reste ${f(b.remaining)}`)
      }
      if (o.chantiers.length) {
        out.push('## Chantiers\n' + o.chantiers.map((c: Row) => `- ${c.name}${c.status === 'termine' ? ' (terminé)' : ''} : ${fmtDuration(c.total_minutes)} au total, ${fmtDuration(c.month_minutes)} ce mois`).join('\n'))
      }
      out.push('## Actions ouvertes\n' + (o.open_actions.length ? o.open_actions.map((a: Row) => actionLine(a)).join('\n') : '_Aucune._'))
      if (o.meetings.length) {
        out.push('## Dernières réunions')
        out.push(fmtMeeting(o.last_meeting, false))
        for (const r of o.meetings.slice(1, 4)) out.push(fmtMeeting(r, false))
      }
      if (o.logs.length) {
        out.push('## Journal (dernières lignes)\n' + o.logs.slice(0, 12).map((l: Row) => `- ${localDate(new Date(l.ts))} ${hm(l.ts)} — ${l.text}`).join('\n'))
      }
      if (o.contacts.length) out.push('## Contacts\n' + o.contacts.map((c: Row) => `- ${c.name}${c.role ? ` (${c.role})` : ''}`).join('\n'))
      return out.join('\n\n')
    },
  )

  tool(
    'list_open_actions',
    'Liste les actions ouvertes (à faire, en cours, en attente), triées par échéance, avec leur id. Filtrable par mission et par responsable. Par défaut : toutes les missions, tous les responsables.',
    { mission: missionOpt, responsable: z.enum(['moi', 'client']).optional().describe('« moi » = l’utilisateur, « client » = quelqu’un chez le client') },
    true,
    ({ mission, responsable }) => {
      const list = core.listActions({ mission_id: mission ? core.resolveMission(mission).id : undefined, owner: responsable, status: 'ouvertes' })
      return list.length ? list.map((a) => actionLine(a, !mission)).join('\n') : 'Aucune action ouverte.'
    },
  )

  const periodDesc = 'Période : « semaine », « semaine_derniere », « mois », « mois_dernier », « annee », « 2026-02 » ou « 2026-02-01..2026-02-28 ». Défaut : mois en cours.'
  tool(
    'get_timesheet',
    'Feuille de temps d’une période : total, répartition par mission et par chantier, montant facturable, et détail des entrées (avec leur id). Sans mission : toutes les missions.',
    { mission: missionOpt, periode: z.string().optional().describe(periodDesc) },
    true,
    ({ mission, periode }) => {
      const p = parsePeriod(periode)
      const ts = core.timesheet({ from: p.from, to: p.to, mission_id: mission ? core.resolveMission(mission).id : undefined })
      const out = [`Feuille de temps ${p.from} → ${p.to} : **${fmtDuration(ts.total_minutes)}** dont ${fmtDuration(ts.billable_minutes)} facturables${ts.amount ? ` (${fmtEuro(ts.amount)} HT)` : ''}`]
      for (const bm of ts.by_mission) {
        out.push(`\n## ${bm.client_name} – ${bm.mission_name} : ${fmtDuration(bm.minutes)}\n` + bm.chantiers.map((c: Row) => `- ${c.name} : ${fmtDuration(c.minutes)}`).join('\n'))
      }
      if (ts.entries.length) {
        out.push('\n## Détail\n' + ts.entries.map((e: Row) => `- [#${e.id}] ${e.date} · ${e.mission_name}${e.chantier_name ? ' / ' + e.chantier_name : ''} · ${fmtDuration(e.minutes)} · ${e.description || '—'}${e.billable ? '' : ' (non facturable)'} · ${STATUS_LABELS[e.status]}`).join('\n'))
      } else out.push('Aucune entrée.')
      return out.join('\n')
    },
  )

  tool(
    'export_timesheet',
    'Exporte la feuille de temps d’une période en Markdown (tableau prêt à coller dans un rapport ou un mail) ou en CSV (pour préparer une facture).',
    { mission: missionOpt, periode: z.string().optional().describe(periodDesc), format: z.enum(['markdown', 'csv']).default('markdown') },
    true,
    ({ mission, periode, format }) => {
      const p = parsePeriod(periode)
      return core.exportTimesheet({ from: p.from, to: p.to, mission_id: mission ? core.resolveMission(mission).id : undefined }, format === 'csv' ? 'csv' : 'md').replace(/^﻿/, '')
    },
  )

  tool(
    'get_unbilled_hours',
    'Heures facturables pas encore facturées, par mission, avec le montant correspondant. Répond à « qu’est-ce qu’il me reste à facturer ? ».',
    {},
    true,
    () => {
      const ms = core.listMissions().filter((m) => m.unbilled_minutes > 0)
      if (!ms.length) return 'Rien à facturer : toutes les heures facturables sont déjà facturées.'
      const total = ms.reduce((s, m) => s + m.unbilled_amount, 0)
      return (
        ms.map((m) => `- ${title(m)} : ${fmtDuration(m.unbilled_minutes)}${m.unbilled_amount ? ` → ${fmtEuro(m.unbilled_amount)} HT` : m.billing_type === 'forfait' ? ' (forfait)' : ''}`).join('\n') +
        `\n\n**Total : ${fmtDuration(ms.reduce((s, m) => s + m.unbilled_minutes, 0))}${total ? ` — ${fmtEuro(total)} HT` : ''}**`
      )
    },
  )

  tool(
    'search',
    'Recherche plein texte (insensible aux accents) dans les réunions (notes, décisions, comptes rendus), les actions, le journal, les descriptions d’heures et les missions. Tous les mots doivent être présents.',
    { query: z.string().describe('Mots-clés, ex. « accès frwks64 »') },
    true,
    ({ query }) => {
      const res = core.search(query, 25)
      const label: Row = { reunion: 'Réunion', action: 'Action', journal: 'Journal', temps: 'Heures', mission: 'Mission' }
      return res.length
        ? res.map((r) => `- **${label[r.type]} #${r.id}** · ${r.date} · ${r.client_name} – ${r.mission_name}\n  ${r.title}${r.snippet ? `\n  > ${r.snippet}` : ''}`).join('\n')
        : `Aucun résultat pour « ${query} ».`
    },
  )

  tool(
    'get_meeting',
    'Texte complet d’une réunion (notes brutes, décisions, compte rendu, actions). Donne son id, ou seulement la mission pour obtenir la dernière réunion. Utile avant de rédiger un compte rendu avec update_meeting.',
    { id: z.number().int().optional().describe('Id de la réunion'), mission: missionOpt },
    true,
    ({ id, mission }) => {
      if (id) return fmtMeeting(core.getMeeting(id), true)
      const last = core.listMeetings({ mission_id: core.resolveMission(mission).id, limit: 1 })[0]
      return last ? fmtMeeting(core.getMeeting(last.id), true) : 'Aucune réunion sur cette mission.'
    },
  )

  tool(
    'get_recent_activity',
    'Activité des N derniers jours (ou d’une période) : heures par mission et chantier avec descriptions, réunions et décisions, actions terminées et créées, journal. Sert à rédiger un rapport d’activité ou préparer un point client.',
    { jours: z.number().int().min(1).max(366).optional().describe('Nombre de jours en arrière (défaut 7). Ignoré si periode est fournie.'), periode: z.string().optional().describe(periodDesc.replace(' Défaut : mois en cours.', '')), mission: missionOpt },
    true,
    ({ jours, periode, mission }) => {
      const p = periode ? parsePeriod(periode) : { from: addDays(today(), -((jours || 7) - 1)), to: today() }
      const a = core.recentActivity({ from: p.from, to: p.to, mission_id: mission ? core.resolveMission(mission).id : undefined })
      const out = [`# Activité du ${a.from} au ${a.to}`, `Total : ${fmtDuration(a.timesheet.total_minutes)}`]
      for (const bm of a.timesheet.by_mission) {
        out.push(`## ${bm.client_name} – ${bm.mission_name} : ${fmtDuration(bm.minutes)}`)
        for (const c of bm.chantiers) {
          const descs = a.timesheet.entries
            .filter((e: Row) => e.mission_id === bm.mission_id && (e.chantier_name || 'Sans chantier') === c.name && e.description)
            .map((e: Row) => `  - ${e.date} (${fmtDuration(e.minutes)}) ${e.description}`)
          out.push(`- **${c.name}** : ${fmtDuration(c.minutes)}\n${descs.join('\n')}`)
        }
      }
      if (a.meetings.length) out.push('## Réunions\n' + a.meetings.map((r: Row) => fmtMeeting(r, false)).join('\n\n'))
      if (a.actions_done.length) out.push('## Actions terminées\n' + a.actions_done.map((x: Row) => actionLine(x, true)).join('\n'))
      if (a.actions_created.length) out.push('## Actions créées\n' + a.actions_created.map((x: Row) => actionLine(x, true)).join('\n'))
      if (a.logs.length) out.push('## Journal\n' + a.logs.map((l: Row) => `- ${localDate(new Date(l.ts))} · ${l.mission_name} — ${l.text}`).join('\n'))
      return out.join('\n\n')
    },
  )

  // ───────────── écriture ─────────────
  tool(
    'log_time',
    'Enregistre du temps passé sur une mission. À utiliser dès que l’utilisateur dit avoir travaillé (« j’ai passé 2h sur le chatbot TOBAM »). Pour un travail qui commence maintenant, préférer start_timer.',
    {
      mission: missionArg,
      duree: z.string().describe('Durée : « 1h30 », « 45m », « 2.5 » (heures) ou « 0.5j » (jours)'),
      description: z.string().optional().describe('Ce qui a été fait, en une phrase'),
      chantier: z.string().optional().describe('Chantier (sous-partie de la mission), nom approximatif'),
      date: z.string().optional().describe('Jour du travail AAAA-MM-JJ (défaut : aujourd’hui)'),
      facturable: z.boolean().optional().describe('Défaut : true'),
      creer_chantier: z.boolean().optional().describe('Créer le chantier s’il n’existe pas (défaut : false)'),
    },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const ch = core.resolveChantier(m, a.chantier, a.creer_chantier)
      const e = core.logTime({ mission_id: m.id, chantier_id: ch?.id, duration: a.duree, description: a.description, date: a.date, billable: a.facturable })
      const day = core.timesheet({ from: e.date, to: e.date })
      const fresh = core.getMission(m.id)
      return `Enregistré [#${e.id}] : ${fmtDuration(e.minutes)} le ${e.date} sur ${title(m)}${ch ? ' / ' + ch.name : ''}${e.billable ? '' : ' (non facturable)'}.\nTotal du ${e.date} : ${fmtDuration(day.total_minutes)} · semaine en cours sur cette mission : ${fmtDuration(fresh.week_minutes)}.`
    },
  )

  tool(
    'update_time_entry',
    'Corrige ou supprime une entrée de temps existante (id donné par log_time ou get_timesheet).',
    {
      id: z.number().int(),
      duree: z.string().optional(),
      description: z.string().optional(),
      chantier: z.string().optional(),
      date: z.string().optional(),
      facturable: z.boolean().optional(),
      supprimer: z.boolean().optional().describe('true pour supprimer l’entrée'),
    },
    false,
    (a) => {
      if (a.supprimer) {
        core.deleteTime(a.id)
        return `Entrée #${a.id} supprimée.`
      }
      const cur = core.getTime(a.id)
      const ch = a.chantier !== undefined ? core.resolveChantier(core.getMission(cur.mission_id), a.chantier) : undefined
      const e = core.updateTime(a.id, { duration: a.duree, description: a.description, date: a.date, billable: a.facturable, ...(ch ? { chantier_id: ch.id } : {}) })
      return `Entrée #${e.id} mise à jour : ${e.date} · ${fmtDuration(e.minutes)} · ${e.mission_name}${e.chantier_name ? ' / ' + e.chantier_name : ''} · ${e.description || '—'}`
    },
  )

  tool(
    'start_timer',
    'Démarre le chrono sur une mission (« je commence à bosser sur X »). Un seul chrono à la fois : s’il y en a déjà un, il est arrêté et enregistré d’abord.',
    { mission: missionArg, chantier: z.string().optional(), description: z.string().optional().describe('Ce sur quoi porte le travail') },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const ch = core.resolveChantier(m, a.chantier)
      const { stopped } = core.startTimer({ mission_id: m.id, chantier_id: ch?.id, description: a.description })
      return `${stopped ? `Chrono précédent arrêté : ${fmtDuration(stopped.minutes)} enregistrés sur ${stopped.mission_name} [#${stopped.id}].\n` : ''}Chrono démarré sur ${title(m)}${ch ? ' / ' + ch.name : ''}.`
    },
  )

  tool(
    'stop_timer',
    'Arrête le chrono en cours et enregistre le temps écoulé comme entrée de temps. Sans chrono en cours, renvoie une erreur.',
    { description: z.string().optional().describe('Ce qui a été fait (remplace la description donnée au démarrage)') },
    false,
    (a) => {
      const e = core.stopTimer({ description: a.description })
      return `Chrono arrêté : ${fmtDuration(e.minutes)} enregistrés le ${e.date} sur ${e.client_name} – ${e.mission_name}${e.chantier_name ? ' / ' + e.chantier_name : ''} [#${e.id}].`
    },
  )

  tool(
    'add_meeting',
    'Enregistre une réunion : notes brutes, et si possible compte rendu structuré, décisions et actions qui en découlent. Les actions passées ici sont créées et rattachées à la réunion (ne pas les recréer avec add_action).',
    {
      mission: missionArg,
      titre: z.string().optional().describe('Ex. « Point hebdo », « Kick-off pipeline »'),
      date: z.string().optional().describe('AAAA-MM-JJ (défaut : aujourd’hui)'),
      heure: z.string().optional().describe('HH:MM'),
      participants: z.string().optional().describe('Noms séparés par des virgules'),
      ordre_du_jour: z.string().optional(),
      notes: z.string().optional().describe('Notes brutes, en Markdown'),
      decisions: z.string().optional().describe('Décisions prises, une par ligne (liste Markdown)'),
      compte_rendu: z.string().optional().describe('Compte rendu structuré, en Markdown'),
      actions: z
        .array(
          z.object({
            description: z.string(),
            responsable: z.enum(['moi', 'client']).optional(),
            nom_responsable: z.string().optional().describe('Prénom de la personne côté client'),
            echeance: z.string().optional().describe('AAAA-MM-JJ'),
          }),
        )
        .optional(),
    },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const r = core.createMeeting({
        mission_id: m.id, title: a.titre, date: a.date, time: a.heure, participants: a.participants, agenda: a.ordre_du_jour,
        notes: a.notes, decisions: a.decisions, summary: a.compte_rendu,
        actions: (a.actions || []).map((x: Row) => ({ description: x.description, owner: x.responsable || 'moi', owner_name: x.nom_responsable, due_date: x.echeance })),
      })
      return `Réunion #${r.id} enregistrée : « ${r.title} » le ${r.date} sur ${title(m)}${r.actions.length ? `, avec ${r.actions.length} action(s) : ${r.actions.map((x: Row) => '#' + x.id).join(', ')}` : ''}.`
    },
  )

  tool(
    'update_meeting',
    'Complète ou corrige une réunion existante : typiquement pour y écrire le compte rendu structuré et les décisions à partir des notes brutes (lire d’abord avec get_meeting). Seuls les champs fournis sont modifiés.',
    {
      id: z.number().int(),
      titre: z.string().optional(), date: z.string().optional(), heure: z.string().optional(), participants: z.string().optional(),
      ordre_du_jour: z.string().optional(), notes: z.string().optional(), decisions: z.string().optional(), compte_rendu: z.string().optional(),
    },
    false,
    (a) => {
      const r = core.updateMeeting(a.id, { title: a.titre, date: a.date, time: a.heure, participants: a.participants, agenda: a.ordre_du_jour, notes: a.notes, decisions: a.decisions, summary: a.compte_rendu })
      return `Réunion #${r.id} « ${r.title} » mise à jour.`
    },
  )

  tool(
    'add_action',
    'Crée une action à suivre sur une mission (chose à faire par l’utilisateur, ou attendue du client).',
    {
      mission: missionArg,
      description: z.string(),
      echeance: z.string().optional().describe('AAAA-MM-JJ'),
      responsable: z.enum(['moi', 'client']).optional().describe('Défaut : moi'),
      nom_responsable: z.string().optional().describe('Prénom de la personne côté client, ex. « Axel »'),
      reunion_id: z.number().int().optional().describe('Réunion d’origine, si l’action en découle'),
    },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const x = core.createAction({ mission_id: m.id, description: a.description, due_date: a.echeance, owner: a.responsable || 'moi', owner_name: a.nom_responsable, meeting_id: a.reunion_id })
      return `Action #${x.id} créée sur ${title(m)} : ${x.description}${due(x)}.`
    },
  )

  tool(
    'update_action',
    'Met à jour une action (id donné par list_open_actions) : la marquer faite, changer son statut, son échéance, sa description ou son responsable.',
    {
      id: z.number().int(),
      statut: z.enum(['a_faire', 'en_cours', 'en_attente', 'fait']).optional(),
      description: z.string().optional(),
      echeance: z.string().optional().describe('AAAA-MM-JJ, ou chaîne vide pour retirer l’échéance'),
      responsable: z.enum(['moi', 'client']).optional(),
      nom_responsable: z.string().optional(),
    },
    false,
    (a) => {
      const x = core.updateAction(a.id, { status: a.statut, description: a.description, due_date: a.echeance, owner: a.responsable, owner_name: a.nom_responsable })
      return `Action #${x.id} : ${x.description} — ${STATUS_LABELS[x.status]}${due(x)}.`
    },
  )

  tool(
    'add_log',
    'Ajoute une ligne horodatée au journal d’une mission : événement, livraison, blocage, information utile plus tard (« accès frwks64 perdu », « livré la v2 du pipeline »). Pas pour les tâches à faire (add_action) ni le temps passé (log_time).',
    { mission: missionArg, texte: z.string(), date: z.string().optional().describe('AAAA-MM-JJ si l’événement n’est pas d’aujourd’hui') },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const l = core.addLog({ mission_id: m.id, text: a.texte, ts: a.date })
      return `Journal de ${title(m)} : « ${l.text} » (${localDate(new Date(l.ts))}).`
    },
  )

  tool(
    'update_mission_status',
    'Change le statut d’une mission : prospect, en_cours, en_pause ou terminee.',
    { mission: missionArg, statut: z.enum(['prospect', 'en_cours', 'en_pause', 'terminee']) },
    false,
    (a) => {
      const m = core.updateMission(core.resolveMission(a.mission).id, { status: a.statut })
      return `${title(m)} est maintenant « ${STATUS_LABELS[m.status]} ».`
    },
  )

  tool(
    'create_mission',
    'Crée une mission (et le client s’il n’existe pas encore), avec éventuellement ses chantiers. À n’utiliser que si l’utilisateur demande explicitement une nouvelle mission.',
    {
      client: z.string().describe('Nom du client'),
      intitule: z.string().describe('Intitulé de la mission'),
      statut: z.enum(['prospect', 'en_cours', 'en_pause', 'terminee']).optional(),
      facturation: z.enum(['temps', 'forfait']).optional().describe('Au temps passé (défaut) ou au forfait'),
      tjm: z.number().optional().describe('Taux journalier en € HT'),
      taux_horaire: z.number().optional().describe('Taux horaire en € HT (si pas de TJM)'),
      montant_forfait: z.number().optional(),
      budget_jours: z.number().optional(),
      budget_heures: z.number().optional(),
      date_debut: z.string().optional(),
      date_fin: z.string().optional(),
      chantiers: z.array(z.string()).optional().describe('Sous-parties de la mission'),
      description: z.string().optional(),
    },
    false,
    (a) => {
      const m = core.createMission({
        client_name: a.client, name: a.intitule, status: a.statut, billing_type: a.facturation,
        rate_type: a.tjm ? 'jour' : a.taux_horaire ? 'heure' : undefined, rate: a.tjm ?? a.taux_horaire, fixed_price: a.montant_forfait,
        budget_hours: a.budget_heures ?? (a.budget_jours ? a.budget_jours * 7 : undefined),
        start_date: a.date_debut, end_date: a.date_fin, chantiers: a.chantiers, description: a.description,
      })
      return `Mission créée : ${title(m)} (id ${m.id})${a.chantiers?.length ? `, chantiers : ${a.chantiers.join(', ')}` : ''}.`
    },
  )

  tool(
    'add_chantier',
    'Ajoute un chantier (sous-partie) à une mission, pour ventiler le temps passé.',
    { mission: missionArg, nom: z.string() },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const c = core.createChantier({ mission_id: m.id, name: a.nom })
      return `Chantier « ${c.name} » ajouté à ${title(m)}.`
    },
  )

  // ───────────── facturation (factures faites dans Qonto) ─────────────
  const invLine = (i: Row) =>
    `- [#${i.id}] ${i.number} · ${i.client_name} – ${i.mission_name} · du ${fr(i.period_start)} au ${fr(i.period_end)} · ${fmtDuration(i.minutes)} · ${fmtEuro(i.amount)} HT · émise ${fr(i.issued_date)}, échéance ${fr(i.due_date)} · ` +
    (i.paid_date ? `payée le ${fr(i.paid_date)}` : i.sent_date ? `envoyée le ${fr(i.sent_date)}, NON PAYÉE` : 'brouillon')

  tool(
    'list_invoices',
    'Liste les factures enregistrées (numéro, période, heures, montant, dates d’émission, d’échéance, d’envoi et de paiement), avec le chiffre d’affaires de l’année.',
    { annee: z.string().optional().describe('Année du chiffre d’affaires (défaut : année en cours)') },
    true,
    (a) => {
      const inv = core.listInvoices()
      const r = core.revenue(a.annee)
      return (inv.length ? inv.map(invLine).join('\n') : 'Aucune facture enregistrée.') +
        `\n\nCA ${r.year} : encaissé ${fmtEuro(r.paid)}, facturé en attente ${fmtEuro(r.pending)}, travaillé non facturé ${fmtEuro(r.unbilled)}.`
    },
  )

  tool(
    'prepare_invoice',
    'Prépare une facture à saisir dans Qonto, sans rien enregistrer : heures facturables pas encore facturées de la période, une ligne par mois (titre, détails, quantité, unité, prix unitaire, TVA, exonération), période d’exécution, échéance et prochain numéro.',
    {
      mission: missionArg,
      du: z.string().optional().describe('Début de période AAAA-MM-JJ (défaut : toutes les heures non facturées)'),
      au: z.string().optional().describe('Fin de période AAAA-MM-JJ (défaut : aujourd’hui)'),
      date_emission: z.string().optional().describe('Date d’émission prévue (défaut : aujourd’hui), sert au calcul de l’échéance'),
    },
    true,
    (a) => {
      const m = core.resolveMission(a.mission)
      const p = core.previewInvoice({ mission_id: m.id, from: a.du || '2000-01-01', to: a.au || today(), issued_date: a.date_emission })
      if (!p.entries.length) return `Aucune heure facturable non facturée pour ${title(m)} sur cette période.`
      return `# Facture à saisir dans Qonto — ${title(m)}\nNuméro suggéré : ${p.next_number} (Qonto numérote lui-même : garde le sien)\n\n` + qontoSheet(p, p.settings) +
        `\n\n${p.entries.length} entrées. Une fois la facture créée dans Qonto, appelle record_invoice avec son numéro et la même période.`
    },
  )

  tool(
    'record_invoice',
    'Enregistre une facture faite dans Qonto : rattache les heures facturables non facturées de la période et les passe en « facturé » (ou « payé » si payee_le est donné). Pour des heures déjà payées, renseigne payee_le.',
    {
      mission: missionArg,
      numero: z.string().describe('Numéro de la facture Qonto (ex. F-2026-001)'),
      du: z.string().describe('Début de la période d’exécution AAAA-MM-JJ'),
      au: z.string().describe('Fin de la période d’exécution AAAA-MM-JJ'),
      date_emission: z.string().describe('Date d’émission AAAA-MM-JJ'),
      date_echeance: z.string().optional().describe('Date d’échéance (défaut : calculée selon les réglages)'),
      montant_ht: z.number().optional().describe('Montant HT réellement facturé, s’il diffère du calcul heures × taux'),
      envoyee_le: z.string().optional(),
      payee_le: z.string().optional().describe('Date de paiement, si déjà payée'),
      notes: z.string().optional(),
    },
    false,
    (a) => {
      const m = core.resolveMission(a.mission)
      const inv = core.createInvoice({
        mission_id: m.id, number: a.numero, from: a.du, to: a.au, issued_date: a.date_emission, due_date: a.date_echeance,
        amount: a.montant_ht, sent_date: a.envoyee_le, paid_date: a.payee_le, notes: a.notes,
      })
      const calc = inv.lines.reduce((x: number, l: Row) => x + l.amount, 0)
      return `Facture enregistrée :\n${invLine(inv)}\n${inv.entries.length} entrées passées en « ${inv.paid_date ? 'payé' : 'facturé'} ».` +
        (Math.abs(calc - inv.amount) > 0.01 ? `\n⚠ Le montant saisi (${fmtEuro(inv.amount)}) diffère du calcul heures × taux (${fmtEuro(calc)}) : vérifie la période.` : '')
    },
  )

  tool(
    'update_invoice',
    'Modifie une facture enregistrée (id ou numéro) : la marquer envoyée ou payée, corriger son numéro, ses dates ou son montant. supprimer = true la supprime et ses heures redeviennent « à facturer ».',
    {
      facture: z.string().describe('Id (#3) ou numéro (F-2026-001) de la facture'),
      numero: z.string().optional(),
      date_emission: z.string().optional(),
      date_echeance: z.string().optional(),
      envoyee_le: z.string().optional().describe('Date d’envoi ; chaîne vide pour effacer'),
      payee_le: z.string().optional().describe('Date de paiement ; chaîne vide pour repasser en non payée'),
      montant_ht: z.number().optional(),
      notes: z.string().optional(),
      supprimer: z.boolean().optional(),
    },
    false,
    (a) => {
      const key = a.facture.trim().replace(/^#/, '')
      const found = core.listInvoices().find((i) => i.number === a.facture.trim() || String(i.id) === key)
      if (!found) throw new Error(`Facture « ${a.facture} » introuvable (voir list_invoices).`)
      if (a.supprimer) {
        core.deleteInvoice(found.id)
        return `Facture ${found.number} supprimée : ses heures redeviennent « à facturer ».`
      }
      const data: Row = { number: a.numero, issued_date: a.date_emission, due_date: a.date_echeance, sent_date: a.envoyee_le, paid_date: a.payee_le, amount: a.montant_ht, notes: a.notes }
      if (a.payee_le && !found.sent_date && a.envoyee_le === undefined) data.sent_date = a.payee_le
      const inv = core.updateInvoice(found.id, data)
      return `Facture mise à jour :\n${invLine(inv)}`
    },
  )

  // ───────────── réglages ─────────────
  const SETTING_HELP: Record<string, string> = {
    owner_name: 'Nom / raison sociale', owner_address: 'Adresse', owner_siret: 'SIRET', owner_email: 'Courriel', owner_iban: 'IBAN',
    micro_ceiling: 'Plafond de CA micro-entrepreneur (€)', vat_mention: 'Mention de TVA', payment_terms: 'Conditions de paiement (texte)',
    invoice_prefix: 'Préfixe des numéros de facture', invoice_line_label: 'Titre des lignes de facture ({mois}, {mission}, {client})',
    due_days: 'Délai de paiement en jours', due_end_of_month: '1 = échéance reportée en fin de mois', vat_exemption: 'Nature de l’exonération de TVA (Qonto)',
  }
  tool(
    'get_settings',
    'Lit les réglages : identité et coordonnées de facturation, plafond micro-entrepreneur, mention de TVA, délai de paiement, préfixe des factures, titre des lignes de facture.',
    {},
    true,
    () => Object.entries(core.getSettings()).map(([k, v]) => `- ${k} (${SETTING_HELP[k] || k}) : ${v || '—'}`).join('\n'),
  )
  tool(
    'update_settings',
    'Modifie un ou plusieurs réglages (clés données par get_settings). Seules les clés fournies changent.',
    { reglages: z.record(z.string(), z.union([z.string(), z.number()])).describe('Ex. { "due_days": "30", "invoice_line_label": "Conseil IA — {mois}" }') },
    false,
    (a) => {
      const known = Object.keys(core.getSettings())
      const bad = Object.keys(a.reglages).filter((k) => !known.includes(k))
      if (bad.length) throw new Error(`Réglage(s) inconnu(s) : ${bad.join(', ')}. Réglages possibles : ${known.join(', ')}.`)
      const st = core.setSettings(a.reglages)
      return 'Réglages enregistrés :\n' + Object.keys(a.reglages).map((k) => `- ${k} : ${st[k] || '—'}`).join('\n')
    },
  )

  return server
}
