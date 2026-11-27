import { useEffect, useState, useRef, useMemo } from 'react';
import { Icon } from './Icon';
import { useAppState, useDispatch } from '../state/store';
import { sendChatMessage, sendTelegramMessage, sendWhatsAppManualMessage } from '../lib/api';
import type { Client } from '../types';
import type { OpenRouterFallbackProgress } from '../lib/openRouter';
import { isPageNavigationCommand, resolvePageNavigation } from '../lib/pageNavigation';

interface Msg { id: number; who: 'me' | 'ai'; html: string; ts: Date; retryQuestion?: string }
let MID = 1;

function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[character] || character));
}

const SUGG = [
  { label: 'Due this week', icon: 'cal' },
  { label: 'Missing documents', icon: 'folder' },
  { label: 'Queued invoices', icon: 'scan' },
  { label: 'Outstanding fees', icon: 'rupee' },
  { label: 'Client overview', icon: 'users' },
];

export function Chat() {
  const state = useAppState();
  const dispatch = useDispatch();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [fallbackProgress, setFallbackProgress] = useState<OpenRouterFallbackProgress | null>(null);
  const [mentionClient, setMentionClient] = useState<Client | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mentionMatch = useMemo(() => {
    if (mentionClient || mentionDismissed) return null;
    const match = input.match(/(?:^|\s)@([^\s@][^@]*)$/) || input.match(/(?:^|\s)@$/);
    if (!match) return null;
    const query = (match[1] || '').trim().toLowerCase();
    return { query, index: match.index ?? 0, full: match[0] };
  }, [input, mentionClient, mentionDismissed]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionMatch) return [];
    const q = mentionMatch.query;
    return state.clients
      .filter((client) => {
        if (!q) return true;
        return (
          client.name.toLowerCase().includes(q)
          || client.short.toLowerCase().includes(q)
          || client.city.toLowerCase().includes(q)
        );
      })
      .slice(0, 8);
  }, [mentionMatch, state.clients]);

  useEffect(() => {
    setMentionActiveIdx(0);
  }, [mentionMatch?.query]);

  function selectMentionClient(client: Client) {
    setMentionClient(client);
    setMentionDismissed(false);
    setInput((prev) => prev.replace(/(?:^|\s)@[^@]*$/, (m) => (m.startsWith(' ') ? ' ' : '')).trimStart());
    inputRef.current?.focus();
  }

  async function deliverClientMessage(client: Client, text: string): Promise<'Telegram' | 'WhatsApp'> {
    try {
      await sendTelegramMessage(client.id, text);
      return 'Telegram';
    } catch (telegramError: unknown) {
      const telegramMsg = telegramError instanceof Error ? telegramError.message : String(telegramError);
      const notLinked = /not linked telegram/i.test(telegramMsg);
      if (notLinked && client.phone) {
        try {
          await sendWhatsAppManualMessage(client.id, client.phone, text);
          return 'WhatsApp';
        } catch (whatsappError: unknown) {
          const waMsg = whatsappError instanceof Error ? whatsappError.message : String(whatsappError);
          throw new Error(`${client.name} has not linked Telegram yet, and WhatsApp delivery failed (${waMsg}).`);
        }
      }
      throw telegramError;
    }
  }

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, isTyping, fallbackProgress]);

  async function ask(question: string, overrideClient?: Client | null) {
    const q = question.trim();
    const targetClient = overrideClient !== undefined ? overrideClient : mentionClient;
    if (!q || isTyping) return;

    if (targetClient) {
      const userMsg: Msg = {
        id: MID++,
        who: 'me',
        html: `<span class="chat-mention-tag">@${escapeHtml(targetClient.name)}</span> ${escapeHtml(q)}`,
        ts: new Date(),
      };
      setMsgs(current => [...current, userMsg]);
      setInput('');
      setMentionClient(null);
      setMentionDismissed(false);
      setIsTyping(true);
      setFallbackProgress(null);
      try {
        const channel = await deliverClientMessage(targetClient, q);
        setMsgs(current => [...current, {
          id: MID++,
          who: 'ai',
          html: `<span class="chat-sent-badge">✓ Message sent</span> to <b>${escapeHtml(targetClient.name)}</b> via ${escapeHtml(channel)}.<br /><span class="chat-sent-preview">"${escapeHtml(q)}"</span>`,
          ts: new Date(),
        }]);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : `Could not send message to ${targetClient.name}.`;
        setMsgs(current => [...current, {
          id: MID++,
          who: 'ai',
          html: `<b>Message not sent</b><br /><span class="chat-error-copy">${escapeHtml(message)}</span>`,
          ts: new Date(),
        }]);
      } finally {
        setIsTyping(false);
      }
      return;
    }

    const userMsg: Msg = { id: MID++, who: 'me', html: escapeHtml(q), ts: new Date() };
    setMsgs(current => [...current, userMsg]);
    setInput('');
    setIsTyping(true);
    setFallbackProgress(null);
    try {
      const navigation = resolvePageNavigation(q);
      if (navigation) {
        const page = navigation.page === 'extraction-review' ? 'extract' : navigation.page;
        const alreadyOnPage = state.page === page;
        if (!alreadyOnPage) dispatch({ type: 'GO', page });
        const status = navigation.page === 'extraction-review'
          ? `Data Extraction Review needs a document selection, so I've ${alreadyOnPage ? 'kept you on' : 'opened'} Invoice Extraction to start that flow.`
          : alreadyOnPage
            ? `You're already on ${navigation.label}.`
            : `I've opened ${navigation.label}.`;
        const next = navigation.page === 'extraction-review'
          ? 'Choose a client and document to review its extracted fields.'
          : navigation.next;
        setMsgs(current => [...current, {
          id: MID++,
          who: 'ai',
          html: `${escapeHtml(status)} ${escapeHtml(next)}`,
          ts: new Date(),
        }]);
        return;
      }
      if (isPageNavigationCommand(q)) {
        setMsgs(current => [...current, {
          id: MID++,
          who: 'ai',
          html: `I couldn't find that page. Available pages are Dashboard, Invoice Extraction, Data Extraction Review, Client Inbox, Client Folders, Deadlines, File Generator, Clients, Subscriptions, Profile, and Settings.`,
          ts: new Date(),
        }]);
        return;
      }

      const history = [...msgs, userMsg]
        .filter(message => !message.retryQuestion)
        .slice(-20)
        .map(message => ({ role: message.who === 'me' ? 'user' as const : 'assistant' as const, content: message.html.replace(/<[^>]*>/g, ' ') }));
      const response = await sendChatMessage(history, setFallbackProgress);
      setMsgs(current => [...current, { id: MID++, who: 'ai', html: escapeHtml(response.text).replace(/\n/g, '<br />'), ts: new Date() }]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The AI request failed. Please try again.';
      setMsgs(current => [...current, { id: MID++, who: 'ai', html: `<b>AI unavailable</b><br /><span class="chat-error-copy">${escapeHtml(message)}</span>`, retryQuestion: q, ts: new Date() }]);
    } finally {
      setIsTyping(false);
      setFallbackProgress(null);
    }
  }

  const formatTime = (date: Date) => date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <aside className="chat" data-tour="ai-assistant" aria-label="AI Assistant">
      <div className="ch-h">
        <div className="ch-h-icon"><Icon name="spark" size={18} /><span className="ch-h-pulse" /></div>
        <div className="ch-h-text"><b>Orvexa Assistant</b><small><span className="online-dot" />Saved device key or secure gateway</small></div>
        <button className="ch-close-btn" onClick={() => dispatch({ type: 'TOGGLE_CHAT' })} title="Close assistant" aria-label="Close assistant">×</button>
      </div>

      <div className="ch-msgs" ref={boxRef} id="ai-msgs" role="log" aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 && !isTyping && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon"><Icon name="spark" size={18} /></div>
            <b>Ready when you are</b>
            <span>Ask about clients, deadlines, documents, or fees.</span>
            <small>Chat uses a saved device key when available; otherwise it uses the secure server gateway.</small>
          </div>
        )}
        {msgs.map(message => (
          <div key={message.id} className={`cm-wrap ${message.who}`}>
            {message.who === 'ai' && <div className="cm-avatar"><Icon name="spark" size={12} /></div>}
            <div className="cm-bubble-group">
              <div className={`cm ${message.who === 'me' ? 'me' : 'ai'}`} dangerouslySetInnerHTML={{ __html: message.html }} />
              {message.retryQuestion && <button className="chat-retry" onClick={() => void ask(message.retryQuestion!)} disabled={isTyping}>↻ Try again</button>}
              <span className="cm-time">{formatTime(message.ts)}</span>
            </div>
          </div>
        ))}
        {isTyping && <div className="cm-wrap ai"><div className="cm-avatar"><Icon name="spark" size={12} /></div><div className="cm-bubble-group"><div className="cm ai typing-indicator"><span /><span /><span /></div>{fallbackProgress && <small className="ai-fallback-status" role="status" aria-live="polite">Auto-trying {fallbackProgress.nextModel} ({fallbackProgress.attempt} of {fallbackProgress.maxAttempts}) after {fallbackProgress.failedModel} failed. {fallbackProgress.waitMs > 0 ? `Waiting ${Math.ceil(fallbackProgress.waitMs / 1000)}s. ` : ''}{fallbackProgress.reason}</small>}</div></div>}
      </div>

      <div className="sugg"><div className="sugg-label">Quick actions</div><div className="sugg-list">
        {SUGG.map(suggestion => <button key={suggestion.label} onClick={() => void ask(suggestion.label)} className="sugg-btn" disabled={isTyping}><Icon name={suggestion.icon} size={12} />{suggestion.label}</button>)}
      </div></div>

      <div className="ch-f">
        <div className="ch-f-label"><span className="ch-f-status" />{mentionClient ? `Sending directly to ${mentionClient.name}` : 'Secure AI workspace · Type @ to message a client'}</div>
        {mentionClient && (
          <div className="chat-mention-pill-row">
            <span className="chat-mention-pill">
              <span>@{mentionClient.name}</span>
              <button type="button" onClick={() => setMentionClient(null)} aria-label={`Remove ${mentionClient.name}`}>×</button>
            </span>
          </div>
        )}
        {mentionMatch && (
          <div className="chat-mention-menu" role="listbox" aria-label="Select a client to message">
            {mentionSuggestions.length === 0 ? (
              <div className="chat-mention-empty">No clients match "@{mentionMatch.query}"</div>
            ) : (
              mentionSuggestions.map((client, idx) => (
                <button
                  key={client.id}
                  type="button"
                  role="option"
                  aria-selected={idx === mentionActiveIdx}
                  className={`chat-mention-item${idx === mentionActiveIdx ? ' active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectMentionClient(client);
                  }}
                >
                  <span className="chat-mention-avatar">{client.short}</span>
                  <span className="chat-mention-meta">
                    <b>{client.name}</b>
                    <small>{client.city || client.country}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        <div className="ch-f-row">
          <input
            ref={inputRef}
            value={input}
            disabled={isTyping}
            onChange={(event) => {
              setInput(event.target.value);
              if (mentionDismissed) setMentionDismissed(false);
            }}
            onKeyDown={(event) => {
              if (mentionMatch && mentionSuggestions.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setMentionActiveIdx((idx) => (idx + 1) % mentionSuggestions.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setMentionActiveIdx((idx) => (idx - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  const chosen = mentionSuggestions[mentionActiveIdx];
                  if (chosen) selectMentionClient(chosen);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMentionDismissed(true);
                  return;
                }
              }
              if (event.key === 'Backspace' && !input && mentionClient) {
                setMentionClient(null);
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask(input);
              }
            }}
            placeholder={mentionClient ? `Type message to send to ${mentionClient.name}…` : 'Ask about clients, or type @ to message…'}
            aria-label="Chat input"
          />
          <button className="ch-send" onClick={() => void ask(input)} aria-label="Send message" disabled={!input.trim() || isTyping}><Icon name="send" size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
