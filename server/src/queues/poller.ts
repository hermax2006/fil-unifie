import { registry } from '../connectors/registry.js';
import { listActiveConnectionsForPolling, type PollingConnectionRow } from '../db/repos/connections.repo.js';
import { getSyncState, saveSyncState, startSyncRun, finishSyncRun, purgeSyncRuns } from '../db/repos/sync.repo.js';
import { decryptToken } from '../crypto/tokens.js';
import { config } from '../config/index.js';
import { enqueueEvent } from './index.js';

/** État de backoff par connexion, en mémoire. */
type BackoffState = { failures: number; nextAttemptAt: number };
const backoff = new Map<string, BackoffState>();
let timer: NodeJS.Timeout | undefined;
let running = false;

/** Délai exponentiel plafonné : base, 2×base, 4×base... maxMs. */
export function computeBackoffMs(failures: number, baseMs: number, maxMs: number): number {
  if (failures <= 0) return 0;
  return Math.min(maxMs, baseMs * 2 ** (failures - 1));
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Interroge une connexion et met ses nouveaux événements en file. */
export async function pollConnection(row: PollingConnectionRow): Promise<number> {
  const connector = registry.get(row.connector_id);
  if (!connector?.poll) return 0;

  const cfg = parseJson<Record<string, unknown>>(row.config_json) ?? {};
  let tokens: Record<string, unknown> | null = null;
  if (row.encrypted_tokens_json) {
    try {
      tokens = JSON.parse(decryptToken(row.encrypted_tokens_json)) as Record<string, unknown>;
    } catch (err) {
      console.error(`Tokens illisibles pour la connexion ${row.id}`, err);
    }
  }

  const startedAt = new Date().toISOString();
  const sync = getSyncState(row.id);

  try {
    const result = await connector.poll({
      accountId: row.account_id,
      config: cfg,
      tokens,
      lastPolledAt: sync?.last_polled_at ?? undefined,
    });

    for (const event of result.events) {
      await enqueueEvent({ ...event, connector: connector.info.id, accountId: row.account_id, connectionId: row.id }, row.user_id);
    }

    const finishedAt = new Date().toISOString();
    saveSyncState(row.id, result.cursor ?? null, finishedAt);

    // On n'historise que les runs utiles (évite une ligne toutes les 60 s).
    if (result.events.length > 0) {
      const runId = startSyncRun(row.id, startedAt);
      finishSyncRun(runId, 'ok', result.events.length);
    }

    return result.events.length;
  } catch (err) {
    const runId = startSyncRun(row.id, startedAt);
    finishSyncRun(runId, 'error', 0, errorMessage(err));
    throw err;
  }
}

/** Un tour de polling sur toutes les connexions actives, avec backoff. */
export async function pollAllConnections(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const row of listActiveConnectionsForPolling()) {
      const state = backoff.get(row.id);
      if (state && Date.now() < state.nextAttemptAt) continue;

      try {
        const count = await pollConnection(row);
        backoff.delete(row.id);
        if (count > 0) console.log(`Polling ${row.connector_id}: ${count} nouvel(s) événement(s)`);
      } catch (err) {
        const failures = (state?.failures ?? 0) + 1;
        const delay = computeBackoffMs(failures, config.pollBackoffBaseMs, config.pollBackoffMaxMs);
        backoff.set(row.id, { failures, nextAttemptAt: Date.now() + delay });
        console.error(
          `Polling ${row.connector_id} (${row.id}) a échoué ` +
          `(tentative ${failures}, prochaine dans ${Math.round(delay / 1000)} s): ${errorMessage(err)}`,
        );
      }
    }
  } finally {
    running = false;
  }
}

/** Démarre la boucle en mémoire (remplaçable par BullMQ/Redis plus tard). */
export function startPoller(): void {
  if (timer || !config.pollingEnabled) return;
  purgeSyncRuns(30);
  void pollAllConnections();
  timer = setInterval(() => void pollAllConnections(), config.pollIntervalMs);
  timer.unref?.();
  console.log(`Polling actif toutes les ${Math.round(config.pollIntervalMs / 1000)}s`);
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
