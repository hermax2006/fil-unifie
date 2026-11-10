import type { NewEvent } from '@fil/shared';
import { Queue, Worker } from 'bullmq';
import { config } from '../config/index.js';
import { processEvent } from './processEvent.js';

export const QUEUE_NAME = 'fil-events';
export const DLQ_NAME = 'fil-events-dlq';

let queue: Queue | null = null;
let dlq: Queue | null = null;
let worker: Worker | null = null;
let bullReady = false;

export function redisConnectionOptions() {
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

function queueConnection() {
  return { ...redisConnectionOptions(), maxRetriesPerRequest: 1, enableOfflineQueue: false };
}

function workerConnection() {
  return { ...redisConnectionOptions(), maxRetriesPerRequest: null };
}

export const eventJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

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

  let q: Queue | null = null;
  let d: Queue | null = null;
  let w: Worker | null = null;
  try {
    q = new Queue(QUEUE_NAME, { connection: queueConnection() });
    await Promise.race([q.waitUntilReady(), timeout(3000)]);
    d = new Queue(DLQ_NAME, { connection: queueConnection() });

    w = new Worker(
      QUEUE_NAME,
      async (job) => {
        const { event, userId } = job.data as { event: NewEvent; userId?: string | null };
        await processEvent(event, userId ?? null);
      },
      { connection: workerConnection(), concurrency: 5 },
    );

    w.on('failed', (job, err) => {
      console.error(`Job BullMQ ${job?.id} échoué`, err);
      const attempts = job?.opts.attempts ?? 1;
      if (!job || !d || job.attemptsMade < attempts) return;
      void d.add('dead-event', {
        event: job.data?.event,
        userId: job.data?.userId ?? null,
        error: err.message,
        failedAt: new Date().toISOString(),
        originalJobId: job.id,
      }, { removeOnComplete: false, removeOnFail: false }).catch((dlqErr) => {
        console.error('Ajout en DLQ impossible', dlqErr);
      });
    });
    w.on('error', (err) => console.error('Worker BullMQ', err));

    queue = q;
    dlq = d;
    worker = w;
    bullReady = true;
    console.log('File d\'événements : BullMQ (Redis)');
  } catch (err) {
    console.error('BullMQ indisponible, fallback mémoire :', err);
    try { await w?.close(); } catch {}
    try { await d?.close(); } catch {}
    try { await q?.close(); } catch {}
    queue = null;
    dlq = null;
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
      await queue.add('process-event', { event, userId: userId ?? null }, eventJobOptions);
      return;
    } catch (err) {
      console.error('Ajout BullMQ impossible, traitement direct :', err);
    }
  }
  await processEvent(event, userId ?? null);
}

/** Remet en file les événements de la DLQ (utile après correction d'un bug). */
export async function requeueDeadLetters(limit = 100): Promise<number> {
  if (!bullReady || !queue || !dlq) return 0;
  const jobs = await dlq.getJobs(['waiting', 'delayed', 'failed'], 0, Math.max(0, limit - 1), false);
  let count = 0;
  for (const job of jobs) {
    const data = job.data as { event?: NewEvent; userId?: string | null };
    if (!data?.event) continue;
    await queue.add('process-event', { event: data.event, userId: data.userId ?? null }, eventJobOptions);
    await job.remove();
    count++;
  }
  return count;
}

export function isBullReady(): boolean {
  return bullReady;
}

export async function stopQueue(): Promise<void> {
  try { await worker?.close(); } catch {}
  try { await queue?.close(); } catch {}
  try { await dlq?.close(); } catch {}
  worker = null;
  queue = null;
  dlq = null;
  bullReady = false;
}
