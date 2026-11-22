import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { fetchClientDocuments, processDocumentExtraction, uploadDocument, type DocumentItem } from '../lib/api';
import { isUsingLocalOpenRouterKey, validateOpenRouterExtractionFile, type OpenRouterFallbackProgress } from '../lib/openRouter';
import { emitToast } from '../lib/toast';

type RunStep = 'idle' | 'uploading' | 'extracting' | 'saving' | 'done' | 'error';
type ConnectionState = 'online' | 'offline' | 'reconnecting';
const CATEGORIES = [['GST', 'GST invoice'], ['Form16', 'Form 16'], ['IncomeTax', 'Income tax'], ['BankStatement', 'Bank statement'], ['Notice', 'Tax notice'], ['General', 'Other document']];

function fileToBase64(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Permission denied: Orvexa could not read this file. Check the file permissions or choose a copy from a folder you can access.'));
    reader.onabort = () => reject(new DOMException('The file read was canceled.', 'AbortError'));
    signal?.addEventListener('abort', () => reader.abort(), { once: true });
    reader.readAsDataURL(file);
  });
}

function prettyKey(key: string) { return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function normalizedFileType(file: File): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WEBP' };
  return types[extension] || 'PDF';
}

export function ExtractPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(s.clients[0]?.id || '');
  const [category, setCategory] = useState('GST');
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<RunStep>('idle');
  const [fallbackProgress, setFallbackProgress] = useState<OpenRouterFallbackProgress | null>(null);
  const [message, setMessage] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
  const [approved, setApproved] = useState(false);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientFiles, setClientFiles] = useState<DocumentItem[]>([]);
  const [clientFilesLoading, setClientFilesLoading] = useState(false);
  const [clientFilesError, setClientFilesError] = useState('');
  const [progress, setProgress] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>(navigator.onLine ? 'online' : 'offline');
  const requestController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const timeoutReached = useRef(false);
  const client = useMemo(() => s.clients.find((item) => item.id === clientId), [clientId, s.clients]);
  const isBusy = step === 'uploading' || step === 'extracting' || step === 'saving';
  const resultEntries = extracted ? Object.entries(extracted) : [];

  useEffect(() => {
    const markOffline = () => setConnectionState('offline');
    const markOnline = () => {
      setConnectionState('reconnecting');
      window.setTimeout(() => setConnectionState('online'), 900);
    };
    window.addEventListener('offline', markOffline);
    window.addEventListener('online', markOnline);
    return () => {
      window.removeEventListener('offline', markOffline);
      window.removeEventListener('online', markOnline);
    };
  }, []);

  useEffect(() => { if (!clientId && s.clients[0]) setClientId(s.clients[0].id); }, [clientId, s.clients]);

  useEffect(() => {
    if (!clientId) { setClientFiles([]); return; }
    const controller = new AbortController();
    setClientFilesLoading(true); setClientFilesError('');
    fetchClientDocuments(clientId, controller.signal)
      .then(setClientFiles)
      .catch((error) => { if (error?.name !== 'AbortError') { setClientFiles([]); setClientFilesError(error?.message || 'Could not load this client’s files.'); } })
      .finally(() => { if (!controller.signal.aborted) setClientFilesLoading(false); });
    return () => controller.abort();
  }, [clientId]);

  const clientCategories = useMemo(() => Array.from(new Set(clientFiles.map((item) => item.category).filter(Boolean))), [clientFiles]);
  const suggestedCategories = clientCategories.length ? CATEGORIES.filter(([value]) => clientCategories.includes(value)).slice(0, 3) : CATEGORIES.slice(0, 3);

  function chooseFile(nextFile?: File) {
    const selected = nextFile || inputRef.current?.files?.[0];
    if (!selected) return;
    const extension = selected.name.split('.').pop()?.toLowerCase();
    if (!extension || !['pdf', 'png', 'jpg', 'jpeg', 'webp'].includes(extension)) { setMessage('Validation: choose a PDF, PNG, JPG, JPEG, or WEBP file.'); setStep('error'); return; }
    if (!selected.size) { setMessage('Validation: the selected file is empty. Choose a file with content and try again.'); setStep('error'); return; }
    if (selected.size > 20 * 1024 * 1024) { setMessage('Validation: files must be 20 MB or smaller. Choose a smaller file and try again.'); setStep('error'); return; }
    setFile(selected); setMessage(''); setStep('idle'); setExtracted(null); setApproved(false);
  }

  function cancelExtraction() {
    if (!isBusy) return;
    cancelRequested.current = true;
    requestController.current?.abort();
    setProgress(0);
    setStep(documentId ? 'error' : 'idle');
    setMessage(documentId
      ? 'Partial success: the original file was uploaded securely, but processing was canceled. Retry extraction when ready.'
      : 'Upload canceled. Choose a file whenever you are ready.');
  }

  async function startExtraction() {
    if (!client || !file || isBusy || connectionState === 'offline') return;
    setMessage(''); setExtracted(null); setApproved(false);
    setFallbackProgress(null);
    setProgress(0);
    cancelRequested.current = false;
    const controller = new AbortController();
    requestController.current = controller;
    timeoutReached.current = false;
    const timeoutId = window.setTimeout(() => { timeoutReached.current = true; controller.abort(); }, 90_000);
    let uploadedId = '';
    try {
      const useLocalOpenRouter = isUsingLocalOpenRouterKey();
      if (useLocalOpenRouter) validateOpenRouterExtractionFile(file);
      setStep('uploading');
      const upload = await uploadDocument({ clientId: client.id, fileName: file.name, fileType: normalizedFileType(file), category, fileBase64: await fileToBase64(file, controller.signal), source: 'Upload', signal: controller.signal });
      const id = upload.data?.id;
      if (!id) throw new Error('The file was saved, but no document ID was returned for extraction.');
      uploadedId = id;
      setDocumentId(id); setProgress(35); setStep('extracting');
      const result = await processDocumentExtraction(id, category, file, (fallback) => { setFallbackProgress(fallback); setProgress(Math.min(84, 35 + Math.round((fallback.attempt / fallback.maxAttempts) * 49))); }, client.name, upload.data?.created_at, client.id, useLocalOpenRouter, controller.signal);
      setStep('saving');
      setProgress(92);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const extractedData = result.data?.extracted_data;
      if (!extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData)) {
        throw new Error('The extraction service did not return valid structured fields. The original file is still stored safely.');
      }
      setExtracted(extractedData);
      setMessage(result.message || 'Draft fields saved for review. They are not approved invoice data.');
      setProgress(100);
      setStep('done');
      emitToast({ kind: 'success', title: 'Extraction complete', message: `${file.name} is ready for human review.`, eventType: 'extraction.completed', entityType: 'document', entityId: uploadedId });
    } catch (error) {
      if (cancelRequested.current || (error instanceof DOMException && error.name === 'AbortError' && !timeoutReached.current)) return;
      const detail = error instanceof Error ? error.message : 'Something went wrong while processing this file.';
      const isConnectivity = /unavailable|could not be reached|connection|timed out|timeout/i.test(detail);
      if (!navigator.onLine || isConnectivity) setConnectionState(navigator.onLine ? 'reconnecting' : 'offline');
      setStep('error');
      const statusMessage = timeoutReached.current
        ? 'Timeout: processing took longer than 90 seconds. The original file is safe in private storage; retry when the service is available.'
        : /maintenance|temporarily unavailable|HTTP 503/i.test(detail)
          ? `Maintenance: the extraction service is temporarily unavailable. ${uploadedId ? 'Your original file is safe in private storage. ' : ''}Please retry shortly.`
          : uploadedId
            ? `Partial success: the original file is safe in private storage, but processing did not finish. ${detail} Retry extraction when the service is available.`
            : detail;
      setMessage(statusMessage);
      emitToast({ kind: timeoutReached.current ? 'warning' : 'error', title: timeoutReached.current ? 'Extraction timed out' : 'Extraction could not finish', message: statusMessage, eventType: timeoutReached.current ? 'extraction.timeout' : 'extraction.failed', entityType: uploadedId ? 'document' : null, entityId: uploadedId || null });
    } finally { window.clearTimeout(timeoutId); requestController.current = null; setFallbackProgress(null); }
  }

  async function approveExtraction() {
    if (!documentId || approved || !client) return;
    const data = extracted || {};
    dispatch({ type: 'OPEN_EXTRACTION_REVIEW', payload: { documentId, clientId: client.id, fileName: file?.name || 'Document', category, extractedData: data } });
  }

  return <div className="extract-workspace">
    {isBusy && <div className="extract-progress" role="status" aria-live="polite"><div className="extract-progress-head"><b>{file?.name}</b><span>{(file ? file.size / 1024 / 1024 : 0).toFixed(2)} MB · {progress}%</span></div><progress max="100" value={progress} aria-label={`Upload and processing progress: ${progress}%`} /><div className="extract-progress-foot"><span>{step === 'uploading' ? 'Uploading securely' : step === 'extracting' ? 'Processing document' : 'Saving structured result'}</span><button className="btn gh sm" onClick={cancelExtraction}>Cancel</button></div></div>}
    <div className="ph extract-header"><div><div className="eyebrow"><span className="eyebrow-dot" />AI DOCUMENT WORKSPACE</div><h1>Extract with confidence</h1><p>Upload a document and choose whether to use the Orvexa AI service or your local OpenRouter key in Settings.</p></div><div className="extract-header-status"><span className="status-pulse" />Cloud &amp; AI ready</div></div>
    {connectionState !== 'online' && <div className={`extract-connectivity ${connectionState}`} role="status" aria-live="polite"><Icon name={connectionState === 'offline' ? 'globe' : 'refresh'} size={14} className={connectionState === 'reconnecting' ? 'ic spin' : 'ic'} /><div><b>{connectionState === 'offline' ? 'You are offline' : 'Reconnecting to Orvexa'}</b><span>{connectionState === 'offline' ? 'Uploads and cloud processing are paused. Check your network; your local file selection is still available.' : 'We are restoring the connection. Keep this page open and retry when the status returns online.'}</span></div></div>}
    {!s.clients.length ? <section className="card extract-no-client-state" aria-labelledby="extract-empty-title">
      <div className="extract-no-client-visual"><div className="pipeline-orb"><Icon name="spark" size={27} /></div><span><Icon name="folder" size={13} /></span><span><Icon name="file" size={13} /></span></div>
      <div className="extract-no-client-copy"><span className="eyebrow"><span className="eyebrow-dot" />READY WHEN YOU ARE</span><h2 id="extract-empty-title">Add a client before extracting</h2><p>Every document is linked to a client workspace first. Create one to keep files, extracted fields, and review history organized and private.</p><button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}><Icon name="users" size={14} />Go to Clients</button></div>
      <div className="extract-no-client-note"><Icon name="lock" size={15} /><div><b>Your files stay organized</b><span>Once a client is added, original documents are stored in the private Supabase bucket until processing and review are complete.</span></div></div>
    </section> : <div className="extract-layout">
      <section className="card extract-setup"><div className="card-h"><div><span className="section-kicker">01 / SOURCE</span><h2>Set up extraction</h2></div><span className="chip cyan"><Icon name="spark" size={12} />AI assisted</span></div><div className="card-b">
        <label className="extract-label">Client</label><div className={`vault-client-select extract-client-select ${clientMenuOpen ? 'menu-open' : ''}`} title="Select client" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setClientMenuOpen(false); }}><button className="vault-client-name" onClick={() => !isBusy && s.clients.length && setClientMenuOpen(value => !value)} disabled={isBusy || !s.clients.length} aria-haspopup="listbox" aria-expanded={clientMenuOpen}><Icon name="users" size={15} />{client?.name || 'Select a client'}</button><span className="vault-client-arrow" aria-hidden="true" />{clientMenuOpen && s.clients.length > 0 && <div className="vault-client-menu" role="listbox">{s.clients.map(item => <button key={item.id} className={`vault-client-option ${item.id === client?.id ? 'active' : ''}`} role="option" aria-selected={item.id === client?.id} onClick={() => { setClientId(item.id); setClientMenuOpen(false); }}>{item.name}{item.id === client?.id && <Icon name="check" size={13} />}</button>)}</div>}</div>
        <div className="client-file-context"><div className="client-context-head"><span><Icon name="folder" size={13} />{client?.name || 'Client'} workspace</span>{!clientFilesLoading && <small>{clientFiles.length} file{clientFiles.length === 1 ? '' : 's'}</small>}</div>{clientFilesLoading ? <div className="client-context-skeleton"><i /><i /><i /></div> : clientFilesError ? <div className="client-context-error"><Icon name="bell" size={13} /><span>{clientFilesError}</span></div> : <><small className="client-context-caption">Suggested document types for this client</small><div className="suggestion-pills">{suggestedCategories.map(([value, label]) => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)} disabled={isBusy}><Icon name={value === 'GST' ? 'file' : 'scan'} size={12} />{label}<span>Suggested</span></button>)}</div></>}</div>
        <label className="extract-label">Document type</label><div className="category-grid">{CATEGORIES.map(([value, label]) => <button key={value} className={'category-choice' + (category === value ? ' selected' : '')} onClick={() => setCategory(value)} disabled={isBusy}><span>{label}</span><small>{value === 'GST' ? 'Invoice fields' : 'Structured fields'}</small>{category === value && <Icon name="check" size={13} />}</button>)}</div>
        <div className="upload-dropzone" onClick={() => !isBusy && inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}><input ref={inputRef} className="vault-file-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={() => chooseFile()} /><div className="upload-icon"><Icon name="upload" size={20} /></div>{file ? <><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(2)} MB · Ready to upload</small></> : <><b>Drop a file here</b><small>or click to open file explorer · PDF, PNG, JPG, or WEBP · max 20 MB</small></>}</div>
        <div className="extract-security"><Icon name="check" size={14} /><span>Files stay in the selected client’s private <b>Raw</b> vault until processing is complete.</span></div><button className="btn pri extract-cta" disabled={!client || !file || isBusy} onClick={() => void startExtraction()}><Icon name={isBusy ? 'refresh' : 'spark'} size={15} className={isBusy ? 'ic spin' : 'ic'} />{isBusy ? 'Processing securely…' : 'Upload &amp; extract'}</button>{fallbackProgress && <div className="ai-fallback-status" role="status" aria-live="polite">Auto-trying {fallbackProgress.nextModel} ({fallbackProgress.attempt} of {fallbackProgress.maxAttempts}) after {fallbackProgress.failedModel} failed. {fallbackProgress.waitMs > 0 ? `Waiting ${Math.ceil(fallbackProgress.waitMs / 1000)}s. ` : ''}{fallbackProgress.reason}</div>}{message && <div className={'extract-message ' + (step === 'error' ? 'error' : step === 'done' ? 'success' : 'warning')}><Icon name={step === 'error' ? 'x' : step === 'done' ? 'check' : 'clock'} size={14} /><span>{message}</span></div>}
      </div></section>
      <section className="card extract-progress-card"><div className="card-h"><div><span className="section-kicker">02 / PIPELINE</span><h2>Processing timeline</h2></div><span className="mono extract-doc-id">{documentId ? documentId.slice(0, 14) : 'WAITING'}</span></div><div className="card-b"><div className="pipeline-intro"><div className="pipeline-orb"><Icon name="spark" size={22} /></div><div><b>{step === 'done' ? 'Extraction complete' : step === 'error' ? 'Needs attention' : isBusy ? 'Your document is being prepared' : 'Ready when you are'}</b><small>{step === 'done' ? 'Your structured result is open on the right.' : 'Every step is handled by the secure backend.'}</small></div></div><div className="pipeline-steps">{[['uploading', 'Save original to cloud', 'Secured in the private bucket'], ['extracting', 'AI extraction', 'Server-side vision model'], ['saving', 'Save structured result', 'Stored in Supabase metadata']].map(([id, title, sub], index) => { const active = step === id; const complete = step === 'done' || (step === 'saving' && index < 2) || (step === 'extracting' && index === 0); return <div className={'pipeline-step ' + (active ? 'active' : '') + (complete ? 'complete' : '')} key={id}><div className="pipeline-marker">{complete ? <Icon name="check" size={13} /> : <span>{index + 1}</span>}</div><div><b>{title}</b><small>{sub}</small></div>{active && <i className="spin" />}</div>; })}</div><div className="pipeline-note"><Icon name="bolt" size={14} /><span>Short, structured instructions are applied automatically for consistent tax data.</span></div></div></section>
      <section className="card extract-result-card"><div className="card-h"><div><span className="section-kicker">03 / REVIEW</span><h2>Extracted data</h2></div><span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? <><Icon name="check" size={12} />Human verified</> : <><span className="warning-dot" />Review required</>}</span></div><div className="card-b">{!extracted ? <div className="result-empty"><div className="result-empty-icon"><Icon name="table" size={22} /></div><b>Your structured result will appear here</b><span>AI extraction is a draft. Compare all fields with the original before approval.</span></div> : <><div className="result-file-bar"><div className="file-mark"><Icon name="file" size={15} /></div><div><b>{file?.name}</b><small>{client?.name} · {category} · Draft for human review</small></div><span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? 'Human verified' : 'Review required'}</span></div><div className="extracted-fields">{resultEntries.map(([key, value]) => <div className="extracted-field" key={key}><small>{prettyKey(key)}</small><strong>{value === null || value === '' ? 'Not detected' : Array.isArray(value) ? `${value.length} items` : typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong><span className="confidence-line"><i /><em>{value === null || value === '' ? 'Needs review' : 'Check original'}</em></span></div>)}</div><div className="result-actions"><button className="btn gh" onClick={() => setExtracted(null)}>Discard</button><button className="btn pri" disabled={approved} onClick={() => void approveExtraction()}><Icon name="check" size={14} />{approved ? 'Review complete' : 'Review & approve'}</button></div></>}</div></section>
    </div>}
  </div>;
}
