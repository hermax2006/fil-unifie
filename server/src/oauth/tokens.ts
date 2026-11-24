import { decryptToken, encryptToken } from '../crypto/tokens.js';
import { setConnectionTokens, type ConnectorConnectionRow } from '../db/repos/connections.repo.js';
import { refreshGoogleAccessToken } from './google.js';
import { refreshMicrosoftAccessToken } from './microsoft.js';

/** Tokens tels que stockés (chiffrés) dans connector_connections. */
export interface StoredTokens extends Record<string, unknown> {
  authType?: string;
  /** Google (défaut), microsoft, slack… */
  provider?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export function decodeConnectionTokens(encrypted: string | null): StoredTokens | null {
  if (!encrypted) return null;
  try {
    return JSON.parse(decryptToken(encrypted)) as StoredTokens;
  } catch {
    return null;
  }
}

export function isOAuthTokens(tokens: StoredTokens | null | undefined): boolean {
  return tokens?.authType === 'oauth2' && typeof tokens.accessToken === 'string';
}

/** Marge avant expiration pour éviter un jeton mort en pleine requête. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

/**
 * Renvoie les tokens utilisables pour une connexion.
 * - Google / Microsoft : rafraîchit l'access token s'il expire bientôt et
 *   ré-enregistre les tokens chiffrés (le refresh token est conservé).
 * - Slack (jeton bot sans expiration) ou mot de passe d'application : tel quel.
 * Lève une erreur explicite si le refresh token est absent/expiré.
 */
export async function freshConnectionTokens(
  row: Pick<ConnectorConnectionRow, 'id' | 'account_id' | 'encrypted_tokens_json'>,
): Promise<StoredTokens | null> {
  const tokens = decodeConnectionTokens(row.encrypted_tokens_json);
  if (!tokens || !isOAuthTokens(tokens)) return tokens;
  // Pas d'information d'expiration (ex. Slack) : rien à rafraîchir.
  if (typeof tokens.expiresAt !== 'number') return tokens;

  if (tokens.expiresAt > Date.now() + REFRESH_MARGIN_MS) return tokens;
  if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken) {
    throw new Error('session expirée : reconnecte le compte');
  }

  const provider = tokens.provider ?? 'google';
  const fresh = provider === 'microsoft'
    ? await refreshMicrosoftAccessToken(tokens.refreshToken)
    : await refreshGoogleAccessToken(tokens.refreshToken);

  const next: StoredTokens = {
    ...tokens,
    accessToken: fresh.access_token,
    expiresAt: Date.now() + Math.max(60, Number(fresh.expires_in) || 3600) * 1000,
  };
  if (fresh.refresh_token) next.refreshToken = fresh.refresh_token;
  setConnectionTokens(row.id, row.account_id, encryptToken(JSON.stringify(next)));
  return next;
}
