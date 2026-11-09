import type { Page } from '../types';

const PAGE_DETAILS: Record<Page, { label: string; aliases: string[]; next: string }> = {
  dashboard: {
    label: 'Dashboard',
    aliases: ['dashboard', 'home', 'overview'],
    next: 'What would you like to review—practice activity, upcoming deadlines, or client work?',
  },
  extract: {
    label: 'Invoice Extraction',
    aliases: ['invoice extraction', 'document extraction', 'extraction', 'extract'],
    next: 'Choose a client and upload the document you would like to process.',
  },
  'extraction-review': {
    label: 'Data Extraction Review',
    aliases: ['data extraction review', 'extraction review', 'review extractions'],
    next: 'Select an extracted document to inspect and verify its fields.',
  },
  whatsapp: {
    label: 'Client Inbox',
    aliases: ['client inbox', 'whatsapp', 'inbox', 'messages'],
    next: 'Choose a client conversation, or open reminders and templates to continue.',
  },
  files: {
    label: 'Client Folders',
    aliases: ['client folders', 'files', 'vault'],
    next: 'Choose a client folder to browse its original and extracted files.',
  },
  deadlines: {
    label: 'Deadlines',
    aliases: ['deadlines', 'deadline', 'calendar'],
    next: 'Which client or due date would you like to review?',
  },
  generate: {
    label: 'File Generator',
    aliases: ['file generator', 'document generator', 'generate'],
    next: 'Choose a client and filing type to prepare a document.',
  },
  clients: {
    label: 'Clients',
    aliases: ['clients', 'client list'],
    next: 'Select a client to review their details, or add a new client.',
  },
  subscriptions: {
    label: 'Subscriptions',
    aliases: ['subscriptions', 'billing', 'plan'],
    next: 'What would you like to check about your plan or billing?',
  },
  profile: {
    label: 'Profile',
    aliases: ['profile', 'account'],
    next: 'What account or practice details would you like to review?',
  },
  settings: {
    label: 'Settings',
    aliases: ['settings', 'preferences'],
    next: 'What would you like to adjust in your AI or application preferences?',
  },
};

const NAVIGATION_COMMAND = /^(?:(?:please|hey|can you|could you|would you|will you|i want you to)\s+)*(?:open|show(?:\s+me)?|go\s+to|switch\s+to|navigate\s+to|take\s+me\s+to|bring\s+up)\s+(?:(?:the|page)\s+)?(.+?)$/i;
const normalize = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');
const PAGE_ALIASES = (Object.entries(PAGE_DETAILS) as Array<[Page, typeof PAGE_DETAILS[Page]]>)
  .flatMap(([page, details]) => details.aliases.map(alias => ({ page, alias: normalize(alias) })))
  .sort((a, b) => b.alias.length - a.alias.length);

export function resolvePageNavigation(message: string): { page: Page; label: string; next: string } | null {
  const command = normalize(message).match(NAVIGATION_COMMAND);
  if (!command) return null;

  const target = command[1].replace(/(?:\s+(?:page|please|now|for me))+$/g, '').trim();
  const match = PAGE_ALIASES.find(({ alias }) => target === alias || target === `the ${alias}`);
  if (!match) return null;

  const { label, next } = PAGE_DETAILS[match.page];
  return { page: match.page, label, next };
}

export function isPageNavigationCommand(message: string): boolean {
  return NAVIGATION_COMMAND.test(normalize(message));
}
