import type { ConnectorInfo } from '@fil/shared';
import type { BaseConnector } from './base.connector.js';
import { WebhookConnector } from './webhook.connector.js';
import { TelegramConnector } from './telegram.connector.js';
import { SlackConnector } from './slack.connector.js';

/** Pour ajouter une app : créer son module, puis l'ajouter à cette liste. */
const connectors: BaseConnector[] = [
  new WebhookConnector(),
  new TelegramConnector(),
  new SlackConnector(),
];

/** Apps annoncées « bientôt » : l'utilisateur peut dire laquelle il veut. */
const soon: ConnectorInfo[] = [
  { id: 'gmail', name: 'Gmail', category: 'Mail, agenda, fichiers', access: 'conditionnel', canReply: true, status: 'soon' },
  { id: 'gcal', name: 'Google Calendar', category: 'Mail, agenda, fichiers', access: 'gratuit', canReply: true, status: 'soon' },
  { id: 'whatsapp-business', name: 'WhatsApp Business', category: 'Messagerie et collaboration', access: 'payant', canReply: true, status: 'soon' },
];

export const registry = {
  get: (id: string) => connectors.find((c) => c.info.id === id),
  catalog: (): ConnectorInfo[] => [...connectors.map((c) => c.info), ...soon],
};
