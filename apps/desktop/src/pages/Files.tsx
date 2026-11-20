import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon } from '../components/Icon';
import { FileArtifactCard } from '../components/FileArtifactCard';
import { DocumentPreviewDialog } from '../components/DocumentPreviewDialog';
import { useAppState, useDispatch } from '../state/store';
import {
  deleteCloudDocument,
  fetchClientDocumentTree,
  fetchCloudDocumentFile,
  fetchDocumentVersions,
  fetchStorageCleanupJob,
  fetchStorageCleanupJobs,
  replaceCloudDocumentVersion,
  retryStorageCleanupJob,
  updateCloudDocumentDetails,
  uploadDocument,
  type DocumentTreeEntry,
  type DocumentVersionItem,
  type StorageCleanupJob
} from '../lib/api';
import { openWithDefaultApp, supportsNativeFileOpen } from '../lib/nativeFiles';
import { fDT } from '../lib/format';
import { emitToast } from '../lib/toast';

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function extension(name: string) { return name.split('.').pop()?.toLowerCase() || 'file'; }
function fileClass(name: string) { return `vault-file-icon ext-${extension(name)}`; }
function folderPaths(entries: DocumentTreeEntry[], prefix = ''): string[] {
  return entries.flatMap(entry => {
    const path = `${prefix}/${entry.name}`;
    return entry.type === 'folder' ? [path, ...folderPaths(entry.children || [], path)] : [];
  });
}

function findEntryAtPath(entries: DocumentTreeEntry[], target: string, prefix = ''): DocumentTreeEntry | null {
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (path === target) return entry;
    if (entry.type === 'folder') {
      const match = findEntryAtPath(entry.children || [], target, path);
      if (match) return match;
    }
  }
  return null;
}

function findFileByName(entries: DocumentTreeEntry[], fileName: string, prefix = ''): { entry: DocumentTreeEntry; path: string } | null {
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.type === 'file' && entry.name.toLocaleLowerCase() === fileName.toLocaleLowerCase()) return { entry, path };
    if (entry.type === 'folder') {
      const match = findFileByName(entry.children || [], fileName, path);
      if (match) return match;
    }
  }
  return null;
}

function findFileById(entries: DocumentTreeEntry[], documentId: string, prefix = ''): { entry: DocumentTreeEntry; path: string } | null {
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    if (entry.type === 'file' && entry.documentId === documentId) return { entry, path };
    if (entry.type === 'folder') {
      const match = findFileById(entry.children || [], documentId, path);
      if (match) return match;
    }
  }
  return null;
}

function addFileToFolder(entries: DocumentTreeEntry[], target: string, file: DocumentTreeEntry, prefix = ''): DocumentTreeEntry[] {
  return entries.map(entry => {
    const path = `${prefix}/${entry.name}`;
    if (path === target && entry.type === 'folder') {
      return { ...entry, children: [...(entry.children || []), file] };
    }
    return entry.type === 'folder'
      ? { ...entry, children: addFileToFolder(entry.children || [], target, file, path) }
      : entry;
  });
}

function fileTypeLabel(name: string) {
  const ext = extension(name).toUpperCase();
  return ext === 'XLSX' || ext === 'CSV' ? 'Spreadsheet' : `${ext} document`;
}

function countChildren(entry: DocumentTreeEntry) {
  const children = entry.children || [];
  return {
    folders: children.filter(child => child.type === 'folder').length,
    files: children.filter(child => child.type === 'file').length,
  };
}

function FileCard({ item, onOpen, onDelete }: { item: DocumentTreeEntry; onOpen: () => void; onDelete: () => void }) {
  return (
    <FileArtifactCard
      fileName={item.name}
      detailText={fileTypeLabel(item.name)}
      sizeText={formatBytes(item.size)}
      modifiedText={fDT(new Date(item.modifiedAt))}
      onOpen={onOpen}
      onDelete={onDelete}
      className="vault-file-card"
    />
  );
}

