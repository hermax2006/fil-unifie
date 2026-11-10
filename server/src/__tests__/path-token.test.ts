import { describe, expect, it } from 'vitest';
import { generatePathToken, hashPathToken } from '../webhooks/path-token.js';

describe('path token', () => {
  it('génère des jetons uniques', () => {
    expect(generatePathToken()).not.toBe(generatePathToken());
  });

  it('hache de façon déterministe sans exposer le jeton', () => {
    const token = generatePathToken();
    const hash = hashPathToken(token);
    expect(hash).toBe(hashPathToken(token));
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
