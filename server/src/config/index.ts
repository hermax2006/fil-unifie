const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  isProd,
};

/**
 * Secret de vérification des webhooks d'un connecteur.
 * MVP : variables d'environnement. Plus tard : secret par compte, stocké chiffré en base.
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
