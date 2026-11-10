import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

function disabled() {
  return !config.rateLimitEnabled;
}

/** Connexion/inscription : limite basse pour freiner le brute force. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: 'trop de tentatives, réessayez dans 15 minutes' },
});

/** Webhooks entrants : limite haute pour ne pas bloquer les apps sources. */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: 'trop de webhooks, réessayez plus tard' },
});

/** API de lecture/écriture du fil. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: disabled,
  message: { error: 'trop de requêtes, réessayez plus tard' },
});
