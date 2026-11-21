import React from 'react';
import { Icon } from './Icon';
import { useAppState, useDispatch } from '../state/store';
import type { Page } from '../types';
import { allTasks } from '../lib/domain';
import { fetchTelegramUnread } from '../lib/api';

const NAV: Array<{ g: string; items: Array<[Page, string, string]> }> = [
  { g: 'Workspace', items: [['dashboard', 'Dashboard', 'grid']] },
  {
    g: 'Automation',
    items: [
      ['extract', 'Invoice Extraction', 'scan'],
      ['extraction-review', 'Data Extraction Review', 'table'],
      ['whatsapp', 'Client Inbox', 'chat'],
      ['files', 'Client Folders', 'folder'],
      ['deadlines', 'Deadlines', 'cal'],
      ['generate', 'File Generator', 'spark'],
    ],
  },
  {
    g: 'Practice',
    items: [
      ['clients', 'Clients', 'users'],
      ['subscriptions', 'Subscriptions', 'spark'],
      ['settings', 'Settings', 'sliders'],
    ],
  },
];

export function Sidebar() {
  const s = useAppState();
  const dispatch = useDispatch();
  const collapsed = s.sidebarCollapsed;
  const [unreadChatTotal, setUnreadChatTotal] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    async function loadUnread() {
      try {
        const summary = await fetchTelegramUnread();
        if (active) setUnreadChatTotal(summary.total);
      } catch (error) {
        console.warn('Failed to refresh unread Telegram count', error);
      }
    }
    void loadUnread();
    const timer = window.setInterval(loadUnread, 10000);
    const onUpdated = () => void loadUnread();
    window.addEventListener('taxflow:unread-updated', onUpdated);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('taxflow:unread-updated', onUpdated);
    };
  }, []);

  const badge = (id: Page): { n: number; hot?: boolean; chatUnread?: boolean } | null => {
    if (id === 'extract') {
      const n = s.docs.filter((d) => d.status === 'queued' || d.status === 'review').length;
      return n ? { n } : null;
    }
    if (id === 'whatsapp') {
      if (unreadChatTotal > 0) {
        return { n: unreadChatTotal, chatUnread: true };
      }
      return null;
    }
    if (id === 'deadlines') {
      const n = allTasks(s.tasks).filter((x) => x.st === 'overdue').length;
      return n ? { n, hot: true } : null;
    }
    return null;
  };

  const initials = s.currentUser?.name
    ? s.currentUser.name.split(' ').filter(Boolean).map((n) => n[0]).join('').substring(0, 2).toUpperCase()
    : 'CA';

  return (
    <nav className={`side${collapsed ? ' collapsed' : ''}`} aria-label="Pages">
      {/* Collapse Toggle Button */}
      <button
        className="sidebar-toggle"
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className="sidebar-toggle-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="15" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </span>
        {!collapsed && <span className="sidebar-toggle-label">Collapse</span>}
      </button>

      {/* Navigation Groups */}
      {NAV.map((g) => (
        <div key={g.g} className="nav-group">
          {!collapsed && <div className="gtitle">{g.g}</div>}
          {g.items.filter(([id]) => id !== 'extraction-review' || Boolean(s.ui.review?.documentId)).map(([id, label, icon]) => {
            const b = badge(id);
            const isActive = s.page === id;
            return (
              <button
                key={id}
                className={'nav' + (isActive ? ' on' : '') + (id === 'extraction-review' ? ' nav-review' : '')}
                data-tour={`nav-${id}`}
                onClick={() => dispatch({ type: 'GO', page: id })}
                title={collapsed ? `${label}${b ? ` (${b.n})` : ''}` : undefined}
                aria-label={label}
              >
                <span className="nav-icon">
                  <Icon name={icon} size={18} />
                </span>
                {!collapsed && <span className="lb">{label}</span>}
                {b && <span className={'bd' + (b.hot ? ' hot' : '') + (b.chatUnread ? ' chat-unread' : '')}>{b.n}</span>}
                {id === 'extraction-review' && <span className="review-nav-dot" aria-label="Review required" />}
                {isActive && <span className="nav-active-bar" />}
              </button>
            );
          })}
        </div>
      ))}

      {/* User Profile */}
      <div className="me" data-tour="profile-card" title={collapsed ? 'Open your profile' : 'Open your profile'} onClick={() => dispatch({ type: 'GO', page: 'profile' })} role="button" tabIndex={0} aria-label="Open your profile" onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') dispatch({ type: 'GO', page: 'profile' }); }}>
        <div className="me-avatar-wrap">
          <span className="av" style={{ ['--t' as any]: '#4C8DFF' }}>
            {initials}
          </span>
          <span className="me-status-dot" title="Online" />
        </div>
        {!collapsed && (
          <div className="me-info">
            <b className="me-name">
              {s.currentUser?.name || 'Personal workspace'}
            </b>
            <small className="me-role">
              {s.currentUser?.role || 'Managing Partner'}
            </small>
          </div>
        )}
        <button
          type="button"
          className="logout-btn"
          onClick={event => { event.stopPropagation(); dispatch({ type: 'LOGOUT' }); }}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
