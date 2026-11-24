# Fil unifié

Un fil unique qui rassemble les messages et notifications de plusieurs applications.

## Structure

```
fil-unifie/
├── shared/           Types partagés (UnifiedEvent, ConnectorInfo), dossier unique
├── client/           React + Vite (fil, catalogue ; voix à venir dans src/voice)
└── server/src/
    ├── config/       Variables d'env et config
    ├── crypto/       Chiffrement AES-256-GCM des tokens
    ├── db/           SQLite (WAL) + migrations + repositories
    ├── connectors/   Un module par app + base.connector + registry
    ├── webhooks/     Réception, vérification de signature, mise en file
    ├── sse/          Flux temps réel
    ├── auth/         Sessions (cookie httpOnly) + middlewares
    ├── oauth/        OAuth Google / Microsoft / Slack (PKCE-free, state anti-CSRF)
    ├── routes/       Routes API Express
    ├── utils/        Validation, dates, divers
    └── queues/       File + traitement (en mémoire, BullMQ plus tard)
```

## Démarrer

```bash
npm install
npm run dev:server     # http://localhost:4000
npm run dev:client     # http://localhost:5173 (dans un autre terminal)
```

## Tester sans aucune app connectée

Avec le serveur lancé, envoie un événement via le webhook générique
(en local, le secret par défaut est `dev-secret`) :

```bash
curl -X POST http://localhost:4000/webhooks/webhook/moi \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: dev-secret" \
  -d '{"title":"Test","body":"Mon premier événement","author":"Moi"}'
```

Il apparaît dans le fil du client en direct.

## Connexions OAuth (recommandé, optionnel)

Sans identifiants OAuth, l'app propose le mot de passe d'application (Gmail/Outlook) ou le
webhook manuel. Avec, les boutons « Se connecter avec … » apparaissent dans l'assistant et
les réglages.

| Fournisseur | Variables | Redirect URI | Scopes |
|---|---|---|---|
| Google (Gmail) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `http://localhost:4000/auth/google/callback` | `https://mail.google.com/` (API Gmail activée, scope ajouté dans *Data Access*) |
| Google (Agenda) | idem | `http://localhost:4000/auth/google/calendar/callback` | `calendar.readonly` |
| Microsoft / Outlook | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | `http://localhost:4000/auth/microsoft/callback` | `IMAP.AccessAsUser.All`, `SMTP.Send`, `offline_access`, `openid email profile` |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | `http://localhost:4000/auth/slack/callback` | `chat:write`, `channels:history`, `users:read`, `team:read`… |

`PUBLIC_BASE_URL` sert de base aux redirect URIs ; en production mets l'URL HTTPS publique.

## Ajouter une app

1. Créer `server/src/connectors/monapp.connector.ts` (étendre `BaseConnector` :
   `verifyWebhook`, `normalize`).
2. L'ajouter à la liste dans `connectors/registry.ts`.

## Inclus

- Connecteurs : IMAP/SMTP (Gmail, Outlook, tout serveur) avec ou sans OAuth, Telegram (lecture + réponse),
  Slack (lecture + réponse), RSS/Atom, Google Agenda (lecture), webhook générique.
- Fil temps réel (SSE), catalogue d'apps, réponses depuis le fil, pièces jointes, comptes multi-utilisateurs.
- Vérification de signature sur tous les webhooks ; en production, les secrets sont obligatoires (voir `.env.example`).

## À ajouter progressivement

PostgreSQL · hébergement HTTPS · monitoring · WhatsApp Business · résumé IA · widget vocal · PWA · Capacitor · Tauri.
