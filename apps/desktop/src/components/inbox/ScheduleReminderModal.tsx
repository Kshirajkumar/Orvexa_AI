import { useEffect, useState } from 'react';
import { Icon } from '../Icon';
import type { MessageTemplate, SupportedCountryTimezone } from '../../lib/api';

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

export interface ScheduleReminderModalProps {
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
}

export function ScheduleReminderModal({
  onClose,
  defaultClient,
  clients,
  templates,
  timezones,
  error,
  saving,
  onSave,
}: ScheduleReminderModalProps) {
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
          <div>
            <h2 id="schedule-modal-title">Schedule a Telegram reminder</h2>
            <p>Saved on the server and sent automatically in the client’s country time.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={saving} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
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
                if (nextTpl) setMessageBody(nextTpl.body);
              }}
            >
              <option value="">Custom reminder text</option>
              {templates.filter((t) => !t.user_id).length > 0 && (
                <optgroup label="Built-in Templates (Country)">
                  {templates.filter((t) => !t.user_id).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.cat})
                    </option>
                  ))}
                </optgroup>
              )}
              {templates.filter((t) => !!t.user_id).length > 0 && (
                <optgroup label="Your Private Templates">
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
          <button type="button" className={repeatMode === 'once' ? 'on' : ''} onClick={() => setRepeatMode('once')}>
            <Icon name="cal" size={14} />One time
          </button>
          <button type="button" className={repeatMode === 'daily' ? 'on' : ''} onClick={() => setRepeatMode('daily')}>
            <Icon name="refresh" size={14} />Every day
          </button>
        </div>

        <div className="mgrid">
          <div className="mrow">
            <label className="f" htmlFor="schedule-timezone">Client time zone</label>
            <select id="schedule-timezone" className="sel" value={timezoneName} onChange={(event) => setTimezoneName(event.target.value)} disabled={!availableTimezones.length}>
              {availableTimezones.map((timezone) => (
                <option key={timezone.timezone_name} value={timezone.timezone_name}>
                  {timezone.timezone_name}{timezone.is_default ? ' · Country default' : ''}
                </option>
              ))}
            </select>
            {selectedClient && <small>Country: {timezones.find((timezone) => timezone.country_id === selectedClient.countryId)?.country_name || 'Not configured'}</small>}
          </div>
          <div className="mrow">
            <label className="f" htmlFor={repeatMode === 'once' ? 'schedule-datetime' : 'schedule-daily-time'}>
              {repeatMode === 'once' ? 'Send at client local time' : 'Send every day at'}
            </label>
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
          <small>Use {'{name}'} for the client name and {'{portalLink}'} for the secure client portal.</small>
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
