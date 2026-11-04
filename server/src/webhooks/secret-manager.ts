import { randomBytes } from 'node:crypto';
import { encryptToken, decryptToken } from '../crypto/tokens.js';

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function encryptWebhookSecret(secret: string): string {
  return encryptToken(secret);
}

export function decryptWebhookSecret(encrypted: string): string {
  return decryptToken(encrypted);
}
