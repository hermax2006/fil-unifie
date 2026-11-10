const isProd = process.env.NODE_ENV === 'production';

function parseOrigins(raw?: string): string[] {
  if (!raw) return isProd ? [] : ['http://localhost:5173', 'capacitor://localhost', 'tauri://localhost'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd,
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  /** Polling des sources distantes (RSS, IMAP...). Désactivable via POLLING_DISABLED=true. */
  pollingEnabled: process.env.POLLING_DISABLED !== 'true',
  pollIntervalMs: Math.max(5000, Number(process.env.POLL_INTERVAL_MS ?? 60000)),
};

/**
 * Secret de vérification des webhooks d'un connecteur (mode legacy env).
 * Préférer les secrets par endpoint (chiffrés en BDD) via /webhooks/w/:path_token.
 */
export function secretFor(connectorId: string): string | undefined {
  const fromEnv: Record<string, string | undefined> = {
    webhook: process.env.WEBHOOK_SECRET,
    telegram: process.env.TELEGRAM_SECRET,
    slack: process.env.SLACK_SIGNING_SECRET,
  };
  const value = fromEnv[connectorId];
  if (value) return value;
  return isProd ? undefined : 'dev-secret'; // pratique en local, refusé en production
}
