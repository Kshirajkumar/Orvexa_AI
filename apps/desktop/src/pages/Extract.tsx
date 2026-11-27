import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import {
  fetchClientDocuments,
  fetchClientDocumentTree,
  fetchCloudDocumentFile,
  processDocumentExtraction,
  resolveAiProvider,
  uploadDocument,
  type DocumentItem,
  type DocumentTreeEntry,
} from '../lib/api';
import { type OpenRouterFallbackProgress } from '../lib/openRouter';
import { emitToast } from '../lib/toast';
import '../styles/extract.css';

type SourceMode = 'upload' | 'cloud';
type QueueItemStatus = 'queued' | 'uploading' | 'extracting' | 'saving' | 'done' | 'error' | 'canceled';
type ConnectionState = 'online' | 'offline' | 'reconnecting';

interface RawCloudFile {
  documentId: string;
  fileName: string;
  folderPath: string;
  sizeBytes: number;
  modifiedAt: string;
  category?: string;
  extractionStatus: string;
  isSupportedFormat: boolean;
}

interface QueueItem {
  id: string;
  source: SourceMode;
  clientId: string;
  clientName: string;
  fileName: string;
  fileSizeBytes: number;
  folderPath?: string;
  localFile?: File;
  documentId?: string;
  category: string;
  status: QueueItemStatus;
  progress: number;
  error?: string;
  message?: string;
  extractedData?: Record<string, unknown>;
  approved?: boolean;
}

const CATEGORIES = [
  ['GST', 'GST invoice'],
  ['Form16', 'Form 16'],
  ['ITR1', 'ITR-1 (Sahaj)'],
  ['ITR2', 'ITR-2'],
  ['BankStatement', 'Bank statement'],
  ['Notice', 'Tax notice'],
  ['General', 'Other document'],
];

const ALLOWED_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp']);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

function getFileExtensionWithDot(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(lastDot).toLowerCase() : '';
}

function normalizeClipboardFile(file: File): File {
  const trimmedName = (file.name || '').trim();
  const currentExt = getFileExtensionWithDot(trimmedName);
  const mappedExt = MIME_TO_EXTENSION[(file.type || '').toLowerCase()] || '';
  const isGenericName = !trimmedName || trimmedName === 'blob' || trimmedName === 'image.png' || trimmedName === 'image';

  if (isGenericName && mappedExt) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const prefix = file.type.startsWith('image/') ? 'pasted-image' : 'pasted-document';
    return new File([file], `${prefix}-${stamp}${mappedExt}`, {
      type: file.type,
      lastModified: file.lastModified || Date.now(),
    });
  }

  if (!currentExt && mappedExt) {
    return new File([file], `${trimmedName}${mappedExt}`, {
      type: file.type,
      lastModified: file.lastModified || Date.now(),
    });
  }

  return file;
}

