/** Types partagés entre le serveur et le client. */

export type EventKind = 'message' | 'mention' | 'notification' | 'task' | 'other';

/** Métadonnées d'une pièce jointe (le contenu n'est pas stocké dans le fil). */
export interface EventAttachment {
  filename: string;
  contentType?: string;
  size?: number;
}

/** Format commun : chaque app est transformée en ceci avant d'entrer dans le fil. */
export interface UnifiedEvent {
  id: string;
  connector: string;          // ex. "telegram"
  accountId: string;          // compte connecté de l'utilisateur
  externalId?: string;        // identifiant d'origine dans l'app source
  kind: EventKind;
  author?: { id?: string; name: string };
  title?: string;
  body: string;
  url?: string;
  attachments?: EventAttachment[];
  occurredAt: string;         // ISO : quand c'est arrivé dans l'app source
  receivedAt: string;         // ISO : quand le fil l'a reçu
  readAt?: string;            // ISO : quand l'utilisateur a lu l'événement
}

/** Événement produit par un connecteur, avant que le serveur ajoute id et receivedAt. */
export type NewEvent = Omit<UnifiedEvent, 'id' | 'receivedAt'>;

export type Access = 'gratuit' | 'conditionnel' | 'payant';

/** Ligne du catalogue affiché à l'utilisateur. */
export interface ConnectorInfo {
  id: string;
  name: string;
  category: string;
  access: Access;
  canReply: boolean;
  status: 'available' | 'soon';
}
