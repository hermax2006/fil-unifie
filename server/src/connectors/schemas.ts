import { z } from 'zod';
import type { ZodSchema } from 'zod';

/**
 * Validation de la config par connecteur.
 * - Champs sensibles (mot de passe) côté tokens, jamais dans config.
 * - `.strict()` pour repérer les fautes de frappe dans les champs.
 */
export const imapConfigSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().min(1),
  mailbox: z.string().trim().min(1).optional(),
  mailboxes: z.array(z.string().trim().min(1)).max(50).optional(),
  smtpHost: z.string().trim().min(1).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().min(1).optional(),
  from: z.string().trim().min(3).optional(),
}).strict();

export const rssConfigSchema = z.object({
  url: z.string().trim().url(),
}).strict();

const schemas: Record<string, ZodSchema> = {
  imap: imapConfigSchema,
  rss: rssConfigSchema,
};

export type ConfigCheck = { ok: true } | { ok: false; details: unknown };

export function validateConnectorConfig(connectorId: string, config: unknown): ConfigCheck {
  const schema = schemas[connectorId];
  if (!schema) return { ok: true };
  const parsed = schema.safeParse(config ?? {});
  return parsed.success ? { ok: true } : { ok: false, details: parsed.error.flatten() };
}
