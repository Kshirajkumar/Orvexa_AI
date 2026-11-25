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
  fetchClientPortalAccess,
  inviteClientToPortal,
  updateClientPortalAccess,
  revokeClientPortalAccess,
  fetchSupportedCountryTimezones,
  fetchTelegramSchedules,
  createTelegramSchedule,
  cancelTelegramSchedule,
  retryTelegramSchedule,
  type TelegramMessage,
  type TelegramPreview,
  type MessageTemplate,
  type ClientPortalAccess,
  type SupportedCountryTimezone,
  type TelegramMessageSchedule,
} from '../lib/api';
import { useAppState, useDispatch } from '../state/store';
import { nextMsgId } from '../lib/messageIds';
import { until, vnow } from '../lib/format';
import type { ChatMsg, Reminder } from '../types';
import {
  TELEGRAM_MIGRATION_COMMAND,
  BUILT_IN_TEMPLATES,
  type TemplateCountryCode,
  getTemplateIcon,
  templateUsesPortalLink,
  fillTpl,
  fillPortalTemplate,
} from '../components/inbox/types';
import { InboxTopBar } from '../components/inbox/InboxTopBar';
import { ConversationList } from '../components/inbox/ConversationList';
import { MessageThread } from '../components/inbox/MessageThread';
import { RemindersPanel } from '../components/inbox/RemindersPanel';
import { TemplatesPanel } from '../components/inbox/TemplatesPanel';
import { ScheduleReminderModal } from '../components/inbox/ScheduleReminderModal';
import '../styles/inbox.css';

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
  // Keep the compact launcher visible on every newly opened conversation. The
  // full composer is an intentional user action, so loading a chat cannot
  // make the primary compose affordance appear/disappear by itself.
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
  const [telegramRetry, setTelegramRetry] = useState(0);
  const [telegramStatusRetry, setTelegramStatusRetry] = useState(0);
  const [portalAccess, setPortalAccess] = useState<ClientPortalAccess | null>(null);
  const [portalAccessClientId, setPortalAccessClientId] = useState('');
  const [portalAccessLoading, setPortalAccessLoading] = useState(false);
  const [portalActionLoading, setPortalActionLoading] = useState(false);
  const [portalActionMessage, setPortalActionMessage] = useState('');
  const [portalActionError, setPortalActionError] = useState('');
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
  const hasCreatedPortalAccount = Boolean(
    c && portalAccess && portalAccessClientId === c.id && (portalAccess.status === 'account_created' || portalAccess.linked)
  );
  const isTemplateLockedForClient = useCallback(
    (template: MessageTemplate) => !hasCreatedPortalAccount && templateUsesPortalLink(template) && template.template_key !== 'portal_invite',
    [hasCreatedPortalAccount],
  );
  const visibleClients = s.clients.filter((client) => client.name.toLocaleLowerCase().includes(clientSearch.trim().toLocaleLowerCase()));
  const thread = c ? (s.threads[c.id] || []).slice().sort((a, b) => a.at.getTime() - b.at.getTime()) : [];
  const isTelegramConversationLoading = channel === 'telegram' && !!c && telegramConversationClientId !== c.id;
  const isTelegramLinkedForCurrentClient = !!c && telegramConversationClientId === c.id && telegramLinked;
  const clientIds = s.clients.map((client) => client.id).join(',');

  useEffect(() => {
    setTelegramTemplatesOpen(false);
    setComposerExpanded(true);
    setTelegramLinkToShare('');
    setTelegramInfo('');
    setPortalActionMessage('');
    setPortalActionError('');
  }, [channel, c?.id]);

  useEffect(() => {
    if (!c?.id) {
      setPortalAccess(null);
      setPortalAccessClientId('');
      setPortalAccessLoading(false);
      return undefined;
    }
    let active = true;
    setPortalAccessLoading(true);
    fetchClientPortalAccess(c.id)
      .then((access) => {
        if (!active) return;
        setPortalAccess(access);
        setPortalAccessClientId(c.id);
      })
      .catch(() => {
        if (!active) return;
        setPortalAccess(null);
        setPortalAccessClientId(c.id);
      })
      .finally(() => {
        if (active) setPortalAccessLoading(false);
      });
    return () => { active = false; };
  }, [c?.id]);

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
  }, [thread.length, telegramMessages, telegramConversationClientId, s.ui.wa.tab, scrollThreadToLatest]);

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
      const activePortalAccess = portalAccessClientId === c.id ? portalAccess : null;
      const message = await fillPortalTemplate(template, c, activePortalAccess);
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

  async function sendTelegramDirect(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || telegramSending || !c) return;
    if (!telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading) {
      setTelegramError('Telegram is not ready or this client is not linked. Please check the connection and try again.');
      return;
    }
    const targetClientId = c.id;
    const requestId = crypto.randomUUID();
    if (overrideText === undefined) setInput('');
    setTelegramSending(true);
    setTelegramError('');
    setTelegramInfo('');
    const optimisticMessage: TelegramMessage = {
      id: `local-${requestId}`,
      client_id: targetClientId,
      provider_message_id: `taxflow:${requestId}`,
      direction: 'outbound',
      chat_id: '',
      body: text,
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
    try {
      const sentMessage = await sendTelegramMessage(targetClientId, text, requestId);
      setTelegramMessages((current) => mergeTelegramMessages([sentMessage], current, targetClientId));
      try {
        setTelegramPreviews(await fetchTelegramPreviews());
      } catch (error) {
        console.warn('Failed to refresh Telegram preview after sending', error);
      }
    } catch (error) {
      setTelegramMessages((current) => current.map((message) =>
        message.provider_message_id === `taxflow:${requestId}`
          ? { ...message, delivery_status: 'failed' }
          : message
      ));
      setTelegramError(error instanceof Error ? error.message : 'Unable to send Telegram message. Please try again.');
    } finally {
      setTelegramSending(false);
    }
  }

  async function pauseOrResumePortal(action: 'pause' | 'resume') {
    if (!c || portalActionLoading) return;
    const verb = action === 'pause' ? 'Pause' : 'Resume';
    if (!window.confirm(`${verb} client portal access for ${c.name}?`)) return;
    setPortalActionLoading(true);
    setPortalActionMessage('');
    setPortalActionError('');
    try {
      const result = await updateClientPortalAccess(c.id, action);
      setPortalAccess((prev) => ({
        enabled: action === 'resume',
        email: prev?.email ?? null,
        createdAt: prev?.createdAt ?? null,
        linked: action === 'resume',
        status: action === 'resume' ? 'account_created' : 'paused',
        portalLink: action === 'resume' ? (prev?.portalLink || 'https://orvvexa.vercel.app/portal') : null,
        telegramLinked: prev?.telegramLinked ?? isTelegramLinkedForCurrentClient,
      }));
      setPortalActionMessage(
        action === 'pause'
          ? 'Portal access paused. Account and documents are preserved; sign-in is blocked until resumed.'
          : `Portal access resumed (${result.status}).`,
      );
    } catch (error) {
      setPortalActionError(error instanceof Error ? error.message : `Could not ${action} portal access.`);
    } finally {
      setPortalActionLoading(false);
    }
  }

  async function revokePortal() {
    if (!c || portalActionLoading) return;
    if (!window.confirm(`Revoke client portal access permanently for ${c.name}? This deletes their portal account.`)) return;
    setPortalActionLoading(true);
    setPortalActionMessage('');
    setPortalActionError('');
    try {
      await revokeClientPortalAccess(c.id);
      setPortalAccess((prev) => ({
        enabled: false,
        email: prev?.email ?? null,
        createdAt: null,
        linked: false,
        status: 'revoked',
        portalLink: null,
        telegramLinked: prev?.telegramLinked ?? isTelegramLinkedForCurrentClient,
      }));
      setPortalActionMessage('Portal access was permanently revoked and the portal account was deleted.');
    } catch (error) {
      setPortalActionError(error instanceof Error ? error.message : 'Could not revoke portal access.');
    } finally {
      setPortalActionLoading(false);
    }
  }

  async function invitePortal() {
    if (!c || portalActionLoading) return;
    setPortalActionLoading(true);
    setPortalActionMessage('');
    setPortalActionError('');
    try {
      const result = await inviteClientToPortal(c.id);
      setPortalAccess((prev) => ({
        enabled: true,
        email: result.email || prev?.email || null,
        createdAt: prev?.createdAt ?? null,
        linked: result.status === 'account_created',
        status: result.status === 'account_created' ? 'account_created' : 'invitation_pending',
        portalLink: result.link,
        telegramLinked: prev?.telegramLinked ?? isTelegramLinkedForCurrentClient,
      }));
      setPortalActionMessage(
        result.status === 'account_created'
          ? 'Client portal account is already active.'
          : `Portal invitation created for ${result.email}.`,
      );
    } catch (error) {
      setPortalActionError(error instanceof Error ? error.message : 'Could not create portal invitation.');
    } finally {
      setPortalActionLoading(false);
    }
  }

  const scheduled = s.reminders.filter((r) => r.status === 'scheduled').sort((a, b) => a.at.getTime() - b.at.getTime());
  const activeTelegramSchedules = telegramSchedules
    .filter((schedule) => schedule.status === 'active')
    .sort((a, b) => new Date(a.next_run_at || '').getTime() - new Date(b.next_run_at || '').getTime());

  if (!c) {
    return (
      <div className="inbox-page">
        <div className="ph inbox-page-head" data-tour="inbox-intro"><div><span className="eyebrow">MESSAGES</span><p>Your WhatsApp and Telegram conversations.</p></div><label className="wa-channel-control"><span>Channel</span><select id="inbox-channel-empty" className="sel" value={channel} onChange={(e) => setChannel(e.target.value as 'whatsapp' | 'telegram')}><option value="telegram">Telegram</option><option value="whatsapp">WhatsApp</option></select></label></div>
        <div className="card workspace-empty workspace-empty-inbox" data-tour="inbox-empty">
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
      await sendTelegramDirect();
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
        const invitation = await inviteClientToPortal(reminderClient.id);
        if (!invitation?.link) throw new Error('The client portal link could not be resolved. Please check the client portal access before sending this reminder.');
        message = message.replace(/https:\/\/orvvexa\.vercel\.app\/portal/g, invitation.link);
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 }}>
            <b>Message templates</b>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={'chip sm ' + (portalAccessLoading ? 'amber' : hasCreatedPortalAccount ? 'green' : 'amber')}>
                {portalAccessLoading ? 'Checking portal…' : hasCreatedPortalAccount ? 'Portal Active' : 'Portal Not Created'}
              </span>
              <span className="chip sm blue">{visibleTemplates.length}</span>
            </div>
          </div>
          <small>
            {hasCreatedPortalAccount
              ? 'Click any template to insert it into your message box'
              : 'Website portal link templates are locked until this client creates their portal account'}
          </small>
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
                {defaultTemplates.map((template) => {
                  const locked = isTemplateLockedForClient(template);
                  return (
                    <button
                      key={template.id}
                      type="button"
                      role="menuitem"
                      className={'telegram-template-option' + (locked ? ' is-locked' : '')}
                      title={locked ? 'Client has not created their portal account yet' : undefined}
                      onClick={() => {
                        if (locked) return;
                        void applyTemplate(template);
                        setTelegramTemplatesOpen(false);
                      }}
                      disabled={locked || !!applyingTemplateId}
                    >
                      <span className="telegram-template-option-icon"><Icon name={locked ? 'lock' : getTemplateIcon(template)} size={14} /></span>
                      <span>
                        <b>{applyingTemplateId === template.id ? 'Preparing…' : template.name}</b>
                        <small>{locked ? 'Requires client portal account creation before sending portal link' : fillTpl(template.body, clientFirstName, portalAccess?.portalLink || undefined)}</small>
                      </span>
                      <span className={'chip sm ' + (locked ? 'amber' : 'green')}>{locked ? 'Portal required' : 'Default'}</span>
                    </button>
                  );
                })}
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
                {privateTemplatesList.map((template) => {
                  const locked = isTemplateLockedForClient(template);
                  return (
                    <button
                      key={template.id}
                      type="button"
                      role="menuitem"
                      className={'telegram-template-option' + (locked ? ' is-locked' : '')}
                      title={locked ? 'Client has not created their portal account yet' : undefined}
                      onClick={() => {
                        if (locked) return;
                        void applyTemplate(template);
                        setTelegramTemplatesOpen(false);
                      }}
                      disabled={locked || !!applyingTemplateId}
                    >
                      <span className="telegram-template-option-icon"><Icon name={locked ? 'lock' : getTemplateIcon(template)} size={14} /></span>
                      <span>
                        <b>{applyingTemplateId === template.id ? 'Preparing…' : template.name}</b>
                        <small>{locked ? 'Requires client portal account creation before sending portal link' : fillTpl(template.body, clientFirstName, portalAccess?.portalLink || undefined)}</small>
                      </span>
                      <span className={'chip sm ' + (locked ? 'amber' : 'violet')}>{locked ? 'Portal required' : 'Private'}</span>
                    </button>
                  );
                })}
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
      <div className="inbox-shell">
        <InboxTopBar
          channel={channel}
          onChannelChange={setChannel}
          activeTab={s.ui.wa.tab}
          onTabChange={(tab) => dispatch({ type: 'WA_TAB', tab })}
          activeSchedulesCount={activeTelegramSchedules.length}
          telegramLoading={telegramLoading}
          telegramReady={telegramReady}
          telegramBot={telegramBot}
          isTelegramConversationLoading={isTelegramConversationLoading}
          isTelegramLinkedForCurrentClient={isTelegramLinkedForCurrentClient}
          totalUnreadAcrossClients={totalUnreadAcrossClients}
          telegramConnecting={telegramConnecting}
          onConnectTelegram={() => void connectTelegram()}
          whatsAppLoading={whatsAppLoading}
          whatsAppReady={whatsAppReady}
          onOpenSchedule={() => {
            setScheduleError('');
            setScheduleNotice('');
            setShowSchedule(true);
          }}
        />

        {s.ui.wa.tab === 'chats' && (
          <div
            className={`st-inbox-grid${contactsCollapsed ? ' contacts-collapsed' : ''}`}
            id="inbox-panel-chats"
            role="tabpanel"
            aria-labelledby="inbox-tab-chats"
          >
            <ConversationList
              clients={visibleClients}
              selectedClientId={c.id}
              clientSearch={clientSearch}
              onClientSearchChange={setClientSearch}
              channel={channel}
              threads={s.threads}
              checks={s.checks}
              telegramPreviews={telegramPreviews}
              unreadCounts={unreadCounts}
              onSelectClient={(clientId) => {
                setTemplateApplyError('');
                dispatch({ type: 'WA_CLIENT', id: clientId });
              }}
            />

            <MessageThread
              client={c}
              channel={channel}
              onSwitchChannel={setChannel}
              contactsCollapsed={contactsCollapsed}
              onToggleContacts={() => setContactsCollapsed((collapsed) => !collapsed)}
              checks={s.checks[c.id] || []}
              threadRef={threadRef}
              onThreadScroll={(element) => {
                shouldFollowThreadRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
              }}
              telegramReady={telegramReady}
              isTelegramConversationLoading={isTelegramConversationLoading}
              isTelegramLinkedForCurrentClient={isTelegramLinkedForCurrentClient}
              telegramConversationClientId={telegramConversationClientId}
              telegramStatusError={telegramStatusError}
              telegramDiagnostics={telegramDiagnostics}
              telegramError={telegramError}
              telegramRefreshWarning={telegramRefreshWarning}
              telegramInfo={telegramInfo}
              telegramLinkToShare={telegramLinkToShare}
              telegramConnecting={telegramConnecting}
              telegramSending={telegramSending}
              telegramLoading={telegramLoading}
              telegramMessages={telegramMessages}
              telegramMigrationCommandCopied={telegramMigrationCommandCopied}
              telegramMigrationCopyError={telegramMigrationCopyError}
              onCopyMigrationCommand={() => void copyTelegramMigrationCommand()}
              onRetryStatus={() => setTelegramStatusRetry((n) => n + 1)}
              onRetryConversation={() => setTelegramRetry((n) => n + 1)}
              onClearTelegramError={() => setTelegramError('')}
              onLogout={() => dispatch({ type: 'LOGOUT' })}
              onConnectTelegram={() => void connectTelegram()}
              onCopyTelegramLink={() => void copyTelegramLink()}
              portalAccess={portalAccessClientId === c.id ? portalAccess : null}
              portalAccessLoading={portalAccessLoading}
              portalActionLoading={portalActionLoading}
              portalActionMessage={portalActionMessage}
              portalActionError={portalActionError}
              onPauseResumePortal={(action) => void pauseOrResumePortal(action)}
              onRevokePortal={() => void revokePortal()}
              onInvitePortal={() => void invitePortal()}
              whatsAppReady={whatsAppReady}
              whatsAppLoading={whatsAppLoading}
              whatsAppError={whatsAppError}
              whatsAppSending={whatsAppSending}
              onClearWhatsAppError={() => setWhatsAppError('')}
              thread={thread}
              scheduledReminders={scheduled.filter((r) => r.client === c.id)}
              sendingReminderId={sendingReminderId}
              reminderSendErrors={reminderSendErrors}
              onApproveReminder={(id) => dispatch({ type: 'REM_APPROVE', id })}
              onSendReminderNow={(r) => void sendReminder(r)}
              onCancelReminder={(id) => dispatch({ type: 'REM_CANCEL', id })}
              input={input}
              onInputChange={setInput}
              onSend={() => void (channel === 'telegram' ? sendTelegramDirect() : send())}
              composerExpanded={composerExpanded}
              onCollapseComposer={() => setComposerExpanded(false)}
              telegramMessageInputRef={telegramMessageInputRef}
              whatsAppMessageInputRef={whatsAppMessageInputRef}
              telegramTemplatesOpen={telegramTemplatesOpen}
              onToggleTemplates={() => setTelegramTemplatesOpen((open) => !open)}
              onCloseTemplates={() => setTelegramTemplatesOpen(false)}
              telegramTemplateMenuRef={telegramTemplateMenuRef}
              applyingTemplateId={applyingTemplateId}
              templateApplyError={templateApplyError}
              onDismissTemplateApplyError={() => setTemplateApplyError('')}
              renderTemplateDropdown={renderTemplateDropdown}
            />
          </div>
        )}

        {s.ui.wa.tab === 'reminders' && (
          <RemindersPanel
            schedules={telegramSchedules}
            loading={schedulesLoading}
            notice={scheduleNotice}
            error={scheduleError}
            actionId={scheduleActionId}
            onRefresh={() => void loadTelegramSchedules()}
            onOpenSchedule={() => {
              setScheduleError('');
              setScheduleNotice('');
              setShowSchedule(true);
            }}
            onDismissNotice={() => setScheduleNotice('')}
            onDismissError={() => setScheduleError('')}
            onCancelSchedule={(schedule) => void cancelTelegramReminder(schedule)}
            onRetrySchedule={(schedule) => void retryTelegramReminder(schedule)}
          />
        )}

        {s.ui.wa.tab === 'templates' && (
          <TemplatesPanel
            client={c}
            templatesLoading={templatesLoading}
            templateError={templateError}
            onDismissError={() => setTemplateError('')}
            defaultTemplatesList={defaultTemplatesList}
            dbDefaultTemplatesCount={dbDefaultTemplates.length}
            privateTemplates={privateTemplates}
            templateCountry={templateCountry}
            onTemplateCountryChange={setTemplateCountry}
            applyingTemplateId={applyingTemplateId}
            onApplyTemplate={(template) => void applyTemplate(template, true)}
            onStartEdit={startTemplateEdit}
            onRemoveTemplate={(template) => void removeTemplate(template)}
            templateEditorOpen={templateEditorOpen}
            editingTemplate={editingTemplate}
            templateForm={templateForm}
            onTemplateFormChange={setTemplateForm}
            templateSaving={templateSaving}
            templateBodyRef={templateBodyRef}
            onInsertToken={insertToken}
            onCloseEditor={() => setTemplateEditorOpen(false)}
            onSaveTemplate={() => void saveTemplate()}
          />
        )}
      </div>

      {showSchedule && (
        <ScheduleReminderModal
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