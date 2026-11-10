# Pipeline de construction - Fil Unifié

Ce document décrit **étape par étape** ce qu'il reste à construire, comment s'y prendre et comment garder le projet extensible pour ajouter de nouveaux connecteurs/logiques sans tout casser.

## Objectif
Construire un "fil unifié" qui agrège notifications/messages depuis plusieurs applications (via webhooks/polling) dans une seule interface, avec une base solide, modulaire et évolutive.

## État actuel
- [x] Monorepo (client/server/shared)
- [x] Serveur Express + routes api/webhooks + SSE
- [x] Connecteurs modulaires (base, registry, webhook générique, telegram, slack)
- [x] File/queue en mémoire (setImmediate)
- [x] Stockage SQLite (persiste)
- [x] Client React + Vite avec Feed/Connectors
- [x] Types partagés (@fil/shared)
- [x] Crypto AES-256-GCM (tokens)
- [x] Vérification signatures webhooks

## Pipeline étape par étape

### Étape 1: Modélisation & base de données (priorité haute)
Objectif: rendre le schéma plus complet pour gérer comptes, connexions, événements.

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **1.1 Étendre le schéma** | `server/src/db/schema.sql` | Ajouter `accounts(id, user_id, name, created_at)`, `connector_connections(id, account_id, connector_id, config_json, encrypted_tokens_json, active, created_at, updated_at)`, `webhook_endpoints(id, account_id, connector_id, secret_hash, path_token, created_at)`. |
| **1.2 Migrations** | `server/src/db/migrate.ts` | Créer un système de migrations simple (version table) pour éviter de casser si on modifie le schéma. |
| **1.3 Repository pattern** | `server/src/db/repos/` | Créer `events.repo.ts`, `accounts.repo.ts`, `connections.repo.ts` pour isoler SQL du reste du code. |
| **1.4 Types DB** | `shared/src/db.ts` (nouveau) ou `server/src/db/types.ts` | Types pour les lignes SQL (row types) distincts des types API. |

**Critère de validation:** Migrations s'exécutent au démarrage, aucun changement dans `webhooks/router.ts` nécessaire.

### Étape 2: Authentification & multi-comptes (priorité haute)
Objectif: permettre d'avoir plusieurs comptes/connecteurs avec un minimum d'auth.

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **2.1 Sessions** | `server/src/auth/session.ts`, `server/src/auth/middleware.ts` | Utiliser des sessions httpOnly (express-session) ou JWT httpOnly. Pour MVP simple, sessions en mémoire/SQLite. |
| **2.2 Routes auth** | `server/src/routes/auth.ts` | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. |
| **2.3 Lier comptes** | `server/src/routes/accounts.ts` | Créer/sélectionner un compte utilisateur, lier un connecteur. |
| **2.4 Protéger routes** | `server/src/routes/api.ts` | Protéger `/events`, `/connectors` si nécessaire, garder `/health` public. |

**Critère de validation:** Un utilisateur peut se connecter et voir uniquement ses événements.

### Étape 3: Gestion des connecteurs & configuration (priorité haute)
Objectif: rendre l'ajout de connecteurs vraiment extensible.

| Tâche | Fichier(s) | Détails |
|tag
|---|---|---|
| **3.1 Interface enrichie** | `server/src/connectors/base.connector.ts` | Ajouter `connect()`, `poll()`, `reply()`, `getAuthUrl()`, `exchangeCode()`. Garder les méthodes existantes pour rétrocompatibilité. |
| **3.1.1 Validation config** | `server/src/connectors/schema.ts` | Utiliser Zod pour valini connecter les configs en fonction de chaque connecteur. |
| **3.2 Registre amélioré** | `server/src/connectors/registry.ts` | Garder le registre central, ajouter des filtations by status/access, permettre chargement dynamique. |
| **3.3 Gestion des connexions** | `server/src/routes/connections.ts` | Créer/supprimer/activer désactiver une connexion, stocker config & tokens chiffrés via `crypto/tokens.ts`. |
| **3.4 Secrets webhooks** | `server/src/webhooks/secret-manager.ts` | Générer des secrets aléatoires par endpoint webhook, hasher (SHA-256) en base, vérifier avec timingSafeEqual. |

