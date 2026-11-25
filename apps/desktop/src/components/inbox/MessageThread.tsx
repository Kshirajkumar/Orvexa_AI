import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Icon } from '../Icon';
import { fTime, fDT, until } from '../../lib/format';
import type { ClientPortalAccess, TelegramMessage } from '../../lib/api';
import type { ChatMsg, CheckItem, Client, Reminder } from '../../types';
import {
  TELEGRAM_MIGRATION_COMMAND,
  dayLabel,
  needsTelegramMigrationHelp,
} from './types';

function TelegramMigrationHelp({
  copied,
  copyError,
  onCopy,
}: {
  copied: boolean;
  copyError: string;
  onCopy: () => void;
}) {
  return (
    <details className="telegram-migration-help">
      <summary>How to fix the database setup</summary>
      <p>
        From the Orvexa project folder, run this in PowerShell. Ensure <code>DATABASE_URL</code> is set in{' '}
        <code>services/backend/.env</code> for the same Supabase project used by the deployed backend.
      </p>
      <code className="telegram-migration-command">{TELEGRAM_MIGRATION_COMMAND}</code>
      <button className="btn sm" onClick={onCopy}>
        {copied ? 'Command copied' : 'Copy PowerShell command'}
      </button>
      {copyError && <span role="status">{copyError}</span>}
    </details>
  );
}

interface MessageThreadProps {
  client: Client;
  channel: 'whatsapp' | 'telegram';
  onSwitchChannel: (channel: 'whatsapp' | 'telegram') => void;
  contactsCollapsed: boolean;
  onToggleContacts: () => void;
  checks: CheckItem[];
  threadRef: RefObject<HTMLDivElement>;
  onThreadScroll: (element: HTMLDivElement) => void;
  telegramReady: boolean;
  isTelegramConversationLoading: boolean;
  isTelegramLinkedForCurrentClient: boolean;
  telegramConversationClientId: string;
  telegramStatusError: string;
  telegramDiagnostics: string[];
  telegramError: string;
  telegramRefreshWarning: string;
  telegramInfo: string;
  telegramLinkToShare: string;
  telegramConnecting: boolean;
  telegramSending: boolean;
  telegramLoading?: boolean;
  telegramMessages: TelegramMessage[];
  telegramMigrationCommandCopied: boolean;
  telegramMigrationCopyError: string;
  onCopyMigrationCommand: () => void;
  onRetryStatus: () => void;
  onRetryConversation: () => void;
  onClearTelegramError: () => void;
  onLogout: () => void;
  onConnectTelegram: () => void;
  onCopyTelegramLink: () => void;
  // Client Portal Settings
  portalAccess: ClientPortalAccess | null;
  portalAccessLoading: boolean;
  portalActionLoading: boolean;
  portalActionMessage: string;
  portalActionError: string;
  onPauseResumePortal: (action: 'pause' | 'resume') => void;
  onRevokePortal: () => void;
  onInvitePortal: () => void;
  // WhatsApp state
  whatsAppReady: boolean;
  whatsAppLoading: boolean;
  whatsAppError: string;
  whatsAppSending: boolean;
  onClearWhatsAppError: () => void;
  thread: ChatMsg[];
  scheduledReminders: Reminder[];
  sendingReminderId: string;
  reminderSendErrors: Record<string, string>;
  onApproveReminder: (id: string) => void;
  onSendReminderNow: (reminder: Reminder) => void;
  onCancelReminder: (id: string) => void;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  composerExpanded: boolean;
  onCollapseComposer: () => void;
  telegramMessageInputRef: RefObject<HTMLTextAreaElement>;
  whatsAppMessageInputRef: RefObject<HTMLTextAreaElement>;
  telegramTemplatesOpen: boolean;
  onToggleTemplates: () => void;
  onCloseTemplates: () => void;
  telegramTemplateMenuRef: RefObject<HTMLDivElement>;
  applyingTemplateId: string;
  templateApplyError: string;
  onDismissTemplateApplyError: () => void;
  renderTemplateDropdown: () => ReactNode;
}

