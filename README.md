# Le Fil — suivi de missions freelance

Heures, chantiers, réunions, actions, journal et facturation, avec un serveur MCP pour que Claude lise et écrive dans le suivi. Un seul conteneur Docker, une base SQLite.

## Démarrer sur le serveur

```bash
cp .env.example .env      # puis adapter (mot de passe, adresse d'écoute)
docker compose up -d --build
```

L'interface est sur `http://<serveur>:3000`. Les données sont dans `./data` (base `suivi.db`), les sauvegardes quotidiennes dans `./backups`.

- **Accès** : par défaut le port n'écoute que sur `127.0.0.1`. Pour y accéder depuis ton réseau Tailscale, mets `BIND_ADDRESS` à l'IP Tailscale du serveur (ou `0.0.0.0`). Hors Tailscale / Cloudflare Access, définis `APP_PASSWORD`.
- **Sauvegarde hors serveur** : pointe `BACKUP_PATH` vers un disque ou un partage externe, ou synchronise `./backups` (rsync, rclone). 30 sauvegardes sont conservées.
- **Mise à jour** : `git pull && docker compose up -d --build`.

## Connecter Claude (MCP)

Le serveur MCP est sur `/mcp` (Streamable HTTP), protégé par un jeton. Le jeton, l'adresse et la commande prête à copier sont dans **Réglages**.

```bash
claude mcp add --transport http suivi-freelance http://<serveur>:3000/mcp --header "Authorization: Bearer <jeton>"
```

Pour un connecteur claude.ai, utilise l'adresse `https://<adresse-publique>/mcp/<jeton>` (il faut une adresse publique en HTTPS, par exemple via Cloudflare Tunnel).

Exemples : « j'ai passé 2 h sur le chatbot TOBAM », « démarre le chrono sur Pilot », « où j'en suis sur TOBAM ? », « note dans le journal que l'accès frwks64 est perdu », « fais le compte rendu de la dernière réunion TOBAM », « qu'est-ce qu'il me reste à facturer ? ».

| Écriture | Lecture |
|---|---|
| `log_time`, `update_time_entry`, `start_timer`, `stop_timer` | `list_missions`, `get_mission_status` |
| `add_meeting`, `update_meeting` | `list_open_actions`, `get_meeting` |
| `add_action`, `update_action`, `add_log` | `get_timesheet`, `export_timesheet`, `get_unbilled_hours` |
| `create_mission`, `add_chantier`, `update_mission_status` | `search`, `get_recent_activity` |

## L'interface

- **Saisie rapide** (`T`) : une ligne en langage libre, « tobam rlm 1h30 atelier prompts hier ». Même fenêtre pour le chrono (`S`), une action (`A`), une ligne de journal (`J`).
- **Palette** (`Ctrl K`) : recherche dans les réunions, actions, journal et heures, plus toutes les commandes. `?` affiche les raccourcis.
- **Page mission** : bloc « Reprendre le fil » (dernière réunion et décisions, journal, actions ouvertes), budget, chantiers.
- **Réunions** : dans les notes, `- [ ]` ou `>>` en début de ligne devient une action, `!!` une décision (bouton « Extraire »).
- **Facturation** : période → récapitulatif → facture imprimable en PDF ; les heures passent à « facturé » puis « payé ».

## Développement

```bash
npm install
npm run dev        # API sur :3000, interface sur :5173
npm test           # tests de la couche métier
npm run build && npm start
```

Toute la logique est dans `src/server/core.ts`, partagée par l'API web (`api.ts`) et le serveur MCP (`mcp.ts`). Les jours sont stockés en date locale (Paris), les horodatages en UTC. Le design system est dans `src/web/styles/theme.css`, la maquette d'origine dans `design/maquette.html`.
