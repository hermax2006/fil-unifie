# Diagramme de classes léger - Fil Unifié

Pour une meilleure lisibilité dans Obsidian (Mermaid plus petit).

## 1) Types partagés
```mermaid
classDiagram
    class EvenementUnifie {
        +identifiant: string
        +connecteur: string
        +compteId: string
        +identifiantExterne: string
        +type: TypeEvenement
        +auteur: Auteur
        +titre: string
        +corps: string
        +lien: string
        +dateEvenement: string
        +dateReception: string
    }
    class NouvelEvenement {
        +connecteur: string
        +compteId: string
        +identifiantExterne: string
        +type: TypeEvenement
        +auteur: Auteur
        +titre: string
        +corps: string
        +lien: string
        +dateEvenement: string
    }
    class InfoConnecteur {
        +identifiant: string
        +nom: string
        +categorie: string
        +acces: string
        +peutRepondre: boolean
        +statut: string
    }
    class Auteur {
        +identifiant: string
        +nom: string
    }
    EvenementUnifie --> Auteur
    NouvelEvenement --> Auteur
```

## 2) Connecteurs
```mermaid
classDiagram
    class ConnecteurAbstrait {
        <<abstract>>
        +infos: InfoConnecteur
        +verifierWebhook(requete, secret): boolean
        +normaliser(requete, compteId): NouvelEvenement[]
    }
    class ConnecteurWebhook
    class ConnecteurTelegram
    class ConnecteurSlack
    class RegistreConnecteurs {
        +obtenir(identifiant): ConnecteurAbstrait
        +catalogue(): InfoConnecteur[]
    }
    ConnecteurAbstrait <|-- ConnecteurWebhook
    ConnecteurAbstrait <|-- ConnecteurTelegram
    ConnecteurAbstrait <|-- ConnecteurSlack
    RegistreConnecteurs --> ConnecteurAbstrait
```

## 3) Webhooks & points d'entrée
```mermaid
classDiagram
    class RouteurWebhook {
        +traiter()
    }
    class ResolveurPointEntree {
        +resoudreJeton(jetonChemin): PointEntreeWebhook
    }
    class PointEntreeWebhook {
        +identifiant: string
        +compteId: string
        +connecteurId: string
        +jetonChemin: string
        +secretChiffre: string
        +actif: boolean
    }
    RouteurWebhook --> ResolveurPointEntree
    ResolveurPointEntree --> PointEntreeWebhook
```

## 4) Traitement & temps réel
```mermaid
classDiagram
    class FileAttente {
        <<interface>>
        +ajouterEvenement(evenement: NouvelEvenement)
    }
    class FileAttenteMemoire
    class TraiterEvenement {
        +traiter(evenement: NouvelEvenement): Promise~void~
    }
    class DiffusionTempsReel {
        +gererConnexion(req,res)
        +diffuser(evenement: EvenementUnifie)
    }
    FileAttente <|-- FileAttenteMemoire
    FileAttente --> TraiterEvenement
    TraiterEvenement --> DiffusionTempsReel
```

## 5) Persistance & comptes
```mermaid
classDiagram
    class ClientBaseDonnees {
        +connexion: Database
        +migrer()
    }
    class DepotEvenements {
        +genererCleDedoublonnage(evenement): string
        +ajouterLigne(evenement): boolean
        +lister(limit, utilisateurId)
    }
    class Utilisateur {
        +identifiant: string
        +courriel: string
        +motDePasseHache: string
    }
    class Compte {
        +identifiant: string
        +utilisateurId: string
        +nom: string
    }
    class ConnexionConnecteur {
        +identifiant: string
        +compteId: string
        +connecteurId: string
        +jetonsChiffres: string
        +actif: boolean
    }
    DepotEvenements --> ClientBaseDonnees
    Compte --> Utilisateur
    ConnexionConnecteur --> Compte
```

## Flux simplifié
```mermaid
flowchart LR
    A[Application tierce] --> B[/webhooks/w/:jetonChemin/]
    B --> C[ResolveurPointEntree]
    C --> D[Connecteur]
    D --> E[FileAttente]
    E --> F[TraiterEvenement]
    F --> G[DepotEvenements + cleDedoublonnage]
    G --> H[DiffusionTempsReel]
    H --> I[Client web]
```
