import { createHash, randomBytes } from 'node:crypto';

/** Jeton secret placé dans l'URL : jamais stocké en clair. */
export function generatePathToken(): string {
  return randomBytes(24).toString('hex');
}

/** Empreinte SHA-256 utilisée pour retrouver un endpoint sans stocker le jeton. */
export function hashPathToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
