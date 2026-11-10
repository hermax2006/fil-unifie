import type { NewEvent } from '@fil/shared';
import { Queue, Worker } from 'bullmq';
import { config } from '../config/index.js';
import { processEvent } from './processEvent.js';

const QUEUE_NAME = 'fil-events';
let queue: Queue | null = null;
let worker: Worker | null = null;
let bullReady = false;

function redisBase() {
  if (config.redisUrl) {
    const url = new URL(config.redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: Number(url.pathname.replace('/', '') || 0),
    };
  }
  return {
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    db: config.redisDb,
  };
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Redis: délai dépassé')), ms));
}

/**
 * Démarre BullMQ si QUEUE_DRIVER=bullmq et si Redis répond.
 * En cas d'échec, on retombe proprement sur le traitement en mémoire.
 */
export async function startQueue(): Promise<void> {
  if (config.queueDriver !== 'bullmq') {
    console.log('File d\'événements : mémoire (QUEUE_DRIVER=memory)');
    return;
  }

  const base = redisBase();
  let q: Queue | null = null;
  let w: Worker | null = null;
  try {
    q = new Queue(QUEUE_NAME, {
      connection: { ...base, maxRetriesPerRequest: 1, enableOfflineQueue: false },
    });
    await Promise.race([q.waitUntilReady(), timeout(3000)]);

    w = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { event, userId } = job.data as { event: NewEvent; userId?: string | null };
        await processEvent(event, userId ?? null);
      },
      { connection: { ...base, maxRetriesPerRequest: null }, concurrency: 5 },
    );
    w.on('failed', (job, err) => console.error(`Job BullMQ ${job?.id} échoué`, err));
    w.on('error', (err) => console.error('Worker BullMQ', err));

    queue = q;
    worker = w;
    bullReady = true;
    console.log('File d\'événements : BullMQ (Redis)');
  } catch (err) {
    console.error('BullMQ indisponible, fallback mémoire :', err);
    try { await w?.close(); } catch {}
    try { await q?.close(); } catch {}
    queue = null;
    worker = null;
    bullReady = false;
  }
}

/**
 * Ajoute un événement à la file.
 * - BullMQ : relances exponentielles, conservation des échecs.
 * - Mémoire : exécution immédiate via processEvent.
 */
export async function enqueueEvent(event: NewEvent, userId?: string | null): Promise<void> {
  if (bullReady && queue) {
    try {
      await queue.add('process-event', { event, userId: userId ?? null }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      return;
    } catch (err) {
      console.error('Ajout BullMQ impossible, traitement direct :', err);
    }
  }
  await processEvent(event, userId ?? null);
}

export async function stopQueue(): Promise<void> {
  try { await worker?.close(); } catch {}
  try { await queue?.close(); } catch {}
  worker = null;
  queue = null;
  bullReady = false;
}
