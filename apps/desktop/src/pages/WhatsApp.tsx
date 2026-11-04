import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../components/Icon';
import {
  createTelegramLink,
  fetchTelegramMessages,
  fetchTelegramStatus,
  sendTelegramMessage,
  fetchTelegramUnread,
  fetchTelegramPreviews,
  markTelegramClientRead,
  fetchWhatsAppStatus,
  sendWhatsAppManualMessage,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  inviteClientToPortal,
  fetchSupportedCountryTimezones,
  fetchTelegramSchedules,
  createTelegramSchedule,
  cancelTelegramSchedule,
  retryTelegramSchedule,
  type TelegramMessage,
  type TelegramPreview,
  type MessageTemplate,
  type SupportedCountryTimezone,
  type TelegramMessageSchedule,
} from '../lib/api';
import { useAppState, useDispatch } from '../state/store';
import { nextMsgId } from '../lib/messageIds';
import { missing } from '../lib/domain';
import { fDate, fTime, fDT, until, agoT, dayDiff, vnow, toInput } from '../lib/format';
import type { ChatMsg, Reminder } from '../types';

const TELEGRAM_MIGRATION_COMMAND = 'Set-Location .\\services\\backend; npm run migrate:telegram';

const TEMPLATE_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SG', name: 'Singapore' },
  { code: 'GB', name: 'United Kingdom' },
] as const;

type TemplateCountryCode = typeof TEMPLATE_COUNTRIES[number]['code'];

function builtInTemplate(countryCode: TemplateCountryCode, key: string, name: string, cat: string, body: string): MessageTemplate {
  return {
    id: `default-${countryCode}-${key}`,
    user_id: null,
    template_key: key,
    name,
    cat,
    body,
    protected: true,
    source: 'default',
    country_code: countryCode,
  };
}

