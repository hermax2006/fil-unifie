import type { ConnectorInfo, NewEvent } from '@fil/shared';

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;   // corps brut, nécessaire pour vérifier une signature
  body: unknown;     // corps déjà décodé en JSON
}

/** Contexte fourni à un connecteur qui interroge une source distante (polling). */
export interface PollContext {
  accountId: string;
  config: Record<string, unknown>;
  tokens: Record<string, unknown> | null;
  /** Dernière interrogation réussie, pour ne récupérer que le nouveau contenu. */
  lastPolledAt?: string;
  /**
   * Curseurs par « ressource » (ex. dossier IMAP) : clé = nom de ressource,
   * valeur = dernier curseur connu. Précède lastPolledAt quand présent.
   */
  resources?: Record<string, string | undefined>;
}

export interface PollResult {
  events: NewEvent[];
  /** Curseur libre (id du dernier message, ETag, date...) pour le prochain tour. */
  cursor?: string;
  /** Curseurs par ressource (ex. un dossier IMAP) : plus fin que le curseur global. */
  resourceCursors?: { resource: string; cursor: string }[];
}

/** Paramètres pour retrouver le contenu d'une pièce jointe à la demande. */
export interface AttachmentRef {
  filename: string;
  /** IMAP : dossier et UID si les métadonnées les connaissent (nouveaux événements). */
  mailbox?: string;
  uid?: number;
  /** Position du fichier dans la liste des PJ du message d'origine. */
  index?: number;
  /** Message-ID du message d'origine (repli pour les anciens événements). */
  messageId?: string;
}

export interface DownloadAttachmentResult {
  content: Buffer;
  contentType?: string;
}

/** Contexte fourni pour répondre à un événement depuis le fil. */
export interface ReplyContext {
  accountId: string;
  config: Record<string, unknown>;
  tokens: Record<string, unknown> | null;
  to: string[];
  subject?: string;
  body: string;
  /** Message-ID d'origine, pour le threading côté client mail. */
  inReplyTo?: string;
  references?: string[];
}

export interface ReplyResult {
  messageId?: string;
}

/** Chaque app du catalogue est un module qui étend cette classe. */
export abstract class BaseConnector {
  abstract readonly info: ConnectorInfo;

  /** Vérifie que la requête vient bien de l'app. Refus par défaut. */
  verifyWebhook(_req: WebhookRequest, _secret: string | undefined): boolean {
    return false;
  }

  /** Réponse immédiate pour une poignée de main (ex. Slack url_verification). */
  handshake(_req: WebhookRequest): unknown | undefined {
    return undefined;
  }

  /** Transforme la requête reçue en événements au format commun. */
  abstract normalize(req: WebhookRequest, accountId: string): NewEvent[];

  /**
   * Interroge la source distante et renvoie les nouveaux événements.
   * Optionnel : seuls les connecteurs « polling » l'implémentent (RSS, IMAP...).
   */
  poll?(_ctx: PollContext): Promise<PollResult>;

  /** Vérifie la connexion/configuration sans récupérer ni stocker d'événements. */
  test?(_ctx: PollContext): Promise<unknown>;

  /** Envoie une réponse à l'événement (email, Slack, Telegram...). */
  reply?(_ctx: ReplyContext): Promise<ReplyResult>;

  /** Récupère le contenu d'une pièce jointe à la demande (IMAP...). */
  downloadAttachment?(_ctx: PollContext, _params: AttachmentRef): Promise<DownloadAttachmentResult>;

  // À ajouter plus tard : connect().
}

export function header(req: WebhookRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
