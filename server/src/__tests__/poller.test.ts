import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../queues/poller.js';

describe('computeBackoffMs', () => {
  it('aucun délai sans échec', () => {
    expect(computeBackoffMs(0, 30000, 1800000)).toBe(0);
  });

  it('double à chaque échec', () => {
    expect(computeBackoffMs(1, 30000, 1800000)).toBe(30000);
    expect(computeBackoffMs(2, 30000, 1800000)).toBe(60000);
    expect(computeBackoffMs(3, 30000, 1800000)).toBe(120000);
  });

  it('plafonne au maximum', () => {
    expect(computeBackoffMs(20, 30000, 1800000)).toBe(1800000);
  });
});