function validatePastedFile(file: File): string | null {
  if (!file.size || file.size <= 0) {
    return `“${file.name || 'This file'}” is empty (0 bytes) and cannot be extracted.`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name || 'This file'}: exceeds 20 MB limit.`;
  }
  const mime = (file.type || '').toLowerCase();
  const hasSupportedExt = isSupportedFileName(file.name);
  const hasSupportedMime = !mime || mime === 'application/octet-stream' || Boolean(MIME_TO_EXTENSION[mime]);
  if (!hasSupportedExt || !hasSupportedMime) {
    return `${file.name || 'Pasted file'}: unsupported format (use PDF, PNG, JPG, JPEG, or WEBP).`;
  }
  return null;
}

function extractClipboardFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const collected: File[] = [];
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i += 1) {
      const file = clipboardData.files.item(i);
      if (file) collected.push(file);
    }
    return collected;
  }
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i += 1) {
      const item = clipboardData.items[i];
      if (item && item.kind === 'file') {
        const file = item.getAsFile();
        if (file) collected.push(file);
      }
    }
  }
  return collected;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

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

function prettyKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizedFileType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = { pdf: 'PDF', png: 'PNG', jpg: 'JPG', jpeg: 'JPEG', webp: 'WEBP' };
  return types[extension] || 'PDF';
}

function mimeTypeFromFileName(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatShortDate(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function isSupportedFileName(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  return ALLOWED_EXTENSIONS.has(extension);
}

function collectRawFolderFiles(entries: DocumentTreeEntry[], parentSegments: string[] = []): RawCloudFile[] {
  const collected: RawCloudFile[] = [];
  for (const entry of entries) {
    if (entry.type === 'folder') {
      const nextSegments = [...parentSegments, entry.name];
      if (entry.children?.length) {
        collected.push(...collectRawFolderFiles(entry.children, nextSegments));
      }
      continue;
    }
    const inRawFolder = parentSegments.some((segment) => segment.toLowerCase() === 'raw');
    if (!inRawFolder || !entry.documentId) continue;
    collected.push({
      documentId: entry.documentId,
      fileName: entry.name,
      folderPath: parentSegments.length ? `/${parentSegments.join('/')}` : '/Raw',
      sizeBytes: Number(entry.size || 0),
      modifiedAt: entry.modifiedAt,
      category: entry.category,
      extractionStatus: entry.extraction?.status || 'uploaded',
      isSupportedFormat: isSupportedFileName(entry.name),
    });
  }
  return collected.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
}

function rawStatusBadge(status: string): { label: string; tone: 'green' | 'cyan' | 'amber' | 'neutral' } {
  if (status === 'approved') return { label: 'Approved', tone: 'green' };
  if (status === 'ai_extracted') return { label: 'Extracted', tone: 'cyan' };
  if (status === 'processing') return { label: 'Processing', tone: 'amber' };
  return { label: 'Ready', tone: 'neutral' };
}

function localFileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function createQueueId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ExtractPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  const [clientId, setClientId] = useState(s.clients[0]?.id || '');
  const [category, setCategory] = useState('GST');
  const [sourceMode, setSourceMode] = useState<SourceMode>('upload');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [pastedFile, setPastedFile] = useState<File | null>(null);
  const [pastedPreviewUrl, setPastedPreviewUrl] = useState<string | null>(null);
  const [pasteCardNote, setPasteCardNote] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const [rawFiles, setRawFiles] = useState<RawCloudFile[]>([]);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState('');
  const [rawSearch, setRawSearch] = useState('');
  const [selectedRawIds, setSelectedRawIds] = useState<string[]>([]);
  const [rawRefreshNonce, setRawRefreshNonce] = useState(0);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeResultId, setActiveResultId] = useState('');
  const [fallbackProgress, setFallbackProgress] = useState<OpenRouterFallbackProgress | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<{ kind: 'error' | 'success' | 'warning'; text: string } | null>(null);

  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [clientFiles, setClientFiles] = useState<DocumentItem[]>([]);
  const [clientFilesLoading, setClientFilesLoading] = useState(false);
  const [clientFilesError, setClientFilesError] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>(navigator.onLine ? 'online' : 'offline');

  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;
  const queueRunningRef = useRef(false);
  const requestController = useRef<AbortController | null>(null);
  const pasteConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRequested = useRef(false);
  const timeoutReached = useRef(false);

  const client = useMemo(() => s.clients.find((item) => item.id === clientId), [clientId, s.clients]);
  const activeItem = useMemo(
    () => queue.find((item) => item.status === 'uploading' || item.status === 'extracting' || item.status === 'saving') || null,
    [queue],
  );
  const queuedItems = useMemo(() => queue.filter((item) => item.status === 'queued'), [queue]);
  const finishedItems = useMemo(
    () => queue.filter((item) => item.status === 'done' || item.status === 'error' || item.status === 'canceled'),
    [queue],
  );
  const isBusy = Boolean(activeItem);

  const activeResultItem = useMemo(() => {
    if (activeResultId) {
      const match = queue.find((item) => item.id === activeResultId && item.status === 'done' && item.extractedData);
      if (match) return match;
    }
    return [...queue].reverse().find((item) => item.status === 'done' && item.extractedData) || null;
  }, [activeResultId, queue]);

  const resultEntries = activeResultItem?.extractedData ? Object.entries(activeResultItem.extractedData) : [];

  const clearPastedFile = useCallback(() => {
    setPastedFile(null);
    setPasteCardNote('');
  }, []);

  useEffect(() => {
    if (!pastedFile || !pastedFile.type.startsWith('image/')) {
      setPastedPreviewUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(pastedFile);
    setPastedPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [pastedFile]);

  useEffect(() => {
    if (!pastedFile) return undefined;
    pasteConfirmButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clearPastedFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearPastedFile, pastedFile]);

  useEffect(() => {
    if (!s.clients.length) return undefined;
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const files = extractClipboardFiles(event.clipboardData);
      if (!files.length) return;

      event.preventDefault();
      if (!client) {
        setNoticeMessage({ kind: 'warning', text: 'Select a client before pasting a file for extraction.' });
        return;
      }
      if (isBusy || queueRunningRef.current) {
        setNoticeMessage({ kind: 'warning', text: 'Please wait for the active extraction queue to finish before pasting a new file.' });
        return;
      }

      const normalized = normalizeClipboardFile(files[0]);
      const validationError = validatePastedFile(normalized);
      if (validationError) {
        clearPastedFile();
        setNoticeMessage({ kind: 'error', text: validationError });
        return;
      }

      setNoticeMessage(null);
      setPasteCardNote(
        files.length > 1
          ? `1 of ${files.length} clipboard files selected (previewing the first file).`
          : '',
      );
      setPastedFile(normalized);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [clearPastedFile, client, isBusy, s.clients.length]);

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

  useEffect(() => {
    if (!clientId && s.clients[0]) setClientId(s.clients[0].id);
  }, [clientId, s.clients]);

  useEffect(() => {
    if (!clientId) {
      setClientFiles([]);
      setRawFiles([]);
      setSelectedRawIds([]);
      return;
    }
    const controller = new AbortController();
    setClientFilesLoading(true);
    setClientFilesError('');
    fetchClientDocuments(clientId, controller.signal)
      .then(setClientFiles)
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setClientFiles([]);
          setClientFilesError(error?.message || 'Could not load this client’s files.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setClientFilesLoading(false);
      });

    setRawLoading(true);
    setRawError('');
    fetchClientDocumentTree(clientId, controller.signal)
      .then((tree) => {
        if (controller.signal.aborted) return;
        const found = collectRawFolderFiles(tree.entries || []);
        setRawFiles(found);
        setSelectedRawIds((prev) => prev.filter((id) => found.some((file) => file.documentId === id && file.isSupportedFormat)));
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setRawFiles([]);
          setRawError(error?.message || 'Could not load files from the client’s Raw folder.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRawLoading(false);
      });

    return () => controller.abort();
  }, [clientId, rawRefreshNonce]);

  const clientCategories = useMemo(
    () => Array.from(new Set(clientFiles.map((item) => item.category).filter(Boolean))),
    [clientFiles],
  );
  const suggestedCategories = clientCategories.length
    ? CATEGORIES.filter(([value]) => clientCategories.includes(value)).slice(0, 3)
    : CATEGORIES.slice(0, 3);

  const visibleRawFiles = useMemo(() => {
    const q = rawSearch.trim().toLowerCase();
    if (!q) return rawFiles;
    return rawFiles.filter(
      (item) =>
        item.fileName.toLowerCase().includes(q) ||
        item.folderPath.toLowerCase().includes(q) ||
        (item.category || '').toLowerCase().includes(q),
    );
  }, [rawFiles, rawSearch]);

  const supportedVisibleRawIds = useMemo(
    () => visibleRawFiles.filter((item) => item.isSupportedFormat).map((item) => item.documentId),
    [visibleRawFiles],
  );

  function addLocalFiles(fileList: FileList | File[] | null | undefined) {
    if (!fileList || isBusy) return;
    const incoming = Array.from(fileList);
    if (!incoming.length) return;

    const existingKeys = new Set(stagedFiles.map(localFileKey));
    const accepted: File[] = [];
    const rejectedMessages: string[] = [];

    for (const candidate of incoming) {
      if (!isSupportedFileName(candidate.name)) {
        rejectedMessages.push(`${candidate.name}: unsupported format (use PDF, PNG, JPG, JPEG, or WEBP).`);
        continue;
      }
      if (!candidate.size) {
        rejectedMessages.push(`${candidate.name}: file is empty.`);
        continue;
      }
      if (candidate.size > MAX_FILE_BYTES) {
        rejectedMessages.push(`${candidate.name}: exceeds 20 MB limit.`);
        continue;
      }
      const key = localFileKey(candidate);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      accepted.push(candidate);
    }

    if (accepted.length) {
      setStagedFiles((prev) => [...prev, ...accepted]);
    }
    if (rejectedMessages.length) {
      setNoticeMessage({ kind: 'error', text: rejectedMessages.slice(0, 2).join(' ') });
    } else {
      setNoticeMessage(null);
    }
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeStagedFile(target: File) {
    const key = localFileKey(target);
    setStagedFiles((prev) => prev.filter((item) => localFileKey(item) !== key));
  }

  function toggleRawFile(documentId: string) {
    setSelectedRawIds((prev) =>
      prev.includes(documentId) ? prev.filter((id) => id !== documentId) : [...prev, documentId],
    );
    setNoticeMessage(null);
  }

  function toggleSelectAllRaw() {
    if (!supportedVisibleRawIds.length) return;
    const allSelected = supportedVisibleRawIds.every((id) => selectedRawIds.includes(id));
    if (allSelected) {
      setSelectedRawIds((prev) => prev.filter((id) => !supportedVisibleRawIds.includes(id)));
    } else {
      setSelectedRawIds((prev) => Array.from(new Set([...prev, ...supportedVisibleRawIds])));
    }
  }

  const updateQueueItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const runQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    cancelRequested.current = false;

    try {
      while (!cancelRequested.current) {
        const nextItem = queueRef.current.find((item) => item.status === 'queued');
        if (!nextItem) break;

        const controller = new AbortController();
        requestController.current = controller;
        timeoutReached.current = false;
        setFallbackProgress(null);

        const timeoutId = window.setTimeout(() => {
          timeoutReached.current = true;
          controller.abort();
        }, 90_000);

        let currentDocId = nextItem.documentId || '';

        try {
          const useLocalOpenRouter = (await resolveAiProvider()) === 'local';
          let fileForExtraction = nextItem.localFile;

          if (nextItem.source === 'upload') {
            if (!nextItem.localFile) {
              throw new Error('The selected local file is no longer available.');
            }
            updateQueueItem(nextItem.id, { status: 'uploading', progress: 15, error: undefined, message: undefined });
            const upload = await uploadDocument({
              clientId: nextItem.clientId,
              fileName: nextItem.localFile.name,
              fileType: normalizedFileType(nextItem.localFile.name),
              category: nextItem.category,
              fileBase64: await fileToBase64(nextItem.localFile, controller.signal),
              source: 'Upload',
              signal: controller.signal,
            });
            const uploadedId = upload.data?.id;
            if (!uploadedId) {
              throw new Error('The file was saved, but no document ID was returned for extraction.');
            }
            currentDocId = uploadedId;
            updateQueueItem(nextItem.id, {
              documentId: uploadedId,
              status: 'extracting',
              progress: 35,
            });
          } else {
            if (!currentDocId) {
              throw new Error('Missing cloud document reference.');
            }
            updateQueueItem(nextItem.id, { status: 'extracting', progress: 25, error: undefined, message: undefined });
            const isPdf = nextItem.fileName.toLowerCase().endsWith('.pdf');
            if (useLocalOpenRouter && !fileForExtraction && !isPdf) {
              const blob = await fetchCloudDocumentFile(currentDocId, undefined, controller.signal);
              fileForExtraction = new File([blob], nextItem.fileName, {
                type: blob.type || mimeTypeFromFileName(nextItem.fileName),
              });
            }
          }

          const result = await processDocumentExtraction(
            currentDocId,
            nextItem.category,
            fileForExtraction,
            (fallback) => {
              setFallbackProgress(fallback);
              updateQueueItem(nextItem.id, {
                progress: Math.min(84, 35 + Math.round((fallback.attempt / fallback.maxAttempts) * 49)),
              });
            },
            nextItem.clientName,
            undefined,
            nextItem.clientId,
            useLocalOpenRouter,
            controller.signal,
          );

          updateQueueItem(nextItem.id, { status: 'saving', progress: 92 });
          await new Promise((resolve) => window.setTimeout(resolve, 350));

          const extractedData = result.data?.extracted_data;
          if (!extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData)) {
            throw new Error('The extraction service did not return valid structured fields. The original file is still stored safely.');
          }

          const doneMessage = result.message || 'Draft fields saved for review. They are not approved invoice data.';
          updateQueueItem(nextItem.id, {
            status: 'done',
            progress: 100,
            extractedData,
            message: doneMessage,
            documentId: currentDocId,
          });
          setActiveResultId(nextItem.id);
          setRawRefreshNonce((n) => n + 1);

          emitToast({
            kind: 'success',
            title: 'Extraction complete',
            message: `${nextItem.fileName} is ready for human review.`,
            eventType: 'extraction.completed',
            entityType: 'document',
            entityId: currentDocId,
          });
        } catch (error) {
          if (cancelRequested.current || (error instanceof DOMException && error.name === 'AbortError' && !timeoutReached.current)) {
            updateQueueItem(nextItem.id, {
              status: 'canceled',
              progress: 0,
              documentId: currentDocId || nextItem.documentId,
              error: currentDocId
                ? 'Canceled. The original file is safe in private storage; retry when ready.'
                : 'Canceled before upload finished.',
            });
            break;
          }

          const detail = error instanceof Error ? error.message : 'Something went wrong while processing this file.';
          const isConnectivity = /unavailable|could not be reached|connection|timed out|timeout/i.test(detail);
          if (!navigator.onLine || isConnectivity) {
            setConnectionState(navigator.onLine ? 'reconnecting' : 'offline');
          }

          const statusMessage = timeoutReached.current
            ? 'Timeout: processing took longer than 90 seconds. The original file is safe in private storage; retry when ready.'
            : /maintenance|temporarily unavailable|HTTP 503/i.test(detail)
              ? `Service temporarily unavailable. ${currentDocId ? 'Your original file is safe in private storage. ' : ''}Please retry shortly.`
              : currentDocId && nextItem.source === 'upload'
                ? `Saved to cloud, but extraction did not finish: ${detail}`
                : detail;

          updateQueueItem(nextItem.id, {
            status: 'error',
            progress: 0,
            documentId: currentDocId || nextItem.documentId,
            error: statusMessage,
          });

          emitToast({
            kind: timeoutReached.current ? 'warning' : 'error',
            title: timeoutReached.current ? 'Extraction timed out' : 'Extraction could not finish',
            message: `${nextItem.fileName}: ${statusMessage}`,
            eventType: timeoutReached.current ? 'extraction.timeout' : 'extraction.failed',
            entityType: currentDocId ? 'document' : null,
            entityId: currentDocId || null,
          });
        } finally {
          window.clearTimeout(timeoutId);
          requestController.current = null;
          setFallbackProgress(null);
        }
      }
    } finally {
      queueRunningRef.current = false;
      if (cancelRequested.current) {
        setQueue((prev) =>
          prev.map((item) =>
            item.status === 'queued'
              ? { ...item, status: 'canceled', error: 'Canceled before processing started.' }
              : item,
          ),
        );
      }
    }
  }, [updateQueueItem]);

  function startExtraction() {
    if (!client || connectionState === 'offline' || queueRunningRef.current || isBusy) return;

    const existingActiveKeys = new Set(
      queue
        .filter((item) => item.status === 'queued' || item.status === 'uploading' || item.status === 'extracting' || item.status === 'saving')
        .map((item) => (item.documentId ? `doc:${item.documentId}` : item.localFile ? `file:${localFileKey(item.localFile)}` : item.id)),
    );

    const newItems: QueueItem[] = [];

    if (sourceMode === 'upload') {
      if (!stagedFiles.length) return;
      for (const localFile of stagedFiles) {
        const key = `file:${localFileKey(localFile)}`;
        if (existingActiveKeys.has(key)) continue;
        existingActiveKeys.add(key);
        newItems.push({
          id: createQueueId(),
          source: 'upload',
          clientId: client.id,
          clientName: client.name,
          fileName: localFile.name,
          fileSizeBytes: localFile.size,
          localFile,
          category,
          status: 'queued',
          progress: 0,
        });
      }
      setStagedFiles([]);
    } else {
      if (!selectedRawIds.length) return;
      for (const docId of selectedRawIds) {
        const rawDoc = rawFiles.find((item) => item.documentId === docId);
        if (!rawDoc || !rawDoc.isSupportedFormat) continue;
        const key = `doc:${rawDoc.documentId}`;
        if (existingActiveKeys.has(key)) continue;
        existingActiveKeys.add(key);
        newItems.push({
          id: createQueueId(),
          source: 'cloud',
          clientId: client.id,
          clientName: client.name,
          fileName: rawDoc.fileName,
          fileSizeBytes: rawDoc.sizeBytes,
          folderPath: rawDoc.folderPath,
          documentId: rawDoc.documentId,
          category,
          status: 'queued',
          progress: 0,
        });
      }
      setSelectedRawIds([]);
    }

    if (!newItems.length) {
      setNoticeMessage({ kind: 'warning', text: 'Selected files are already in the active extraction queue.' });
      return;
    }

    setNoticeMessage(null);
    const updatedQueue = [...queueRef.current, ...newItems];
    queueRef.current = updatedQueue;
    setQueue(updatedQueue);
    void runQueue();
  }

  function startPastedExtraction() {
    if (!pastedFile || !client || connectionState === 'offline' || queueRunningRef.current || isBusy) return;

    const existingActiveKeys = new Set(
      queueRef.current
        .filter((item) => item.status === 'queued' || item.status === 'uploading' || item.status === 'extracting' || item.status === 'saving')
        .map((item) => (item.documentId ? `doc:${item.documentId}` : item.localFile ? `file:${localFileKey(item.localFile)}` : item.id)),
    );

    const key = `file:${localFileKey(pastedFile)}`;
    if (existingActiveKeys.has(key)) {
      clearPastedFile();
      setNoticeMessage({ kind: 'warning', text: 'This file is already in the active extraction queue.' });
      return;
    }

    const newItem: QueueItem = {
      id: createQueueId(),
      source: 'upload',
      clientId: client.id,
      clientName: client.name,
      fileName: pastedFile.name,
      fileSizeBytes: pastedFile.size,
      localFile: pastedFile,
      category,
      status: 'queued',
      progress: 0,
    };

    clearPastedFile();
    setSourceMode('upload');
    setNoticeMessage(null);
    const updatedQueue = [...queueRef.current, newItem];
    queueRef.current = updatedQueue;
    setQueue(updatedQueue);
    void runQueue();
  }

  function cancelActiveQueue() {
    if (!isBusy) return;
    cancelRequested.current = true;
    requestController.current?.abort();
  }

  function removeQueuedItem(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function retryQueueItem(id: string) {
    if (connectionState === 'offline') return;
    const updatedQueue = queueRef.current.map((item) =>
      item.id === id ? { ...item, status: 'queued' as const, progress: 0, error: undefined } : item,
    );
    queueRef.current = updatedQueue;
    setQueue(updatedQueue);
    void runQueue();
  }

  function clearFinishedItems() {
    setQueue((prev) => prev.filter((item) => item.status !== 'done' && item.status !== 'error' && item.status !== 'canceled'));
    if (activeResultItem && activeResultItem.status === 'done') {
      setActiveResultId('');
    }
  }

  async function approveExtraction() {
    if (!activeResultItem?.documentId || activeResultItem.approved) return;
    const data = activeResultItem.extractedData || {};
    dispatch({
      type: 'OPEN_EXTRACTION_REVIEW',
      payload: {
        documentId: activeResultItem.documentId,
        clientId: activeResultItem.clientId,
        fileName: activeResultItem.fileName,
        category: activeResultItem.category,
        extractedData: data,
      },
    });
  }

  const readyCount = sourceMode === 'upload' ? stagedFiles.length : selectedRawIds.length;
  const ctaLabel = isBusy
    ? 'Processing queue…'
    : sourceMode === 'upload'
      ? readyCount > 1
        ? `Upload & extract (${readyCount})`
        : 'Upload & extract'
      : readyCount > 1
        ? `Extract selected (${readyCount})`
        : 'Extract selected';

  return (
    <div className="extract-workspace">
      {activeItem && (
        <div className="extract-progress" role="status" aria-live="polite">
          <div className="extract-progress-head">
            <b>
              {activeItem.fileName}
              {queuedItems.length > 0 ? ` (+${queuedItems.length} in queue)` : ''}
            </b>
            <span>
              {formatSize(activeItem.fileSizeBytes)} · {activeItem.progress}%
            </span>
          </div>
          <progress max="100" value={activeItem.progress} aria-label={`Processing progress: ${activeItem.progress}%`} />
          <div className="extract-progress-foot">
            <span>
              {activeItem.status === 'uploading'
                ? 'Uploading securely to Raw vault'
                : activeItem.status === 'extracting'
                  ? 'Running AI extraction'
                  : 'Saving structured result'}
            </span>
            <button className="btn gh sm" onClick={cancelActiveQueue}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {connectionState !== 'online' && (
        <div className={`extract-connectivity ${connectionState}`} role="status" aria-live="polite">
          <Icon name={connectionState === 'offline' ? 'globe' : 'refresh'} size={14} className={connectionState === 'reconnecting' ? 'ic spin' : 'ic'} />
          <div>
            <b>{connectionState === 'offline' ? 'You are offline' : 'Reconnecting to Orvexa'}</b>
            <span>
              {connectionState === 'offline'
                ? 'Uploads and cloud processing are paused. Check your network; your local file selection is still available.'
                : 'We are restoring the connection. Keep this page open and retry when the status returns online.'}
            </span>
          </div>
        </div>
      )}

      {!s.clients.length ? (
        <section className="card extract-no-client-state" aria-labelledby="extract-empty-title">
          <div className="extract-no-client-visual">
            <div className="pipeline-orb">
              <Icon name="spark" size={27} />
            </div>
            <span>
              <Icon name="folder" size={13} />
            </span>
            <span>
              <Icon name="file" size={13} />
            </span>
          </div>
          <div className="extract-no-client-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              READY WHEN YOU ARE
            </span>
            <h2 id="extract-empty-title">Add a client before extracting</h2>
            <p>
              Every document is linked to a client workspace first. Create one to keep files, extracted fields, and review history organized and private.
            </p>
            <button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}>
              <Icon name="users" size={14} />
              Go to Clients
            </button>
          </div>
          <div className="extract-no-client-note">
            <Icon name="lock" size={15} />
            <div>
              <b>Your files stay organized</b>
              <span>Once a client is added, original documents are stored in the private Supabase bucket until processing and review are complete.</span>
            </div>
          </div>
        </section>
      ) : (
        <div className="extract-layout">
          <div className="extract-left-col">
            <section className="card extract-setup-card">
              <div className="card-h">
                <div>
                  <span className="section-kicker">01 / CLIENT &amp; TYPE</span>
                  <h2>Configure extraction</h2>
                </div>
                <span className="chip cyan">
                  <Icon name="spark" size={12} />
                  AI assisted
                </span>
              </div>
              <div className="card-b">
                <div className="extract-client-row">
                  <div className="extract-client-field">
                    <label className="extract-label">Client</label>
                    <div
                      className={`vault-client-select extract-client-select ${clientMenuOpen ? 'menu-open' : ''}`}
                      title={isBusy ? 'Finish or cancel the active queue before switching clients' : 'Select client'}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setClientMenuOpen(false);
                      }}
                    >
                      <button
                        className="vault-client-name"
                        onClick={() => !isBusy && s.clients.length && setClientMenuOpen((value) => !value)}
                        disabled={isBusy || !s.clients.length}
                        aria-haspopup="listbox"
                        aria-expanded={clientMenuOpen}
                      >
                        <Icon name="users" size={15} />
                        {client?.name || 'Select a client'}
                      </button>
                      <span className="vault-client-arrow" aria-hidden="true" />
                      {clientMenuOpen && s.clients.length > 0 && (
                        <div className="vault-client-menu" role="listbox">
                          {s.clients.map((item) => (
                            <button
                              key={item.id}
                              className={`vault-client-option ${item.id === client?.id ? 'active' : ''}`}
                              role="option"
                              aria-selected={item.id === client?.id}
                              onClick={() => {
                                setClientId(item.id);
                                setClientMenuOpen(false);
                                setSelectedRawIds([]);
                                setRawSearch('');
                                setNoticeMessage(null);
                              }}
                            >
                              {item.name}
                              {item.id === client?.id && <Icon name="check" size={13} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="extract-client-meta-pill" title="Files stored in this client's workspace">
                    <Icon name="folder" size={14} />
                    {clientFilesLoading ? (
                      <span>Loading files…</span>
                    ) : clientFilesError ? (
                      <span>Files unavailable</span>
                    ) : (
                      <span>
                        <strong>{clientFiles.length}</strong> workspace file{clientFiles.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                </div>

                {!clientFilesLoading && !clientFilesError && suggestedCategories.length > 0 && (
                  <div className="extract-suggested-row">
                    <span className="extract-suggested-label">Suggested:</span>
                    {suggestedCategories.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`extract-suggested-pill${category === value ? ' active' : ''}`}
                        onClick={() => setCategory(value)}
                        disabled={isBusy}
                      >
                        <Icon name={value === 'GST' ? 'file' : 'scan'} size={11} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                <label className="extract-label">Document type</label>
                <div className="category-grid">
                  {CATEGORIES.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={'category-choice' + (category === value ? ' selected' : '')}
                      onClick={() => setCategory(value)}
                      disabled={isBusy}
                    >
                      <span>{label}</span>
                      <small>{value === 'GST' ? 'Invoice fields' : 'Structured fields'}</small>
                      {category === value && <Icon name="check" size={13} />}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="card extract-source-card">
              <div className="card-h">
                <div>
                  <span className="section-kicker">02 / SOURCE</span>
                  <h2>Select or upload files</h2>
                </div>
                <div className="extract-source-tabs" role="tablist" aria-label="Document source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceMode === 'upload'}
                    className={`extract-source-tab${sourceMode === 'upload' ? ' active' : ''}`}
                    onClick={() => {
                      setSourceMode('upload');
                      setNoticeMessage(null);
                    }}
                  >
                    <Icon name="upload" size={13} />
                    <span>Upload files</span>
                    {stagedFiles.length > 0 && <em className="source-count">{stagedFiles.length}</em>}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sourceMode === 'cloud'}
                    className={`extract-source-tab${sourceMode === 'cloud' ? ' active' : ''}`}
                    onClick={() => {
                      setSourceMode('cloud');
                      setNoticeMessage(null);
                    }}
                  >
                    <Icon name="folder" size={13} />
                    <span>Client Raw storage</span>
                    <em className="source-count">{rawLoading ? '…' : rawFiles.length}</em>
                  </button>
                </div>
              </div>
              <div className="card-b">
                {sourceMode === 'upload' ? (
                  <>
                    <div
                      className={`upload-dropzone${dragActive ? ' drag-over' : ''}${isBusy ? ' is-busy' : ''}`}
                      onClick={() => !isBusy && inputRef.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!isBusy) setDragActive(true);
                      }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDragActive(false);
                        addLocalFiles(event.dataTransfer.files);
                      }}
                    >
                      <input
                        ref={inputRef}
                        className="vault-file-input"
                        type="file"
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        onChange={(event) => addLocalFiles(event.target.files)}
                      />
                      <div className="upload-icon">
                        <Icon name="upload" size={20} />
                      </div>
                      {stagedFiles.length ? (
                        <>
                          <b>
                            {stagedFiles.length} file{stagedFiles.length === 1 ? '' : 's'} ready to upload
                          </b>
                          <small>Click or drop more files to add to batch · max 20 MB each</small>
                        </>
                      ) : (
                        <>
                          <b>Drop files here</b>
                          <small>or click to open file explorer · Ctrl+V to paste · PDF, PNG, JPG, or WEBP · max 20 MB</small>
                        </>
                      )}
                    </div>

                    {stagedFiles.length > 0 && (
                      <div className="extract-staged-list" aria-label="Selected local files">
                        <div className="extract-staged-head">
                          <span>Staged files ({stagedFiles.length})</span>
                          <button type="button" className="btn gh xs" onClick={() => setStagedFiles([])} disabled={isBusy}>
                            Clear all
                          </button>
                        </div>
                        {stagedFiles.map((item) => (
                          <div className="extract-staged-row" key={localFileKey(item)}>
                            <Icon name="file" size={13} />
                            <div className="extract-staged-meta">
                              <b title={item.name}>{item.name}</b>
                              <small>{formatSize(item.size)}</small>
                            </div>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Remove ${item.name}`}
                              onClick={() => removeStagedFile(item)}
                              disabled={isBusy}
                            >
                              <Icon name="x" size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="cloud-raw-browser" aria-label="Client cloud Raw folder files">
                    <div className="cloud-raw-toolbar">
                      <div className="cloud-raw-folder-badge" title={client?.name || 'Client'}>
                        <Icon name="folder" size={13} />
                        <span>/Raw</span>
                      </div>
                      <label className="cloud-raw-search">
                        <Icon name="search" size={12} />
                        <input
                          value={rawSearch}
                          onChange={(event) => setRawSearch(event.target.value)}
                          placeholder="Filter Raw files or folder path…"
                          aria-label="Filter Raw folder files"
                        />
                        {rawSearch && (
                          <button type="button" onClick={() => setRawSearch('')} aria-label="Clear filter">
                            <Icon name="x" size={11} />
                          </button>
                        )}
                      </label>
                      <div className="cloud-raw-actions">
                        {supportedVisibleRawIds.length > 0 && (
                          <button type="button" className="btn sm" onClick={toggleSelectAllRaw} disabled={isBusy}>
                            {supportedVisibleRawIds.every((id) => selectedRawIds.includes(id)) ? 'Unselect all' : 'Select all'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn gh sm"
                          onClick={() => setRawRefreshNonce((n) => n + 1)}
                          disabled={rawLoading}
                          title="Refresh Raw folder"
                        >
                          <Icon name="refresh" size={12} className={rawLoading ? 'ic spin' : 'ic'} />
                          Refresh
                        </button>
                      </div>
                    </div>

                    {rawLoading ? (
                      <div className="cloud-raw-empty">
                        <Icon name="refresh" size={16} className="ic spin" />
                        <span>Loading files from /Raw folder…</span>
                      </div>
                    ) : rawError ? (
                      <div className="cloud-raw-error">
                        <Icon name="bell" size={14} />
                        <div>
                          <b>Could not load Raw folder</b>
                          <span>{rawError}</span>
                        </div>
                        <button type="button" className="btn sm" onClick={() => setRawRefreshNonce((n) => n + 1)}>
                          Retry
                        </button>
                      </div>
                    ) : !visibleRawFiles.length ? (
                      <div className="cloud-raw-empty">
                        <Icon name="folder" size={18} />
                        <b>{rawSearch ? 'No matching Raw files' : 'No files in /Raw folder yet'}</b>
                        <span>
                          {rawSearch
                            ? 'Try a different filename or folder filter.'
                            : 'Upload files or receive client portal uploads to see them here.'}
                        </span>
                      </div>
                    ) : (
                      <div className="cloud-raw-list" role="listbox" aria-multiselectable="true">
                        {visibleRawFiles.map((item) => {
                          const checked = selectedRawIds.includes(item.documentId);
                          const statusMeta = rawStatusBadge(item.extractionStatus);
                          return (
                            <button
                              type="button"
                              key={item.documentId}
                              role="option"
                              aria-selected={checked}
                              disabled={!item.isSupportedFormat || isBusy}
                              className={`cloud-raw-item${checked ? ' selected' : ''}${!item.isSupportedFormat ? ' disabled' : ''}`}
                              onClick={() => toggleRawFile(item.documentId)}
                            >
                              <span className={`cloud-raw-check${checked ? ' checked' : ''}`} aria-hidden="true">
                                {checked && <Icon name="check" size={11} />}
                              </span>
                              <span className="cloud-raw-file-icon" aria-hidden="true">
                                <Icon name="file" size={14} />
                              </span>
                              <div className="cloud-raw-item-body">
                                <div className="cloud-raw-item-top">
                                  <b title={item.fileName}>{item.fileName}</b>
                                  <span className={`cloud-raw-status ${statusMeta.tone}`}>
                                    {item.isSupportedFormat ? statusMeta.label : 'Unsupported'}
                                  </span>
                                </div>
                                <div className="cloud-raw-item-meta">
                                  <span className="cloud-raw-path" title={item.folderPath}>
                                    <Icon name="folder" size={10} />
                                    {item.folderPath}
                                  </span>
                                  <span>{formatSize(item.sizeBytes)}</span>
                                  {item.modifiedAt && <span>{formatShortDate(item.modifiedAt)}</span>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="extract-action-bar">
                  <div className="extract-security">
                    <Icon name="check" size={14} />
                    <span>
                      {sourceMode === 'upload'
                        ? <>Files stay in the selected client’s private <b>Raw</b> vault until processing is complete.</>
                        : <>Selected files are processed directly from the client’s private <b>Raw</b> cloud folder without re-uploading.</>}
                    </span>
                  </div>

                  <button
                    className="btn pri extract-cta"
                    disabled={!client || readyCount === 0 || isBusy || connectionState === 'offline'}
                    onClick={() => startExtraction()}
                  >
                    <Icon name={isBusy ? 'refresh' : 'spark'} size={15} className={isBusy ? 'ic spin' : 'ic'} />
                    {ctaLabel}
                  </button>
                </div>

                {fallbackProgress && (
                  <div className="ai-fallback-status" role="status" aria-live="polite">
                    Auto-trying {fallbackProgress.nextModel} ({fallbackProgress.attempt} of {fallbackProgress.maxAttempts}) after {fallbackProgress.failedModel} failed.{' '}
                    {fallbackProgress.waitMs > 0 ? `Waiting ${Math.ceil(fallbackProgress.waitMs / 1000)}s. ` : ''}
                    {fallbackProgress.reason}
                  </div>
                )}

                {noticeMessage && (
                  <div className={`extract-message ${noticeMessage.kind}`}>
                    <Icon name={noticeMessage.kind === 'error' ? 'x' : noticeMessage.kind === 'success' ? 'check' : 'clock'} size={14} />
                    <span>{noticeMessage.text}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="card extract-progress-card">
            <div className="card-h">
              <div>
                <span className="section-kicker">03 / PIPELINE</span>
                <h2>Processing &amp; queue</h2>
              </div>
              <span className="mono extract-doc-id">
                {activeItem?.documentId
                  ? activeItem.documentId.slice(0, 14)
                  : activeResultItem?.documentId
                    ? activeResultItem.documentId.slice(0, 14)
                    : 'WAITING'}
              </span>
            </div>
            <div className="card-b">
              <div className="pipeline-intro">
                <div className="pipeline-orb">
                  <Icon name="spark" size={22} />
                </div>
                <div>
                  <b>
                    {activeItem
                      ? `Processing ${activeItem.fileName}`
                      : finishedItems.some((item) => item.status === 'done')
                        ? 'Queue complete'
                        : finishedItems.some((item) => item.status === 'error')
                          ? 'Needs attention'
                          : 'Ready when you are'}
                  </b>
                  <small>
                    {activeItem
                      ? `${queuedItems.length} waiting in queue · handled by the secure backend`
                      : queue.length > 0
                        ? `${finishedItems.filter((i) => i.status === 'done').length} done · ${finishedItems.filter((i) => i.status === 'error').length} failed`
                        : 'Select one or more files on the left to start extraction.'}
                  </small>
                </div>
              </div>

              <div className="pipeline-steps">
                {[
                  ['uploading', 'Save original to cloud', activeItem?.source === 'cloud' ? 'Already in Raw storage' : 'Secured in the private bucket'],
                  ['extracting', 'AI extraction', 'Server-side vision model'],
                  ['saving', 'Save structured result', 'Stored in Supabase metadata'],
                ].map(([id, title, sub], index) => {
                  const active = activeItem?.status === id;
                  const complete =
                    (!activeItem && activeResultItem?.status === 'done') ||
                    (activeItem?.status === 'saving' && index < 2) ||
                    (activeItem?.status === 'extracting' && index === 0);
                  return (
                    <div className={'pipeline-step ' + (active ? 'active' : '') + (complete ? 'complete' : '')} key={id}>
                      <div className="pipeline-marker">{complete ? <Icon name="check" size={13} /> : <span>{index + 1}</span>}</div>
                      <div>
                        <b>{title}</b>
                        <small>{sub}</small>
                      </div>
                      {active && <i className="spin" />}
                    </div>
                  );
                })}
              </div>

              {queue.length > 0 && (
                <div className="extract-queue" aria-label="Extraction queue">
                  <div className="extract-queue-head">
                    <span>Extraction queue ({queue.length})</span>
                    {finishedItems.length > 0 && (
                      <button type="button" className="btn gh xs" onClick={clearFinishedItems}>
                        Clear finished
                      </button>
                    )}
                  </div>

                  {activeItem && (
                    <div className="extract-queue-section">
                      <small className="extract-queue-label">Currently processing</small>
                      <div className="extract-queue-item active">
                        <Icon name="refresh" size={13} className="ic spin" />
                        <div className="extract-queue-meta">
                          <b title={activeItem.fileName}>{activeItem.fileName}</b>
                          <small>
                            {activeItem.status === 'uploading'
                              ? 'Uploading to Raw…'
                              : activeItem.status === 'extracting'
                                ? 'Extracting fields…'
                                : 'Saving result…'}{' '}
                            ({activeItem.progress}%)
                          </small>
                        </div>
                        <button type="button" className="btn gh xs" onClick={cancelActiveQueue}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {queuedItems.length > 0 && (
                    <div className="extract-queue-section">
                      <small className="extract-queue-label">Up next ({queuedItems.length})</small>
                      {queuedItems.map((item, idx) => (
                        <div className="extract-queue-item queued" key={item.id}>
                          <span className="queue-order">{idx + 1}</span>
                          <div className="extract-queue-meta">
                            <b title={item.fileName}>{item.fileName}</b>
                            <small>
                              {item.folderPath ? `${item.folderPath} · ` : ''}
                              {formatSize(item.fileSizeBytes)} · {item.category}
                            </small>
                          </div>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove ${item.fileName} from queue`}
                            onClick={() => removeQueuedItem(item.id)}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {finishedItems.length > 0 && (
                    <div className="extract-queue-section">
                      <small className="extract-queue-label">Completed &amp; status ({finishedItems.length})</small>
                      {finishedItems.map((item) => {
                        const isSelected = activeResultItem?.id === item.id;
                        return (
                          <div
                            className={`extract-queue-item ${item.status}${isSelected ? ' viewing' : ''}`}
                            key={item.id}
                          >
                            <Icon
                              name={item.status === 'done' ? 'check' : item.status === 'error' ? 'x' : 'clock'}
                              size={13}
                            />
                            <div className="extract-queue-meta">
                              <b title={item.fileName}>{item.fileName}</b>
                              <small>
                                {item.status === 'done'
                                  ? item.approved
                                    ? 'Approved'
                                    : 'Ready for review'
                                  : item.error || 'Canceled'}
                              </small>
                            </div>
                            {item.status === 'done' ? (
                              <button
                                type="button"
                                className={`btn xs${isSelected ? ' pri' : ''}`}
                                onClick={() => setActiveResultId(item.id)}
                              >
                                {isSelected ? 'Viewing' : 'View'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn xs"
                                onClick={() => retryQueueItem(item.id)}
                                disabled={connectionState === 'offline'}
                              >
                                Retry
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="pipeline-note">
                <Icon name="bolt" size={14} />
                <span>Short, structured instructions are applied automatically for consistent tax data.</span>
              </div>
            </div>
          </section>

          <section className="card extract-result-card">
            <div className="card-h">
              <div>
                <span className="section-kicker">04 / REVIEW</span>
                <h2>Extracted data</h2>
              </div>
              <span className={'chip ' + (activeResultItem?.approved ? 'green' : 'amber')}>
                {activeResultItem?.approved ? (
                  <>
                    <Icon name="check" size={12} />
                    Human verified
                  </>
                ) : (
                  <>
                    <span className="warning-dot" />
                    Review required
                  </>
                )}
              </span>
            </div>
            <div className="card-b">
              {!activeResultItem?.extractedData ? (
                <div className="result-empty">
                  <div className="result-empty-icon">
                    <Icon name="table" size={22} />
                  </div>
                  <b>Your structured result will appear here</b>
                  <span>AI extraction is a draft. Compare all fields with the original before approval.</span>
                </div>
              ) : (
                <>
                  <div className="result-file-bar">
                    <div className="file-mark">
                      <Icon name="file" size={15} />
                    </div>
                    <div>
                      <b>{activeResultItem.fileName}</b>
                      <small>
                        {activeResultItem.clientName} · {activeResultItem.category} · Draft for human review
                      </small>
                    </div>
                    <span className={'chip ' + (activeResultItem.approved ? 'green' : 'amber')}>
                      {activeResultItem.approved ? 'Human verified' : 'Review required'}
                    </span>
                  </div>
                  <div className="extracted-fields">
                    {resultEntries.map(([key, value]) => (
                      <div className="extracted-field" key={key}>
                        <small>{prettyKey(key)}</small>
                        <strong>
                          {value === null || value === ''
                            ? 'Not detected'
                            : Array.isArray(value)
                              ? `${value.length} items`
                              : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)}
                        </strong>
                        <span className="confidence-line">
                          <i />
                          <em>{value === null || value === '' ? 'Needs review' : 'Check original'}</em>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="result-actions">
                    <button
                      className="btn gh"
                      onClick={() => {
                        setQueue((prev) => prev.filter((item) => item.id !== activeResultItem.id));
                        setActiveResultId('');
                      }}
                    >
                      Discard
                    </button>
                    <button className="btn pri" disabled={Boolean(activeResultItem.approved)} onClick={() => void approveExtraction()}>
                      <Icon name="check" size={14} />
                      {activeResultItem.approved ? 'Review complete' : 'Review & approve'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {pastedFile && client && (
        <div
          className="extract-paste-backdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              clearPastedFile();
            }
          }}
        >
          <div
            className="extract-paste-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extract-paste-title"
            aria-describedby="extract-paste-question"
          >
            <div className="extract-paste-head">
              <div className="extract-paste-icon">
                <Icon name="spark" size={17} />
              </div>
              <div>
                <span className="section-kicker">CLIPBOARD FILE DETECTED</span>
                <h2 id="extract-paste-title">Do you want to upload this file?</h2>
              </div>
            </div>

            <div className="extract-paste-file-box">
              {pastedPreviewUrl ? (
                <div className="extract-paste-preview">
                  <img src={pastedPreviewUrl} alt={`Preview of ${pastedFile.name}`} />
                </div>
              ) : (
                <div className="extract-paste-file-badge" aria-hidden="true">
                  <Icon name="file" size={22} />
                  <span>{normalizedFileType(pastedFile.name)}</span>
                </div>
              )}
              <div className="extract-paste-file-meta">
                <b title={pastedFile.name}>{pastedFile.name}</b>
                <span>{formatSize(pastedFile.size)} · {normalizedFileType(pastedFile.name)}</span>
                <small>
                  Client: <strong>{client.name}</strong> · {CATEGORIES.find(([val]) => val === category)?.[1] || category}
                </small>
              </div>
            </div>

            <p id="extract-paste-question" className="extract-paste-question">
              Click <strong>Start Data Extraction</strong> to upload this file securely and send it to the AI for extraction.
            </p>

            {pasteCardNote && (
              <div className="extract-message warning" role="status">
                <Icon name="clock" size={14} />
                <span>{pasteCardNote}</span>
              </div>
            )}

            {connectionState === 'offline' && (
              <div className="extract-message error" role="alert">
                <Icon name="globe" size={14} />
                <span>You are offline. Reconnect to start data extraction.</span>
              </div>
            )}

            <div className="extract-paste-actions">
              <button type="button" className="btn gh" onClick={clearPastedFile}>
                Cancel
              </button>
              <button
                ref={pasteConfirmButtonRef}
                type="button"
                className="btn pri"
                disabled={connectionState === 'offline' || isBusy}
                onClick={startPastedExtraction}
              >
                <Icon name="spark" size={15} />
                Start Data Extraction
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
