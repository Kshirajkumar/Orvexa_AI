import { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { BrandLogo } from './BrandLogo';
import { useAppState, useDispatch } from '../state/store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { fetchNotifications, markNotificationsRead, searchTelegramMessages, searchCloudDocuments, type NotificationItem, type TelegramSearchResult, type CloudDocumentSearchResult } from '../lib/api';
import type { Page } from '../types';
import { emitToast, TOAST_EVENT, type ToastPayload } from '../lib/toast';

interface WorkspaceSearchResult {
  id: string;
  kind: 'client' | 'document' | 'file' | 'conversation' | 'deadline' | 'page';
  title: string;
  subtitle: string;
  clientId?: string;
  documentId?: string;
  file?: CloudDocumentSearchResult;
  page?: Page;
}

const SEARCH_PAGES: Array<{ title: string; page: Page; keywords: string }> = [
  { title: 'Dashboard', page: 'dashboard', keywords: 'home overview' },
  { title: 'Clients', page: 'clients', keywords: 'client directory' },
  { title: 'Client Inbox', page: 'whatsapp', keywords: 'telegram whatsapp messages chats' },
  { title: 'Client Folders', page: 'files', keywords: 'vault files documents' },
  { title: 'Deadlines', page: 'deadlines', keywords: 'compliance due dates' },
  { title: 'Invoice Extraction', page: 'extract', keywords: 'invoices scan' },
  { title: 'File Generator', page: 'generate', keywords: 'reports forms' },
  { title: 'Subscriptions', page: 'subscriptions', keywords: 'plans account pricing' },
  { title: 'Profile', page: 'profile', keywords: 'account user' },
  { title: 'Settings', page: 'settings', keywords: 'preferences integrations' },
];

const PAGE_TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  extract: 'Invoice Extraction',
  'extraction-review': 'Data Extraction Review',
  whatsapp: 'Client Inbox',
  files: 'Client Folders',
  deadlines: 'Deadlines',
  generate: 'File Generator',
  clients: 'Clients',
  subscriptions: 'Subscriptions',
  profile: 'Profile',
  settings: 'Settings',
};