export function MessageThread({
  client,
  channel,
  onSwitchChannel,
  contactsCollapsed,
  onToggleContacts,
  checks,
  threadRef,
  onThreadScroll,
  telegramReady,
  isTelegramConversationLoading,
  isTelegramLinkedForCurrentClient,
  telegramConversationClientId,
  telegramStatusError,
  telegramDiagnostics,
  telegramError,
  telegramRefreshWarning,
  telegramInfo,
  telegramLinkToShare,
  telegramConnecting,
  telegramSending,
  telegramLoading = false,
  telegramMessages,
  telegramMigrationCommandCopied,
  telegramMigrationCopyError,
  onCopyMigrationCommand,
  onRetryStatus,
  onRetryConversation,
  onClearTelegramError,
  onLogout,
  onConnectTelegram,
  onCopyTelegramLink,
  portalAccess,
  portalAccessLoading,
  portalActionLoading,
  portalActionMessage,
  portalActionError,
  onPauseResumePortal,
  onRevokePortal,
  onInvitePortal,
  whatsAppReady,
  whatsAppLoading,
  whatsAppError,
  whatsAppSending,
  onClearWhatsAppError,
  thread,
  scheduledReminders,
  sendingReminderId,
  reminderSendErrors,
  onApproveReminder,
  onSendReminderNow,
  onCancelReminder,
  input,
  onInputChange,
  onSend,
  telegramMessageInputRef,
  whatsAppMessageInputRef,
  telegramTemplatesOpen,
  onToggleTemplates,
  onCloseTemplates,
  telegramTemplateMenuRef,
  applyingTemplateId,
  templateApplyError,
  onDismissTemplateApplyError,
  renderTemplateDropdown,
}: MessageThreadProps) {
  const [copiedPortalMsgId, setCopiedPortalMsgId] = useState('');
  const [portalSettingsOpen, setPortalSettingsOpen] = useState(false);
  const portalSettingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortalSettingsOpen(false);
  }, [client.id]);

  useEffect(() => {
    if (!portalSettingsOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (portalSettingsRef.current && !portalSettingsRef.current.contains(event.target as Node)) {
        setPortalSettingsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPortalSettingsOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [portalSettingsOpen]);

  const isConnected = channel === 'telegram' ? isTelegramLinkedForCurrentClient : whatsAppReady;
  const activeInputRef = channel === 'telegram' ? telegramMessageInputRef : whatsAppMessageInputRef;
  const isSending = channel === 'telegram' ? telegramSending : whatsAppSending;
  const isComposerDisabled = channel === 'telegram'
    ? telegramSending || telegramLoading || isTelegramConversationLoading
    : whatsAppLoading || !whatsAppReady || whatsAppSending;
  const isSendDisabled = channel === 'telegram'
    ? !input.trim() || !telegramReady || !isTelegramLinkedForCurrentClient || isTelegramConversationLoading || telegramSending || telegramLoading
    : !input.trim() || whatsAppLoading || !whatsAppReady || whatsAppSending;
  const pendingDocsCount = checks.filter((x) => !x.ok).length;

  const portalStatus = portalAccess?.status;
  const isPortalActive = portalStatus === 'account_created' || Boolean(portalAccess?.linked);
  const isPortalPaused = portalStatus === 'paused';
  const isPortalPending = portalStatus === 'invitation_pending';
  const portalStatusLabel = portalAccessLoading
    ? 'Checking…'
    : isPortalPaused
      ? 'Paused'
      : isPortalActive
        ? 'Account active'
        : isPortalPending
          ? 'Invitation pending'
          : portalStatus === 'revoked'
            ? 'Revoked'
            : 'Not invited';

  const insertQuickChip = (text: string) => {
    onInputChange(text);
    requestAnimationFrame(() => activeInputRef.current?.focus());
  };

  const copyPortalUrl = async (msgId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedPortalMsgId(msgId);
      setTimeout(() => setCopiedPortalMsgId((cur) => (cur === msgId ? '' : cur)), 2000);
    } catch {
      /* ignore clipboard error */
    }
  };

  return (
    <main className="st-chat-main">
      {/* Sticky Chat Header */}
      <header className="st-chat-header">
        <div className="st-chat-header-left">
          <button
            type="button"
            className="st-icon-btn"
            onClick={onToggleContacts}
            aria-label={contactsCollapsed ? 'Open conversations sidebar' : 'Collapse conversations sidebar'}
            aria-expanded={!contactsCollapsed}
            title={contactsCollapsed ? 'Open conversations sidebar' : 'Collapse conversations sidebar'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              menu
            </span>
          </button>

          <div className="st-avatar-wrap">
            <div className="st-avatar primary">{client.short.slice(0, 2).toUpperCase()}</div>
            {isConnected && <span className="st-online-dot" aria-hidden="true" />}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="st-chat-title-row">
              <h2 className="st-chat-name">{client.name}</h2>
              <span className={`st-badge-success${isConnected ? '' : ' warn'}`} role="status">
                <span className="st-badge-success-dot" aria-hidden="true" />
                <span>
                  {channel === 'telegram'
                    ? isTelegramLinkedForCurrentClient
                      ? 'Telegram connected'
                      : 'Telegram not linked'
                    : whatsAppReady
                      ? 'WhatsApp connected'
                      : 'WhatsApp unavailable'}
                </span>
              </span>
            </div>
            <div className="st-chat-subline">
              <span className="st-mono-sm">{client.phone}</span>
              {pendingDocsCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{pendingDocsCount} pending {pendingDocsCount === 1 ? 'doc' : 'docs'}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="st-chat-header-right">
          <div className="st-portal-settings-anchor" ref={portalSettingsRef}>
            <button
              type="button"
              className="st-btn-secondary"
              onClick={() => setPortalSettingsOpen((open) => !open)}
              aria-expanded={portalSettingsOpen}
              aria-haspopup="dialog"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
                shield_lock
              </span>
              <span>Client Portal Settings</span>
            </button>

            {portalSettingsOpen && (
              <div className="st-portal-popover" role="dialog" aria-label={`Client Portal Settings for ${client.name}`}>
                <div className="st-portal-popover-head">
                  <b>Client Portal Settings</b>
                  <span className={`chip sm ${isPortalPaused ? 'amber' : isPortalActive ? 'green' : isPortalPending ? 'blue' : 'amber'}`}>
                    {portalStatusLabel}
                  </span>
                </div>

                <p className="st-portal-popover-desc">
                  {isPortalPaused
                    ? `${client.name}'s portal access is paused. Account and documents are preserved, but sign-in and uploads are blocked.`
                    : isPortalActive
                      ? `${client.name} has active Client Portal access for secure document uploads.`
                      : isPortalPending
                        ? `An invitation link is pending for ${client.name}.`
                        : `${client.name} does not currently have an active Client Portal account.`}
                </p>

                {portalActionMessage && <div className="st-portal-popover-msg" role="status">{portalActionMessage}</div>}
                {portalActionError && <div className="st-portal-popover-err" role="alert">{portalActionError}</div>}

                <div className="st-portal-popover-actions">
                  {isPortalActive && !isPortalPaused && (
                    <button
                      type="button"
                      className="st-portal-popover-btn warn"
                      disabled={portalActionLoading || portalAccessLoading}
                      onClick={() => onPauseResumePortal('pause')}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">pause_circle</span>
                      <span>{portalActionLoading ? 'Updating…' : 'Pause portal access'}</span>
                    </button>
                  )}

                  {isPortalPaused && (
                    <button
                      type="button"
                      className="st-portal-popover-btn"
                      disabled={portalActionLoading || portalAccessLoading}
                      onClick={() => onPauseResumePortal('resume')}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">play_circle</span>
                      <span>{portalActionLoading ? 'Updating…' : 'Resume portal access'}</span>
                    </button>
                  )}

                  {(isPortalActive || isPortalPaused || isPortalPending) && (
                    <button
                      type="button"
                      className="st-portal-popover-btn danger"
                      disabled={portalActionLoading || portalAccessLoading}
                      onClick={onRevokePortal}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">block</span>
                      <span>{portalActionLoading ? 'Revoking…' : 'Revoke access permanently'}</span>
                    </button>
                  )}

                  {!isPortalActive && !isPortalPaused && !isPortalPending && (
                    <button
                      type="button"
                      className="st-portal-popover-btn"
                      disabled={portalActionLoading || portalAccessLoading}
                      onClick={onInvitePortal}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">add_link</span>
                      <span>{portalActionLoading ? 'Creating…' : 'Create portal invite'}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable Message Thread */}
      <div
        id="message-thread"
        ref={threadRef}
        role="region"
        className="st-thread-scroll"
        aria-label="Message history"
        aria-busy={channel === 'telegram' && isTelegramConversationLoading}
        onScroll={(event) => onThreadScroll(event.currentTarget)}
      >
        <div className="st-thread-inner">
          {templateApplyError && (
            <div className="empty error" role="alert">
              <b>Secure portal invitation could not be prepared</b>
              <span>{templateApplyError}</span>
              <button className="btn sm" onClick={onDismissTemplateApplyError}>Dismiss</button>
            </div>
          )}

          {channel === 'telegram' && isTelegramConversationLoading && (
            <div className="tg-conversation-skeleton" role="status" aria-live="polite">
              <div className="tg-skeleton-heading">
                <span className="tg-skeleton-dot" />
                <span>Loading Telegram conversation with {client.name}…</span>
              </div>
              <div className="tg-skeleton-message incoming"><i /><i /><i /></div>
              <div className="tg-skeleton-message outgoing"><i /><i /></div>
              <div className="tg-skeleton-message incoming short"><i /><i /></div>
            </div>
          )}

          {channel === 'telegram' && telegramStatusError && (
            <div className="empty error" role="alert">
              <b>Telegram setup needs attention</b>
              <span>{telegramStatusError}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn sm" onClick={onRetryStatus}>Retry</button>
                {telegramDiagnostics.length > 0 && (
                  <small className="wa-diagnostics">{telegramDiagnostics.join(' ')}</small>
                )}
              </div>
              {needsTelegramMigrationHelp([telegramStatusError, ...telegramDiagnostics]) && (
                <TelegramMigrationHelp
                  copied={telegramMigrationCommandCopied}
                  copyError={telegramMigrationCopyError}
                  onCopy={onCopyMigrationCommand}
                />
              )}
            </div>
          )}

          {channel === 'telegram' && !isTelegramConversationLoading && telegramError && (
            <div className="empty error" role="alert">
              <b>Telegram could not complete that request</b>
              <span>{telegramError}</span>
              <div className="row" style={{ gap: 8 }}>
                {telegramError.toLowerCase().includes('session expired') && (
                  <button className="btn sm pri" onClick={onLogout}>Log in again</button>
                )}
                <button className="btn sm" onClick={onRetryConversation}>Retry</button>
                <button className="btn sm gh" onClick={onClearTelegramError}>Dismiss</button>
              </div>
              {needsTelegramMigrationHelp([telegramError]) && (
                <TelegramMigrationHelp
                  copied={telegramMigrationCommandCopied}
                  copyError={telegramMigrationCopyError}
                  onCopy={onCopyMigrationCommand}
                />
              )}
            </div>
          )}

          {channel === 'whatsapp' && whatsAppError && (
            <div className="empty error" role="alert">
              <b>WhatsApp could not deliver the message</b>
              <span>{whatsAppError}</span>
              <button className="btn sm" onClick={onClearWhatsAppError}>Dismiss</button>
            </div>
          )}

          {channel === 'whatsapp' && !whatsAppLoading && !whatsAppReady && (
            <div className="telegram-notice" role="status">
              <div>
                <b>WhatsApp Business API is not configured.</b> Switch to Telegram to message {client.name} live, or add Meta API credentials to <code>services/backend/.env</code>.
              </div>
              <button className="btn sm" onClick={() => onSwitchChannel('telegram')}>Switch to Telegram</button>
            </div>
          )}

          {channel === 'telegram' && !isTelegramConversationLoading && telegramConversationClientId === client.id && !telegramError && !isTelegramLinkedForCurrentClient && (
            <div className="tg-unlinked-state" role="status">
              <div className="tg-unlinked-art">
                <span className="tg-unlinked-orbit orbit-one" />
                <span className="tg-unlinked-orbit orbit-two" />
                <span className="tg-unlinked-icon"><Icon name="send" size={23} /></span>
                <span className="tg-unlinked-lock"><Icon name="lock" size={13} /></span>
              </div>
              <span className="eyebrow">PRIVATE CLIENT CONNECTION</span>
              <h3>{telegramReady ? `Connect ${client.short} to Telegram` : 'Telegram is unavailable'}</h3>
              <p>
                {telegramReady
                  ? `Link ${client.name} with your Telegram bot to securely load this conversation and exchange messages here.`
                  : 'The Telegram bot is not available right now. Check the backend connection and try again.'}
              </p>
              {telegramReady && (
                <button className="btn sm pri" onClick={onConnectTelegram} disabled={telegramConnecting}>
                  {telegramConnecting ? <><span className="spin spin-light" />Creating secure link…</> : <><Icon name="link" size={13} />Connect client</>}
                </button>
              )}
            </div>
          )}

          {channel === 'telegram' && !isTelegramConversationLoading && isTelegramLinkedForCurrentClient && !telegramError && telegramMessages.length === 0 && (
            <div className="tg-conversation-empty" role="status">
              <span><Icon name="chat" size={20} /></span>
              <b>No messages yet</b>
              <small>This Telegram conversation is connected. Send a message below to start.</small>
            </div>
          )}

          {channel === 'telegram' && telegramConversationClientId === client.id && !isTelegramConversationLoading && telegramInfo && (
            <div className="telegram-notice" role="status">
              {telegramInfo}
              {telegramLinkToShare && (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <input className="inp" aria-label={`Telegram connection link for ${client.name}`} readOnly value={telegramLinkToShare} onFocus={(e) => e.currentTarget.select()} />
                  <button className="btn sm" onClick={onCopyTelegramLink}>Copy link</button>
                </div>
              )}
            </div>
          )}

          {channel === 'telegram' && telegramRefreshWarning && (
            <div className="telegram-notice telegram-refresh-warning" role="status">{telegramRefreshWarning}</div>
          )}

          {/* Telegram Messages */}
          {channel === 'telegram' && isTelegramLinkedForCurrentClient && !isTelegramConversationLoading && (() => {
            let lastDay = '';
            return telegramMessages.map((m) => {
              const msgDate = new Date(m.created_at);
              const dl = dayLabel(msgDate);
              const sep = dl !== lastDay
                ? (lastDay = dl, (
                  <div key={`sep-${m.id}`} className="st-date-divider">
                    <span className="st-date-pill">{dl}</span>
                  </div>
                ))
                : null;

              const isPortalCard = m.direction === 'outbound'
                && /secure client portal invitation/i.test(m.body);
              const portalUrlMatch = m.body.match(/https?:\/\/[^\s]+/);
              const portalUrl = portalUrlMatch ? portalUrlMatch[0] : 'https://orvvexa.vercel.app/portal';

              return (
                <div key={m.provider_message_id || m.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {sep}
                  <div className={`st-msg-row ${m.direction === 'outbound' ? 'out' : 'in'}`}>
                    {isPortalCard ? (
                      <article className="st-portal-card">
                        <header className="st-portal-card-head">
                          <div className="st-portal-card-title-wrap">
                            <div className="st-portal-icon-box" aria-hidden="true">
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>lock</span>
                            </div>
                            <div>
                              <h3 className="st-portal-card-title">Secure Client Portal Invitation</h3>
                              <p className="st-portal-card-sub">Sign in with your CA-registered email</p>
                            </div>
                          </div>
                          <span className="st-badge-success">Active</span>
                        </header>
                        <div className="st-portal-url-box">
                          <span className="st-portal-url">{portalUrl}</span>
                          <button type="button" className="st-copy-btn" onClick={() => void copyPortalUrl(m.id, portalUrl)}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden="true">content_copy</span>
                            <span>{copiedPortalMsgId === m.id ? 'Copied' : 'Copy link'}</span>
                          </button>
                        </div>
                        <footer className="st-portal-card-foot">
                          <span>Private link — do not forward</span>
                          <button
                            type="button"
                            className="st-link-action"
                            onClick={() => insertQuickChip(`Here is your private TaxFlow Client Portal link: ${portalUrl}`)}
                          >
                            Resend invite
                          </button>
                        </footer>
                      </article>
                    ) : (
                      <div className={m.direction === 'outbound' ? 'st-bubble-out' : 'st-bubble-in'}>
                        {m.body}
                      </div>
                    )}

                    <div className="st-msg-meta">
                      <span className="st-msg-time">
                        {fTime(msgDate)} · {
                          m.direction === 'inbound'
                            ? client.name
                            : m.delivery_status === 'sending' || m.delivery_status === 'queued'
                              ? 'Sending…'
                              : m.delivery_status === 'failed'
                                ? 'Delivery failed'
                                : 'Sent'
                        }
                      </span>
                    </div>
                  </div>
                </div>
              );
            });
          })()}

          {/* WhatsApp Messages */}
          {channel === 'whatsapp' && (() => {
            let last = '';
            return thread.map((m) => {
              const dl = dayLabel(m.at);
              const sep = dl !== last ? (last = dl, (
                <div key={`sep-${m.id}`} className="st-date-divider">
                  <span className="st-date-pill">{dl}</span>
                </div>
              )) : null;
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {sep}
                  {m.f === 'sys' ? (
                    <div className="sys"><Icon name="bolt" size={12} />{m.t}</div>
                  ) : (
                    <div className={`st-msg-row ${m.f === 'me' ? 'out' : 'in'}`}>
                      <div className={m.f === 'me' ? 'st-bubble-out' : 'st-bubble-in'}>
                        {m.file && (
                          <div className="att"><Icon name="file" size={18} /><div><div className="mono" style={{ fontSize: 11.5 }}>{m.file}</div><div style={{ fontSize: 10.5, opacity: 0.75 }}>Captured to client folder</div></div></div>
                        )}
                        {m.t}
                      </div>
                      <div className="st-msg-meta">
                        <span className="st-msg-time">{fTime(m.at)}{m.auto ? ' · automated' : ''}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            });
          })()}

          {channel === 'whatsapp' && scheduledReminders.length > 0 && (
            <div className="st-date-divider"><span className="st-date-pill">Scheduled</span></div>
          )}
          {channel === 'whatsapp' && scheduledReminders.map((r) => (
            <div key={r.id} className="st-msg-row out">
              <div className="st-bubble-out">
                <div className="sh">
                  <Icon name="clock" size={13} /><span>{fDT(r.at)} · {until(r.at)}</span>
                  {r.approve ? <span className="chip amber">Needs approval</span> : <span className="chip green">Auto-send</span>}
                </div>
                {r.text}
                <div className="sa" style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  {r.approve && <button className="btn sm" onClick={() => onApproveReminder(r.id)}>Approve</button>}
                  <button className="btn sm" onClick={() => onSendReminderNow(r)} disabled={sendingReminderId === r.id || whatsAppLoading || !whatsAppReady}>
                    {sendingReminderId === r.id ? 'Sending…' : 'Send now'}
                  </button>
                  <button className="btn sm gh" onClick={() => onCancelReminder(r.id)}>Cancel</button>
                </div>
                {reminderSendErrors[r.id] && <small className="wa-reminder-error">{reminderSendErrors[r.id]}</small>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky Bottom Chat Composer (Pinned & Always Visible Above Taskbar) */}
      <footer className="st-composer-footer">
        <div className="st-composer-inner">
          {/* Quick Action Template Chips */}
          <div className="st-chip-row">
            <button
              type="button"
              className="st-template-chip"
              onClick={() => insertQuickChip('Please upload your Form 16 and AIS statement through your secure Client Portal when ready.')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">description</span>
              <span>Request documents</span>
            </button>
            <button
              type="button"
              className="st-template-chip"
              onClick={() => insertQuickChip('Here is your private TaxFlow Client Portal link: https://orvvexa.vercel.app/portal')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">add_link</span>
              <span>Send portal invite</span>
            </button>
            <button
              type="button"
              className="st-template-chip"
              onClick={() => insertQuickChip('Privacy reminder: please do not send sensitive documents or photos in Telegram. Use your Client Portal instead.')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">verified_user</span>
              <span>Privacy reminder</span>
            </button>
            <div className="telegram-template-anchor" ref={telegramTemplateMenuRef}>
              <button
                type="button"
                className={`st-template-chip${telegramTemplatesOpen ? ' is-open' : ''}`}
                aria-label="More templates"
                aria-expanded={telegramTemplatesOpen}
                aria-controls="message-template-menu"
                onClick={onToggleTemplates}
                disabled={isSending || !!applyingTemplateId}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">library_books</span>
                <span>All templates</span>
              </button>
              {telegramTemplatesOpen && renderTemplateDropdown()}
            </div>
          </div>

          {/* Pinned Message Typing Input Box */}
          <form
            id="chat-composer-form"
            className="st-composer-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isSendDisabled) onSend();
            }}
          >
            <textarea
              id="chat-input"
              ref={activeInputRef}
              rows={1}
              className="st-chat-input"
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onCloseTemplates();
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!isSendDisabled) onSend();
                }
              }}
              placeholder={
                channel === 'telegram'
                  ? `Message ${client.name} via Telegram...`
                  : whatsAppLoading
                    ? 'Checking WhatsApp API status...'
                    : !whatsAppReady
                      ? 'WhatsApp API not configured (switch to Telegram)'
                      : `Message ${client.name} via WhatsApp...`
              }
              disabled={isComposerDisabled}
              aria-label={`Message ${client.name} via ${channel === 'telegram' ? 'Telegram' : 'WhatsApp'}`}
            />
            <button
              id="send-btn"
              type="submit"
              className="st-send-btn"
              disabled={isSendDisabled}
              aria-label="Send message"
            >
              <span>{isSending ? 'Sending…' : 'Send message'}</span>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
                send
              </span>
            </button>
          </form>
        </div>
      </footer>
    </main>
  );
}