function TreeNode({ entry, depth, path, expanded, selectedPath, selectedDocumentId, toggle, select }: {
  entry: DocumentTreeEntry; depth: number; path: string; expanded: Set<string>; selectedPath: string; selectedDocumentId?: string;
  toggle: (path: string) => void; select: (entry: DocumentTreeEntry, path: string) => void;
}) {
  const folder = entry.type === 'folder';
  const open = expanded.has(path);
  const counts = folder ? countChildren(entry) : null;
  const isSelected = folder
    ? selectedPath === path
    : selectedDocumentId ? selectedDocumentId === entry.documentId : selectedPath === path;
  return <div className="vault-node-wrap">
    <button className={`vault-node ${isSelected ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => { select(entry, path); if (folder) toggle(path); }} title={entry.name}>
      <span className={`vault-caret ${open ? 'open' : ''}`}>{folder && <Icon name="chev" size={11} />}</span>
      <span className={folder ? 'vault-folder-icon' : fileClass(entry.name)}><Icon name={folder ? 'folder' : 'file'} size={14} /></span>
      <span className="vault-node-name">{entry.name}</span>
      {folder && <span className="vault-node-count" aria-label={`${counts?.folders || 0} folders, ${counts?.files || 0} files`}>
        <span className="vault-count-folder"><Icon name="folder" size={11} />{counts?.folders || 0}</span>
        <span className="vault-count-file"><Icon name="file" size={11} />{counts?.files || 0}</span>
      </span>}
    </button>
    {folder && open && (entry.children || []).map((child, index) => <TreeNode key={child.type === 'file' ? child.documentId || `${path}/${child.name}/${index}` : `${path}/${child.name}`} entry={child} depth={depth + 1} path={`${path}/${child.name}`} expanded={expanded} selectedPath={selectedPath} selectedDocumentId={selectedDocumentId} toggle={toggle} select={select} />)}
  </div>;
}

function FolderTreeSkeleton() {
  const rows = [
    { depth: 0, folder: true },
    { depth: 1, folder: true },
    { depth: 2, folder: false },
    { depth: 1, folder: true },
    { depth: 2, folder: false },
    { depth: 2, folder: false },
    { depth: 1, folder: true },
    { depth: 2, folder: false },
  ];

  return <div className="vault-tree-skeleton" role="status" aria-label="Loading client folders">
    <div className="vault-tree-skeleton-message">
      <span className="vault-tree-skeleton-pulse" aria-hidden="true" />
      <span><b>Syncing folder tree</b><small>Fetching secure files from the cloud</small></span>
    </div>
    <div className="vault-tree-skeleton-rows" aria-hidden="true">
      {rows.map((row, index) => <div className="vault-tree-skeleton-row" key={index} style={{ paddingLeft: 8 + row.depth * 14 }}>
        <span className="vault-tree-skeleton-caret" />
        <span className={`vault-tree-skeleton-icon${row.folder ? ' is-folder' : ''}`} />
        <span className="vault-tree-skeleton-name" />
        {row.folder && <span className="vault-tree-skeleton-count"><i /><i /></span>}
      </div>)}
    </div>
  </div>;
}

export function FilesPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [clientId, setClientId] = useState(s.clients[0]?.id || '');
  const [entries, setEntries] = useState<DocumentTreeEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ entry: DocumentTreeEntry; path: string } | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadMessageKind, setUploadMessageKind] = useState<'success' | 'warning' | 'error' | ''>('');
  const [pendingDelete, setPendingDelete] = useState<{ entry: DocumentTreeEntry } | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsForm, setDetailsForm] = useState({ fileName: '', category: 'General', assessmentYear: '' });
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [cleanupJobs, setCleanupJobs] = useState<StorageCleanupJob[]>([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupError, setCleanupError] = useState('');
  const [openingFile, setOpeningFile] = useState(false);
  const [activeVaultPreview, setActiveVaultPreview] = useState<{ fileName: string; file: Blob } | null>(null);
  const [openingNativePreview, setOpeningNativePreview] = useState(false);
  const [nativePreviewError, setNativePreviewError] = useState('');
  const [loadedClientId, setLoadedClientId] = useState('');
  const [pendingOpenFile, setPendingOpenFile] = useState<{ clientId: string; fileName: string; documentId?: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const client = s.clients.find(item => item.id === clientId) || s.clients[0];
  const treeLoading = Boolean(clientId) && (loading || loadedClientId !== clientId);

  useEffect(() => {
    const onOpenFile = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId: string; fileName: string; documentId?: string }>).detail;
      if (!detail?.clientId || !detail.fileName || !s.clients.some(clientItem => clientItem.id === detail.clientId)) return;
      setClientId(detail.clientId);
      setSelected(null);
      setQuery(detail.fileName);
      setPendingOpenFile(detail);
    };
    window.addEventListener('taxflow:open-document', onOpenFile);
    return () => window.removeEventListener('taxflow:open-document', onOpenFile);
  }, [s.clients]);

  function addRoot(items: DocumentTreeEntry[]) { return client ? [{ name: client.name, type: 'folder' as const, modifiedAt: new Date().toISOString(), children: items }] : items; }

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true); setError('');
    fetchClientDocumentTree(clientId).then(result => {
      if (cancelled) return;
      const tree = addRoot(result.entries || []);
      setEntries(tree); setLoadedClientId(clientId); setExpanded(new Set(folderPaths(tree)));
      if (selected?.path) {
        const refreshedSelection = findEntryAtPath(tree, selected.path);
        setSelected(refreshedSelection ? { entry: refreshedSelection, path: selected.path } : null);
      }
    }).catch(err => {
      if (cancelled) return;
      setEntries([]);
      setSelected(null);
      setLoadedClientId(clientId);
      setError(err.message || 'Cloud documents could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    fetchStorageCleanupJobs().then(jobs => {
      if (!cancelled) setCleanupJobs(jobs);
    }).catch(error => {
      if (!cancelled) setCleanupError(error instanceof Error ? error.message : 'Cleanup status could not be loaded.');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pendingOpenFile || loadedClientId !== pendingOpenFile.clientId || !client) return;
    const match = pendingOpenFile.documentId
      ? findFileById(entries, pendingOpenFile.documentId)
      : findFileByName(entries, pendingOpenFile.fileName);
    if (match) {
      setSelected(match);
    } else {
      setUploadMessageKind('error');
      setUploadMessage('This cloud document is no longer available. Refresh the list and search again.');
    }
    setPendingOpenFile(null);
  }, [pendingOpenFile, loadedClientId, client, entries]);

  const visibleEntries = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return entries;
    const filter = (items: DocumentTreeEntry[]): DocumentTreeEntry[] => items.flatMap(item => {
      if (item.type === 'file') return item.name.toLowerCase().includes(term) ? [item] : [];
      const children = filter(item.children || []);
      return item.name.toLowerCase().includes(term) || children.length ? [{ ...item, children }] : [];
    });
    return filter(entries);
  }, [entries, query]);

  const currentSelectedEntry = selected ? findEntryAtPath(entries, selected.path) : null;
  const selectedFolderEntry = currentSelectedEntry?.type === 'folder'
    ? currentSelectedEntry
    : selected?.entry.type === 'folder' ? selected.entry : null;
  const selectedChildren = selectedFolderEntry?.children || [];
  const folderCount = selectedChildren.filter(item => item.type === 'folder').length;
  const fileCount = selectedChildren.filter(item => item.type === 'file').length;
  const pathLabel = selected?.path || `/${client?.name || 'Client folder'}`;
  const selectedFolderName = selected?.entry.type === 'folder' ? selected.entry.name : '';
  const uploadCategory = selectedFolderName === 'Extracted' ? 'Extracted' : selectedFolderName === 'Raw' ? 'General' : '';
  const canUpload = Boolean(client && uploadCategory && !uploading);

  function toggle(path: string) { setExpanded(previous => { const next = new Set(previous); next.has(path) ? next.delete(path) : next.add(path); return next; }); }

  function removeFileById(items: DocumentTreeEntry[], targetDocumentId: string): DocumentTreeEntry[] {
    return items.flatMap(item => {
      if (item.type === 'file') return item.documentId === targetDocumentId ? [] : [item];
      return [{ ...item, children: removeFileById(item.children || [], targetDocumentId) }];
    });
  }

  function toBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('The selected file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !client || !uploadCategory) return;

    const extensionName = extension(file.name).toUpperCase();
    const supportedTypes = new Set(['PDF', 'PNG', 'JPG', 'JPEG', 'XLSX', 'CSV']);
    if (!supportedTypes.has(extensionName)) {
      setUploadMessageKind('error');
      setUploadMessage(`Unsupported file type: .${extension(file.name)}. Use PDF, image, XLSX, or CSV.`);
      return;
    }

    setUploading(true);
    setUploadMessage('');
    setUploadMessageKind('');
    try {
      const result = await uploadDocument({
        clientId: client.id,
        fileName: file.name,
        fileType: extensionName,
        category: uploadCategory,
        fileBase64: await toBase64(file),
        source: 'Manual',
      });
      const uploadedDocument = result.data;
      if (!uploadedDocument?.id) throw new Error('The upload succeeded but returned no document ID.');
      const savedName = uploadedDocument.file_name || file.name;
      const savedSize = Number(uploadedDocument.file_size_kb || 0) * 1024;
      const savedAt = uploadedDocument.created_at || new Date().toISOString();
      const uploadedEntry: DocumentTreeEntry = {
        name: savedName, type: 'file', documentId: uploadedDocument.id,
        size: savedSize, modifiedAt: savedAt
      };
      const selectedPath = selected?.path;
      if (selectedPath) {
        setEntries(previous => addFileToFolder(previous, selectedPath, uploadedEntry));
        setSelected(previous => previous && previous.path === selectedPath
          ? { ...previous, entry: { ...previous.entry, children: [...(previous.entry.children || []), uploadedEntry] } }
          : previous);
      }
      setUploadMessageKind('success');
      setUploadMessage(`${file.name} uploaded to private cloud storage.`);
      emitToast({ kind: 'success', title: 'File uploaded', message: `${file.name} is stored in private cloud storage.`, eventType: 'document.uploaded', entityType: 'document', entityId: uploadedDocument.id });
      setRefresh(value => value + 1);
    } catch (err) {
      setUploadMessageKind('error');
      const message = err instanceof Error ? err.message : 'The file could not be uploaded.';
      setUploadMessage(message);
      emitToast({ kind: 'error', title: 'File could not be uploaded', message, eventType: 'document.upload_failed', entityType: 'client', entityId: client.id });
    } finally {
      setUploading(false);
    }
  }

  async function permanentlyDeleteFile() {
    if (!client || !pendingDelete) return;
    const documentId = pendingDelete.entry.documentId;
    if (!documentId) {
      setDeleteError('This file has no cloud document ID and cannot be deleted here.');
      return;
    }

    setDeletingFile(true);
    setDeleteError('');
    try {
      const job = await deleteCloudDocument(documentId);
      setCleanupJobs(previous => [job, ...previous.filter(existing => existing.id !== job.id)]);
      setCleanupError('');
      setEntries(previous => removeFileById(previous, documentId));
      if (selected?.entry.documentId === documentId) setSelected(null);
      setPendingDelete(null);
      setUploadMessageKind('warning');
      setUploadMessage(`${pendingDelete.entry.name} was hidden and queued for secure cloud deletion.`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'The file could not be deleted.');
    } finally {
      setDeletingFile(false);
    }
  }

  function startEditingDetails() {
    if (!selected?.entry.documentId) return;
    setDetailsForm({
      fileName: selected.entry.name,
      category: selected.entry.category || 'General',
      assessmentYear: ''
    });
    setDetailsError('');
    setEditingDetails(true);
  }

  async function saveDocumentDetails() {
    if (!selected?.entry.documentId || savingDetails) return;
    setSavingDetails(true);
    setDetailsError('');
    try {
      await updateCloudDocumentDetails(selected.entry.documentId, {
        fileName: detailsForm.fileName,
        category: detailsForm.category,
        ...(detailsForm.assessmentYear ? { assessmentYear: detailsForm.assessmentYear } : {})
      });
      setEditingDetails(false);
      setUploadMessageKind('success');
      setUploadMessage('Document details updated. The cloud file itself was not changed.');
      setRefresh(value => value + 1);
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Document details could not be updated.');
    } finally {
      setSavingDetails(false);
    }
  }

  async function loadDocumentVersions() {
    if (!selected?.entry.documentId || versionsLoading) return;
    setVersionsLoading(true);
    setVersionsError('');
    try {
      setVersions(await fetchDocumentVersions(selected.entry.documentId));
      setVersionsOpen(true);
    } catch (error) {
      setVersionsError(error instanceof Error ? error.message : 'Version history could not be loaded.');
    } finally {
      setVersionsLoading(false);
    }
  }

  async function replaceSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selected?.entry.documentId) return;
    const fileType = extension(file.name).toUpperCase();
    if (!new Set(['PDF', 'PNG', 'JPG', 'JPEG', 'XLSX', 'CSV']).has(fileType)) {
      setUploadMessageKind('error');
      setUploadMessage('Unsupported replacement type. Use PDF, PNG/JPG, XLSX, or CSV.');
      return;
    }
    setUploading(true);
    setUploadMessage('');
    try {
      await replaceCloudDocumentVersion(selected.entry.documentId, file.name, fileType, await toBase64(file));
      setUploadMessageKind('success');
      setUploadMessage(`A new immutable version of ${selected.entry.name} was saved. Earlier versions remain available.`);
      setRefresh(value => value + 1);
      if (versionsOpen) setVersions(await fetchDocumentVersions(selected.entry.documentId));
    } catch (error) {
      setUploadMessageKind('error');
      setUploadMessage(error instanceof Error ? error.message : 'The replacement version could not be saved.');
    } finally {
      setUploading(false);
    }
  }

  async function refreshCleanupStatus(jobId: string) {
    if (cleanupLoading) return;
    setCleanupLoading(true);
    setCleanupError('');
    try {
      const updatedJob = await fetchStorageCleanupJob(jobId);
      setCleanupJobs(previous => previous.map(job => job.id === jobId ? updatedJob : job));
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : 'Cleanup status could not be loaded.');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function retryCleanup(jobId: string) {
    if (cleanupLoading) return;
    setCleanupLoading(true);
    setCleanupError('');
    try {
      await retryStorageCleanupJob(jobId);
      setCleanupJobs(previous => previous.map(job => job.id === jobId
        ? { ...job, status: 'pending', attempt_count: 0, message: 'Cloud deletion was queued for retry.' }
        : job));
    } catch (error) {
      setCleanupError(error instanceof Error ? error.message : 'Cleanup could not be retried.');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function openSelectedFile(versionId?: string, versionFileName?: string) {
    if (!client || selected?.entry.type !== 'file' || openingFile) return;
    const documentId = selected.entry.documentId;
    if (!documentId) {
      setUploadMessageKind('error');
      setUploadMessage('This file has no cloud document ID and cannot be opened.');
      return;
    }
    const fileName = versionFileName || selected.entry.name;

    setOpeningFile(true);
    setUploadMessage('');
    setNativePreviewError('');
    try {
      const file = await fetchCloudDocumentFile(documentId, versionId);
      try {
        if (await openWithDefaultApp(file, fileName)) {
          setUploadMessageKind('success');
          setUploadMessage(`Opened ${fileName} with the default app on this computer.`);
          return;
        }
      } catch (nativeError) {
        setNativePreviewError(nativeError instanceof Error ? nativeError.message : 'A default app could not open this file. You can still preview or download it here.');
      }
      setActiveVaultPreview({ fileName, file });
    } catch (error) {
      setUploadMessageKind('error');
      setUploadMessage(error instanceof Error ? error.message : 'The cloud document could not be opened.');
    } finally {
      setOpeningFile(false);
    }
  }

  async function openVaultPreviewNative() {
    if (!activeVaultPreview) return;
    setOpeningNativePreview(true);
    setNativePreviewError('');
    try {
      await openWithDefaultApp(activeVaultPreview.file, activeVaultPreview.fileName);
    } catch (error) {
      setNativePreviewError(error instanceof Error ? error.message : 'The file could not be opened by a default application.');
    } finally {
      setOpeningNativePreview(false);
    }
  }

  if (!client) {
    return <div className="vault-page">
      <div className="ph vault-page-head" data-tour="files-intro"><div><div className="eyebrow">PRIVATE CLOUD STORAGE</div><h1>Client documents</h1><p>Your private document workspace is ready when you add your first client.</p></div><div className="vault-health"><span className="health-dot ok" /><span>Cloud storage</span></div></div>
      <div className="card workspace-empty vault-empty-files" data-tour="files-empty">
        <div className="workspace-empty-visual"><span className="workspace-empty-ring ring-one" /><span className="workspace-empty-ring ring-two" /><span className="workspace-empty-orb"><Icon name="folder" size={30} /></span><span className="workspace-empty-float float-one"><Icon name="check" size={14} /></span><span className="workspace-empty-float float-two"><Icon name="file" size={14} /></span></div>
        <div className="workspace-empty-copy"><span className="eyebrow">A PRIVATE HOME FOR EVERY FILE</span><h2>Start with your first client folder</h2><p>Each client gets a private cloud folder for original documents, generated files, and records ready for review.</p><button className="btn pri" onClick={() => dispatch({ type: 'GO', page: 'clients' })}><Icon name="users" size={14} />Add your first client</button></div>
        <div className="workspace-empty-steps"><div><span>01</span><b>Raw</b><small>Keep original uploads untouched</small></div><div><span>02</span><b>Extracted</b><small>Organise reviewed information</small></div><div><span>03</span><b>Review</b><small>Open the right file when needed</small></div></div>
      </div>
    </div>;
  }

  return <div className="vault-page">
    <div className="ph vault-page-head" data-tour="files-intro"><div><div className="eyebrow">PRIVATE CLOUD STORAGE</div><h1>Client documents</h1><p>Browse documents stored for the selected client in private Supabase Storage.</p></div><div className="vault-health"><span className={`health-dot ${error ? 'warn' : 'ok'}`} /><span>{error ? 'Limited access' : 'Cloud storage'}</span></div></div>
    <div className="vault-toolbar" data-tour="files-controls"><div className={`vault-client-select ${clientMenuOpen ? 'menu-open' : ''}`} title="Select client" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setClientMenuOpen(false); }}><button className="vault-client-name" onClick={() => s.clients.length && setClientMenuOpen(value => !value)} disabled={!s.clients.length} aria-haspopup="listbox" aria-expanded={clientMenuOpen}>{client?.name || 'No clients'}</button><span className="vault-client-arrow" aria-hidden="true" />{clientMenuOpen && s.clients.length > 0 && <div className="vault-client-menu" role="listbox">{s.clients.map(item => <button key={item.id} className={`vault-client-option ${item.id === client?.id ? 'active' : ''}`} role="option" aria-selected={item.id === client?.id} onClick={() => { setClientId(item.id); setSelected(null); setUploadMessage(''); setClientMenuOpen(false); }}>{item.name}{item.id === client?.id && <Icon name="check" size={13} />}</button>)}</div>}</div><div className="vault-path-label"><Icon name="folder" size={15} /><span>{pathLabel}</span></div><label className="vault-search"><Icon name="search" size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this vault" aria-label="Search this vault" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={13} /></button>}</label></div>
    {selected?.entry.type === 'file' && <div className="vault-global-open"><span className="mut">Selected file: <b>{selected.entry.name}</b></span><button className="btn pri" onClick={() => void openSelectedFile()} disabled={openingFile}><Icon name="open" size={14} />{openingFile ? 'Opening…' : supportsNativeFileOpen() ? 'Open with default app' : 'Preview file'}</button></div>}
    <div className="vault-two-pane">
      <section className="vault-tree-panel card" data-tour="files-tree"><div className="vault-panel-head"><div><span className="eyebrow">FOLDER TREE</span><h2>{client?.name || 'No client selected'}</h2></div><button className="btn ghost" onClick={() => setRefresh(value => value + 1)} disabled={treeLoading || !clientId}><Icon name="refresh" size={14} />Refresh</button></div>{error && <div className="vault-notice"><Icon name="bell" size={15} /><span>{error}</span></div>}<div className="vault-tree-scroll" aria-busy={treeLoading}>{treeLoading ? <FolderTreeSkeleton /> : visibleEntries.length ? visibleEntries.map((entry, index) => <TreeNode key={entry.type === 'file' ? entry.documentId || `${entry.name}/${index}` : entry.name} entry={entry} depth={0} path={`/${entry.name}`} expanded={expanded} selectedPath={selected?.path || ''} selectedDocumentId={selected?.entry.type === 'file' ? selected.entry.documentId : undefined} toggle={toggle} select={(entry, path) => setSelected({ entry, path })} />) : <div className="vault-empty"><span className="vault-empty-icon"><Icon name="folder" size={22} /></span><b>{query ? 'No matching items' : 'No documents yet'}</b><span>{query ? 'Try a different search.' : 'Files will appear here when added.'}</span></div>}</div></section>
      <section className="vault-contents-panel card"><div className="vault-panel-head"><div><span className="eyebrow">SELECTED FOLDER</span><h2>{selected?.entry.name || client?.name || 'Folder contents'}</h2><small>{selected?.entry.type === 'folder' ? `${folderCount} folder${folderCount === 1 ? '' : 's'} · ${fileCount} file${fileCount === 1 ? '' : 's'}` : 'Select a folder in the tree'}</small></div><div className="vault-upload-action"><input ref={fileInputRef} type="file" className="vault-file-input" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" onChange={uploadSelectedFile} /><button className="btn pri" onClick={() => fileInputRef.current?.click()} disabled={!canUpload} title={uploadCategory ? `Upload to ${selectedFolderName}` : 'Select the Raw or Extracted folder first'}><Icon name="upload" size={14} />{uploading ? 'Uploading…' : 'Upload file'}</button></div></div>{uploading && <div className="vault-uploading-state"><span className="vault-upload-orbit"><Icon name="upload" size={17} /></span><div><b>Uploading securely to {selectedFolderName}</b><small>Saving securely to private cloud storage and refreshing this folder…</small></div></div>}{uploadMessage && <div className={`vault-upload-message ${uploadMessageKind}`}><Icon name={uploadMessageKind === 'success' ? 'check' : uploadMessageKind === 'error' ? 'x' : 'bell'} size={14} /><span>{uploadMessage}</span></div>}{selected?.entry.type === 'file' ? <div className="vault-file-preview"><FileArtifactCard fileName={selected.entry.name} detailText={fileTypeLabel(selected.entry.name)} sizeText={formatBytes(selected.entry.size)} modifiedText={fDT(new Date(selected.entry.modifiedAt))} statusText="Stored in this client’s private cloud storage" onOpen={() => void openSelectedFile()} openLabel={supportsNativeFileOpen() ? 'Open with default app' : 'Preview file'} opening={openingFile} /><div className="vault-detail-path">{selected.path}</div><div className="kv"><span>Type</span><b>{extension(selected.entry.name).toUpperCase()} file</b><span>Size</span><b>{formatBytes(selected.entry.size)}</b><span>Modified</span><b>{fDT(new Date(selected.entry.modifiedAt))}</b></div></div> : selected ? <div className="vault-contents"><div className="vault-current-path"><Icon name="folder" size={15} /><span>{selected.path}</span></div>{selectedChildren.length ? <div className="vault-file-grid">{selectedChildren.map((item, index) => item.type === 'folder' ? <button className="vault-folder-card" key={item.name} onClick={() => setSelected({ entry: item, path: `${selected.path}/${item.name}` })}><span className="vault-folder-card-icon"><Icon name="folder" size={22} /></span><span><b>{item.name}</b><small>{item.children?.length || 0} items</small></span><Icon name="chev" size={14} /></button> : <FileCard key={item.documentId || `${selected.path}/${item.name}/${index}`} item={item} onOpen={() => setSelected({ entry: item, path: `${selected.path}/${item.name}` })} onDelete={() => { setDeleteError(''); setPendingDelete({ entry: item }); }} />)}</div> : <div className="vault-empty"><span className="vault-empty-icon"><Icon name="folder" size={22} /></span><b>This folder is empty</b><span>Files added to this folder will appear here.</span></div>}</div> : <div className="vault-overview"><div className="vault-overview-icon"><Icon name="folder" size={28}></Icon></div><b>Select a folder</b><span>Choose a folder from the tree to view everything inside it.</span></div>}</section>
    </div>
    {(cleanupJobs.length > 0 || cleanupError) && <div className="vault-lifecycle-panel card" aria-label="Cloud cleanup jobs">
      <div><b>Cloud cleanup</b><small>Queued deletions finish automatically; failed jobs can be retried here.</small></div>
      {cleanupError && <span className="ob-error" role="alert">{cleanupError}</span>}
      {cleanupJobs.map(job => <div className="vault-cleanup-row" key={job.id} role="status">
        <span><b>{job.message}</b><small>Status: {job.status}</small></span>
        <div className="vault-lifecycle-actions">
          <button className="btn sm" onClick={() => void refreshCleanupStatus(job.id)} disabled={cleanupLoading}>{cleanupLoading ? 'Checking…' : 'Check status'}</button>
          {job.status === 'failed' && <button className="btn sm" onClick={() => void retryCleanup(job.id)} disabled={cleanupLoading}>Retry cleanup</button>}
        </div>
      </div>)}
    </div>}
    {selected?.entry.type === 'file' && <section className="vault-lifecycle-panel card" aria-label="Document management">
      <div><b>Document management</b><small>Opening downloads a copy. Local edits are not synced; use “Replace version” to upload a new immutable version.</small></div>
      <div className="vault-lifecycle-actions">
        <button className="btn sm" onClick={startEditingDetails} disabled={!selected.entry.documentId}>Rename / categorize</button>
        <input ref={replaceInputRef} type="file" className="vault-file-input" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv" onChange={replaceSelectedFile} />
        <button className="btn sm" onClick={() => replaceInputRef.current?.click()} disabled={!selected.entry.documentId || uploading}>{uploading ? 'Uploading…' : 'Replace version'}</button>
        <button className="btn sm" onClick={() => void loadDocumentVersions()} disabled={!selected.entry.documentId || versionsLoading}>{versionsLoading ? 'Loading…' : 'Version history'}</button>
        <button className="btn sm danger" onClick={() => { setDeleteError(''); setPendingDelete({ entry: selected.entry }); }} disabled={!selected.entry.documentId}>Delete</button>
      </div>
      {editingDetails && <div className="vault-lifecycle-form">
        <label>File name<input className="modal-input" value={detailsForm.fileName} onChange={event => setDetailsForm(previous => ({ ...previous, fileName: event.target.value }))} /></label>
        <label>Category<select className="modal-input" value={detailsForm.category} onChange={event => setDetailsForm(previous => ({ ...previous, category: event.target.value }))}>
          {['GST', 'IncomeTax', 'Form16', 'BankStatement', 'Notice', 'TDS', 'Audit', 'General', 'Extracted', 'Generated'].map(category => <option key={category} value={category}>{category}</option>)}
        </select></label>
        <label>Assessment year (optional)<input className="modal-input" value={detailsForm.assessmentYear} placeholder="YYYY or YYYY-YY" onChange={event => setDetailsForm(previous => ({ ...previous, assessmentYear: event.target.value }))} /></label>
        {detailsError && <span className="ob-error" role="alert">{detailsError}</span>}
        <button className="btn pri" onClick={() => void saveDocumentDetails()} disabled={savingDetails}>{savingDetails ? 'Saving…' : 'Save details'}</button>
        <button className="btn gh" onClick={() => setEditingDetails(false)} disabled={savingDetails}>Cancel</button>
      </div>}
      {versionsError && <span className="ob-error" role="alert">{versionsError}</span>}
      {versionsOpen && <div className="vault-version-list">
        <b>Immutable versions</b>
        {!versions.length ? <small>No version history is available.</small> : versions.map(version => <div className="vault-version-row" key={version.id}>
          <span><b>Version {version.version_number}</b><small>{version.file_name} · {fDT(new Date(version.created_at))}</small></span>
          <button className="btn sm" onClick={() => void openSelectedFile(version.id, version.file_name)} disabled={openingFile}>Open</button>
        </div>)}
      </div>}
    </section>}
    {activeVaultPreview && (
      <DocumentPreviewDialog
        file={activeVaultPreview.file}
        fileName={activeVaultPreview.fileName}
        mimeType={activeVaultPreview.file.type}
        onClose={() => setActiveVaultPreview(null)}
        onOpenNative={supportsNativeFileOpen() ? () => void openVaultPreviewNative() : undefined}
        openingNative={openingNativePreview}
        nativeError={nativePreviewError}
      />
    )}
    {pendingDelete && <div className="modal delete-confirm-modal vault-delete-modal" onMouseDown={event => { if (event.target === event.currentTarget && !deletingFile) setPendingDelete(null); }}><div className="card delete-confirm-card vault-delete-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-vault-file-title"><div className="delete-confirm-icon"><Icon name="trash" size={22} /></div><span className="eyebrow">Permanent deletion</span><h2 id="delete-vault-file-title">Delete this file?</h2><p><strong>{pendingDelete.entry.name}</strong> will be permanently removed from your private cloud storage folder. This cannot be undone.</p>{deleteError && <div className="ob-error">{deleteError}</div>}<div className="delete-confirm-actions"><button className="btn gh" disabled={deletingFile} onClick={() => setPendingDelete(null)}>Keep file</button><button className="btn danger" disabled={deletingFile} onClick={permanentlyDeleteFile}>{deletingFile ? <><i className="spin" />Deleting</> : <><Icon name="trash" size={14} />Delete permanently</>}</button></div></div></div>}
  </div>;
}
