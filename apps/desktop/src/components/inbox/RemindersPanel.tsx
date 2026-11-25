import { Icon } from '../Icon';
import type { TelegramMessageSchedule } from '../../lib/api';
import { scheduledTimeLabel } from './types';

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

interface RemindersPanelProps {
  schedules: TelegramMessageSchedule[];
  loading: boolean;
  notice: string;
  error: string;
  actionId: string;
  onRefresh: () => void;
  onOpenSchedule: () => void;
  onDismissNotice: () => void;
  onDismissError: () => void;
  onCancelSchedule: (schedule: TelegramMessageSchedule) => void;
  onRetrySchedule: (schedule: TelegramMessageSchedule) => void;
}

export function RemindersPanel({
  schedules,
  loading,
  notice,
  error,
  actionId,
  onRefresh,
  onOpenSchedule,
  onDismissNotice,
  onDismissError,
  onCancelSchedule,
  onRetrySchedule,
}: RemindersPanelProps) {
  return (
    <div className="wa-reminders inbox-tab-panel" data-tour="inbox-reminders" id="inbox-panel-reminders" role="tabpanel" aria-labelledby="inbox-tab-reminders">
      <div className="wa-reminders-header">
        <div className="wa-reminder-notice wa-reminders-banner">
          <Icon name="clock" size={14} />
          <span>Scheduled reminders are delivered automatically through the client's linked Telegram chat, using the client-country time zone.</span>
        </div>
        <div className="wa-reminders-actions-row">
          <button className="btn sm" onClick={onRefresh} disabled={loading} title="Refresh schedules">
            {loading ? <span className="spin" /> : <Icon name="refresh" size={13} />}
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn sm pri" onClick={onOpenSchedule}>
            <Icon name="plus" size={13} />Schedule Telegram reminder
          </button>
        </div>
      </div>

      {notice && (
        <div className="wa-reminders-notice-card wa-reminders-notice-success" role="status">
          <Icon name="check" size={14} />
          <span>{notice}</span>
          <button className="btn sm gh wa-reminders-notice-dismiss" onClick={onDismissNotice}>✕</button>
        </div>
      )}

      {error && (
        <div className="wa-reminders-notice-card wa-reminders-notice-error" role="alert">
          <Icon name="info" size={14} />
          <span>{error}</span>
          <button className="btn sm gh wa-reminders-notice-dismiss" onClick={onDismissError}>✕</button>
        </div>
      )}

      {loading && !schedules.length && (
        <div className="wa-reminder-list" role="status" aria-label="Loading schedules">
          <ScheduleCardSkeleton />
          <ScheduleCardSkeleton />
          <ScheduleCardSkeleton />
        </div>
      )}

      {!loading && !schedules.length && (
        <div className="wa-tab-empty">
          <span className="wa-tab-empty-icon"><Icon name="clock" size={28} /></span>
          <b>No saved Telegram reminders</b>
          <span>Choose a client, message and client-local send time to schedule a one-time or daily reminder.</span>
          <button className="btn pri" style={{ marginTop: 10 }} onClick={onOpenSchedule}>
            <Icon name="plus" size={13} />Create your first reminder
          </button>
        </div>
      )}

      {!loading && schedules.length > 0 && (
        <div className="wa-reminder-list">
          {schedules.map((schedule) => (
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
                  <button className="btn sm gh" onClick={() => onCancelSchedule(schedule)} disabled={actionId === schedule.id}>
                    Cancel
                  </button>
                )}
                {schedule.status === 'failed' && (
                  <button className="btn sm" onClick={() => onRetrySchedule(schedule)} disabled={actionId === schedule.id}>
                    {actionId === schedule.id ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
