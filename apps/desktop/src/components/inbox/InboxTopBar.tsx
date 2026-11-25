import { Icon } from '../Icon';

interface InboxTopBarProps {
  channel: 'whatsapp' | 'telegram';
  onChannelChange: (channel: 'whatsapp' | 'telegram') => void;
  activeTab: 'chats' | 'reminders' | 'templates';
  onTabChange: (tab: 'chats' | 'reminders' | 'templates') => void;
  activeSchedulesCount: number;
  telegramLoading: boolean;
  telegramReady: boolean;
  telegramBot: string;
  isTelegramConversationLoading: boolean;
  isTelegramLinkedForCurrentClient: boolean;
  totalUnreadAcrossClients: number;
  telegramConnecting: boolean;
  onConnectTelegram: () => void;
  whatsAppLoading: boolean;
  whatsAppReady: boolean;
  onOpenSchedule: () => void;
}

export function InboxTopBar({
  channel,
  onChannelChange,
  activeTab,
  onTabChange,
  activeSchedulesCount,
  telegramLoading,
  telegramReady,
  telegramBot,
  isTelegramConversationLoading,
  isTelegramLinkedForCurrentClient,
  totalUnreadAcrossClients,
  telegramConnecting,
  onConnectTelegram,
  whatsAppLoading,
  whatsAppReady,
  onOpenSchedule,
}: InboxTopBarProps) {
  return (
    <header className="inbox-topbar" data-tour="inbox-controls">
      <div className="inbox-topbar-left">
        <label className="wa-channel-control" htmlFor="inbox-channel">
          <span>Channel</span>
          <select
            id="inbox-channel"
            className="sel"
            value={channel}
            onChange={(e) => onChannelChange(e.target.value as 'whatsapp' | 'telegram')}
          >
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </label>

        {channel === 'telegram' && (
          <div className="inbox-status-pills">
            <span className={'chip ' + (telegramLoading ? 'amber' : telegramReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: 0 }} />
              {telegramLoading ? 'Checking…' : telegramReady ? `@${telegramBot}` : 'Offline'}
            </span>
            <span className={'chip wa-linked-status ' + (isTelegramConversationLoading ? 'amber' : isTelegramLinkedForCurrentClient ? 'green' : 'amber')}>
              {isTelegramConversationLoading ? 'Loading…' : isTelegramLinkedForCurrentClient ? 'Client linked' : 'Not linked'}
            </span>
            {totalUnreadAcrossClients > 0 && (
              <span
                className="chip wa-total-unread-pill"
                title={`${totalUnreadAcrossClients} unread message${totalUnreadAcrossClients > 1 ? 's' : ''}`}
              >
                <span className="wa-unread-glow-dot" />
                {totalUnreadAcrossClients} unread
              </span>
            )}
          </div>
        )}

        {channel === 'whatsapp' && (
          <div className="inbox-status-pills">
            <span className={'chip ' + (whatsAppLoading ? 'amber' : whatsAppReady ? 'green' : 'amber')}>
              <i className="sdot" style={{ margin: 0 }} />
              {whatsAppLoading ? 'Checking…' : whatsAppReady ? 'WhatsApp connected' : 'Not configured'}
            </span>
          </div>
        )}
      </div>

      <div className="inbox-tabs-segmented" role="tablist" aria-label="Client inbox sections">
        {(['chats', 'reminders', 'templates'] as const).map((tab) => (
          <button
            key={tab}
            id={`inbox-tab-${tab}`}
            data-tour={`nav-wa-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`inbox-panel-${tab}`}
            className={`inbox-tab-btn${activeTab === tab ? ' on' : ''}`}
            onClick={() => onTabChange(tab)}
          >
            <Icon
              name={tab === 'chats' ? 'chat' : tab === 'reminders' ? 'clock' : 'file'}
              size={13}
            />
            <span>
              {tab === 'chats'
                ? 'Chats'
                : tab === 'reminders'
                  ? `Scheduled (${activeSchedulesCount})`
                  : 'Templates'}
            </span>
          </button>
        ))}
      </div>

      <div className="inbox-topbar-actions">
        <button type="button" className="btn sm inbox-schedule-btn" onClick={onOpenSchedule}>
          <Icon name="plus" size={13} />
          <span>Schedule</span>
        </button>
        {channel === 'telegram' && (
          <button
            type="button"
            className="btn sm wa-connect-btn"
            onClick={onConnectTelegram}
            disabled={telegramLoading || isTelegramConversationLoading || telegramConnecting || !telegramReady}
          >
            {telegramConnecting && <span className="spin" />}
            <span>
              {telegramConnecting ? 'Connecting…' : isTelegramLinkedForCurrentClient ? 'Reconnect client' : 'Connect client'}
            </span>
          </button>
        )}
      </div>
    </header>
  );
}
