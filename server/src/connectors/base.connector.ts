import type { ConnectorInfo, NewEvent } from '@fil/shared';

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;   // corps brut, nécessaire pour vérifier une signature
  body: unknown;     // corps déjà décodé en JSON
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

  // À ajouter plus tard : connect(), poll(), reply().
}

export function header(req: WebhookRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
