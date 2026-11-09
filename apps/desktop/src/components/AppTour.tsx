import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Page } from '../types';
import { useAppState, useDispatch } from '../state/store';
import { Icon } from './Icon';

type TourStep = {
  page: Page;
  target: string;
  title: string;
  body: string;
  navigation?: boolean;
};

const TOUR_STEPS: TourStep[] = [
  { page: 'dashboard', target: 'dashboard-intro', title: 'Your practice at a glance', body: 'Start here each day. Your client workload, filings, documents, reminders, and recent activity come together in one view.' },
  { page: 'dashboard', target: 'dashboard-metrics', title: 'Spot what needs attention', body: 'These figures summarize your current workload, extraction queue, upcoming deadlines, and scheduled reminders.' },
  { page: 'dashboard', target: 'dashboard-workload', title: 'Keep filings moving', body: 'Open a deadline or select a filing to see progress and the work still to be done.' },
  { page: 'dashboard', target: 'dashboard-documents', title: 'Follow documents and client activity', body: 'See what is waiting, under review, extracted, or approved. Below, check upcoming reminders, missing documents, and recent automation activity.' },
  { page: 'dashboard', target: 'ai-assistant', title: 'Ask the TaxFlow Assistant', body: 'Ask about clients, missing documents, deadlines, or fees. Quick actions below the conversation help you get started.' },
  { page: 'extract', target: 'nav-extract', title: 'Next: document extraction', body: 'Click Invoice Extraction in the sidebar. You can also choose Next to open it for you.', navigation: true },
  { page: 'extract', target: 'extract-intro', title: 'Turn documents into usable data', body: 'Choose a client and document type, then upload an invoice or statement. The original stays in private Supabase Storage.' },
  { page: 'extract', target: 'extract-document-type', title: 'Choose what you are processing', body: 'Select the document type so extraction can look for the right fields.' },
  { page: 'extract', target: 'extract-upload', title: 'Upload a document securely', body: 'Drop a file here or click to browse. The original is saved to the client’s private cloud folder before processing.' },
  { page: 'extract', target: 'extract-result', title: 'Review before you rely on it', body: 'Follow processing on the timeline, check each extracted field, then open the review step to correct values and approve the result.' },
  { page: 'whatsapp', target: 'nav-whatsapp', title: 'Next: client conversations', body: 'Click Client Inbox to see messages, document hand-offs, and follow-ups together.', navigation: true },
  { page: 'whatsapp', target: 'inbox-controls', title: 'Keep client messages together', body: 'Check the connected messaging channel, then use the tabs to manage conversations, scheduled reminders, and reusable templates.' },
  { page: 'whatsapp', target: 'inbox-conversations', title: 'Find the right conversation', body: 'Search or select a client on the left. Their conversation and follow-up actions appear alongside it.' },
  { page: 'whatsapp', target: 'nav-wa-reminders', title: 'Explore scheduled reminders', body: 'Choose Scheduled reminders to review follow-ups and check whether each message is scheduled, sent, or needs attention.', navigation: true },
  { page: 'whatsapp', target: 'inbox-reminders', title: 'Review follow-ups before they go out', body: 'See scheduled client reminders, delivery status, and any errors. Use the schedule action to plan a new follow-up.' },
  { page: 'whatsapp', target: 'nav-wa-templates', title: 'Explore message templates', body: 'Choose Templates to see reusable messages for common client requests.', navigation: true },
  { page: 'whatsapp', target: 'inbox-templates', title: 'Reuse clear client messages', body: 'Browse built-in and private templates by country. Create or edit a template to make repeat follow-ups quicker.' },
  { page: 'files', target: 'nav-files', title: 'Next: client folders', body: 'Click Client Folders to browse files stored in private cloud storage.', navigation: true },
  { page: 'files', target: 'files-intro', title: 'A private home for client files', body: 'Select a client and search their folders. Originals and extracted files stay organized by client.' },
  { page: 'files', target: 'files-controls', title: 'Choose a client and find a file', body: 'Switch between client workspaces, check the selected folder path, or search for a document by name.' },
  { page: 'files', target: 'files-tree', title: 'Browse and inspect files', body: 'Choose a folder in the tree to view its contents. Select a file to preview it or open it with your computer’s default app.' },
  { page: 'deadlines', target: 'nav-deadlines', title: 'Next: deadlines', body: 'Click Deadlines to follow filing dates and completion progress.', navigation: true },
  { page: 'deadlines', target: 'deadlines-intro', title: 'See compliance work clearly', body: 'Use the summary to spot overdue and upcoming filings, then open a client row to update individual work steps.' },
  { page: 'deadlines', target: 'deadlines-summary', title: 'Prioritize the next filing', body: 'The summary separates urgent work, near-term due dates, completed filings, and the number of clients being tracked.' },
  { page: 'deadlines', target: 'deadline-client', title: 'Update a client’s filing checklist', body: 'Open a client’s timeline, review each due date, and tick off work steps as they are completed.' },
  { page: 'generate', target: 'nav-generate', title: 'Next: file generator', body: 'Click File Generator to prepare outputs from approved invoice data.', navigation: true },
  { page: 'generate', target: 'generator-intro', title: 'Build filing outputs', body: 'Pick a client, period, and output type. Generate files from approved data, then preview the result before using it.' },
  { page: 'generate', target: 'generator-setup', title: 'Choose the filing output', body: 'Set the client and period, then choose the output types you need. Available options depend on the client’s country and services.' },
  { page: 'generate', target: 'generator-results', title: 'Preview generated files', body: 'Generate outputs from approved invoice data, then preview each completed file before using it.' },
  { page: 'clients', target: 'nav-clients', title: 'Next: your client list', body: 'Click Clients to add or update the people and businesses you serve.', navigation: true },
  { page: 'clients', target: 'clients-intro', title: 'Keep each client’s work connected', body: 'Client details and filing services connect documents, messages, and deadlines to the right workspace.' },
  { page: 'clients', target: 'clients-workspace', title: 'Add or review a client', body: 'Create a client profile with contact information and filing services. Open a client later to review details and work completed.' },
  { page: 'subscriptions', target: 'nav-subscriptions', title: 'Next: subscription information', body: 'Click Subscriptions to review the plan information available for this workspace.', navigation: true },
  { page: 'subscriptions', target: 'subscriptions-intro', title: 'Review workspace plan details', body: 'This page shows the current workspace status and proposed plans. Plan purchasing is not connected yet.' },
  { page: 'subscriptions', target: 'subscription-plans', title: 'Compare proposed plans', body: 'Review the indicative plan limits and features. These are planning details only; subscriptions cannot be purchased here yet.' },
  { page: 'profile', target: 'nav-profile', title: 'Next: your profile', body: 'Click Profile to manage your account and practice details.', navigation: true },
  { page: 'profile', target: 'profile-intro', title: 'Manage your account', body: 'Update your name and practice information here, and check your account and cloud document storage.' },
  { page: 'profile', target: 'profile-details', title: 'Keep your practice details current', body: 'Your profile identifies the account owner and shows the workspace and cloud-storage status.' },
  { page: 'settings', target: 'nav-settings', title: 'Next: settings', body: 'Click Settings for your AI connection, automation preferences, and the option to replay this guide.', navigation: true },
  { page: 'settings', target: 'settings-intro', title: 'Make TaxFlow work your way', body: 'Settings bring your AI connection, secure provider options, automation preferences, and this replayable guide together.' },
  { page: 'settings', target: 'automation-settings', title: 'Set your automation preferences', body: 'Choose whether TaxFlow extracts new bills, reminds clients, asks before sending, and blocks duplicate invoices.' },
  { page: 'settings', target: 'settings-replay', title: 'Replay this guide any time', body: 'Come back to this button whenever you want another page-by-page tour of TaxFlow.' },
];

