import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'fil-unifie.sqlite');
export const db = new Database(dbPath);

// WAL : lectures concurrentes sans bloquer l'écriture (poller + requêtes HTTP,
// et processus de test multiples). busy_timeout : on attend au lieu d'échouer
// immédiatement sur « database is locked ».
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

export { migrate } from './migrate.js';
