import { useState } from 'react';
import { Icon } from '../Icon';
import { missing } from '../../lib/domain';
import { agoT } from '../../lib/format';
import type { TelegramPreview } from '../../lib/api';
import type { ChatMsg, CheckItem, Client } from '../../types';

interface ConversationListProps {
  clients: Client[];
  selectedClientId: string;
  clientSearch: string;
  onClientSearchChange: (value: string) => void;
  channel: 'whatsapp' | 'telegram';
  threads: Record<string, ChatMsg[]>;
  checks: Record<string, CheckItem[]>;
  telegramPreviews: Record<string, TelegramPreview>;
  unreadCounts: Record<string, number>;
  onSelectClient: (clientId: string) => void;
}

export function ConversationList({
  clients,
  selectedClientId,
  clientSearch,
  onClientSearchChange,
  channel,
  threads,
  checks,
  telegramPreviews,
  unreadCounts,
  onSelectClient,
}: ConversationListProps) {
  const [filterTab, setFilterTab] = useState<'all' | 'telegram' | 'pending'>('all');

  const filteredClients = clients.filter((cl) => {
    if (filterTab === 'telegram') {
      return Boolean(telegramPreviews[cl.id]) || cl.id === selectedClientId;
    }
    if (filterTab === 'pending') {
      return missing(checks, cl.id).length > 0;
    }
    return true;
  });

  return (
    <aside className="st-rail" data-tour="inbox-conversations" aria-label="Client conversations">
      {/* Workspace & Conversations Header */}
      <header className="st-rail-header">
        <div className="st-rail-brand-row">
          <div className="st-rail-brand">
            <div className="st-rail-logo" aria-hidden="true">
              <Icon name="chat" size={17} />
            </div>
            <div className="st-rail-brand-text">
              <h1 className="st-rail-title">Orvexa</h1>
              <span className="st-rail-sub">Client Inbox</span>
            </div>
          </div>
          <span className="st-badge-numeric" role="status">
            {clients.length} {clients.length === 1 ? 'client' : 'clients'}
          </span>
        </div>

        {/* Search Input */}
        <label className="st-search-wrap">
          <span className="material-symbols-outlined st-search-icon" aria-hidden="true">
            search
          </span>
          <input
            id="client-search"
            type="search"
            className="st-search-input"
            value={clientSearch}
            onChange={(event) => onClientSearchChange(event.target.value)}
            placeholder="Find a client or phone..."
            aria-label="Find a client or phone"
          />
        </label>

        {/* Filter Tabs */}
        <div className="st-filter-tabs" role="tablist" aria-label="Filter conversations">
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'all'}
            className={`st-filter-tab${filterTab === 'all' ? ' on' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'telegram'}
            className={`st-filter-tab${filterTab === 'telegram' ? ' on' : ''}`}
            onClick={() => setFilterTab('telegram')}
          >
            Telegram
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filterTab === 'pending'}
            className={`st-filter-tab${filterTab === 'pending' ? ' on' : ''}`}
            onClick={() => setFilterTab('pending')}
          >
            Portal Pending
          </button>
        </div>
      </header>

      {/* Client Conversation List */}
      <nav className="st-client-list" aria-label="Client conversations">
        {filteredClients.length === 0 ? (
          <div className="wa-list-empty">
            <span>No matching clients</span>
          </div>
        ) : (
          filteredClients.map((cl) => {
            const th = threads[cl.id] || [];
            const whatsappLast = th
              .filter((message) => message.f !== 'sys')
              .reduce<ChatMsg | undefined>(
                (latest, message) => (!latest || message.at > latest.at ? message : latest),
                undefined,
              );
            const telegramLast = telegramPreviews[cl.id];
            const previewText = channel === 'telegram'
              ? telegramLast?.body
              : whatsappLast?.file
                ? `Attachment: ${whatsappLast.file}`
                : whatsappLast?.t;
            const previewAt = channel === 'telegram'
              ? telegramLast?.created_at
                ? new Date(telegramLast.created_at)
                : undefined
              : whatsappLast?.at;
            const clUnread = unreadCounts[cl.id] || 0;
            const clientPreview = clUnread > 0
              ? `${clUnread} new message${clUnread === 1 ? '' : 's'}`
              : previewText || 'No messages yet';
            const isSelected = selectedClientId === cl.id;
            const isOnline = channel === 'telegram' && (Boolean(telegramLast) || isSelected);

            return (
              <button
                type="button"
                key={cl.id}
                className={`st-client-card${isSelected ? ' on' : ''}`}
                aria-label={`${cl.name}${clUnread ? `, ${clUnread} unread messages` : ''}`}
                aria-pressed={isSelected}
                title={cl.name}
                onClick={() => onSelectClient(cl.id)}
              >
                <div className="st-avatar-wrap">
                  <div className={`st-avatar${isSelected ? ' primary' : ''}`}>
                    {cl.short.slice(0, 2).toUpperCase()}
                  </div>
                  {isOnline && (
                    <span
                      className="st-online-dot"
                      role="status"
                      aria-label="Telegram online"
                    />
                  )}
                </div>

                <div className="st-client-meta">
                  <div className="st-client-row">
                    <h2 className="st-client-name">{cl.name}</h2>
                    <span className="st-client-time">
                      {previewAt ? agoT(previewAt) : ''}
                    </span>
                  </div>
                  <p className="st-client-preview" title={clientPreview}>
                    {clientPreview}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}
