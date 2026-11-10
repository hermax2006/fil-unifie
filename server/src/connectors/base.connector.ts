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
}

export interface PollResult {
  events: NewEvent[];
  /** Curseur libre (id du dernier message, ETag, date...) pour le prochain tour. */
  cursor?: string;
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

  // À ajouter plus tard : connect(), reply().
}

export function header(req: WebhookRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
