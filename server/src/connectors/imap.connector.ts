import type { NewEvent } from '@fil/shared';
import { BaseConnector, type PollContext, type PollResult, type WebhookRequest } from './base.connector.js';

/**
 * Squelette IMAP.
 * La connexion (host, port, user, mot de passe/app-password) sera stockée chiffrée
 * dans connector_connections.encrypted_tokens_json. L'implémentation réelle
 * (imapflow ou équivalent) viendra à l'étape « polling mail ».
 */
export class ImapConnector extends BaseConnector {
  readonly info = {
    id: 'imap',
    name: 'IMAP (mail)',
    category: 'Mail, agenda, fichiers',
    access: 'gratuit' as const,
    canReply: true,
    status: 'soon' as const,
  };

  normalize(_req: WebhookRequest, _accountId: string): NewEvent[] {
    return [];
  }

  async poll(_ctx: PollContext): Promise<PollResult> {
    throw new Error('IMAP: polling pas encore implémenté');
  }
}