**Critère de validation:** Ajouter un nouveau connecteur devrait prendre < 30 min (créer un fichier dans `connecteurs/`, l'ajouter au registre). 

### Étape 4: Queue & workers (priorité moyenne-haute)
Objectif: préparer au-delà du `setImmediate` (polling, retries, DLQ).

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **4.1 Abstraction queue** | `server/src/queues/queue.interface.ts` | Interface IQueue avec `add()`, `process()`. Permet de basculer entre mémoire et BullMQ sans changer le code. |
| **4.2 Implémentation mémoire** | `server/src/queues/memory.queue.ts` | Refactoriser l'actuel `enqueueEvent()` vers cette interface. |
| **4.3 BullMQ (optionnel)** | `server/src/queues/bullmq.queue.ts` | Si `REDIS_URL` présent, utiliser BullMQ. Sinon mémoire. Ajouter `server/src/queues/worker.ts`. |
| **4.4 Jobs types** | `server/src/queues/jobs/` | `process-event.ts`, `poll-connector.ts`, `sync-account.ts`. Séparer clairement. |

**Critère de validation:** Si Redis absent, tout fonctionne comme aujourd'hui. Si Redis présent, les jobs passent par BullMQ.

### Étape 5: Polling + synchronisation (priorité moyenne)
Objectif: connecter des apps sans webhook (IMAP, RSS, etc.).

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **5.1 Scheduler** | `server/src/scheduler/index.ts` | Cron simple (node-cron) ou BullMQ repeatable jobs. |
| **5.2 IMAP connector** | `server/src/connectors/imap.connector.ts` | Polling IMAP (imap-simple/node-imap), normaliser en `UnifiedEvent`. Stocker `last_uid` par connexion. |
| **5.3 RSS connector** | `server/src/connectors/rss.connector.ts` | Parser RSS/Atom, déduplication par `externalId` (guid/link). |
| **5.4 Deduplication** | `server/src/utils/dedup.ts` | Créer `dedup_key` basé sur `(connector, accountId, externalId)` ou hash du contenu. Empêcher doublons. |

**Critère de validation:** Un connecteur en polling ne crée pas de doublons entre deux exécutions.

### Étape 6: Voice/IA & accessibilité (priorité basse-moyenne)
Objectif: ajout vocal comme prévu dans les objectifs.

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **6.1 Voice widget** | `client/src/voice/VoiceWidget.tsx`, `client/src/voice/hooks.ts` | Bouton microphone, enregistrement, transcription. |
| **6.2 Transcription** | `server/src/voice/transcribe.ts` | Groq Whisper (recommandé) ou Gemini. Fallback local si possible. |
| **6.3 TTS** | `client/src/voice/tts.ts` | `speechSynthesis` côté client, options voix. |
| **6.4 Actions vocales** | `server/src/voice/actions.ts` | Demander à LLM de mapper commande vocale vers action (lire, répondre, marquer lu). |

**Critère de validation:** Enregistrer audio, obtenir transcription, pouvoir lire un événement à voix haute.

### Étape 7: Client & UX (priorité moyenne)
Objectif: rendre l'utilisation fluide.

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **7.1 Layout amélioré** | `client/src/App.tsx`, `client/src/index.css` | Barre de recherche/filtre, onglets (Fil / Applications / Réglages). |
| **7.2 Feed amélioré** | `client/src/components/Feed.tsx`, `client/src/components/EventItem.tsx` | Composant séparé pour un événement, tri, filtre par connecteur/kind, "marquer lu". |
| **7.3 Gestion connexions** | `client/src/components/Connections.tsx` | Ajouter/modifier/lier un connecteur, afficher URL webhook, configurer secret. |
| **7ep.7.4 Temps réel** | Déjà fait via SSE | Vérifier reconnexion SSE en cas de déconnexion, gérer erreurs. |

**Critère de validation:** L'utilisateur peut facilement configurer un nouveau webhook générique depuis l'UI.

### Étape 8: Sécurité, tests & déploiement (priorité haute pour la production)
Objectif: renforcer sécurité et faciliter déploiement.

| Tâche | Fichier(s) | Détails |
|---|---|---|
| **8.1 Sécurité webhooks** | Déjà fait partiellement | Améliorer secret-manager, vérifier timingSafeEqual partout, interdire fallback dev-secret en production. |
| **8.2 CORS** | `server/src/app.ts` (nouveau) ou `server/src/index.ts` | Configurer strict CORS selon `ALLOWED_ORIGINS` (.env). Déjà prévu dans `.env.example. |
| **8.3 Validation** | `server/src/utils/validate.ts` | Middleware Zod pour valider body/params/query. |
| **8.4 Tests unitaires** | `server/tests/`, `shared/tests/ | But simple (connecteurs, normalize, crypto). Vitest. |
| **8.5 Docker & déploiement** | `docker-compose.yml, `Dockerfile` | Préparer pour prod (Postgres + Redis + server + client). |

**Critère de validation:** En prod, aucun secret n'apparaît dans les logs, signatures sont vérifiées, CORS strict.

## Règles d'évolutivité (à respecter)
Pour ajouter **n'importe quel connecteur** sans casser l'existant:

1. **Créer un fichier** dans `server/src/connectors/<id>.connector.ts` qui étend `BaseConnector`.
2. **Implémenter** `info` + `verifyWebhook()` (si webhook) + `normalize()`. Ajouter `connect()/poll()/reply()` si nécessaire.
3. **Ajouter au registre** `server/src/connectors/registry.ts`.
4. **Mettre à jour types** si nouveau `EventKind` nécessaire dans `shared/src/index.ts`.
5. **Pas toucher** aux routes `webhooks/router.ts`, `api/routes.ts`, `queues/`, `sse/` - ils doivent rester génériques.

Le principe: **"interface partagée + registre central"**. 

## Plan immédiat (ce qu'on doit construire maintenant)
Pour avancer concrètement dans l'immédiat:

| Ordre | Tâche | Pourquoi |
|---|---|---|---|
| **A)** | Étendre schéma SQLite + repo pattern (Étape 1) | Éviter de devoir tout réécrire plus tard pour multi-comptes. |
| **B)** | Améliorer UI Connections (copier URL, configurer secret) + Feed (filtres) (Étape 7) | Rendre le testable et utilisable sans Postman/curl. |
| **C)** | Créer secret-manager pour webhooks (Étape 3.4) | Mieux sécuriser et faciliter ajout de nouveaux endpoints webhooks. |
| **D)** | Mettre en place auth basique (Étape 2) | Préparer au multi-utilisateurs. |
| **E)**
| **E)** | Tests / validation des connecteurs (Étape 8.4) | Garantir stabilité à chaque ajout.

**Recommandation:** Commencer par **A)** - étendre le schéma + repo pattern. C'est le socle qui facilitera toutes les étapes suivantes.

## Ajouts issus du correctif (Claude)

### Corrections appliquées (Étape A' - Socle DB refondu)
- [x] **Table `users`** ajoutée (auth futur)
- [x] **Tables `accounts`, `connector_connections`, `webhook_endpoints`** ajoutées
- [x] **`webhook_endpoints.path_token` UNIQUE** pour identifier l'endpoint sans exposer `accountId` dans l'URL
- [x] **`events.dedup_key` UNIQUE** (idempotence dès les webhooks, Slack/Telegram)
- [x] **`events.user_id`, `events.connector_id`** ajoutés (préparation isolation SSE par utilisateur)
- [x] **Système de migrations** avec `schema_version`
- [x] **Repo pattern** (`server/src/db/repos/`) pour isoler SQL
- [x] **`endpoint-resolver.ts`** prêt pour résolution par `path_token`

### Règles à respecter (mises à jour)
- **Secrets webhook**: ne pas hacher les secrets utilisés pour recalculer des HMAC (Slack). Chiffrer avec AES-256-GCM si nécessaire. Seul `path_token` peut être hashe/retrouvé.
- **URL webhook**: basculer vers `/webhooks/w/:path_token` (plus `/webhooks/:connector/:accountId`). Résolution via `endpoint-resolver`.
- **Idempotence**: calculer `dedup_key` et ignorer les doublons (ne pas `INSERT OR REPLACE`).
- **SSE**: préparer diffusion par utilisateur/compte (ne plus broadcaster à tout le monde une fois auth en place).
- **Ordre à suivre**: A' → D (auth) → C (webhooks sécurisés) → B (UI connexions) → E (tests/durcissement)

## Tables intermédiaires à prévoir (évolutif)

### Indispensables au démarrage (MVP minimal)
| Table | Rôle | Colonnes clés |
|---|---|---|
| `users` | Comptes utilisateurs | `id`, `email` (unique), `password_hash` |
| `sessions` | Sessions connectées (cookie httpOnly) | `id`, `user_id`, `expires_at` |
| `connector_connections` | App branchée par l'utilisateur | `id`, `account_id`, `connector_id`, `tokens_enc`, `cursor`, `active` |
| `events` | Messages/notifications du fil | `id`, `account_id`, `connection_id`, `external_id`, `dedup_key` (UNIQUE), `kind`, `body`, `occurred_at`, `received_at`, `read_at`, `user_id` |
| `schema_migrations` | Suivi des migrations | `version`, `applied_at` |

### Selon les étapes
| Table | Étape | Rôle |
|---|---|---|
| `accounts` | Auth/espaces | Espace de travail d'un utilisateur (utile si multi-comptes/espaces) |
| `webhook_endpoints` | Webhooks sécurisés | Endpoint par connexion avec `path_token_hash`, `secret_enc` |
| `webhook_deliveries` | Fiabilité webhooks | Historique des requêtes webhooks (acceptée/rejetée/doublon) |
| `password_resets` | Auth | Jetons à usage unique pour réinitialisation mot de passe |
| `app_wishes` | Catalogue | Demandes "Je veux celle-ci" pour apps "bientôt" |
| `oauth_states` | OAuth | Protection contre CSRF lors du retour OAuth |
| `sync_state` | Polling | Curseur par ressource (dossiers/calendriers) au lieu d'un seul |
| `sync_runs` | Polling | Historique des synchronisations (début/fin/erreur) |
| `outbound_messages` | Réponses | Réponses envoyées depuis le fil + statut |
| `audit_log` | Sécurité/traçabilité | Actions utilisateur |
| `threads` | UX | Regroupement des messages par conversation |
| `event_attachments` | UX | Pièces jointes |
| `user_settings` | UX | Préférences (langue, voix, notifications) |
| `push_subscriptions` | Notifications | Abonnements push par appareil |
| `saved_filters` | UX | Filtres/recherches enregistrés |
| `ai_usage` | Voix/IA | Consommation par utilisateur (limiter coûts) |
| `summaries` | Voix/IA | Résumés conservés |
| `reply_drafts` | Voix/IA | Brouillons proposés en attente de validation |
| `plans`, `subscriptions`, `payments` | Paiements | Offres/abonnements/paiements |
| `payment_webhooks` | Paiements | Webhooks prestataires de paiement |

### Tables de liaison (si besoin)
| Table | Étape | Rôle |
|---|---|---|
| `account_members` | Partage | Lien utilisateurs ↔ comptes (plusieurs personnes par espace) |
| `event_tags` | Organisation | Étiquettes partagées sur plusieurs événements |
| `event_reads` | Partage/UX | Statut lu/non-lu par utilisateur (si compte partagé) |

**Note:** Les files BullMQ/Redis ne génèrent pas de tables SQL. `sessions` peut vivre en SQLite ou Redis selon le choix.

## Étape C - Avancement (webhooks sécurisés)
- [x] Route sécurisée `/webhooks/w/:path_token` avec `endpoint-resolver`
- [x] Secrets webhook chiffrés AES-256-GCM (`secret-manager.ts`), affichés une seule fois
- [x] CRUD endpoints (génération/liste/révocation) + UI "Connexions"
- [x] Ancien routeur `/webhooks/:connector/:accountId` : dev only, 410 en prod
- [x] Slack HMAC vérifié avec `rawBody` + timestamp anti-rejeu (OK pour secret déchiffré)
- [x] Tests Vitest : `verifyWebhook` (webhook/telegram/slack), handshake Slack, normalisation, `dedup_key`
- [ ] Rotation de secret / hash `path_token` (optionnel selon politique)

## Durcissement (fait)
- [x] CORS strict via `ALLOWED_ORIGINS` (fallback localhost en dev)
- [x] Handler d'erreur global (CORS -> 403)
- [x] Rotation du secret webhook (`POST /webhook/endpoints/:id/rotate-secret`) + UI "Nouveau secret"

## Validation & connexions (fait)
- [x] Validation Zod : `POST /auth/register|login`, `GET /api/events`, routes `/api/connections/*`
- [x] CRUD `connector_connections` (`connections.repo.ts`) + routes `GET|POST|PATCH`
- [x] UI "Connexions connecteurs" (ajout RSS, pause/réactivation)

## Polling (squelette fait)
- [x] Contrat `poll()` / `PollContext` / `PollResult` dans `base.connector.ts`
- [x] Connecteur RSS/Atom (`rss.connector.ts`) : fetch + parsing, filtre `lastPolledAt`, limite 20 items
- [x] Squelette IMAP (`imap.connector.ts`) annoncé "bientôt"
- [x] Boucle `queues/poller.ts` : connexions actives, `POLL_INTERVAL_MS`
- [x] Attribution `user_id` aux événements webhook et polling
- [x] Tests RSS (normalisation, filtre temporel, refus URL non http)
- [x] Curseur persisté (`sync_state`, migration v3) + reprise après redémarrage
- [x] Backoff exponentiel plafonné (`POLL_BACKOFF_BASE_MS` / `POLL_BACKOFF_MAX_MS`)
- [x] Historique des runs (`sync_runs`) : échecs + succès avec événements, purge > 30 j
- [x] UI : dernière sync + dernier échec par connexion
- [x] BullMQ/Redis (relances durables) et implémentation IMAP réelle (voir sections dédiées)

## IMAP réel (fait)
- [x] Connecteur IMAP via `imapflow` + `mailparser`
- [x] Config : `host`, `port`, `secure`, `user`, `mailbox` (INBOX par défaut)
- [x] Mot de passe/app-password dans `tokens.pass`, chiffré AES-256-GCM
- [x] Route `PUT /api/connections/connector-connections/:id/tokens` (jamais réaffiché)
- [x] UI : formulaire IMAP (hôte, port, utilisateur, mot de passe)
- [x] Recherche IMAP `SINCE` avec marge d'un jour, max 20 messages, déduplication par Message-ID
- [ ] Dossiers multiples, pièces jointes, OAuth Gmail/Outlook, envoi de réponses

## BullMQ / Redis (fait)
- [x] `QUEUE_DRIVER=bullmq` : Queue + Worker BullMQ (`ioredis`)
- [x] Relances : 5 tentatives, backoff exponentiel, `removeOnComplete/Fail`
- [x] Fallback automatique en mémoire si Redis est indisponible
- [x] Arrêt propre sur SIGINT/SIGTERM (`stopPoller`, `stopQueue`)
- [x] Redis local installé et testé (smoke test : webhook -> BullMQ -> SQLite/SSE)
- [ ] Supervision des files (Bull Board), DLQ dédiée, Redis managé en production

## IMAP multi-dossiers + pièces jointes (fait)
- [x] `config.mailboxes[]` (UI : dossiers séparés par des virgules), repli sur `mailbox`/INBOX
- [x] Parcours de chaque dossier avec verrou IMAP indépendant
- [x] Métadonnées de pièces jointes (`filename`, `contentType`, `size`), contenu non stocké
- [x] Table `event_attachments` (migration v4), insertion transactionnelle avec l'événement
- [x] API events : pièces jointes renvoyées avec chaque événement
- [x] UI Fil : affichage des pièces jointes et de leur taille
- [x] Webhook générique : accepte `attachments[]` (utile pour tests/intégrations)
- [ ] Téléchargement des pièces jointes, OAuth Gmail/Outlook, envoi de réponses

## Bull Board + DLQ (fait)
- [x] Dashboard `/admin/queues` (`@bull-board/express`) pour la file principale et la DLQ
- [x] Basic auth via `QUEUE_ADMIN_USER` / `QUEUE_ADMIN_PASS` (obligatoire en prod)
- [x] File `fil-events-dlq` : les jobs épuisés après 5 tentatives y sont copiés
- [x] `POST /admin/queues/requeue-dlq` pour remettre les dead letters dans la file principale
- [ ] Alerting sur DLQ, purge automatique, Redis managé en production