const TOUR_FALLBACKS: Record<string, string> = {
  'dashboard-metrics': '[data-tour="dashboard-empty"]',
  'dashboard-workload': '[data-tour="dashboard-empty"]',
  'dashboard-documents': '[data-tour="dashboard-empty"]',
  'extract-document-type': '[data-tour="extract-empty"]',
  'extract-upload': '[data-tour="extract-empty"]',
  'extract-result': '[data-tour="extract-empty"]',
  'inbox-controls': '[data-tour="inbox-empty"]',
  'inbox-conversations': '[data-tour="inbox-empty"]',
  'nav-wa-reminders': '[data-tour="inbox-empty"]',
  'inbox-reminders': '[data-tour="inbox-empty"]',
  'nav-wa-templates': '[data-tour="inbox-empty"]',
  'inbox-templates': '[data-tour="inbox-empty"]',
  'files-tree': '[data-tour="files-empty"]',
  'files-controls': '[data-tour="files-empty"]',
  'deadlines-summary': '[data-tour="deadlines-empty"]',
  'deadline-client': '[data-tour="deadlines-empty"]',
  'generator-setup': '[data-tour="generator-empty"]',
  'generator-results': '[data-tour="generator-empty"]',
  'clients-workspace': '[data-tour="clients-empty"], [data-tour="clients-list"]',
};

const TOUR_SELECTORS: Record<string, string> = {
  'extract-intro': '.extract-header',
  'extract-empty': '.extract-no-client-state',
  'extract-document-type': '.category-grid',
  'extract-upload': '.upload-dropzone',
  'extract-result': '.extract-result-card',
};

