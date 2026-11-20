import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useDispatch } from '../state/store';
import { TOAST_EVENT, type ToastItem, type ToastPayload } from '../lib/toast';

const TOAST_DURATION_MS = 28_000;
const EXIT_DURATION_MS = 280;

function toastIcon(kind: ToastItem['kind']): string {
  if (kind === 'success') return 'check';
  if (kind === 'error') return 'x';
  if (kind === 'warning') return 'bell';
  return 'info';
}

function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [progress, setProgress] = useState(1);
  const remaining = useRef(TOAST_DURATION_MS);
  const lastTick = useRef(Date.now());

  useEffect(() => {
    if (leaving) return undefined;
    lastTick.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      if (!paused) {
        remaining.current = Math.max(0, remaining.current - (now - lastTick.current));
        setProgress(remaining.current / TOAST_DURATION_MS);
        if (remaining.current <= 0) {
          setLeaving(true);
          window.setTimeout(() => onRemove(item.id), EXIT_DURATION_MS);
        }
      }
      lastTick.current = now;
    }, 50);
    return () => window.clearInterval(interval);
  }, [item.id, leaving, onRemove, paused]);

  function close() {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => onRemove(item.id), EXIT_DURATION_MS);
  }

  function openRelatedNotification() {
    if (item.eventType === 'telegram.message_received' && item.entityId) {
      window.dispatchEvent(new CustomEvent('taxflow:open-telegram-client', { detail: item.entityId }));
    }
  }

  return <article
    className={`toast-card toast-${item.kind}${leaving ? ' is-leaving' : ''}${paused ? ' is-paused' : ''}`}
    role={item.kind === 'error' ? 'alert' : 'status'}
    aria-live={item.kind === 'error' ? 'assertive' : 'polite'}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onClick={openRelatedNotification}
  >
    <span className="toast-icon"><Icon name={toastIcon(item.kind)} size={15} /></span>
    <span className="toast-copy"><b>{item.title}</b><span>{item.message}</span></span>
    <button className="toast-close" onClick={(event) => { event.stopPropagation(); close(); }} aria-label="Dismiss notification"><Icon name="x" size={13} /></button>
    <span className="toast-timer" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
  </article>;
}

export function ToastHost() {
  const dispatch = useDispatch();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function receive(event: Event) {
      const payload = (event as CustomEvent<ToastPayload>).detail;
      if (!payload?.title || !payload.message) return;
      const item: ToastItem = { ...payload, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
      setItems(previous => [...previous, item].slice(-4));
    }
    window.addEventListener(TOAST_EVENT, receive);
    return () => window.removeEventListener(TOAST_EVENT, receive);
  }, []);

  useEffect(() => {
    const openTelegram = (event: Event) => {
      const clientId = (event as CustomEvent<string>).detail;
      if (clientId) dispatch({ type: 'WA_CLIENT', id: clientId });
      dispatch({ type: 'GO', page: 'whatsapp' });
    };
    window.addEventListener('taxflow:open-telegram-client', openTelegram);
    return () => window.removeEventListener('taxflow:open-telegram-client', openTelegram);
  }, [dispatch]);

  function remove(id: string) {
    setItems(previous => previous.filter(item => item.id !== id));
  }

  if (!items.length) return null;
  return <div className="toast-host" aria-label="Recent activity">
    {items.map(item => <ToastCard key={item.id} item={item} onRemove={remove} />)}
  </div>;
}
