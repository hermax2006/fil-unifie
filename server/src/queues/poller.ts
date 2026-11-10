import { registry } from '../connectors/registry.js';
import { listActiveConnectionsForPolling, type PollingConnectionRow } from '../db/repos/connections.repo.js';
import { decryptToken } from '../crypto/tokens.js';
import { config } from '../config/index.js';
import { enqueueEvent } from './index.js';

/** Curseur / dernière date de polling réussie, par connexion. */
const lastPolledAt = new Map<string, string>();
let timer: NodeJS.Timeout | undefined;
let running = false;

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

  const result = await connector.poll({
    accountId: row.account_id,
    config: cfg,
    tokens,
    lastPolledAt: lastPolledAt.get(row.id),
  });

  for (const event of result.events) {
    enqueueEvent({ ...event, connector: connector.info.id, accountId: row.account_id }, row.user_id);
  }
  lastPolledAt.set(row.id, result.cursor ?? new Date().toISOString());
  return result.events.length;
}

/** Un tour de polling sur toutes les connexions actives. */
export async function pollAllConnections(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const row of listActiveConnectionsForPolling()) {
      try {
        const count = await pollConnection(row);
        if (count > 0) console.log(`Polling ${row.connector_id}: ${count} nouvel(s) événement(s)`);
      } catch (err) {
        console.error(`Polling ${row.connector_id} (${row.id}) a échoué`, err);
      }
    }
  } finally {
    running = false;
  }
}

/** Démarre la boucle en mémoire (remplaçable par BullMQ/Redis plus tard). */
export function startPoller(): void {
  if (timer || !config.pollingEnabled) return;
  void pollAllConnections();
  timer = setInterval(() => void pollAllConnections(), config.pollIntervalMs);
  timer.unref?.();
  console.log(`Polling actif toutes les ${Math.round(config.pollIntervalMs / 1000)}s`);
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