const BUILT_IN_TEMPLATES: Record<TemplateCountryCode, MessageTemplate[]> = {
  IN: [
    builtInTemplate('IN', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('IN', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('IN', 'itr_return', 'ITR filing documents', 'Income tax', 'Hello {name}, please upload Form 16, 26AS/AIS, bank interest certificates, and investment proofs for your ITR: {portalLink}'),
    builtInTemplate('IN', 'gst_return', 'GST return documents', 'GST', 'Hello {name}, please upload your sales and purchase invoices, GSTR-2B, and expense records for {period}: {portalLink}'),
    builtInTemplate('IN', 'tds_form16', 'TDS / Form 16 request', 'TDS', 'Hello {name}, please upload your Form 16, TDS certificates, and 26AS/AIS for {period}: {portalLink}'),
    builtInTemplate('IN', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('IN', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  US: [
    builtInTemplate('US', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('US', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('US', 'individual_return', 'Individual tax return documents', 'Income tax', 'Hello {name}, please upload your W-2, 1099s, mortgage interest, deductions, and investment statements for {period}: {portalLink}'),
    builtInTemplate('US', 'business_return', 'Business tax return documents', 'Business tax', 'Hello {name}, please upload your income statement, balance sheet, bank statements, and 1099 records for {period}: {portalLink}'),
    builtInTemplate('US', 'estimated_tax', 'Quarterly estimated tax reminder', 'Payment', 'Hello {name}, your quarterly estimated tax payment is due on {due}. Please review the payment details with your CA.'),
    builtInTemplate('US', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('US', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  AE: [
    builtInTemplate('AE', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('AE', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('AE', 'vat_return', 'VAT return documents', 'VAT', 'Hello {name}, please upload your sales invoices, purchase invoices, VAT summary, and supporting records for {period}: {portalLink}'),
    builtInTemplate('AE', 'corporate_tax', 'Corporate tax documents', 'Corporate tax', 'Hello {name}, please upload your financial statements, trial balance, and corporate tax records for {period}: {portalLink}'),
    builtInTemplate('AE', 'trn_documents', 'TRN and registration documents', 'Compliance', 'Hello {name}, please upload your TRN certificate, trade licence, and registration documents securely here: {portalLink}'),
    builtInTemplate('AE', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('AE', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  SG: [
    builtInTemplate('SG', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('SG', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('SG', 'gst_return', 'GST return documents', 'GST', 'Hello {name}, please upload your sales records, purchase invoices, GST reconciliation, and supporting records for {period}: {portalLink}'),
    builtInTemplate('SG', 'corporate_tax', 'Corporate income tax documents', 'Income tax', 'Hello {name}, please upload your financial statements, tax computation, and supporting records for {period}: {portalLink}'),
    builtInTemplate('SG', 'ir8a', 'IR8A / payroll documents', 'Payroll', 'Hello {name}, please upload your IR8A, payroll summary, CPF records, and employee details for {period}: {portalLink}'),
    builtInTemplate('SG', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('SG', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  GB: [
    builtInTemplate('GB', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('GB', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('GB', 'self_assessment', 'Self Assessment documents', 'Income tax', 'Hello {name}, please upload your P60/P45, P11D, bank interest, dividend, and investment records for {period}: {portalLink}'),
    builtInTemplate('GB', 'vat_return', 'VAT return documents', 'VAT', 'Hello {name}, please upload your sales invoices, purchase invoices, VAT reports, and MTD records for {period}: {portalLink}'),
    builtInTemplate('GB', 'mtd', 'Making Tax Digital records', 'Compliance', 'Hello {name}, please upload your digital bookkeeping reports and supporting records for {period}: {portalLink}'),
    builtInTemplate('GB', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('GB', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
};

function needsTelegramMigrationHelp(messages: string[]) {
  return messages.some((message) => /database table .* missing|database setup.*incomplete|migrations? are missing|required telegram database object/i.test(message));
}

function TelegramMigrationHelp({ copied, copyError, onCopy }: { copied: boolean; copyError: string; onCopy: () => void }) {
  return (
    <details className="telegram-migration-help">
      <summary>How to fix the database setup</summary>
      <p>From the TaxFlow project folder, run this in PowerShell. Ensure <code>DATABASE_URL</code> is set in <code>services/backend/.env</code> for the same Supabase project used by the deployed backend.</p>
      <code className="telegram-migration-command">{TELEGRAM_MIGRATION_COMMAND}</code>
      <button className="btn sm" onClick={onCopy}>{copied ? 'Command copied' : 'Copy PowerShell command'}</button>
      {copyError && <span role="status">{copyError}</span>}
      <p>Do not share your database URL or password. If the command reports a database login error, correct the credentials in the backend environment before retrying.</p>
    </details>
  );
}

function dayLabel(d: Date) {
  const n = dayDiff(vnow(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fDate(d);
}

function scheduledTimeLabel(schedule: TelegramMessageSchedule) {
  const value = schedule.next_run_at || schedule.scheduled_at;
  if (!value) return 'No upcoming send';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: schedule.timezone_name,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}



function getTemplateIcon(template: MessageTemplate) {
  if (template.template_key === 'website_link' || template.template_key === 'portal_link') return 'globe';
  if (template.template_key === 'portal_invite') return 'lock';
  if (template.template_key === 'docs') return 'scan';
  if (template.template_key === 'pending') return 'info';
  if (template.template_key === 'itr') return 'table';
  if (template.template_key === 'payment_reminder') return 'rupee';
  if (template.template_key === 'status_update') return 'check';
  if (template.template_key === 'onboarding') return 'users';
  if (template.cat === 'Payment') return 'rupee';
  if (template.cat === 'Client portal') return 'globe';
  if (template.cat === 'Links') return 'link';
  if (template.cat === 'Filing') return 'scan';
  if (template.cat === 'Reminder') return 'bell';
  return 'file';
}

function fillTpl(body: string, name: string, portalLink?: string) {
  const link = portalLink || 'https://taxflowaiwebsite.vercel.app/portal';
  return body.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'name') return name;
    if (k === 'period') return 'August 2026';
    if (k === 'due') return '20 Sep 2026';
    if (k === 'filing') return 'GSTR-3B';
    if (k === 'doc') return 'bank statement';
    if (k === 'portalLink' || k === 'websiteLink' || k === 'link') return link;
    return '—';
  });
}

async function fillPortalTemplate(template: MessageTemplate, client: { id: string; contact: string }) {
  const clientName = client.contact ? client.contact.split(' ')[0] : 'Client';
  const defaultPortalUrl = 'https://taxflowaiwebsite.vercel.app/portal';
  let portalLink = defaultPortalUrl;

  // Only the specific 1-on-1 "portal_invite" needs an invitation token generated:
  if (template.template_key === 'portal_invite') {
    try {
      const invitation = await inviteClientToPortal(client.id);
      if (invitation?.link) {
        portalLink = invitation.link;
      }
    } catch (err) {
      // Gracefully fall back to standard portal link so the CA is NEVER blocked by an invitation creation error
      console.warn('[Portal Template] Invite link creation unavailable or failed, using standard portal URL:', err);
      portalLink = defaultPortalUrl;
    }
  } else {
    // For "website_link" and all other templates, directly use the public portal website link:
    portalLink = defaultPortalUrl;
  }
  return fillTpl(template.body, clientName, portalLink);
}

function TemplateCardSkeleton() {
  return (
    <article className="card tpl wa-template-skeleton-card" aria-hidden="true">
      <div className="wa-template-skeleton-header">
        <div className="wa-skeleton-shimmer wa-template-skeleton-icon" />
        <div className="wa-skeleton-shimmer wa-template-skeleton-title" />
        <div className="wa-skeleton-shimmer wa-template-skeleton-chip" />
      </div>
      <div className="wa-template-skeleton-body">
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '92%' }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '78%' }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '60%' }} />
      </div>
      <div className="wa-template-skeleton-footer">
        <div className="wa-skeleton-shimmer wa-template-skeleton-btn" style={{ width: 64 }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-btn" style={{ width: 92 }} />
      </div>
    </article>
  );
}

function ScheduleCardSkeleton() {
  return (
    <article className="card wa-reminder-card wa-sched-skeleton" aria-hidden="true">
      <div className="wa-reminder-time">
        <div className="wa-skeleton-shimmer" style={{ height: 18, width: 46, borderRadius: 6, marginBottom: 5 }} />
        <div className="wa-skeleton-shimmer" style={{ height: 10, width: 62, borderRadius: 4 }} />
      </div>
      <div className="wa-reminder-content" style={{ flex: 1 }}>
        <div className="wa-reminder-client">
          <div className="wa-skeleton-shimmer" style={{ width: 22, height: 22, borderRadius: '50%' }} />
          <div className="wa-skeleton-shimmer" style={{ height: 13, width: 110, borderRadius: 5 }} />
          <div className="wa-skeleton-shimmer" style={{ height: 18, width: 44, borderRadius: 99 }} />
        </div>
        <div className="wa-skeleton-shimmer" style={{ height: 10, width: '80%', borderRadius: 4, marginTop: 7 }} />
        <div className="wa-skeleton-shimmer" style={{ height: 10, width: '60%', borderRadius: 4, marginTop: 5 }} />
      </div>
      <div className="wa-reminder-actions">
        <div className="wa-skeleton-shimmer" style={{ height: 20, width: 52, borderRadius: 99 }} />
        <div className="wa-skeleton-shimmer" style={{ height: 28, width: 60, borderRadius: 7 }} />
      </div>
    </article>
  );
}

function TemplateDropdownSkeleton() {
  return (
    <div className="wa-dropdown-skeleton-item" aria-hidden="true">
      <div className="wa-skeleton-shimmer" style={{ width: 28, height: 28, borderRadius: 8 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
        <div className="wa-skeleton-shimmer" style={{ height: 11, width: '55%' }} />
        <div className="wa-skeleton-shimmer" style={{ height: 9, width: '85%' }} />
      </div>
      <div className="wa-skeleton-shimmer" style={{ height: 16, width: 44, borderRadius: 99 }} />
    </div>
  );
}


function sameTelegramMessages(a: TelegramMessage[], b: TelegramMessage[]) {
  return a.length === b.length && a.every((message, index) => {
    const next = b[index];
    return message.id === next.id
      && message.provider_message_id === next.provider_message_id
      && message.body === next.body
      && message.message_type === next.message_type
      && message.delivery_status === next.delivery_status;
  });
}

function mergeTelegramMessages(serverMessages: TelegramMessage[], currentMessages: TelegramMessage[], clientId: string): TelegramMessage[] {
  const merged = new Map<string, TelegramMessage>();
  const statusRank: Record<string, number> = { received: 0, queued: 1, sending: 2, failed: 3, sent: 4 };
  const keyFor = (message: TelegramMessage) => message.provider_message_id || message.id;
  for (const message of serverMessages) {
    merged.set(keyFor(message), message);
  }
  for (const message of currentMessages) {
    if (message.client_id !== clientId) continue;
    const key = keyFor(message);
    const serverMessage = merged.get(key);
    if (!serverMessage) {
      merged.set(key, message);
    } else {
      const preferredStatus = (statusRank[message.delivery_status] || 0) > (statusRank[serverMessage.delivery_status] || 0)
        ? message.delivery_status
        : serverMessage.delivery_status;
      merged.set(key, { ...message, ...serverMessage, delivery_status: preferredStatus });
    }
  }
  return Array.from(merged.values())
    .sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      || keyFor(a).localeCompare(keyFor(b))
    )
    .slice(-200);
}

export function WhatsAppPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [channel, setChannel] = useState<'whatsapp' | 'telegram'>('telegram');
  const [input, setInput] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState('');
  const [reminderSendErrors, setReminderSendErrors] = useState<Record<string, string>>({});
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const [telegramConversationClientId, setTelegramConversationClientId] = useState('');
  const [telegramReady, setTelegramReady] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBot, setTelegramBot] = useState('');
  const [telegramStatusError, setTelegramStatusError] = useState('');
  const [telegramDiagnostics, setTelegramDiagnostics] = useState<string[]>([]);
  const [telegramMigrationCommandCopied, setTelegramMigrationCommandCopied] = useState(false);
  const [telegramMigrationCopyError, setTelegramMigrationCopyError] = useState('');
  const [telegramError, setTelegramError] = useState('');
  const [telegramRefreshWarning, setTelegramRefreshWarning] = useState('');
  const [telegramInfo, setTelegramInfo] = useState('');
  const [telegramLinkToShare, setTelegramLinkToShare] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramSending, setTelegramSending] = useState(false);
  const [telegramTemplatesOpen, setTelegramTemplatesOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateApplyError, setTemplateApplyError] = useState('');
  const [applyingTemplateId, setApplyingTemplateId] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', cat: 'Utility', body: '' });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCountry, setTemplateCountry] = useState<TemplateCountryCode>('IN');
  const [countryTimezones, setCountryTimezones] = useState<SupportedCountryTimezone[]>([]);
  const [countryTimezonesError, setCountryTimezonesError] = useState('');
  const [telegramSchedules, setTelegramSchedules] = useState<TelegramMessageSchedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [scheduleActionId, setScheduleActionId] = useState('');
  const [contactsCollapsed, setContactsCollapsed] = useState(false);
  const [telegramDraft, setTelegramDraft] = useState('');
  const [telegramRequestId, setTelegramRequestId] = useState('');
  const [telegramRetry, setTelegramRetry] = useState(0);
  const [telegramStatusRetry, setTelegramStatusRetry] = useState(0);
  /** Text staged inline in the thread waiting for approval — NOT yet sent */
  const [pendingTelegramMsg, setPendingTelegramMsg] = useState('');
  const [pendingTelegramClientId, setPendingTelegramClientId] = useState('');
  /** Whether the approval card is currently in inline-edit mode */
  const [isEditingPending, setIsEditingPending] = useState(false);
  /** Holds the in-progress edit text while editing mode is active */
  const [editText, setEditText] = useState('');
  /** Unread counts mapped by client_id */
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [telegramPreviews, setTelegramPreviews] = useState<Record<string, TelegramPreview>>({});
  /** Total unread messages across all clients */
  const [totalUnreadAcrossClients, setTotalUnreadAcrossClients] = useState(0);
  /** WhatsApp status state */
  const [whatsAppReady, setWhatsAppReady] = useState(false);
  const [whatsAppLoading, setWhatsAppLoading] = useState(false);
  const [whatsAppError, setWhatsAppError] = useState('');
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const telegramMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const whatsAppMessageInputRef = useRef<HTMLTextAreaElement>(null);
  const telegramTemplateMenuRef = useRef<HTMLDivElement>(null);
  const templateBodyRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowThreadRef = useRef(true);
  const c = s.clients.find((x) => x.id === s.ui.wa.client) || s.clients[0];
  const builtInTemplates = BUILT_IN_TEMPLATES[templateCountry];
  // Separate templates fetched from the database:
  // 1. dbDefaultTemplates: rows with user_id IS NULL (shared defaults from DB)
  // 2. privateTemplates: rows with user_id IS NOT NULL (created by this specific CA)
  const dbDefaultTemplates = templates.filter((t) => !t.user_id);
  const privateTemplates = templates.filter((t) => Boolean(t.user_id));
  const defaultTemplatesList = dbDefaultTemplates.length > 0 ? dbDefaultTemplates : builtInTemplates;
  const visibleTemplates = [...defaultTemplatesList, ...privateTemplates];
  const pendingTelegramClient = s.clients.find((client) => client.id === pendingTelegramClientId);
  const pendingTelegramForCurrentClient = !!pendingTelegramMsg && pendingTelegramClientId === c?.id;
  const pendingTelegramForOtherClient = !!pendingTelegramMsg && !!pendingTelegramClientId && pendingTelegramClientId !== c?.id;
  const visibleClients = s.clients.filter((client) => client.name.toLocaleLowerCase().includes(clientSearch.trim().toLocaleLowerCase()));
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];
  const isTelegramConversationLoading = channel === 'telegram' && !!c && telegramConversationClientId !== c.id;
  const isTelegramLinkedForCurrentClient = !!c && telegramConversationClientId === c.id && telegramLinked;
  const clientIds = s.clients.map((client) => client.id).join(',');

  useEffect(() => {
    setTelegramTemplatesOpen(false);
    setComposerExpanded(false);
    setTelegramLinkToShare('');
    setTelegramInfo('');
  }, [channel, c?.id]);

  useLayoutEffect(() => {
    if (!composerExpanded) return;
    const textarea = channel === 'telegram'
      ? telegramMessageInputRef.current
      : whatsAppMessageInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 168;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input, channel, composerExpanded]);

  function openComposer() {
    setComposerExpanded(true);
    scrollThreadToLatest('smooth');
    requestAnimationFrame(() => {
      const textarea = channel === 'telegram'
        ? telegramMessageInputRef.current
        : whatsAppMessageInputRef.current;
      if (!textarea?.disabled) textarea?.focus();
    });
  }

  const loadUnreadCounts = useCallback(async () => {
    try {
      const summary = await fetchTelegramUnread();
      setUnreadCounts(summary.counts || {});
      setTotalUnreadAcrossClients(summary.total || 0);
    } catch (error) {
      console.warn('Failed to refresh unread Telegram counts', error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchSupportedCountryTimezones()
      .then((timezones) => {
        if (active) {
          setCountryTimezones(timezones);
          setCountryTimezonesError('');
        }
      })
      .catch((error) => {
        if (active) setCountryTimezonesError(error instanceof Error ? error.message : 'Country time zones could not be loaded.');
      });
    return () => { active = false; };
  }, []);

  const loadTelegramSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    setScheduleError('');
    try {
      const data = await fetchTelegramSchedules();
      setTelegramSchedules(data);
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'Scheduled reminders could not be loaded.');
    } finally {
      setSchedulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTelegramSchedules();
  }, [loadTelegramSchedules]);

  useEffect(() => {
    if (s.ui.wa.tab !== 'reminders') return undefined;
    const timer = window.setInterval(() => void loadTelegramSchedules(), 30_000);
    return () => window.clearInterval(timer);
  }, [s.ui.wa.tab, loadTelegramSchedules]);

  useEffect(() => {
    void loadUnreadCounts();
    const timer = window.setInterval(() => void loadUnreadCounts(), 5000);
    return () => window.clearInterval(timer);
  }, [loadUnreadCounts]);

  useEffect(() => {
    if (channel === 'telegram' && c?.id && unreadCounts[c.id]) {
      void markTelegramClientRead(c.id).then(() => {
        setUnreadCounts((prev) => {
          if (!prev[c.id]) return prev;
          const next = { ...prev, [c.id]: 0 };
          const total = Object.values(next).reduce((a, b) => a + b, 0);
          setTotalUnreadAcrossClients(total);
          return next;
        });
        window.dispatchEvent(new CustomEvent('taxflow:unread-updated'));
      }).catch((error) => {
        console.warn('Failed to mark Telegram messages as read', error);
      });
    }
  }, [channel, c?.id, unreadCounts[c?.id || '']]);

  useEffect(() => {
    if (channel !== 'telegram') return undefined;
    let active = true;
    const load = async () => {
      try {
        const previews = await fetchTelegramPreviews();
        if (active) setTelegramPreviews(previews);
      } catch (error) {
        console.warn('Failed to refresh Telegram message previews', error);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [channel, clientIds]);

  const scrollThreadToLatest = useCallback((behavior: ScrollBehavior = 'smooth') => {
    shouldFollowThreadRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const threadElement = threadRef.current;
      if (threadElement) threadElement.scrollTo({ top: threadElement.scrollHeight, behavior });
    }));
  }, []);

  useEffect(() => {
    if (!shouldFollowThreadRef.current) return;
    scrollThreadToLatest('auto');
  }, [thread.length, telegramMessages, pendingTelegramMsg, isEditingPending, telegramConversationClientId, s.ui.wa.tab, scrollThreadToLatest]);

  useEffect(() => {
    if (!telegramTemplatesOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!telegramTemplateMenuRef.current?.contains(event.target as Node)) setTelegramTemplatesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTelegramTemplatesOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [telegramTemplatesOpen]);

  useEffect(() => {
    if (channel !== 'telegram') return undefined;
    let active = true;
    const loadStatus = async () => {
      if (active) setTelegramLoading(true);
      try {
        const status = await fetchTelegramStatus();
        if (active) {
          setTelegramReady(status.connected);
          setTelegramBot(status.bot?.username || '');
          setTelegramDiagnostics(status.diagnostics?.warnings || []);
          setTelegramStatusError('');
        }
      } catch (error) {
        if (active) {
          setTelegramReady(false);
          setTelegramDiagnostics([]);
          setTelegramStatusError(error instanceof Error ? error.message : 'Telegram is unavailable.');
        }
      } finally {
        if (active) setTelegramLoading(false);
      }
    };
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [channel, telegramStatusRetry]);

  useEffect(() => {
    if (channel !== 'telegram' || !c) {
      setTelegramMessages([]);
      setTelegramLinked(false);
      setTelegramConversationClientId('');
      return undefined;
    }
    let active = true;
    let loadingConversation = false;
    let hasLoadedConversation = telegramConversationClientId === c.id;
    if (!hasLoadedConversation) {
      shouldFollowThreadRef.current = true;
      setTelegramLinked(false);
    }
    setTelegramError('');
    setTelegramRefreshWarning('');
    const load = async () => {
      if (loadingConversation) return;
      loadingConversation = true;
      try {
        const conversation = await fetchTelegramMessages(c.id);
        if (active) {
          hasLoadedConversation = true;
          setTelegramLinked(conversation.linked);
          setTelegramMessages((current) => {
            const merged = mergeTelegramMessages(conversation.messages, current, c.id);
            return sameTelegramMessages(current, merged) ? current : merged;
          });
          setTelegramConversationClientId(c.id);
          setTelegramError('');
          setTelegramRefreshWarning('');
        }
      }
      catch (error) {
        if (active) {
          const message = error instanceof Error ? error.message : 'Telegram is unavailable.';
          if (!hasLoadedConversation) {
            setTelegramLinked(false);
            setTelegramConversationClientId(c.id);
            setTelegramError(message);
          } else {
            setTelegramRefreshWarning('Live refresh is temporarily unavailable. Previously loaded messages remain visible.');
            console.warn('Telegram conversation refresh failed; keeping the current conversation visible.', error);
          }
        }
      }
      finally { loadingConversation = false; }
    };
    void load(); const timer = window.setInterval(() => void load(), 4000); return () => { active = false; window.clearInterval(timer); };
  }, [channel, c?.id, telegramRetry]);

  useEffect(() => {
    let active = true;
    setWhatsAppLoading(true);
    void fetchWhatsAppStatus().then((status) => {
      if (!active) return;
      setWhatsAppReady(status.connected);
      if (!status.connected) {
        setWhatsAppError(status.message || 'WhatsApp Cloud API is not configured on this server.');
      } else {
        setWhatsAppError('');
      }
      setWhatsAppLoading(false);
    });
    return () => { active = false; };
  }, []);

  // Load only account-owned templates from the backend. Built-in templates are local and country-aware.
  useEffect(() => {
    let active = true;
    async function loadTemplates() {
      setTemplatesLoading(true);
      setTemplateError('');
      try {
        const data = await fetchTemplates();
        if (active) setTemplates(data || []);
      } catch (error) {
        if (active) {
          setTemplates([]);
          setTemplateError(error instanceof Error
            ? `Private templates could not be loaded. Built-in templates remain available. (${error.message})`
            : 'Private templates could not be loaded. Built-in templates remain available.');
        }
      } finally {
        if (active) setTemplatesLoading(false);
      }
    }
    void loadTemplates();
  }, []);

  function startTemplateEdit(template?: MessageTemplate) {
    setEditingTemplate(template || null);
    setTemplateEditorOpen(true);
    setTemplateForm(template
      ? { name: template.name, cat: template.cat, body: template.body }
      : { name: '', cat: 'Utility', body: '' });
    setTemplateError('');
  }

  function insertToken(token: string) {
    const el = templateBodyRef.current;
    if (!el) {
      setTemplateForm((c) => ({ ...c, body: c.body + token }));
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = el.value;
    const newText = text.substring(0, start) + token + text.substring(end);
    setTemplateForm((c) => ({ ...c, body: newText }));
    requestAnimationFrame(() => {
      el.focus();
      const newPos = start + token.length;
      el.setSelectionRange(newPos, newPos);
    });
  }

  async function applyTemplate(template: MessageTemplate, openChats = false) {
    if (applyingTemplateId || !c) return;
    setApplyingTemplateId(template.id);
    setTemplateError('');
    setTemplateApplyError('');
    try {
      const message = await fillPortalTemplate(template, c);
      setInput(message);
      if (openChats) {
        setComposerExpanded(true);
        dispatch({ type: 'WA_TAB', tab: 'chats' });
        scrollThreadToLatest('smooth');
      }
      requestAnimationFrame(() => {
        const el = channel === 'telegram' ? telegramMessageInputRef.current : whatsAppMessageInputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Could not apply template to message composer. Please try again.';
      setTemplateError(message);
      setTemplateApplyError(message);
    } finally {
      setApplyingTemplateId('');
    }
  }

  async function saveTemplate() {
    if (templateSaving) return;
    setTemplateSaving(true);
    setTemplateError('');
    try {
      const payload = {
        name: templateForm.name.trim(),
        cat: templateForm.cat.trim() || 'Utility',
        body: templateForm.body.trim(),
      };
      if (editingTemplate) {
        const updated = await updateTemplate(editingTemplate.id, payload);
        setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const created = await createTemplate(payload);
        setTemplates((current) => [...current, created]);
      }
      setTemplateEditorOpen(false);
      setEditingTemplate(null);
      setTemplateForm({ name: '', cat: 'Utility', body: '' });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save template.');
    } finally {
      setTemplateSaving(false);
    }
  }

  async function removeTemplate(template: MessageTemplate) {
    if (template.protected || !window.confirm(`Delete the "${template.name}" template?`)) return;
    setTemplateError('');
    try {
      await deleteTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not delete template.');
    }
  }

  async function connectTelegram() {
    if (telegramConnecting) return;
    setTelegramConnecting(true);
    setTelegramError('');
    setTelegramInfo('');
    setTelegramLinkToShare('');
    try {
      const result = await createTelegramLink(c.id);
      setTelegramLinkToShare(result.link);
      let copied = false;
      try {
        await navigator.clipboard.writeText(result.link);
        copied = true;
      } catch {
        copied = false;
      }
      const expiresAt = new Date(result.expiresAt).toLocaleTimeString();
      setTelegramInfo(`${copied ? 'Connection link copied.' : 'Connection link is ready below.'} Send it directly to ${c.name}; do not open it from your own Telegram account. It expires at ${expiresAt}.`);
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : 'Unable to create Telegram connection link.');
    } finally {
      setTelegramConnecting(false);
    }
  }

  async function copyTelegramLink() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(telegramLinkToShare);
      setTelegramError('');
      setTelegramInfo(`Connection link copied. Send it directly to ${c.name}; do not open it from your own Telegram account.`);
    } catch {
      setTelegramError('Could not copy the link. Select the link text and copy it manually.');
    }
  }

  async function copyTelegramMigrationCommand() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(TELEGRAM_MIGRATION_COMMAND);
      setTelegramMigrationCommandCopied(true);
      setTelegramMigrationCopyError('');
    } catch (error) {
      console.error('[Telegram] Could not copy the database migration command:', error);
      setTelegramMigrationCommandCopied(false);
      setTelegramMigrationCopyError('Clipboard access is unavailable. Select the command above and copy it manually.');
    }
  }

  function requestTelegramSend() {
    const text = input.trim();
    if (!text || telegramSending || pendingTelegramMsg || !c) return;
    if (!telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading) {
      setTelegramError('Telegram is not ready or this client is not linked. Please check the connection and try again.');
      return;
    }
    setTelegramError('');
    setTelegramInfo('');
    setTelegramRequestId(crypto.randomUUID());
    setTelegramDraft(text);
    setPendingTelegramMsg(text);
    setPendingTelegramClientId(c.id);
    setInput('');
    scrollThreadToLatest();
  }

  async function confirmTelegramSend() {
    const messageText = telegramDraft;
    if (!messageText || telegramSending || !c || pendingTelegramClientId !== c.id) return;
    const targetClientId = pendingTelegramClientId;
    const requestId = telegramRequestId || crypto.randomUUID();
    setTelegramSending(true);
    setTelegramError('');
    setTelegramInfo('Sending message through Telegram…');
    try {
      const optimisticMessage: TelegramMessage = {
        id: `local-${requestId}`,
        client_id: targetClientId,
        provider_message_id: `taxflow:${requestId}`,
        direction: 'outbound',
        chat_id: '',
        body: messageText,
        message_type: 'text',
        delivery_status: 'sending',
        created_at: new Date().toISOString(),
      };
      setTelegramMessages((current) => mergeTelegramMessages(
        [optimisticMessage],
        current,
        targetClientId,
      ));
      scrollThreadToLatest();
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setIsEditingPending(false);
      setEditText('');

      const sentMessage = await sendTelegramMessage(targetClientId, messageText, requestId);
      setTelegramMessages((current) => mergeTelegramMessages([sentMessage], current, targetClientId));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setTelegramInfo('Message sent through Telegram.');
      setTelegramSending(false);

      try {
        setTelegramPreviews(await fetchTelegramPreviews());
      } catch (error) {
        console.warn('Failed to refresh Telegram preview after sending', error);
      }
    } catch (error) {
      setTelegramInfo('');
      setTelegramMessages((current) => current.map((message) =>
        message.provider_message_id === `taxflow:${requestId}`
          ? { ...message, delivery_status: 'failed' }
          : message
      ));
      setPendingTelegramMsg('');
      setPendingTelegramClientId('');
      setTelegramDraft('');
      setTelegramRequestId('');
      setIsEditingPending(false);
      setEditText('');
      setTelegramError(error instanceof Error ? error.message : 'Unable to send Telegram message. Please try again.');
    } finally {
      setTelegramSending(false);
    }
  }

  function cancelTelegramPending() {
    setPendingTelegramMsg('');
    setPendingTelegramClientId('');
    setTelegramDraft('');
    setTelegramRequestId('');
    setTelegramError('');
    setTelegramInfo('');
    setIsEditingPending(false);
    setEditText('');
  }

  /** Enter inline-edit mode for the pending message */
  const startEditingPending = useCallback(() => {
    setEditText(pendingTelegramMsg);
    setIsEditingPending(true);
    // Focus the textarea on next paint
    requestAnimationFrame(() => editTextareaRef.current?.focus());
  }, [pendingTelegramMsg]);

  /** Commit the edited text — updates both the visible bubble and the draft to be sent */
  function commitEdit() {
    const trimmed = editText.trim();
    if (!trimmed) return; // guard: empty message not allowed
    setPendingTelegramMsg(trimmed);
    setTelegramDraft(trimmed);
    // Regenerate request ID so a re-edit can't collide with a previous idempotency key
    setTelegramRequestId(crypto.randomUUID());
    setIsEditingPending(false);
    setEditText('');
  }

  /** Abort inline-edit and return to the approval view without changing anything */
  function abortEdit() {
    setIsEditingPending(false);
    setEditText('');
  }

  const scheduled = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime());
  const activeTelegramSchedules = telegramSchedules
    .filter((schedule) => schedule.status === 'active')
    .sort((a, b) => new Date(a.next_run_at || '').getTime() - new Date(b.next_run_at || '').getTime());

  if (!c) {
    return (
      <div className="inbox-page">
        <div className="ph inbox-page-head"><div><span className="eyebrow">MESSAGES</span><h1>Client Inbox</h1><p>Your WhatsApp and Telegram conversations.</p></div><label className="wa-channel-control"><span>Channel</span><select id="inbox-channel-empty" className="sel" value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label></div>
        <div className="card workspace-empty workspace-empty-inbox">
          <div className="workspace-empty-visual"><span className="workspace-empty-ring ring-one" /><span className="workspace-empty-ring ring-two" /><span className="workspace-empty-orb"><Icon name="chat" size={30} /></span><span className="workspace-empty-float float-one"><Icon name="send" size={14} /></span><span className="workspace-empty-float float-two"><Icon name="bell" size={14} /></span></div>
          <div className="workspace-empty-copy"><span className="eyebrow">A QUIET INBOX IS A CLEAN START</span><h2>Your client conversations will appear here</h2><p>Once a client is added, chats, reminders, and approved message templates will stay together in one focused workspace.</p><button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}><Icon name="users" size={14} />Add your first client</button></div>
          <div className="workspace-empty-note"><Icon name="check" size={16} /><div><b>Ready for WhatsApp and Telegram</b><span>Choose a channel when your first client is ready.</span></div></div>
        </div>
      </div>
    );
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (channel === 'telegram') {
      requestTelegramSend();
      return;
    }
    if (channel === 'whatsapp') {
      if (!whatsAppReady) {
        setWhatsAppError('WhatsApp Cloud API is not configured on this server. Please use Telegram or configure WhatsApp credentials in backend .env.');
        return;
      }
      setWhatsAppSending(true);
      setWhatsAppError('');
      try {
        await sendWhatsAppManualMessage(c.id, c.phone, text);
        const msg: ChatMsg = { id: nextMsgId(), f: 'me', t: text, at: vnow(), st: 'sent' };
        dispatch({ type: 'WA_APPEND', client: c.id, msg });
        setInput('');
      } catch (err) {
        setWhatsAppError(err instanceof Error ? err.message : 'Failed to send WhatsApp message.');
      } finally {
        setWhatsAppSending(false);
      }
    }
  }

  async function sendReminder(reminder: Reminder) {
    const reminderClient = s.clients.find((client) => client.id === reminder.client);
    if (!reminderClient) {
      setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: 'The selected client could not be found.' }));
      return;
    }
    if (!whatsAppReady) {
      setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: 'Connect WhatsApp before sending this reminder.' }));
      return;
    }

    setSendingReminderId(reminder.id);
    setReminderSendErrors((errors) => ({ ...errors, [reminder.id]: '' }));
    try {
      const reminderTemplate = visibleTemplates.find((template) => template.id === reminder.tpl);
      let message = reminder.text;
      if (reminderTemplate?.template_key === 'portal_invite' && reminderTemplate.body.includes('{portalLink}')) {
        try {
          const invitation = await inviteClientToPortal(reminderClient.id);
          if (invitation?.link) {
            message = message.replace(/https:\/\/taxflowaiwebsite\.vercel\.app\/portal/g, invitation.link);
          }
        } catch (inviteErr) {
          console.warn('[Reminder Send] Could not generate invite token, using default portal link:', inviteErr);
        }
      }
      await sendWhatsAppManualMessage(reminderClient.id, reminderClient.phone, message);
      dispatch({ type: 'REM_SEND_NOW', id: reminder.id });
    } catch (error) {
      setReminderSendErrors((errors) => ({
        ...errors,
        [reminder.id]: error instanceof Error ? error.message : 'Could not send this reminder.',
      }));
    } finally {
      setSendingReminderId('');
    }
  }

  async function saveTelegramReminder(input: {
    clientId: string;
    templateId?: string;
    messageBody: string;
    repeatMode: 'once' | 'daily';
    timezoneName: string;
    scheduledLocal?: string;
    localTime?: string;
  }) {
    setScheduleSaving(true);
    setScheduleError('');
    setScheduleNotice('');
    try {
      const created = await createTelegramSchedule(input);
      setTelegramSchedules((current) => [created, ...current]);
      setScheduleNotice(`Telegram reminder saved for ${created.client?.name || 'the client'} in ${created.timezone_name}. The backend will send it automatically.`);
      setShowSchedule(false);
      dispatch({ type: 'WA_TAB', tab: 'reminders' });
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'The reminder could not be saved.');
    } finally {
      setScheduleSaving(false);
    }
  }

  async function cancelTelegramReminder(schedule: TelegramMessageSchedule) {
    if (scheduleActionId) return;
    setScheduleActionId(schedule.id);
    setScheduleError('');
    try {
      await cancelTelegramSchedule(schedule.id);
      setTelegramSchedules((current) => current.map((item) => item.id === schedule.id ? { ...item, status: 'cancelled' } : item));
      setScheduleNotice('Scheduled Telegram reminder cancelled.');
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'The reminder could not be cancelled.');
    } finally {
      setScheduleActionId('');
    }
  }

  async function retryTelegramReminder(schedule: TelegramMessageSchedule) {
    if (scheduleActionId) return;
    setScheduleActionId(schedule.id);
    setScheduleError('');
    try {
      await retryTelegramSchedule(schedule.id);
      await loadTelegramSchedules();
      setScheduleNotice('Reminder retry queued. The backend will attempt delivery shortly.');
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'The reminder could not be retried.');
    } finally {
      setScheduleActionId('');
    }
  }

  const renderTemplateDropdown = () => {
    const query = templateSearch.trim().toLowerCase();
    const filteredTemplates = visibleTemplates.filter((template) =>
      `${template.name} ${template.cat} ${template.body}`.toLowerCase().includes(query)
    );
    const defaultTemplates = filteredTemplates.filter((t) => !t.user_id || t.source === 'default');
    const privateTemplatesList = filteredTemplates.filter((t) => Boolean(t.user_id) && t.source !== 'default');
    const clientFirstName = c?.contact ? c.contact.split(' ')[0] : 'Client';

    return (
      <div className="telegram-template-menu" id="message-template-menu" role="menu" aria-label="Message templates">
        <div className="telegram-template-menu-heading">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <b>Message templates</b>
            <span className="chip sm blue">{visibleTemplates.length} total</span>
          </div>
          <small>Click any template to insert it into your chat composer</small>
        </div>
        <input
          className="telegram-template-search"
          type="search"
          value={templateSearch}
          onChange={(event) => setTemplateSearch(event.target.value)}
          placeholder="Search templates (e.g. website link, GST, fee)..."
          aria-label="Search message templates"
          autoFocus
        />
        {templatesLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }} role="status" aria-label="Loading templates">
            <TemplateDropdownSkeleton />
            <TemplateDropdownSkeleton />
            <TemplateDropdownSkeleton />
            <TemplateDropdownSkeleton />
          </div>
        )}
        {templateError && <div className="telegram-template-empty error" role="alert">{templateError}</div>}
        {!templatesLoading && (
          <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
            {/* Default Templates Section */}
            {defaultTemplates.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ padding: '6px 10px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--c-text-mut, #888)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <Icon name="globe" size={11} />
                  <span>Built-in Templates (Country)</span>
                  <span className="chip sm green" style={{ marginLeft: 'auto', fontSize: '10px' }}>{defaultTemplates.length}</span>
                </div>
                {defaultTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    role="menuitem"
                    className="telegram-template-option"
                    onClick={() => {
                      void applyTemplate(template);
                      setTelegramTemplatesOpen(false);
                    }}
                    disabled={!!applyingTemplateId}
                  >
                    <span className="telegram-template-option-icon"><Icon name={getTemplateIcon(template)} size={14} /></span>
                    <span>
                      <b>{applyingTemplateId === template.id ? 'Preparing…' : template.name}</b>
                      <small>{fillTpl(template.body, clientFirstName)}</small>
                    </span>
                    <span className="chip sm green">Default Template</span>
                  </button>
                ))}
              </div>
            )}

            {/* Private Templates Section */}
            {privateTemplatesList.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ padding: '8px 10px 4px', fontSize: '11px', fontWeight: 600, color: 'var(--c-text-mut, #888)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <Icon name="lock" size={11} />
                  <span>Your Private Templates</span>
                  <span className="chip sm violet" style={{ marginLeft: 'auto', fontSize: '10px' }}>{privateTemplates.length}</span>
                </div>
                {privateTemplatesList.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    role="menuitem"
                    className="telegram-template-option"
                    onClick={() => {
                      void applyTemplate(template);
                      setTelegramTemplatesOpen(false);
                    }}
                    disabled={!!applyingTemplateId}
                  >
                    <span className="telegram-template-option-icon"><Icon name={getTemplateIcon(template)} size={14} /></span>
                    <span>
                      <b>{applyingTemplateId === template.id ? 'Preparing…' : template.name}</b>
                      <small>{fillTpl(template.body, clientFirstName)}</small>
                    </span>
                    <span className="chip sm violet">Your Private Template</span>
                  </button>
                ))}
              </div>
            )}

            {filteredTemplates.length === 0 && (
              <div className="telegram-template-empty">No matching templates found.</div>
            )}
          </div>
        )}
        <div className="telegram-template-menu-footer">
          <button
            type="button"
            className="btn sm gh"
            onClick={() => {
              setTelegramTemplatesOpen(false);
              dispatch({ type: 'WA_TAB', tab: 'templates' });
            }}
          >
            Manage all templates in Templates tab →
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="inbox-page">
      <div className="ph inbox-page-head">
        <div><span className="eyebrow">MESSAGES</span><h1>Client Inbox</h1><p>Conversations, files, and follow-ups in one focused workspace.</p></div>
        <button className="btn sm" onClick={() => setShowSchedule(true)}><Icon name="plus" size={14} />Schedule reminder</button>
      </div>

      <div className="card wa-top">
        <label className="wa-channel-control" htmlFor="inbox-channel"><span>Channel</span><select id="inbox-channel" className="sel" value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}>
          <option value="telegram">Telegram</option>
          <option value="whatsapp">WhatsApp</option>
        </select></label>
        {channel === 'telegram' && (
          <>
            <span className={'chip ' + (telegramLoading ? 'amber' : telegramReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {telegramLoading ? 'Checking Telegram…' : telegramReady ? `@${telegramBot}` : 'Telegram unavailable'}
            </span>
            <span className={'chip wa-linked-status ' + (isTelegramConversationLoading ? 'amber' : isTelegramLinkedForCurrentClient ? 'green' : 'amber')}>
              {isTelegramConversationLoading ? 'Loading chat…' : isTelegramLinkedForCurrentClient ? 'Client linked' : 'Client not linked'}
            </span>
            {totalUnreadAcrossClients > 0 && (
              <span className="chip wa-total-unread-pill" title={`${totalUnreadAcrossClients} unread message${totalUnreadAcrossClients > 1 ? 's' : ''} across all connected clients`}>
                <span className="wa-unread-glow-dot" />
                {totalUnreadAcrossClients} unread {totalUnreadAcrossClients === 1 ? 'message' : 'messages'}
              </span>
            )}
          </>
        )}
        {channel === 'whatsapp' && (
          <>
            <span className={'chip ' + (whatsAppLoading ? 'amber' : whatsAppReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: '0 2px 0 0' }} />
              {whatsAppLoading ? 'Checking WhatsApp…' : whatsAppReady ? 'WhatsApp connected' : 'WhatsApp not configured'}
            </span>
          </>
        )}
        <div className="tabs inbox-tabs" role="tablist" aria-label="Client inbox sections">
          {(['chats', 'reminders', 'templates'] as const).map((tab) => (
            <button
              key={tab}
              id={`inbox-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={s.ui.wa.tab === tab}
              aria-controls={`inbox-panel-${tab}`}
              className={s.ui.wa.tab === tab ? 'on' : ''}
              onClick={() => dispatch({ type: 'WA_TAB', tab })}
            >
              {tab === 'chats' ? 'Chats' : tab === 'reminders' ? `Scheduled reminders (${activeTelegramSchedules.length})` : 'Templates'}
            </button>
          ))}
        </div>
        <span className="sp" />
        <button type="button" className="btn sm inbox-schedule-btn" onClick={() => setShowSchedule(true)}>
          <Icon name="plus" size={13} />Schedule
        </button>
        {channel === 'telegram' && <button className="btn sm wa-connect-btn" onClick={() => void connectTelegram()} disabled={telegramLoading || isTelegramConversationLoading || telegramConnecting || !telegramReady}>
          {telegramConnecting && <span className="spin" />}
          {telegramConnecting ? 'Connecting…' : isTelegramLinkedForCurrentClient ? 'Reconnect client' : 'Connect client'}
        </button>}
        {!whatsAppReady && channel === 'whatsapp' && <small className="wa-config-note">Configure Meta API credentials on the backend.</small>}
      </div>

      {s.ui.wa.tab === 'chats' && <div className={`card wa${contactsCollapsed ? ' contacts-collapsed' : ''}`} id="inbox-panel-chats" role="tabpanel" aria-labelledby="inbox-tab-chats">
          <div className="wa-l">
            <div className="wa-list-head">
              <div><b>Conversations</b><span>{visibleClients.length} clients</span></div>
              <label className="wa-client-search"><Icon name="search" size={13} /><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Find a client" aria-label="Filter clients" /></label>
            </div>
            {visibleClients.map((cl) => {
              const th = s.threads[cl.id] || [];
              const whatsappLast = th
                .filter((message) => message.f !== 'sys')
                .reduce<ChatMsg | undefined>((latest, message) => (
                  !latest || message.at > latest.at ? message : latest
                ), undefined);
              const telegramLast = telegramPreviews[cl.id];
              const previewText = channel === 'telegram'
                ? telegramLast?.body
                : whatsappLast?.file ? `Attachment: ${whatsappLast.file}` : whatsappLast?.t;
              const previewAt = channel === 'telegram'
                ? telegramLast?.created_at ? new Date(telegramLast.created_at) : undefined
                : whatsappLast?.at;
              const m = missing(s.checks, cl.id).length;
              const clUnread = unreadCounts[cl.id] || 0;
              const clientPreview = clUnread > 0
                ? `${clUnread} New Message${clUnread === 1 ? '' : 's'}`
                : previewText || 'No messages yet';
              const isSelected = s.ui.wa.client === cl.id;
              return (
                <button
                  type="button"
                  key={cl.id}
                  className={'wa-c' + (isSelected ? ' on' : '') + (clUnread > 0 ? ' has-unread' : '')}
                  aria-label={`${cl.name}${clUnread ? `, ${clUnread} unread messages` : ''}`}
                  aria-pressed={isSelected}
                  title={cl.name}
                  onClick={() => {
                    setTemplateApplyError('');
                    dispatch({ type: 'WA_CLIENT', id: cl.id });
                  }}
                >
                  <span className="av" style={{ ['--t' as any]: cl.tone }}>
                    {cl.short.slice(0, 2).toUpperCase()}
                    {clUnread > 0 && <span className="wa-c-unread-dot" />}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row">
                      <span className={'nm' + (clUnread > 0 ? ' unread-nm' : '')} title={cl.name}>{cl.name}</span>
                      <span className="sp" />
                      <span className="tm">{previewAt ? agoT(previewAt) : ''}</span>
                    </div>
                    <div className="row">
                      <span className={'pv' + (clUnread > 0 ? ' unread-pv' : '')} title={clientPreview}>
                        {clientPreview}
                      </span>
                      {clUnread > 0 ? (
                        <span className="wa-unread-chip" title={`${clUnread} unread Telegram message${clUnread > 1 ? 's' : ''}`} aria-label={`${clUnread} unread Telegram message${clUnread > 1 ? 's' : ''}`}>
                          {clUnread}
                        </span>
                      ) : m ? (
                        <span className="chip amber" style={{ marginLeft: 'auto', padding: '0 7px' }}>{m}</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className={`wa-r${composerExpanded ? ' composer-open' : ''}`}>
            <div className="wa-h">
              <div className="row">
                <button
                  type="button"
                  className="wa-contacts-toggle"
                  onClick={() => setContactsCollapsed((collapsed) => !collapsed)}
                  aria-label={contactsCollapsed ? 'Show conversations list' : 'Collapse conversations list'}
                  aria-expanded={!contactsCollapsed}
                  title={contactsCollapsed ? 'Show conversations' : 'Collapse conversations'}
                >
                  <Icon name="chev" size={15} />
                </button>
                <span className="av lg wa-chat-avatar" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div className="wa-chat-identity">
                  <b>{c.name}</b>
                  <small className="wa-chat-subtitle">
                    <i className={channel === 'telegram'
                      ? (isTelegramLinkedForCurrentClient ? 'connected' : 'disconnected')
                      : (whatsAppLoading ? 'pending' : whatsAppReady ? 'connected' : 'disconnected')} />
                    {channel === 'telegram'
                      ? `${isTelegramLinkedForCurrentClient ? 'Telegram connected' : 'Telegram not linked'} · ${c.contact} · ${c.phone}`
                      : `${whatsAppLoading ? 'Checking WhatsApp' : whatsAppReady ? 'WhatsApp connected' : 'WhatsApp unavailable'} · ${c.contact} · ${c.phone}`}
                  </small>
                </div>
                <span className="sp" />
              </div>
              <div className="ckl">
                {s.checks[c.id]?.map((x, i) => (
                  <span key={i} className={'chip ' + (x.ok ? 'green' : 'amber')}><Icon name={x.ok ? 'check' : 'clock'} size={12} />{x.n}</span>
                ))}
              </div>
            </div>
            <div
              id="wa-thread"
              ref={threadRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                shouldFollowThreadRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
              }}
            >
              {templateApplyError && (
                <div className="empty error" role="alert">
                  <b>Secure portal invitation could not be prepared</b>
                  <span>{templateApplyError}</span>
                  <button className="btn sm" onClick={() => setTemplateApplyError('')}>Dismiss</button>
                </div>
              )}
              {channel === 'telegram' && isTelegramConversationLoading && (
                <div className="tg-conversation-skeleton" role="status" aria-live="polite" aria-label={`Loading Telegram conversation with ${c.name}`}>
                  <div className="tg-skeleton-heading"><span className="tg-skeleton-dot" /><span>Loading conversation history</span></div>
                  <div className="tg-skeleton-message incoming"><i /><i /><i /></div>
                  <div className="tg-skeleton-message outgoing"><i /><i /></div>
                  <div className="tg-skeleton-message incoming short"><i /><i /></div>
                  <div className="tg-skeleton-message outgoing short"><i /><i /><i /></div>
                </div>
              )}
              {channel === 'telegram' && (telegramStatusError || telegramDiagnostics.length > 0) && (
                <div className="empty telegram-state error" role="alert">
                  <b>Telegram integration setup needs attention</b>
                  <span>This is a workspace-wide database or webhook issue, not a status report for {c.name}'s Telegram link.</span>
                  {telegramStatusError && <span>{telegramStatusError}</span>}
                  {telegramDiagnostics.map((warning) => <span key={warning}>{warning}</span>)}
                  {needsTelegramMigrationHelp([telegramStatusError, ...telegramDiagnostics]) && (
                    <TelegramMigrationHelp
                      copied={telegramMigrationCommandCopied}
                      copyError={telegramMigrationCopyError}
                      onCopy={() => void copyTelegramMigrationCommand()}
                    />
                  )}
                  <button className="btn sm" onClick={() => setTelegramStatusRetry((value) => value + 1)}>Check again</button>
                </div>
              )}
              {channel === 'whatsapp' && (!whatsAppReady || whatsAppError) && (
                <div className="empty whatsapp-state error">
                  <b>WhatsApp API is not connected</b>
                  <span>{whatsAppError || 'WhatsApp Business API requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the backend environment. Switch to Telegram to message clients with live two-way sync.'}</span>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn sm pri" onClick={() => setChannel('telegram')}>Switch to Telegram (Connected)</button>
                    {whatsAppError && <button className="btn sm" onClick={() => setWhatsAppError('')}>Dismiss</button>}
                  </div>
                </div>
              )}
              {channel === 'telegram' && telegramConversationClientId === c.id && telegramError && (
                <div className="empty telegram-state error">
                  <b>Telegram action needs attention</b>
                  <span>{telegramError}</span>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button className="btn sm" onClick={() => { setTelegramError(''); setTelegramRetry((value) => value + 1); setTelegramStatusRetry((value) => value + 1); }}>Retry connection</button>
                    {/session|expired|invalid|unauthorized|log in/i.test(telegramError) && (
                      <button className="btn sm pri" onClick={() => dispatch({ type: 'LOGOUT' })}>Log in again</button>
                    )}
                  </div>
                  {needsTelegramMigrationHelp([telegramError]) && (
                    <TelegramMigrationHelp
                      copied={telegramMigrationCommandCopied}
                      copyError={telegramMigrationCopyError}
                      onCopy={() => void copyTelegramMigrationCommand()}
                    />
                  )}
                </div>
              )}
              {channel === 'telegram' && !isTelegramConversationLoading && telegramConversationClientId === c.id && !telegramError && !isTelegramLinkedForCurrentClient && (
                <div className="tg-unlinked-state" role="status">
                  <div className="tg-unlinked-art">
                    <span className="tg-unlinked-orbit orbit-one" />
                    <span className="tg-unlinked-orbit orbit-two" />
                    <span className="tg-unlinked-icon"><Icon name="send" size={23} /></span>
                    <span className="tg-unlinked-lock"><Icon name="lock" size={13} /></span>
                  </div>
                  <span className="eyebrow">PRIVATE CLIENT CONNECTION</span>
                  <h3>{telegramReady ? `Connect ${c.short} to Telegram` : 'Telegram is unavailable'}</h3>
                  <p>
                    {telegramReady
                      ? `Link ${c.name} with your Telegram bot to securely load this conversation and exchange messages here.`
                      : 'The Telegram bot is not available right now. Check the backend connection and try again.'}
                  </p>
                  {telegramReady && (
                    <button className="btn sm pri" onClick={() => void connectTelegram()} disabled={telegramConnecting}>
                      {telegramConnecting ? <><span className="spin spin-light" />Creating secure link…</> : <><Icon name="link" size={13} />Connect client</>}
                    </button>
                  )}
                  <small>Messages will appear in this conversation after the client completes the Telegram link.</small>
                </div>
              )}
              {channel === 'telegram' && !isTelegramConversationLoading && isTelegramLinkedForCurrentClient && !telegramError && telegramMessages.length === 0 && !pendingTelegramForCurrentClient && (
                <div className="tg-conversation-empty" role="status">
                  <span><Icon name="chat" size={20} /></span>
                  <b>No messages yet</b>
                  <small>This Telegram conversation is connected. Send a message to start the conversation.</small>
                </div>
              )}
              {channel === 'telegram' && pendingTelegramForOtherClient && pendingTelegramClient && (
                <div className="telegram-notice tg-pending-client-notice">
                  <span>A message for {pendingTelegramClient.short} is waiting for your approval.</span>
                  <button className="btn sm" onClick={() => dispatch({ type: 'WA_CLIENT', id: pendingTelegramClient.id })}>Review message</button>
                </div>
              )}
              {channel === 'telegram' && telegramConversationClientId === c.id && !isTelegramConversationLoading && telegramInfo && (
                <div className="telegram-notice" role="status">
                  {telegramInfo}
                  {telegramLinkToShare && (
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <input className="inp" aria-label={`Telegram connection link for ${c.name}`} readOnly value={telegramLinkToShare} onFocus={(event) => event.currentTarget.select()} />
                      <button className="btn sm" onClick={() => void copyTelegramLink()}>Copy link</button>
                    </div>
                  )}
                </div>
              )}
              {channel === 'telegram' && telegramRefreshWarning && (
                <div className="telegram-notice telegram-refresh-warning" role="status">{telegramRefreshWarning}</div>
              )}
              {channel === 'telegram' && isTelegramLinkedForCurrentClient && !isTelegramConversationLoading && telegramMessages.map((m) => {
                return (
                  <div key={m.provider_message_id || m.id} className={'msg ' + (m.direction === 'outbound' ? 'me' : 'cl')}>
                    <div className="wa-message-body">{m.body}</div>
                    <span className="mt">
                      {fTime(new Date(m.created_at))} · {
                        m.delivery_status === 'sending' || m.delivery_status === 'queued'
                          ? 'Sending…'
                          : m.delivery_status === 'failed'
                            ? 'Delivery failed'
                            : m.delivery_status === 'sent' ? 'Sent' : m.delivery_status
                      }
                    </span>
                  </div>
                );
              })}
              {channel === 'telegram' && pendingTelegramForCurrentClient && (
                <div className="tg-pending-group">

                  {/* ── Message bubble (muted while pending / editing) ── */}
                  <div className={`msg me tg-pending-bubble${isEditingPending ? ' tg-pending-bubble--editing' : ''}`}>
                    <div>{pendingTelegramMsg}</div>
                    <span className="mt">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display:'inline', verticalAlign:'middle', marginRight:3 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      {isEditingPending ? 'Editing…' : 'Pending approval'}
                    </span>
                  </div>

                  {/* ── Approval / Edit card ── */}
                  <div className={`tg-approval-card${isEditingPending ? ' tg-approval-card--editing' : ''}`}>

                    {isEditingPending ? (
                      /* ── EDIT MODE ── */
                      <>
                        <div className="tg-edit-header">
                          <span className="tg-approval-icon tg-approval-icon--edit">
                            {/* Pencil icon */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </span>
                          <div className="tg-approval-text">
                            <b>Edit your message</b>
                            <span>Press Enter or click Update to re-review. Shift + Enter adds a new line.</span>
                          </div>
                        </div>
                        <div className="tg-edit-body">
                          <textarea
                            ref={editTextareaRef}
                            className="tg-edit-textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (editText.trim()) commitEdit();
                              } else if (e.key === 'Escape') {
                                abortEdit();
                              }
                            }}
                            rows={3}
                            maxLength={4096}
                            aria-label="Edit pending Telegram message"
                          />
                          {editText.trim() === '' && (
                            <p className="tg-edit-error">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                              Message cannot be empty.
                            </p>
                          )}
                        </div>
                        <div className="tg-approval-actions">
                          <button className="tg-cancel-btn" onClick={abortEdit}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                            Back
                          </button>
                          <button
                            className="tg-approve-btn tg-update-btn"
                            onClick={commitEdit}
                            disabled={!editText.trim()}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            Update
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ── REVIEW MODE ── */
                      <>
                        <div className="tg-approval-header">
                          <span className="tg-approval-icon">
                            {/* Phone icon */}
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.47 2 2 0 0 1 3.62 1.27h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.72-.72a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                          </span>
                          <div className="tg-approval-text">
                            <b>Review before sending via Telegram</b>
                            <span>Message not delivered yet. Approve, edit, or discard.</span>
                          </div>
                        </div>
                        <div className="tg-approval-actions">
                          {/* Discard */}
                          <button className="tg-cancel-btn" onClick={cancelTelegramPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            Discard
                          </button>
                          {/* Edit */}
                          <button className="tg-edit-btn" onClick={startEditingPending} disabled={telegramSending}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit
                          </button>
                          {/* Approve & Send */}
                          <button className="tg-approve-btn" onClick={() => void confirmTelegramSend()} disabled={telegramSending}>
                            {telegramSending
                              ? <><span className="tg-spin" />Sending…</>
                              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Approve &amp; Send</>
                            }
                          </button>
                        </div>
                      </>
                    )}

                  </div>
                </div>
              )}

              {channel === 'whatsapp' && (() => {
                let last = '';
                return thread.map((m) => {
                  const dl = dayLabel(m.at);
                  const sep = dl !== last ? (last = dl, <div key={'sep' + m.id} className="dsep">{dl}</div>) : null;
                  return (
                    <>
                      {sep}
                      {m.f === 'sys' ? (
                        <div key={m.id} className="sys"><Icon name="bolt" size={12} />{m.t}</div>
                      ) : (
                        <div key={m.id} className={'msg ' + m.f}>
                          {m.file && (
                            <div className="att"><Icon name="file" size={18} /><div><div className="mono" style={{ fontSize: 11.5 }}>{m.file}</div><div style={{ fontSize: 10.5, opacity: 0.75 }}>Captured to client folder</div></div></div>
                          )}
                          {m.t}
                          <span className="mt">{fTime(m.at)}{m.auto ? ' · automated' : ''}</span>
                        </div>
                      )}
                    </>
                  );
                });
              })()}
              {channel === 'whatsapp' && scheduled.filter((r) => r.client === c.id).length > 0 && <div className="dsep">Scheduled</div>}
              {channel === 'whatsapp' && scheduled.filter((r) => r.client === c.id).map((r) => (
                <div key={r.id} className="msg me sched">
                  <div className="sh">
                    <Icon name="clock" size={13} /><span>{fDT(r.at)} · {until(r.at)}</span>
                    {r.approve ? <span className="chip amber">Needs your approval</span> : <span className="chip green">Auto-send</span>}
                  </div>
                  {r.text}
                  <div className="sa">
                    {r.approve && <button className="btn sm" onClick={() => dispatch({ type: 'REM_APPROVE', id: r.id })}>Approve</button>}
                    <button className="btn sm" onClick={() => void sendReminder(r)} disabled={sendingReminderId === r.id || whatsAppLoading || !whatsAppReady}>
                      {sendingReminderId === r.id ? 'Sending…' : 'Send now'}
                    </button>
                    <button className="btn sm gh" onClick={() => dispatch({ type: 'REM_CANCEL', id: r.id })}>Cancel</button>
                  </div>
                  {reminderSendErrors[r.id] && <small className="wa-reminder-error">{reminderSendErrors[r.id]}</small>}
                </div>
              ))}
            </div>
            <div className={`wa-compose-dock${composerExpanded ? ' expanded' : ''}`}>
              {composerExpanded ? (
                <>
                  <div className="wa-compose-heading">
                    <span className="wa-compose-heading-icon"><Icon name="chat" size={14} /></span>
                    <span><b>Message {c.contact.split(' ')[0]}</b><small>via {channel === 'telegram' ? 'Telegram' : 'WhatsApp'}</small></span>
                    <button
                      type="button"
                      className="wa-compose-collapse"
                      onClick={() => { setComposerExpanded(false); setTelegramTemplatesOpen(false); }}
                      aria-label="Collapse message composer"
                      title="Collapse composer"
                    >
                      <Icon name="chev" size={15} />
                    </button>
                  </div>
                  {channel === 'telegram' ? (
                <div className="wa-f telegram-composer">
                <div className="telegram-composer-pill">
                  <div className="telegram-template-anchor" ref={telegramTemplateMenuRef}>
                    <button
                      type="button"
                      className="telegram-composer-action telegram-template-trigger"
                      aria-label="Insert a message template"
                      aria-expanded={telegramTemplatesOpen}
                      aria-controls="message-template-menu"
                      title="Choose a message template"
                      onClick={() => setTelegramTemplatesOpen((open) => !open)}
                      disabled={telegramSending || !!pendingTelegramMsg || isEditingPending}
                    >
                      <Icon name="file" size={17} />
                    </button>
                    {telegramTemplatesOpen && renderTemplateDropdown()}
                  </div>
                    <textarea
                    ref={telegramMessageInputRef}
                    className="inp telegram-composer-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setTelegramTemplatesOpen(false);
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        requestTelegramSend();
                      }
                      if (event.key === 'Escape') setComposerExpanded(false);
                    }}
                    placeholder={
                      pendingTelegramForOtherClient
                        ? `Review the pending message for ${pendingTelegramClient?.short || 'another client'} first…`
                        : pendingTelegramForCurrentClient || isEditingPending
                          ? isEditingPending
                            ? 'Finish editing the message above first…'
                            : 'Approve, edit, or discard the pending message first…'
                          : `Message ${c.contact.split(' ')[0]} via Telegram`
                    }
                    disabled={telegramSending || telegramLoading || isTelegramConversationLoading || !!pendingTelegramMsg || isEditingPending}
                    aria-label="Message input"
                  />
                    <button
                    type="button"
                    className="telegram-composer-send"
                    onClick={requestTelegramSend}
                    disabled={!input.trim() || !telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading || telegramSending || telegramLoading || !!pendingTelegramMsg || isEditingPending}
                    aria-label="Review message before sending"
                    title="Review message"
                  >
                    {telegramSending ? <span className="spin spin-light" /> : <Icon name="send" size={17} />}
                  </button>
                </div>
                <small className="telegram-composer-hint">Messages are reviewed before they are sent.</small>
              </div>
            ) : (
              <div className="wa-f">
                <div className="telegram-template-anchor" ref={telegramTemplateMenuRef}>
                  <button
                    type="button"
                    className="telegram-composer-action telegram-template-trigger wa-template-trigger"
                    aria-label="Insert a message template"
                    aria-expanded={telegramTemplatesOpen}
                    aria-controls="message-template-menu"
                    title="Choose a message template"
                    onClick={() => setTelegramTemplatesOpen((open) => !open)}
                    disabled={!!applyingTemplateId || whatsAppSending}
                  >
                    <Icon name="file" size={17} />
                  </button>
                  {telegramTemplatesOpen && renderTemplateDropdown()}
                </div>
                <textarea
                  ref={whatsAppMessageInputRef}
                  className="inp wa-compose-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                    if (event.key === 'Escape') setComposerExpanded(false);
                  }}
                  placeholder={whatsAppLoading
                    ? 'Checking WhatsApp API status…'
                    : !whatsAppReady
                      ? 'WhatsApp API not configured (switch to Telegram or add env vars)'
                      : `Message ${c.contact.split(' ')[0]} via WhatsApp`}
                  disabled={whatsAppLoading || !whatsAppReady || whatsAppSending}
                  aria-label="Message input"
                />
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => void send()}
                  disabled={!input.trim() || whatsAppLoading || !whatsAppReady || whatsAppSending}
                  aria-label="Send message"
                >
                  {whatsAppSending ? <span className="spin spin-light" /> : <Icon name="send" size={15} />}
                </button>
              </div>
            )}
                  <div className="wa-footer-note" role="status">
                    <Icon name="lock" size={11} />
                    <span>Messages are sent through the selected channel. Delivery status appears in each message.</span>
                    <span className="wa-footer-channel">{channel === 'telegram' ? 'Telegram gateway' : 'WhatsApp Business'}</span>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="wa-compose-launcher"
                  onClick={openComposer}
                  aria-label={`Write a message to ${c.contact.split(' ')[0]}`}
                  title="Write a message"
                >
                  <Icon name="chat" size={18} />
                  <span className="wa-compose-launcher-plus"><Icon name="plus" size={11} /></span>
                </button>
              )}
            </div>
          </div>
        </div>}

      {s.ui.wa.tab === 'reminders' && (
        <div className="wa-reminders" id="inbox-panel-reminders" role="tabpanel" aria-labelledby="inbox-tab-reminders">

          {/* Header row */}
          <div className="wa-reminders-header">
            <div className="wa-reminder-notice wa-reminders-banner">
              <Icon name="clock" size={14} />
              <span>Scheduled reminders are delivered automatically through the client's linked Telegram chat, using the client-country time zone.</span>
            </div>
            <div className="wa-reminders-actions-row">
              <button
                className="btn sm"
                onClick={() => void loadTelegramSchedules()}
                disabled={schedulesLoading}
                title="Refresh schedules"
              >
                {schedulesLoading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
                {schedulesLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                className="btn sm pri"
                onClick={() => { setScheduleError(''); setScheduleNotice(''); setShowSchedule(true); }}
              >
                <Icon name="plus" size={13} />Schedule Telegram reminder
              </button>
            </div>
          </div>

          {/* Success notice */}
          {scheduleNotice && (
            <div className="wa-reminders-notice-card wa-reminders-notice-success" role="status">
              <Icon name="check" size={14} />{scheduleNotice}
              <button className="btn sm gh wa-reminders-notice-dismiss" onClick={() => setScheduleNotice('')}>✕</button>
            </div>
          )}

          {/* Error notice — suppress raw 404 strings */}
          {scheduleError && (
            <div className="wa-reminders-notice-card wa-reminders-notice-error" role="alert">
              <Icon name="info" size={14} />
              <span>{scheduleError}</span>
              <button className="btn sm gh wa-reminders-notice-dismiss" onClick={() => setScheduleError('')}>✕</button>
            </div>
          )}

          {/* Skeleton loading */}
          {schedulesLoading && !telegramSchedules.length && (
            <div className="wa-reminder-list" role="status" aria-label="Loading schedules">
              <ScheduleCardSkeleton />
              <ScheduleCardSkeleton />
              <ScheduleCardSkeleton />
            </div>
          )}

          {/* Empty state */}
          {!schedulesLoading && !telegramSchedules.length && (
            <div className="card wa-tab-empty">
              <span className="wa-tab-empty-icon"><Icon name="clock" size={28} /></span>
              <b>No saved Telegram reminders</b>
              <span>Choose a client, message and client-local send time to schedule a one-time or daily reminder.</span>
              <button
                className="btn pri"
                style={{ marginTop: 10 }}
                onClick={() => { setScheduleError(''); setScheduleNotice(''); setShowSchedule(true); }}
              >
                <Icon name="plus" size={13} />Create your first reminder
              </button>
            </div>
          )}

          {/* Schedules list */}
          {!schedulesLoading && telegramSchedules.length > 0 && (
            <div className="wa-reminder-list">
              {telegramSchedules.map((schedule) => (
                <article className="card wa-reminder-card" key={schedule.id}>
                  <div className="wa-reminder-time">
                    <b>{schedule.repeat_mode === 'daily' ? schedule.local_time?.slice(0, 5) : scheduledTimeLabel(schedule)}</b>
                    <small>{schedule.repeat_mode === 'daily' ? 'Every day' : schedule.status === 'active' ? 'One-time send' : schedule.status}</small>
                  </div>
                  <div className="wa-reminder-content">
                    <div className="wa-reminder-client">
                      <span className="av"><Icon name="users" size={13} /></span>
                      <b>{schedule.client?.name || 'Client'}</b>
                      <span className="chip blue">{schedule.repeat_mode === 'daily' ? 'Daily' : 'One time'}</span>
                      <span className="chip">{schedule.timezone_name}</span>
                    </div>
                    <small className="mut">Next send: {scheduledTimeLabel(schedule)} · {schedule.occurrence_count} sent</small>
                    <p>{schedule.message_body}</p>
                    {schedule.last_error && <small className="wa-reminder-error">{schedule.last_error}</small>}
                  </div>
                  <div className="wa-reminder-actions">
                    <span className={`chip ${schedule.status === 'active' ? 'green' : schedule.status === 'failed' ? 'red' : 'blue'}`}>{schedule.status}</span>
                    {schedule.status === 'active' && (
                      <button className="btn sm gh" onClick={() => void cancelTelegramReminder(schedule)} disabled={scheduleActionId === schedule.id}>
                        Cancel
                      </button>
                    )}
                    {schedule.status === 'failed' && (
                      <button className="btn sm" onClick={() => void retryTelegramReminder(schedule)} disabled={scheduleActionId === schedule.id}>
                        {scheduleActionId === schedule.id ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {s.ui.wa.tab === 'templates' && (
        <div id="inbox-panel-templates" role="tabpanel" aria-labelledby="inbox-tab-templates">

          {/* Tab header */}
          <div className="wa-tpl-header">
            <div className="wa-tpl-header-left">
              <span className="wa-tpl-header-icon"><Icon name="file" size={18} /></span>
              <div>
                <h2 className="wa-tpl-title">Message Templates</h2>
                <p className="wa-tpl-subtitle">Built-in templates are available by country. Private templates are loaded only for your account.</p>
              </div>
            </div>
            {!templateEditorOpen && (
              <button className="btn pri" onClick={() => startTemplateEdit()}>
                <Icon name="plus" size={14} />New template
              </button>
            )}
          </div>

          {/* Error banner */}
          {templateError && (
            <div className="wa-reminders-notice-card wa-reminders-notice-error" role="alert">
              <Icon name="info" size={14} />
              <span>{templateError}</span>
              <button className="btn sm gh wa-reminders-notice-dismiss" onClick={() => setTemplateError('')}>✕</button>
            </div>
          )}

          {/* Template editor modal (mid-size floating card with close button) */}
          {templateEditorOpen && (
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="template-modal-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !templateSaving) {
                  setTemplateEditorOpen(false);
                  setEditingTemplate(null);
                  setTemplateError('');
                }
              }}
            >
              <section className="mbox wa-tpl-editor-modal-card" style={{ width: 'min(760px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }} role="form" aria-label="Template Editor">
                <div className="wa-tpl-editor-heading" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
                  <div className="wa-tpl-editor-heading-left">
                    <span className="wa-tpl-editor-icon">
                      <Icon name={editingTemplate ? 'pencil' : 'spark'} size={18} />
                    </span>
                    <div>
                      <h3 className="wa-tpl-editor-title" id="template-modal-title">
                        {editingTemplate ? `Editing: ${editingTemplate.name}` : 'Create New Template'}
                        <span className="chip violet sm"><Icon name="lock" size={10} /> Your Private Template</span>
                      </h3>
                      <p className="wa-tpl-editor-sub">
                        Saved privately to your account · Loaded and visible only for you
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, fontSize: 14 }}
                    onClick={() => {
                      setTemplateEditorOpen(false);
                      setEditingTemplate(null);
                      setTemplateError('');
                    }}
                    disabled={templateSaving}
                    aria-label="Close template editor"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>

                {/* Form Grid: Name & Category */}
                <div className="wa-tpl-form-grid">
                  <div className="wa-tpl-input-wrap">
                    <label htmlFor="template-name">
                      <Icon name="file" size={13} /> Template Name
                    </label>
                    <input
                      id="template-name"
                      className="inp"
                      maxLength={200}
                      placeholder="e.g. Monthly GST Filing Reminder"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm((c) => ({ ...c, name: e.target.value }))}
                    />
                  </div>
                  <div className="wa-tpl-input-wrap">
                    <label htmlFor="template-category">
                      <Icon name="sliders" size={13} /> Category Section
                    </label>
                    <select
                      id="template-category"
                      className="sel"
                      value={templateForm.cat}
                      onChange={(e) => setTemplateForm((c) => ({ ...c, cat: e.target.value }))}
                    >
                      {['Client portal', 'Utility', 'Links', 'Filing', 'Payment', 'Reminder', 'General'].map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Dynamic Variables Instruction Banner (Big, Clear, Prominent) */}
                <div className="wa-tpl-instruction-banner">
                  <div className="wa-tpl-instruction-header">
                    <span className="wa-tpl-instruction-badge">
                      <Icon name="spark" size={11} /> Auto-Personalization
                    </span>
                    <span className="wa-tpl-instruction-title">Dynamic Client Message Placeholders</span>
                  </div>
                  <p className="wa-tpl-instruction-text">
                    When sending messages or reminders, TaxFlow automatically replaces these <strong>&#123;tags&#125;</strong> with the selected client's actual data. <strong>Click any placeholder below to insert it at your cursor:</strong>
                  </p>
                  <div className="wa-tpl-tokens-grid">
                    {([
                      ['{name}', 'Client Name', 'Replaced with client first name (e.g. Rajesh)'],
                      ['{portalLink}', 'Portal / Website Link', 'Client portal website or private link'],
                      ['{period}', 'Filing Period', 'Filing period (e.g. August 2026)'],
                      ['{due}', 'Due Date', 'Upcoming deadline date (e.g. 20 Sep 2026)'],
                      ['{doc}', 'Document Name', 'Requested document (e.g. bank statement)'],
                      ['{filing}', 'Filing Type', 'Form or filing type (e.g. GSTR-3B, ITR-1)'],
                    ] as const).map(([token, label, desc]) => (
                      <button
                        key={token}
                        type="button"
                        className="wa-tpl-token-card"
                        title={`Click to insert ${token} at cursor position`}
                        onClick={() => insertToken(token)}
                      >
                        <div className="wa-tpl-token-card-top">
                          <code className="wa-tpl-token-code">{token}</code>
                          <span className="wa-tpl-token-name">{label}</span>
                        </div>
                        <span className="wa-tpl-token-desc">{desc}</span>
                      </button>
                    ))}
                  </div>
                  <div className="wa-tpl-instruction-footer">
                    <Icon name="info" size={12} />
                    <span>Use <code>{'{portalLink}'}</code> to automatically attach the client portal link in your message.</span>
                  </div>
                </div>

                {/* Split Editor: Message Body Textarea & Live Preview */}
                <div className="wa-tpl-body-preview-grid">
                  <div className="wa-tpl-input-wrap">
                    <label htmlFor="template-body">
                      <Icon name="chat" size={13} /> Message Body Text
                      <span className="wa-tpl-char-count">{templateForm.body.length} / 5000 characters</span>
                    </label>
                    <textarea
                      ref={templateBodyRef}
                      id="template-body"
                      className="inp"
                      rows={7}
                      maxLength={5000}
                      placeholder="Type your message text here. Click the placeholders above to insert {name}, {portalLink}, etc."
                      value={templateForm.body}
                      onChange={(e) => setTemplateForm((c) => ({ ...c, body: e.target.value }))}
                    />
                  </div>
                  <div className="wa-tpl-live-preview">
                    <div className="wa-tpl-preview-header">
                      <Icon name="globe" size={13} />
                      <span>Live Client Message Preview</span>
                    </div>
                    <div className="wa-tpl-preview-bubble">
                      {templateForm.body.trim()
                        ? fillTpl(templateForm.body, c?.contact?.split(' ')[0] || 'Rajesh')
                        : <span className="wa-tpl-preview-empty">Your personalized message preview will appear here in real-time as you type...</span>}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="wa-tpl-editor-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                  <button
                    type="button"
                    className="btn gh"
                    onClick={() => { setTemplateEditorOpen(false); setEditingTemplate(null); setTemplateError(''); }}
                    disabled={templateSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn pri"
                    onClick={() => void saveTemplate()}
                    disabled={templateSaving || !templateForm.name.trim() || !templateForm.body.trim()}
                  >
                    {templateSaving
                      ? <><span className="spin spin-light" />Saving…</>
                      : <><Icon name="check" size={13} />{editingTemplate ? 'Update template' : 'Save Private Template'}</>}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* Skeleton loading */}
          {templatesLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="wa-tpl-section-label" style={{ opacity: 0.7 }}>
                <div className="wa-skeleton-shimmer" style={{ width: 140, height: 26, borderRadius: 20 }} />
                <div className="wa-skeleton-shimmer" style={{ width: 180, height: 14, borderRadius: 4 }} />
              </div>
              <div className="wa-template-grid" role="status" aria-label="Loading templates">
                {[...Array(6)].map((_, i) => <TemplateCardSkeleton key={i} />)}
              </div>
            </div>
          )}

          {/* Empty state */}
          {/* Shared defaults section */}
          {!templatesLoading && defaultTemplatesList.length > 0 && (
            <>
              <div className="wa-tpl-section-label">
                <span className="wa-tpl-section-badge green">
                  <Icon name="globe" size={12} /> Shared Default Templates
                </span>
                <span className="wa-tpl-section-desc">
                  {dbDefaultTemplates.length > 0
                    ? 'Loaded from database · Shared with all users in your practice'
                    : 'Built into TaxFlow · Select a country to change the message set'}
                </span>
              </div>
              {dbDefaultTemplates.length === 0 && (
                <div className="wa-tpl-country-control" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, maxWidth: 340 }}>
                  <label className="f" htmlFor="template-country">Template country</label>
                  <select id="template-country" className="sel" value={templateCountry} onChange={(event) => setTemplateCountry(event.target.value as TemplateCountryCode)}>
                    {TEMPLATE_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
                  </select>
                </div>
              )}
              <div className="wa-template-grid">
                {defaultTemplatesList.map((template) => (
                  <article className="card tpl wa-template-card wa-template-card--shared" key={template.id}>
                    <div className="wa-template-card-header">
                      <span className="wa-tpl-card-icon">
                        <Icon name={getTemplateIcon(template)} size={16} />
                      </span>
                      <div className="wa-tpl-card-meta">
                        <b className="wa-tpl-card-name">{template.name}</b>
                        <div className="wa-tpl-card-chips">
                          <span className="chip blue sm">{template.cat}</span>
                          <span className="chip green sm"><Icon name="globe" size={10} /> Shared Default</span>
                        </div>
                      </div>
                    </div>
                    <p className="wa-tpl-card-preview">
                      {fillTpl(template.body, c?.contact?.split(' ')[0] || 'Client')}
                    </p>
                    <div className="wa-template-footer">
                      <span className="sp" />
                      <button
                        className="btn sm pri"
                        onClick={() => void applyTemplate(template, true)}
                        disabled={!!applyingTemplateId}
                      >
                        {applyingTemplateId === template.id
                          ? <><span className="spin spin-light" />Preparing…</>
                          : <><Icon name="send" size={12} />Use in Chat</>}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {/* Private templates section */}
          {!templatesLoading && (
            <>
              <div className="wa-tpl-section-label">
                <span className="wa-tpl-section-badge violet">
                  <Icon name="lock" size={12} /> Your Private Templates
                </span>
                <span className="wa-tpl-section-desc">Only visible and loaded for your account</span>
              </div>
              {privateTemplates.length === 0 ? (
                <div className="wa-private-tpl-empty">
                  <div className="wa-private-tpl-empty-icon"><Icon name="lock" size={22} /></div>
                  <div className="wa-private-tpl-empty-text">
                    <b>No private templates created yet</b>
                    <p>Templates you create with "+ New template" are saved privately to your account and loaded exclusively for you.</p>
                  </div>
                  <button className="btn sm pri" onClick={() => startTemplateEdit()}>
                    <Icon name="plus" size={13} />Create Private Template
                  </button>
                </div>
              ) : (
                <div className="wa-template-grid">
                  {privateTemplates.map((template) => (
                    <article className="card tpl wa-template-card wa-template-card--private" key={template.id}>
                      <div className="wa-template-card-header">
                        <span className="wa-tpl-card-icon">
                          <Icon name={getTemplateIcon(template)} size={16} />
                        </span>
                        <div className="wa-tpl-card-meta">
                          <b className="wa-tpl-card-name">{template.name}</b>
                          <div className="wa-tpl-card-chips">
                            <span className="chip blue sm">{template.cat}</span>
                            <span className="chip violet sm"><Icon name="lock" size={10} /> Your Private Template</span>
                          </div>
                        </div>
                      </div>
                      <p className="wa-tpl-card-preview">
                        {fillTpl(template.body, c?.contact?.split(' ')[0] || 'Client')}
                      </p>
                      <div className="wa-template-footer">
                        <button className="btn sm" onClick={() => startTemplateEdit(template)}>
                          <Icon name="pencil" size={12} />Edit
                        </button>
                        <button
                          className="btn sm gh"
                          onClick={() => void removeTemplate(template)}
                          disabled={template.protected}
                          title={template.protected ? 'Protected templates cannot be deleted' : 'Delete template'}
                        >
                          <Icon name="trash" size={12} />Delete
                        </button>
                        <span className="sp" />
                        <button
                          className="btn sm pri"
                          onClick={() => void applyTemplate(template, true)}
                          disabled={!!applyingTemplateId}
                        >
                          {applyingTemplateId === template.id
                            ? <><span className="spin spin-light" />Preparing…</>
                            : <><Icon name="send" size={12} />Use in Chat</>}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showSchedule && (
        <ScheduleModal
          onClose={() => setShowSchedule(false)}
          defaultClient={c.id}
          clients={s.clients}
          templates={visibleTemplates}
          timezones={countryTimezones}
          error={scheduleError}
          saving={scheduleSaving}
          onSave={saveTelegramReminder}
        />
      )}

    </div>
  );
}

function localDateTimeInput(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T10:00`;
}

function ScheduleModal({
  onClose,
  defaultClient,
  clients,
  templates,
  timezones,
  error,
  saving,
  onSave,
}: {
  onClose: () => void;
  defaultClient: string;
  clients: Array<{ id: string; name: string; contact: string; countryId?: string }>;
  templates: MessageTemplate[];
  timezones: SupportedCountryTimezone[];
  error: string;
  saving: boolean;
  onSave: (data: {
    clientId: string;
    templateId?: string;
    messageBody: string;
    repeatMode: 'once' | 'daily';
    timezoneName: string;
    scheduledLocal?: string;
    localTime?: string;
  }) => Promise<void>;
}) {
  const [clientId, setClientId] = useState(defaultClient || clients[0]?.id || '');
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  const [repeatMode, setRepeatMode] = useState<'once' | 'daily'>('once');
  const [timezoneName, setTimezoneName] = useState('');
  const [localTime, setLocalTime] = useState('10:00');
  const [now, setNow] = useState(() => new Date());
  const selectedClient = clients.find((client) => client.id === clientId);
  const availableTimezones = timezones.filter((timezone) => timezone.country_id === selectedClient?.countryId);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const [scheduledLocal, setScheduledLocal] = useState(() => localDateTimeInput(new Date(Date.now() + 86_400_000), 'UTC'));
  const [messageBody, setMessageBody] = useState(selectedTemplate?.body || '');

  useEffect(() => {
    const countryTimezone = availableTimezones.find((timezone) => timezone.timezone_name === timezoneName)
      || availableTimezones.find((timezone) => timezone.is_default)
      || availableTimezones[0];
    if (countryTimezone && timezoneName !== countryTimezone.timezone_name) {
      setTimezoneName(countryTimezone.timezone_name);
      setScheduledLocal(localDateTimeInput(new Date(Date.now() + 86_400_000), countryTimezone.timezone_name));
    }
  }, [availableTimezones, timezoneName]);

  useEffect(() => {
    if (selectedTemplate) setMessageBody(selectedTemplate.body);
  }, [selectedTemplate]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title" onClick={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div className="mbox wa-schedule-modal">
        <div className="wa-schedule-heading">
          <span className="wa-schedule-icon"><Icon name="clock" size={18} /></span>
          <div><h2 id="schedule-modal-title">Schedule a Telegram reminder</h2><p>Saved on the server and sent automatically in the client’s country time.</p></div>
        </div>
        <div className="mgrid">
          <div className="mrow">
            <label className="f" htmlFor="schedule-client">Client</label>
            <select id="schedule-client" className="sel" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </div>
          <div className="mrow">
            <label className="f" htmlFor="schedule-template">Message template</label>
            <select
              id="schedule-template"
              className="sel"
              value={templateId}
              onChange={(event) => {
                const nextId = event.target.value;
                setTemplateId(nextId);
                const nextTpl = templates.find((t) => t.id === nextId);
                if (nextTpl) {
                  setMessageBody(nextTpl.body);
                }
              }}
            >
              <option value="">✍️ Custom reminder text</option>
              {templates.filter((t) => !t.user_id).length > 0 && (
                <optgroup label="🌐 Built-in Templates (Country)">
                  {templates.filter((t) => !t.user_id).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.cat})
                    </option>
                  ))}
                </optgroup>
              )}
              {templates.filter((t) => !!t.user_id).length > 0 && (
                <optgroup label="🔒 Your Private Templates">
                  {templates.filter((t) => !!t.user_id).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.cat})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </div>
        <div className="wa-schedule-repeat" role="group" aria-label="Repeat schedule">
          <button type="button" className={repeatMode === 'once' ? 'on' : ''} onClick={() => setRepeatMode('once')}><Icon name="cal" size={14} />One time</button>
          <button type="button" className={repeatMode === 'daily' ? 'on' : ''} onClick={() => setRepeatMode('daily')}><Icon name="refresh" size={14} />Every day</button>
        </div>
        <div className="mgrid">
          <div className="mrow">
            <label className="f" htmlFor="schedule-timezone">Client time zone</label>
            <select id="schedule-timezone" className="sel" value={timezoneName} onChange={(event) => setTimezoneName(event.target.value)} disabled={!availableTimezones.length}>
              {availableTimezones.map((timezone) => <option key={timezone.timezone_name} value={timezone.timezone_name}>{timezone.timezone_name}{timezone.is_default ? ' · Country default' : ''}</option>)}
            </select>
            {selectedClient && <small>Country: {timezones.find((timezone) => timezone.country_id === selectedClient.countryId)?.country_name || 'Not configured'}</small>}
          </div>
          <div className="mrow">
            <label className="f" htmlFor={repeatMode === 'once' ? 'schedule-datetime' : 'schedule-daily-time'}>{repeatMode === 'once' ? 'Send at client local time' : 'Send every day at'}</label>
            {repeatMode === 'once'
              ? <input id="schedule-datetime" className="inp" type="datetime-local" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} />
              : <input id="schedule-daily-time" className="inp" type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} />}
            {timezoneName && <small>Current client time: {new Intl.DateTimeFormat(undefined, { timeZone: timezoneName, dateStyle: 'medium', timeStyle: 'medium' }).format(now)}</small>}
          </div>
        </div>
        <details className="wa-timezone-clocks">
          <summary>Live clocks for supported client countries</summary>
          <div className="wa-timezone-table-wrap">
            <table className="wa-timezone-table">
              <thead><tr><th>Country</th><th>Time zone</th><th>Local time</th></tr></thead>
              <tbody>{timezones.map((timezone) => (
                <tr key={timezone.timezone_name}>
                  <td>{timezone.country_name}</td>
                  <td>{timezone.timezone_name}{timezone.is_default ? ' · Default' : ''}</td>
                  <td><time dateTime={now.toISOString()}>{new Intl.DateTimeFormat(undefined, { timeZone: timezone.timezone_name, dateStyle: 'medium', timeStyle: 'medium' }).format(now)}</time></td>
                </tr>
              ))}</tbody>
            </table>
            {!timezones.length && <p className="mut">Apply the inbox automation SQL migration to load country time zones.</p>}
          </div>
        </details>
        <div className="mrow">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="f" htmlFor="schedule-message-body" style={{ margin: 0 }}>Message text</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(['{name}', '{portalLink}', '{period}', '{due}'] as const).map((token) => (
                <button
                  key={token}
                  type="button"
                  className="btn xs gh"
                  style={{ padding: '2px 6px', fontSize: '11px', fontFamily: 'monospace' }}
                  title={`Insert ${token}`}
                  onClick={() => setMessageBody((prev) => prev ? `${prev} ${token}` : token)}
                >
                  +{token}
                </button>
              ))}
            </div>
          </div>
          <textarea id="schedule-message-body" className="inp" rows={4} maxLength={4096} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} />
          <small>Use {'{name}'} for the client name and {'{portalLink}'} for the secure client portal. At send time, TaxFlow automatically resolves the client’s real data and portal link.</small>
        </div>
        {error && <div className="ob-error" role="alert">{error}</div>}
        <div className="row wa-schedule-actions">
          <span className="wa-reminder-notice"><Icon name="lock" size={12} />Private to this CA · Telegram only</span>
          <span className="sp" />
          <button className="btn gh" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn pri"
            disabled={saving || !clientId || !messageBody.trim() || !timezoneName || !availableTimezones.length || (repeatMode === 'once' && !scheduledLocal)}
            onClick={() => void onSave({
              clientId,
              ...(templateId ? { templateId } : {}),
              messageBody: messageBody.trim(),
              repeatMode,
              timezoneName,
              ...(repeatMode === 'once' ? { scheduledLocal } : { localTime }),
            })}
          >
            {saving ? <><span className="spin spin-light" />Saving…</> : <><Icon name="clock" size={14} />Save schedule</>}
          </button>
        </div>
      </div>
    </div>
  );
}
