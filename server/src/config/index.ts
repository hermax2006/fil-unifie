import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Charger .env AVANT de lire process.env (les imports ES sont hoistés).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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
  pollBackoffBaseMs: Math.max(1000, Number(process.env.POLL_BACKOFF_BASE_MS ?? 30000)),
  pollBackoffMaxMs: Math.max(60000, Number(process.env.POLL_BACKOFF_MAX_MS ?? 1800000)),
  /** File d'événements : mémoire (défaut) ou BullMQ/Redis. */
  queueDriver: (process.env.QUEUE_DRIVER === 'bullmq' ? 'bullmq' : 'memory') as 'bullmq' | 'memory',
  redisUrl: process.env.REDIS_URL,
  redisHost: process.env.REDIS_HOST ?? '127.0.0.1',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  redisPassword: process.env.REDIS_PASSWORD,
  redisDb: Number(process.env.REDIS_DB ?? 0),
  /** Rate limiting HTTP (désactivable via RATE_LIMIT_DISABLED=true). */
  rateLimitEnabled: process.env.RATE_LIMIT_DISABLED !== 'true',
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