function tourSelector(target: string): string {
  return TOUR_SELECTORS[target] || `[data-tour="${target}"]`;
}

function tourKey(userId: string) {
  return `taxflow_app_tour_seen_${userId}`;
}

export function TourWelcome({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const startRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => startRef.current?.focus(), []);
  useEffect(() => () => returnFocusRef.current?.focus(), []);

  return (
    <div className="tour-welcome-backdrop">
      <section className="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title" onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}>
        <span className="tour-welcome-mark" aria-hidden="true"><Icon name="spark" size={20} /></span>
        <p className="tour-eyebrow">YOUR WORKSPACE IS READY</p>
        <h2 id="tour-welcome-title">Want a quick tour?</h2>
        <p className="tour-welcome-copy">We can walk through each page, show you where work happens, and introduce your AI assistant. It takes about 2–3 minutes.</p>
        <div className="tour-welcome-actions">
          <button type="button" className="btn gh tour-welcome-skip" onClick={onSkip}>Skip for now</button>
          <button type="button" className="btn pri" ref={startRef} onClick={onStart}>Let’s take the tour</button>
        </div>
      </section>
    </div>
  );
}

export function AppTour({ onFinish }: { onFinish: () => void }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [spotlight, setSpotlight] = useState<{ top: number; left: number; width: number; height: number; radius: number } | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const finishRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const step = TOUR_STEPS[index];
  const trapDialogFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  useEffect(() => {
    if (done) finishRef.current?.focus();
    else nextRef.current?.focus();
  }, [done, index]);
  useEffect(() => () => returnFocusRef.current?.focus(), []);

  useEffect(() => {
    if (step.page !== state.page) dispatch({ type: 'GO', page: step.page });
    if (step.target === 'ai-assistant' && !state.chatOpen) dispatch({ type: 'TOGGLE_CHAT' });
  }, [dispatch, state.chatOpen, state.page, step]);

  useLayoutEffect(() => {
    if (done) {
      setSpotlight(null);
      return undefined;
    }
    let frame = 0;
    let settleTimer = 0;
    let focusedTarget: HTMLElement | null = null;
    const updateFocus = () => {
      if (!focusedTarget) return;
      const bounds = focusedTarget.getBoundingClientRect();
      const styles = window.getComputedStyle(focusedTarget);
      const parsedRadius = Number.parseFloat(styles.borderTopLeftRadius);
      setSpotlight({ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height, radius: Number.isFinite(parsedRadius) ? Math.max(14, parsedRadius) : 14 });
      const cardWidth = Math.min(380, window.innerWidth - 32);
      const left = bounds.left < 250
        ? bounds.right + 14
        : bounds.right > window.innerWidth - cardWidth - 24
          ? bounds.left - cardWidth - 14
          : bounds.left + bounds.width / 2 - cardWidth / 2;
      const safeLeft = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, left));
      const top = bounds.bottom + 244 < window.innerHeight
        ? Math.max(16, bounds.bottom + 14)
        : bounds.top > 260
          ? undefined
          : 16;
      setPosition(top === undefined
        ? { left: safeLeft, bottom: Math.min(window.innerHeight - 16, window.innerHeight - bounds.top + 14) }
        : { left: safeLeft, top });
    };
    const updatePosition = () => {
      focusedTarget = document.querySelector<HTMLElement>(tourSelector(step.target));
      if (!focusedTarget && TOUR_FALLBACKS[step.target]) {
        focusedTarget = document.querySelector<HTMLElement>(TOUR_FALLBACKS[step.target]);
      }
      if (!focusedTarget) {
        setSpotlight(null);
        setPosition({ left: '50%', bottom: 24, transform: 'translateX(-50%)' });
        return;
      }
      const main = focusedTarget.closest<HTMLElement>('.main');
      const mainBounds = main?.getBoundingClientRect();
      const targetBounds = focusedTarget.getBoundingClientRect();
      if (main && mainBounds && (targetBounds.top < mainBounds.top || targetBounds.bottom > mainBounds.bottom)) {
        const offset = targetBounds.top - mainBounds.top;
        main.scrollTo({ top: Math.max(0, main.scrollTop + offset - Math.max(24, (main.clientHeight - targetBounds.height) / 2)), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      } else {
        focusedTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      }

      updateFocus();
      settleTimer = window.setTimeout(updateFocus, 240);
    };
    frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updateFocus, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updateFocus, true);
    };
  }, [done, index, state.page, step.target]);

  useEffect(() => {
    if (!step.navigation) return undefined;
    const onTargetClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(tourSelector(step.target))) return;
      window.setTimeout(() => setIndex(current => current === index ? Math.min(current + 1, TOUR_STEPS.length) : current), 0);
    };
    document.addEventListener('click', onTargetClick, true);
    return () => document.removeEventListener('click', onTargetClick, true);
  }, [done, index, step.navigation, step.target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onFinish();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onFinish]);

  function next() {
    if (step.navigation) dispatch({ type: 'GO', page: step.page });
    if (step.target === 'nav-wa-reminders') dispatch({ type: 'WA_TAB', tab: 'reminders' });
    if (step.target === 'nav-wa-templates') dispatch({ type: 'WA_TAB', tab: 'templates' });
    if (index + 1 === TOUR_STEPS.length) setDone(true);
    else setIndex(index + 1);
  }

  if (done) {
    return (
      <div className="tour-welcome-backdrop">
        <section className="tour-welcome tour-complete" role="dialog" aria-modal="true" aria-labelledby="tour-complete-title" onKeyDown={trapDialogFocus}>
          <span className="tour-welcome-mark tour-finished-mark" aria-hidden="true"><Icon name="check" size={20} /></span>
          <p className="tour-eyebrow">YOU’RE READY TO GO</p>
          <h2 id="tour-complete-title">That’s your TaxFlow workspace</h2>
          <p className="tour-welcome-copy">You can replay this page-by-page guide anytime from Settings.</p>
          <div className="tour-welcome-actions"><button type="button" className="btn pri" ref={finishRef} onClick={onFinish}>Go to work</button></div>
        </section>
      </div>
    );
  }

  return (
    <div className="tour-layer">
      {spotlight ? (
        <svg className="tour-mask" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none" aria-hidden="true">
          <path
            fillRule="evenodd"
            d={`M0 0H${window.innerWidth}V${window.innerHeight}H0Z M${spotlight.left - 8 + spotlight.radius} ${spotlight.top - 8} H${spotlight.left + spotlight.width + 8 - spotlight.radius} Q${spotlight.left + spotlight.width + 8} ${spotlight.top - 8} ${spotlight.left + spotlight.width + 8} ${spotlight.top - 8 + spotlight.radius} V${spotlight.top + spotlight.height + 8 - spotlight.radius} Q${spotlight.left + spotlight.width + 8} ${spotlight.top + spotlight.height + 8} ${spotlight.left + spotlight.width + 8 - spotlight.radius} ${spotlight.top + spotlight.height + 8} H${spotlight.left - 8 + spotlight.radius} Q${spotlight.left - 8} ${spotlight.top + spotlight.height + 8} ${spotlight.left - 8} ${spotlight.top + spotlight.height + 8 - spotlight.radius} V${spotlight.top - 8 + spotlight.radius} Q${spotlight.left - 8} ${spotlight.top - 8} ${spotlight.left - 8 + spotlight.radius} ${spotlight.top - 8}Z`}
          />
          <rect className="tour-focus-ring" x={spotlight.left - 8} y={spotlight.top - 8} width={spotlight.width + 16} height={spotlight.height + 16} rx={spotlight.radius + 8} />
        </svg>
      ) : <div className="tour-scrim" aria-hidden="true" />}
      <section className="tour-card" style={position} role="dialog" aria-modal="true" aria-live="polite" aria-label={`App tour, step ${index + 1} of ${TOUR_STEPS.length}`} onKeyDown={trapDialogFocus}>
        <div className="tour-card-top"><span>Workspace tour</span><button type="button" className="tour-close" onClick={onFinish} aria-label="Close tour">×</button></div>
        <div className="tour-progress"><i style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} /></div>
        <p className="tour-count">STEP {index + 1} OF {TOUR_STEPS.length}</p>
        <h2>{step.title}</h2>
        <p className="tour-description">{step.body}</p>
        <div className="tour-card-actions">
          <button type="button" className="btn gh tour-skip" onClick={onFinish}>Skip tour</button>
          <div>
            {index > 0 && <button type="button" className="btn gh" onClick={() => setIndex(index - 1)}>Back</button>}
            <button type="button" className="btn pri" ref={nextRef} onClick={next}>{step.navigation ? 'Open page' : index + 1 === TOUR_STEPS.length ? 'Finish tour' : 'Next'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function shouldShowTourWelcome(userId: string): boolean {
  try {
    return localStorage.getItem(tourKey(userId)) !== 'true';
  } catch (error) {
    console.warn('Could not read the app tour preference.', error);
    return true;
  }
}

export function markTourWelcomeSeen(userId: string): void {
  try {
    localStorage.setItem(tourKey(userId), 'true');
  } catch (error) {
    console.warn('Could not save the app tour preference.', error);
  }
}
