import { describe, it, expect } from 'vitest';
import { makeDedupKey } from '../db/repos/events.repo.js';
import type { UnifiedEvent } from '@fil/shared';

function ev(over: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: '1', connector: 'webhook', accountId: 'acc', kind: 'message',
    body: 'hello', occurredAt: '2026-01-01T00:00:00Z', receivedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as UnifiedEvent;
}

describe('makeDedupKey', () => {
  it('same input -> same key', () => {
    expect(makeDedupKey(ev())).toBe(makeDedupKey(ev()));
  });
  it('different externalId/body -> different key', () => {
    expect(makeDedupKey(ev({ externalId: 'a' }))).not.toBe(makeDedupKey(ev({ externalId: 'b' })));
    expect(makeDedupKey(ev({ body: 'a' }))).not.toBe(makeDedupKey(ev({ body: 'b' })));
  });
});
