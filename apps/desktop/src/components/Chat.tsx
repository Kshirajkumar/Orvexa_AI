import { useEffect, useState, useRef } from 'react';
import { Icon } from './Icon';
import { useAppState, useDispatch } from '../state/store';
import { sendChatMessage } from '../lib/api';
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
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, isTyping, fallbackProgress]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || isTyping) return;
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
        <div className="ch-h-text"><b>Taxflow Assistant</b><small><span className="online-dot" />Saved device key or secure gateway</small></div>
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
        <div className="ch-f-label"><span className="ch-f-status" />Secure AI workspace</div>
        <div className="ch-f-row">
          <input value={input} disabled={isTyping} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(input); } }} placeholder="Ask about clients, deadlines, fees…" aria-label="Chat input" />
          <button className="ch-send" onClick={() => void ask(input)} aria-label="Send message" disabled={!input.trim() || isTyping}><Icon name="send" size={16} /></button>
        </div>
      </div>
    </aside>
  );
}