export function Titlebar() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [cloudDocumentResults, setCloudDocumentResults] = useState<CloudDocumentSearchResult[]>([]);
  const [telegramSearchResults, setTelegramSearchResults] = useState<TelegramSearchResult[]>([]);
  const [vaultSearchLoading, setVaultSearchLoading] = useState(false);
  const [vaultSearchError, setVaultSearchError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const knownNotificationIds = useRef<Set<string> | null>(null);
  const recentActivityKeys = useRef<Set<string>>(new Set());
  const localNotifications = useRef<NotificationItem[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    async function initWindow() {
      try {
        const appWin = getCurrentWindow();
        setIsMaximized(await appWin.isMaximized());
        unlisten = await appWin.onResized(async () => {
          try { setIsMaximized(await appWin.isMaximized()); } catch {}
        });
      } catch {}
    }
    initWindow();
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!focused || query.length < 2) {
      setCloudDocumentResults([]);
      setTelegramSearchResults([]);
      setVaultSearchLoading(false);
      setVaultSearchError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setVaultSearchLoading(true);
      setVaultSearchError('');
      void Promise.allSettled([
        searchCloudDocuments(query, controller.signal),
        searchTelegramMessages(query, controller.signal),
      ])
        .then(([files, messages]) => {
          if (controller.signal.aborted) return;
          const errors: string[] = [];
          if (files.status === 'fulfilled') setCloudDocumentResults(files.value);
          else {
            setCloudDocumentResults([]);
            errors.push(files.reason instanceof Error ? files.reason.message : 'Cloud documents could not be searched.');
          }
          if (messages.status === 'fulfilled') setTelegramSearchResults(messages.value);
          else {
            setTelegramSearchResults([]);
            errors.push(messages.reason instanceof Error ? messages.reason.message : 'Telegram conversations could not be searched.');
          }
          setVaultSearchError(errors.join(' '));
        })
        .finally(() => {
          if (!controller.signal.aborted) setVaultSearchLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, focused]);

  // Notifications are created by the database trigger and refreshed here so
  // the titlebar remains current without coupling client mutations to UI state.
  useEffect(() => {
    let cancelled = false;
    async function loadNotifications() {
      if (!s.currentUser) return;
      try {
        const result = await fetchNotifications();
        if (!cancelled) {
          const knownIds = knownNotificationIds.current;
          if (knownIds) {
            result.data.filter(notification => !knownIds.has(notification.id)).reverse().forEach(notification => {
              const activityKey = `${notification.event_type}:${notification.entity_id || ''}`;
              if (recentActivityKeys.current.has(activityKey)) return;
              const isTelegram = notification.event_type === 'telegram.message_received';
              const isDeleted = notification.event_type === 'client.deleted';
              const isDocument = notification.event_type === 'document.received';
              const isError = /error|failed|failure|timeout|denied/i.test(notification.event_type || '');
              const telegramClientName = typeof notification.metadata?.client_name === 'string'
                ? notification.metadata.client_name
                : notification.title.replace(/^Telegram from\s+/i, '').trim();
              const telegramPreview = String(notification.message || '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'New message received in Telegram.';
              const toastEntityId = notification.entity_id || (typeof notification.metadata?.client_id === 'string' ? notification.metadata.client_id : null);
              emitToast({
                kind: isError ? 'error' : isDeleted ? 'warning' : isTelegram || isDocument ? 'info' : 'success',
                title: isTelegram ? `New message from ${telegramClientName || 'Client'}` : notification.title,
                message: isTelegram ? telegramPreview : notification.message,
                eventType: notification.event_type,
                entityType: notification.entity_type,
                entityId: toastEntityId,
                metadata: notification.metadata,
                persisted: true,
              });
            });
          }
          knownNotificationIds.current = new Set(result.data.map(notification => notification.id));
          const localItems = localNotifications.current.filter(notification => !result.data.some(item => item.id === notification.id));
          setNotifications([...result.data, ...localItems].slice(0, 20));
          setUnreadNotifications(result.unreadCount + localItems.filter(notification => !notification.read_at).length);
        }
      } catch (error) {
        if (!cancelled) console.warn('[NOTIFICATIONS] Could not load notifications:', error);
      }
    }
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [s.currentUser?.id]);

  useEffect(() => {
    function addLocalNotification(event: Event) {
      const payload = (event as CustomEvent<ToastPayload>).detail;
      if (!payload?.title || !payload.message || payload.persisted) return;
      const item: NotificationItem = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        event_type: payload.eventType || 'app.activity',
        title: payload.title,
        message: payload.message,
        entity_type: payload.entityType,
        entity_id: payload.entityId,
        created_at: new Date().toISOString(),
        read_at: null,
      };
      const activityKey = `${item.event_type}:${item.entity_id || ''}`;
      recentActivityKeys.current.add(activityKey);
      window.setTimeout(() => recentActivityKeys.current.delete(activityKey), 30_000);
      localNotifications.current = [item, ...localNotifications.current].slice(0, 20);
      setNotifications(previous => [item, ...previous].slice(0, 20));
      setUnreadNotifications(previous => previous + 1);
    }
    window.addEventListener(TOAST_EVENT, addLocalNotification);
    return () => window.removeEventListener(TOAST_EVENT, addLocalNotification);
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleMinimize = async () => {
    try { await getCurrentWindow().minimize(); } catch (e) {
      console.warn('Minimize failed:', e);
    }
  };
  const handleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (e) { console.warn('Maximize failed:', e); }
  };
  const handleClose = async () => {
    try { await getCurrentWindow().close(); } catch (e) {
      console.warn('Close failed:', e);
    }
  };

  const query = q.trim().toLocaleLowerCase();
  const clientResults: WorkspaceSearchResult[] = query
    ? s.clients
        .filter((client) => [client.name, client.gstin, client.pan, client.phone, client.contact].some((value) => value?.toLocaleLowerCase().includes(query)))
        .slice(0, 3)
        .map((client) => ({
          id: `client:${client.id}`,
          kind: 'client',
          title: client.name,
          subtitle: `Client · ${client.city} · ${client.gstin || 'No GSTIN'}`,
          clientId: client.id,
        }))
    : [];
  const documentResults: WorkspaceSearchResult[] = query
    ? s.docs
        .filter((document) => [document.party, document.gstin, document.no, document.kind].some((value) => value.toLocaleLowerCase().includes(query)))
        .slice(0, 3)
        .map((document) => ({
          id: `document:${document.id}`,
          kind: 'document',
          title: document.party || document.no || 'Invoice record',
          subtitle: `Extraction · ${s.clients.find((client) => client.id === document.client)?.name || 'Client'} · ${document.no}`,
          clientId: document.client,
          documentId: document.id,
        }))
    : [];
  const conversationResults: WorkspaceSearchResult[] = query
    ? Object.entries(s.threads)
        .flatMap(([clientId, messages]): WorkspaceSearchResult[] => {
          const matchingMessage = [...messages].reverse().find((message) => (
            message.t.toLocaleLowerCase().includes(query) || message.file?.toLocaleLowerCase().includes(query)
          ));
          const client = s.clients.find((item) => item.id === clientId);
          if (!matchingMessage || !client) return [];
          return [{
            id: `message:${clientId}:${matchingMessage.id}`,
            kind: 'conversation',
            title: client.name,
            subtitle: `Conversation · ${(matchingMessage.file || matchingMessage.t).slice(0, 90)}`,
            clientId,
          }];
        })
        .slice(0, 3)
    : [];
  const deadlineResults: WorkspaceSearchResult[] = query
    ? s.tasks
        .filter((task) => task.name.toLocaleLowerCase().includes(query))
        .slice(0, 2)
        .map((task) => ({
          id: `deadline:${task.id}`,
          kind: 'deadline',
          title: task.name,
          subtitle: `Deadline · ${s.clients.find((client) => client.id === task.client)?.name || 'Client'}`,
          clientId: task.client,
        }))
    : [];
  const pageResults: WorkspaceSearchResult[] = query
    ? SEARCH_PAGES
        .filter((item) => `${item.title} ${item.keywords}`.toLocaleLowerCase().includes(query))
        .slice(0, 2)
        .map((item) => ({
          id: `page:${item.page}`,
          kind: 'page',
          title: item.title,
          subtitle: 'Workspace page',
          page: item.page,
        }))
    : [];
  const remoteFileResults: WorkspaceSearchResult[] = cloudDocumentResults.map((file) => ({
    id: `document-file:${file.documentId}`,
    kind: 'file',
    title: file.fileName,
    subtitle: `Cloud document · ${file.clientName}`,
    clientId: file.clientId,
    documentId: file.documentId,
    file,
  }));
  const remoteConversationResults: WorkspaceSearchResult[] = telegramSearchResults.map((message) => ({
    id: `telegram-message:${message.id}`,
    kind: 'conversation',
    title: message.clientName,
    subtitle: `Telegram · ${message.body.slice(0, 90)}`,
    clientId: message.clientId,
  }));
  const results = [...clientResults, ...remoteFileResults, ...documentResults, ...conversationResults, ...remoteConversationResults, ...deadlineResults, ...pageResults].slice(0, 10);
  const sessionExpired = s.sessionStatus === 'expired';

  function openSearchResult(result: WorkspaceSearchResult) {
    if (result.kind === 'client' || result.kind === 'conversation') {
      if (result.clientId) dispatch({ type: 'WA_CLIENT', id: result.clientId });
      dispatch({ type: 'GO', page: 'whatsapp' });
    } else if (result.kind === 'file') {
      if (result.clientId) {
        dispatch({ type: 'GO', page: 'files' });
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('taxflow:open-document', {
          detail: {
            clientId: result.clientId,
            fileName: result.file?.fileName || result.title,
            documentId: result.documentId,
          },
        })), 0);
      }
    } else if (result.kind === 'document' && result.documentId) {
      dispatch({ type: 'EX_SELECT', id: result.documentId });
      dispatch({ type: 'GO', page: 'extract' });
    } else if (result.kind === 'deadline' && result.clientId) {
      dispatch({ type: 'DL_TOGGLE', client: result.clientId });
      dispatch({ type: 'GO', page: 'deadlines' });
    } else if (result.page) {
      dispatch({ type: 'GO', page: result.page });
    }
    setQ('');
    setFocused(false);
  }

  return (
    <header className="titlebar">
      {/* Brand */}
      <div className="brand" data-tauri-drag-region>
        <BrandLogo className="titlebar-brand-logo" />
        <small className="brand-badge page-title-badge" aria-live="polite">{PAGE_TITLES[s.page] || 'Workspace'}</small>
      </div>

      {/* Search Bar */}
      <div className={`gsearch${focused ? ' focused' : ''}`}>
        <span className="gi">
          <Icon name="search" size={14} />
        </span>
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFocused(false);
            if (event.key === 'Enter' && results[0]) openSearchResult(results[0]);
          }}
          placeholder="Search clients, messages, files…"
          autoComplete="off"
          aria-label="Search workspace"
          aria-expanded={focused && (results.length > 0 || vaultSearchLoading)}
          aria-haspopup="listbox"
        />
        {q && (
          <button
            className="gsearch-clear"
            onClick={() => { setQ(''); searchRef.current?.focus(); }}
            aria-label="Clear search"
          >
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {focused && q.trim() && (
          <div className="gres" ref={dropRef} role="listbox">
            {results.map((c) => (
              <button
                key={c.id}
                role="option"
                onClick={() => openSearchResult(c)}
              >
                <span className={`gres-av gres-icon gres-${c.kind}`}>
                  <Icon name={c.kind === 'client' ? 'users' : c.kind === 'file' || c.kind === 'document' ? 'file' : c.kind === 'conversation' ? 'chat' : c.kind === 'deadline' ? 'cal' : 'grid'} size={14} />
                </span>
                <span className="gres-info">
                  <b>{c.title}</b>
                  <small>{c.subtitle}</small>
                </span>
                <span className="gres-arrow">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
              </button>
            ))}
            {vaultSearchLoading && <div className="gres-status"><span className="spin" />Searching client documents…</div>}
            {!vaultSearchLoading && !results.length && !vaultSearchError && <div className="gres-status">No matching workspace items.</div>}
            {vaultSearchError && <div className="gres-status error">{vaultSearchError}</div>}
          </div>
        )}
      </div>

      {/* Session status */}
      <div className={`session-status ${sessionExpired ? 'is-expired' : 'is-active'}`}>
        <span className="session-status-icon" aria-hidden="true">
          <Icon name={sessionExpired ? 'bell' : 'check'} size={13} />
        </span>
        {sessionExpired ? (
          <>
            <span className="session-status-copy">Session is invalid or has expired.</span>
            <span className="session-status-actions">
              <button className="session-status-btn secondary" onClick={() => dispatch({ type: 'LOGOUT' })}>Re Login</button>
              <button className="session-status-btn primary" onClick={() => dispatch({ type: 'LOGOUT' })}>Update Session</button>
            </span>
          </>
        ) : (
          <span className="session-status-copy">Session active</span>
        )}
      </div>

      {/* Drag space */}
      <div data-tauri-drag-region className="titlebar-drag-space" />

      {/* Right Controls */}
      <div className="wc">
        {/* Notifications */}
        <div className="wc-notification-wrap">
          <button className={`wc-action-btn wc-notif${notificationsOpen ? ' active' : ''}`} onClick={() => {
            const nextOpen = !notificationsOpen;
            setNotificationsOpen(nextOpen);
            if (nextOpen && unreadNotifications > 0) {
              const now = new Date().toISOString();
              localNotifications.current = localNotifications.current.map(notification => ({ ...notification, read_at: notification.read_at || now }));
              setNotifications(previous => previous.map(notification => ({ ...notification, read_at: notification.read_at || now })));
              void markNotificationsRead().then(() => setUnreadNotifications(0)).catch((error) => console.warn('[NOTIFICATIONS] Could not mark read:', error));
            }
          }} title="Notifications" aria-label="Notifications" aria-expanded={notificationsOpen}>
            <Icon name="bell" size={15} />
            {unreadNotifications > 0 && <span className="notif-count">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
          </button>
          {notificationsOpen && <div className="notifications-panel" role="dialog" aria-label="Notifications">
            <div className="notifications-panel-head"><div><b>Notifications</b><small>Database activity for your practice</small></div><button className="notifications-close" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="x" size={14} /></button></div>
            <div className="notifications-list">
              {notifications.length === 0 ? (
                <div className="notifications-empty">
                  <Icon name="bell" size={18} />
                  <span>No recent activity</span>
                  <small>New client activity will appear here.</small>
                </div>
              ) : (
                notifications.map((notification) => {
                  const isTelegram = notification.event_type === 'telegram.message_received';
                  const isDeleted = notification.event_type === 'client.deleted';
                  const isDocument = notification.event_type === 'document.received';
                  const isDeadline = notification.event_type?.startsWith('deadline');
                  const isClickable = isTelegram || isDocument || isDeadline;
                  return (
                    <div
                      className={`notification-item${notification.read_at ? '' : ' unread'}${isClickable ? ' is-clickable' : ''}`}
                      key={notification.id}
                      onClick={() => {
                        if (isTelegram && notification.entity_id) {
                          dispatch({ type: 'WA_CLIENT', id: notification.entity_id });
                          dispatch({ type: 'GO', page: 'whatsapp' });
                          setNotificationsOpen(false);
                        } else if (isDocument) {
                          dispatch({ type: 'GO', page: 'files' });
                          setNotificationsOpen(false);
                        } else if (isDeadline) {
                          dispatch({ type: 'GO', page: 'deadlines' });
                          setNotificationsOpen(false);
                        }
                      }}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      title={isClickable ? 'Click to navigate' : undefined}
                    >
                      <span className={`notification-item-icon ${isDeleted ? 'deleted' : isTelegram ? 'telegram' : isDocument ? 'document' : isDeadline ? 'deadline' : 'created'}`}>
                        <Icon name={isDeleted ? 'x' : isTelegram ? 'chat' : isDocument ? 'file' : isDeadline ? 'cal' : 'users'} size={13} />
                      </span>
                      <span className="notification-item-copy">
                        <b>{notification.title}</b>
                        <span>{notification.message}</span>
                        <small>{new Date(notification.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>}
        </div>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* AI Chat Toggle */}
        <button
          className={`wc-action-btn wc-chat-btn${s.chatOpen ? ' active' : ''}${s.page === 'extraction-review' ? ' locked' : ''}`}
          onClick={() => s.page !== 'extraction-review' && dispatch({ type: 'TOGGLE_CHAT' })}
          disabled={s.page === 'extraction-review'}
          title={s.page === 'extraction-review' ? 'AI assistant is unavailable during extraction review' : s.chatOpen ? 'Hide AI assistant' : 'Show AI assistant'}
          aria-label="Toggle AI assistant"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {s.chatOpen && <span className="wc-chat-active-dot" />}
        </button>

        {/* Divider */}
        <div className="wc-divider" />

        {/* Window Controls */}
        <button className="wc-btn wc-min" onClick={handleMinimize} title="Minimize" aria-label="Minimize">
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="wc-btn wc-max"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="1.5" width="7" height="7" rx="1.2" />
              <path d="M1.5 4.5v5a1.2 1.2 0 0 0 1.2 1.2h5" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          )}
        </button>
        <button className="wc-btn wc-close" onClick={handleClose} title="Close" aria-label="Close">
          <svg width="11" height="11" viewBox="0 0 12 12">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
