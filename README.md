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
    ├── db/           Stockage (en mémoire pour l'instant, Postgres/SQLite à venir)
    ├── connectors/   Un module par app + base.connector + registry
    ├── webhooks/     Réception, vérification de signature, mise en file
    ├── sse/          Flux temps réel
    ├── auth/         À venir
    ├── routes/       Routes API Express
    ├── utils/        À venir
    └── queues/       File + traitement (en mémoire, BullMQ plus tard)
```

## Démarrer

```bash
npm install
npm run dev:server     # http://localhost:3001
npm run dev:client     # http://localhost:5173 (dans un autre terminal)
```

## Tester sans aucune app connectée

Avec le serveur lancé, envoie un événement via le webhook générique
(en local, le secret par défaut est `dev-secret`) :

```bash
curl -X POST http://localhost:3001/webhooks/webhook/moi \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: dev-secret" \
  -d '{"title":"Test","body":"Mon premier événement","author":"Moi"}'
```

Il apparaît dans le fil du client en direct.

## Ajouter une app

1. Créer `server/src/connectors/monapp.connector.ts` (étendre `BaseConnector` :
   `verifyWebhook`, `normalize`).
2. L'ajouter à la liste dans `connectors/registry.ts`.

## Inclus au départ

- Connecteurs : webhook générique, Telegram (réception), Slack (réception).
- Fil temps réel (SSE), catalogue avec apps « bientôt ».
- Vérification de signature sur tous les webhooks ; en production, les secrets
  sont obligatoires (voir `.env.example`).

## À ajouter progressivement

PostgreSQL ou SQLite (`server/src/db/`) · idempotence des webhooks · BullMQ + Redis · authentification des utilisateurs ·
OAuth (Gmail, Calendar) · réponses depuis le fil · widget vocal · PWA · Capacitor · Tauri.
