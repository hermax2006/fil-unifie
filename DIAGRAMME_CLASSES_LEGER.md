# Diagramme de classes léger - Fil Unifié

Pour une meilleure lisibilité dans Obsidian (Mermaid plus petit).

## 1) Types partagés
```mermaid
classDiagram
    class UnifiedEvent {
        +id: string
        +connector: string
        +accountId: string
        +externalId: string
        +kind: EventKind
        +author: Author
        +title: string
        +body: string
        +url: string
        +occurredAt: string
        +receivedAt: string
    }
    class NewEvent {
        +connector: string
        +accountId: string
        +kind: EventKind
        +body: string
    }
    class ConnectorInfo {
        +id: string
        +name: string
        +category: string
        +access: string
        +canReply: boolean
        +status: string
    }
    UnifiedEvent --> NewEvent
```

## 2) Connecteurs
```mermaid
classDiagram
    class BaseConnector {
        <<abstract>>
        +info: ConnectorInfo
        +verifyWebhook(req, secret): boolean
        +normalize(req, accountId): NewEvent[]
    }
    class WebhookConnector
    class TelegramConnector
    class SlackConnector
    class ConnectorRegistry {
        +get(id): BaseConnector
        +catalog(): ConnectorInfo[]
    }
    BaseConnector <|-- WebhookConnector
    BaseConnector <|-- TelegramConnector
    BaseConnector <|-- SlackConnector
    ConnectorRegistry --> BaseConnector
```

## 3) Webhooks & endpoints
```mermaid
classDiagram
    class WebhookRouter {
        +post()
    }
    class EndpointResolver {
        +resolveEndpoint(pathToken)
    }
    class WebhookEndpoint {
        +id: string
        +account_id: string
        +connector_id: string
        +path_token: string
        +secret_encrypted: string
    }
    WebhookRouter --> EndpointResolver
    EndpointResolver --> WebhookEndpoint
```

## 4) Traitement & temps réel
```mermaid
classDiagram
    class Queue {
        <<interface>>
        +enqueueEvent(e: NewEvent)
    }
    class MemoryQueue
    class ProcessEvent {
        +processEvent(input): Promise~void~
    }
    class SSE {
        +sseHandler(req,res)
        +broadcast(e)
    }
    Queue <|-- MemoryQueue
    Queue --> ProcessEvent
    ProcessEvent --> SSE
```

## 5) Persistance & comptes
```mermaid
classDiagram
    class DbClient {
        +db: Database
        +migrate()
    }
    class EventsRepo {
        +makeDedupKey(e): string
        +addEventRow(e): boolean
        +listEvents(limit,userId)
    }
    class User {
        +id: string
        +email: string
        +password_hash: string
    }
    class Account {
        +id: string
        +user_id: string
        +name: string
    }
    class ConnectorConnection {
        +id: string
        +account_id: string
        +connector_id: string
        +encrypted_tokens_json: string
    }
    EventsRepo --> DbClient
    Account --> User
    ConnectorConnection --> Account
```

## Flux simplifié
```mermaid
flowchart LR
    A[App tierce] --> B[/webhooks/w/:path_token/]
    B --> C[EndpointResolver]
    C --> D[Connector]
    D --> E[Queue]
    E --> F[ProcessEvent]
    F --> G[EventsRepo + dedup_key]
    G --> H[SSE]
    H --> I[Client]
```
