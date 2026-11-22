import React from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import { allTasks, missing } from '../lib/domain';
import { money, sum } from '../lib/format';
import { createClient, deleteClient, fetchClientPortalAccess, fetchStorageCleanupJob, fetchStorageCleanupJobs, inviteClientToPortal, retryStorageCleanupJob, revokeClientPortalAccess, sendClientPortalLinkToTelegram, updateClient, updateClientPortalAccess, type StorageCleanupJob } from '../lib/api';
import { ClientFormCard, type ClientFormValues } from '../components/ClientFormCard';
import { emitToast } from '../lib/toast';
import { FilingTypePicker } from '../components/FilingTypePicker';
import {
  deleteOpenRouterApiKey,
  hasOpenRouterApiKey,
  isDesktopApp,
  saveOpenRouterApiKey,
} from '../lib/secureCredentials';
import {
  fetchOpenRouterModels,
  getOpenRouterFallbackSettings,
  getSelectedOpenRouterModel,
  isUsingLocalOpenRouterKey,
  setOpenRouterFallbackSettings,
  setSelectedOpenRouterModel,
  setUsingLocalOpenRouterKey,
  type OpenRouterFallbackSettings,
  type OpenRouterModel,
} from '../lib/openRouter';

export function ClientsPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const [showAdd, setShowAdd] = React.useState(false);
  const [selectedClient, setSelectedClient] = React.useState<(typeof s.clients)[number] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [portalNotice, setPortalNotice] = React.useState('');
  const [editingClient, setEditingClient] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState('');
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const [deleteSaving, setDeleteSaving] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState('');
  const [cleanupJobs, setCleanupJobs] = React.useState<StorageCleanupJob[]>([]);
  const [cleanupLoading, setCleanupLoading] = React.useState(false);
  const [cleanupError, setCleanupError] = React.useState('');
  const [cleanupSuccess, setCleanupSuccess] = React.useState('');
  const [portalAccessEnabled, setPortalAccessEnabled] = React.useState(false);
  const [portalAccessLoading, setPortalAccessLoading] = React.useState(false);
  const [portalActionLoading, setPortalActionLoading] = React.useState(false);
  const [portalInviteLink, setPortalInviteLink] = React.useState('');
  const [portalMessage, setPortalMessage] = React.useState('');
  const [portalError, setPortalError] = React.useState('');
  const [portalStatus, setPortalStatus] = React.useState<'account_created' | 'invitation_pending' | 'invitation_expired' | 'paused' | 'revoked' | 'pending' | 'not_started'>('not_started');
  const [portalCardStates, setPortalCardStates] = React.useState<Record<string, { status: 'account_created' | 'invitation_pending' | 'invitation_expired' | 'paused' | 'revoked' | 'not_started' | 'unavailable'; link: string | null }>>({});
  const [portalCardCopied, setPortalCardCopied] = React.useState('');
  const [portalTelegramLinked, setPortalTelegramLinked] = React.useState(false);
  const [portalTelegramLoading, setPortalTelegramLoading] = React.useState(false);
  const [editForm, setEditForm] = React.useState({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] as string[] });
  const [form, setForm] = React.useState<ClientFormValues>({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] });
  const update = (key: keyof ClientFormValues, value: string | string[]) => setForm(prev => ({ ...prev, [key]: value }));
  React.useEffect(() => {
    let disposed = false;
    fetchStorageCleanupJobs().then(jobs => {
      if (!disposed) setCleanupJobs(jobs);
    }).catch(err => {
      if (!disposed) setCleanupError(err instanceof Error ? err.message : 'Could not load cloud cleanup jobs.');
    });
    return () => { disposed = true; };
  }, []);
  React.useEffect(() => {
    let disposed = false;
    if (!selectedClient) return undefined;
    setPortalAccessLoading(true);
    setPortalMessage('');
    setPortalError('');
    setPortalInviteLink('');
    fetchClientPortalAccess(selectedClient.id)
      .then(access => {
        if (!disposed) {
          setPortalAccessEnabled(access.linked);
          setPortalStatus(access.status);
          setPortalTelegramLinked(access.telegramLinked);
          if (access.portalLink) setPortalInviteLink(access.portalLink);
        }
      })
      .catch(err => {
        if (!disposed) setPortalError(err instanceof Error ? err.message : 'Could not load portal access.');
      })
      .finally(() => {
        if (!disposed) setPortalAccessLoading(false);
      });
    return () => { disposed = true; };
  }, [selectedClient?.id]);
  React.useEffect(() => {
    let disposed = false;
    if (!s.clients.length) {
      setPortalCardStates({});
      return () => { disposed = true; };
    }
    Promise.all(s.clients.map(async client => {
      try {
        const access = await fetchClientPortalAccess(client.id);
        return [client.id, { status: access.status === 'account_created' || access.status === 'invitation_expired' || access.status === 'invitation_pending' || access.status === 'paused' || access.status === 'revoked' ? access.status : 'not_started', link: access.portalLink }] as const;
      } catch {
        return [client.id, { status: 'unavailable', link: null }] as const;
      }
    })).then(entries => {
      if (!disposed) setPortalCardStates(Object.fromEntries(entries));
    });
    return () => { disposed = true; };
  }, [s.clients]);

  async function inviteSelectedClientToPortal() {
    if (!selectedClient || portalActionLoading) return;
    setPortalActionLoading(true);
    setPortalMessage('');
    setPortalError('');
    setPortalInviteLink('');
    try {
      const result = await inviteClientToPortal(selectedClient.id);
      setPortalInviteLink(result.link);
      setPortalStatus(result.status === 'account_created' ? 'account_created' : 'invitation_pending');
      setPortalCardStates(previous => ({ ...previous, [selectedClient.id]: { status: result.status === 'account_created' ? 'account_created' : 'invitation_pending', link: result.link } }));
      setPortalMessage(result.status === 'account_created'
        ? `This client already has a portal account. Use the normal portal link to sign in.`
        : `A private invitation for ${result.email} is ready. The same link will be reused until the client creates their account.`);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not send the portal invitation.');
    } finally {
      setPortalActionLoading(false);
    }

  }

  async function copyPortalInviteLink() {
    if (!portalInviteLink) return;
    try {
      await navigator.clipboard.writeText(portalInviteLink);
      setPortalMessage('Invitation link copied. Send it directly to the client in your private conversation.');
    } catch {
      setPortalError('Could not copy the invitation link. Select and copy it manually.');
    }
  }

  async function sendPortalLinkToTelegram() {
    if (!selectedClient || portalTelegramLoading) return;
    setPortalTelegramLoading(true);
    setPortalMessage('');
    setPortalError('');
    try {
      const result = await sendClientPortalLinkToTelegram(selectedClient.id);
      setPortalInviteLink(result.link);
      setPortalMessage(result.accountCreated
        ? 'The normal client portal sign-in link was sent to the client’s linked Telegram chat.'
        : 'The one-time portal account-creation link was sent to the client’s linked Telegram chat.');
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not send the portal link through Telegram.');
    } finally {
      setPortalTelegramLoading(false);
    }
  }

  async function revokeSelectedClientPortalAccess() {
    if (!selectedClient || portalActionLoading) return;
    if (!window.confirm(`Revoke client portal access for ${selectedClient.name}?`)) return;
    setPortalActionLoading(true);
    setPortalMessage('');
    setPortalError('');
    setPortalInviteLink('');
    try {
      await revokeClientPortalAccess(selectedClient.id);
      setPortalAccessEnabled(false);
      setPortalStatus('revoked');
      setPortalCardStates(previous => ({ ...previous, [selectedClient.id]: { status: 'revoked', link: null } }));
      setPortalMessage('Portal access was revoked and the old client portal account was deleted. Create a new secure account link when you are ready to invite this client again.');
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not revoke portal access.');
    } finally {
      setPortalActionLoading(false);
    }
  }

  async function pauseOrResumeSelectedClientPortalAccess(action: 'pause' | 'resume') {
    if (!selectedClient || portalActionLoading) return;
    const verb = action === 'pause' ? 'Pause' : 'Resume';
    if (!window.confirm(`${verb} client portal access for ${selectedClient.name}?`)) return;
    setPortalActionLoading(true);
    setPortalMessage('');
    setPortalError('');
    try {
      const result = await updateClientPortalAccess(selectedClient.id, action);
      setPortalAccessEnabled(action === 'resume');
      setPortalStatus(action === 'resume' ? 'account_created' : 'paused');
      setPortalCardStates(previous => ({ ...previous, [selectedClient.id]: { status: action === 'resume' ? 'account_created' : 'paused', link: action === 'resume' ? 'https://orvvexa.vercel.app/portal' : null } }));
      setPortalInviteLink(action === 'resume' ? 'https://orvvexa.vercel.app/portal' : '');
      setPortalMessage(action === 'pause'
        ? 'Portal access is paused. The client account and documents are preserved; sign-in and uploads are blocked until you resume access.'
        : `Portal access is active again (${result.status}). The client can sign in using the normal portal link.`);
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : `Could not ${action} portal access.`);
    } finally {
      setPortalActionLoading(false);
    }
  }
  async function save() {
    if (!form.name.trim()) { setError('Client name is required.'); return; }
    if (!form.countryId) { setError('Please select a supported country.'); return; }
    setSaving(true); setError('');
    try {
      const saved: any = await createClient(form as any);
      if (!saved) throw new Error('Could not save client.');
      setPortalNotice(saved.portalInvitation?.link
        ? `Client created. A one-time portal invitation is ready for ${saved.email} and expires in 30 days.`
        : 'Client created. Add an email address later to enable the secure client portal.');
      if (saved.portalInvitation?.link) setPortalInviteLink(saved.portalInvitation.link);
      setPortalCardStates(previous => ({ ...previous, [saved.id]: { status: saved.portalInvitation?.link ? 'invitation_pending' : 'not_started', link: saved.portalInvitation?.link || null } }));
      dispatch({ type: 'ADD_CLIENT', client: { id: saved.id, name: saved.name, entityType: saved.entity_type || form.entityType, short: saved.name.slice(0, 3).toUpperCase(), city: 'Local', country: saved.country_name || 'Selected country', countryId: saved.country_id || form.countryId, cur: saved.currency_code || 'INR', gstin: saved.gstin || '', pan: saved.pan || '', svc: saved.filing_types || form.filingTypes, filingTypes: saved.filing_types || form.filingTypes, contact: saved.email || '', phone: saved.phone || '', fee: 0, tone: 'blue', alias: [] } });
      setShowAdd(false); setForm({ name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] });
      emitToast({ kind: 'success', title: 'Client created', message: `${saved.name} was added to your practice.`, eventType: 'client.created', entityType: 'client', entityId: saved.id });
    } catch (err: any) { setError(err.message || 'Could not save client.'); emitToast({ kind: 'error', title: 'Client could not be saved', message: err.message || 'Could not save client.', eventType: 'client.create_failed' }); }
    finally { setSaving(false); }
  }
  function startEditing() {
    if (!selectedClient) return;
    setEditForm({ name: selectedClient.name, entityType: selectedClient.entityType || 'Individual', pan: selectedClient.pan, gstin: selectedClient.gstin, phone: selectedClient.phone, email: selectedClient.contact, countryId: selectedClient.countryId || '', filingTypes: selectedClient.filingTypes?.length ? [...selectedClient.filingTypes] : [...selectedClient.svc] });
    setEditError('');
    setDeleteConfirm(false);
    setDeleteError('');
    setEditingClient(true);
  }

  async function permanentlyDeleteClient() {
    if (!selectedClient || deleteSaving) return;
    setDeleteSaving(true);
    setDeleteError('');
    setCleanupSuccess('');
    try {
      const deleted = await deleteClient(selectedClient.id);
      dispatch({ type: 'DELETE_CLIENT', id: selectedClient.id });
      const deletionJobId = deleted.deletionJobId;
      if (deletionJobId) {
        setCleanupJobs(previous => [{
          id: deletionJobId,
          target_type: 'client',
          status: 'pending',
          attempt_count: 0,
          created_at: new Date().toISOString(),
          completed_at: null,
          message: `Deletion of ${deleted.name} and its cloud files is queued.`
        }, ...previous.filter(job => job.id !== deletionJobId)]);
        setPortalNotice('');
        setCleanupError('');
      } else {
        setPortalNotice(`${deleted.name} was removed from demo data.`);
      }
      setDeleteConfirm(false);
      setEditingClient(false);
      setSelectedClient(null);
      emitToast({ kind: 'success', title: 'Client deletion queued', message: `${deleted.name} was removed from the active list. Cloud files and the portal account are still being cleaned up; success will appear when cleanup completes.`, eventType: 'client.delete_queued', entityType: 'client', entityId: deleted.id });
    } catch (err: any) {
      setDeleteError(err.message || 'Could not delete this client. Nothing was removed.');
      emitToast({ kind: 'error', title: 'Client could not be deleted', message: err.message || 'Nothing was removed.', eventType: 'client.delete_failed', entityType: 'client', entityId: selectedClient?.id || null });
    } finally {
      setDeleteSaving(false);
    }
  }

  async function refreshCleanupJob(jobId: string) {
    if (cleanupLoading) return;
    setCleanupLoading(true);
    setCleanupError('');
    try {
      const updatedJob = await fetchStorageCleanupJob(jobId);
      setCleanupJobs(previous => previous.map(job => job.id === jobId ? updatedJob : job));
      if (updatedJob.status === 'completed') {
        setCleanupSuccess(updatedJob.message || 'Client data, cloud files, and the portal account were deleted successfully.');
        setCleanupError('');
        window.setTimeout(() => {
          setCleanupJobs(previous => previous.filter(job => job.id !== jobId));
          setCleanupSuccess('');
        }, 3000);
      } else if (updatedJob.status === 'failed') {
        setCleanupSuccess('');
        setCleanupError(updatedJob.error_message || updatedJob.last_error || updatedJob.message || 'Cloud cleanup failed and needs a retry.');
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : 'Could not load cloud cleanup status.');
    } finally {
      setCleanupLoading(false);
    }
  }

  async function retryCleanupJob(jobId: string) {
    if (cleanupLoading) return;
    setCleanupLoading(true);
    setCleanupError('');
    try {
      await retryStorageCleanupJob(jobId);
      setCleanupSuccess('');
      setCleanupJobs(previous => previous.map(job => job.id === jobId
        ? { ...job, status: 'pending', attempt_count: 0, message: 'Cloud cleanup was queued for retry.' }
        : job));
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : 'Could not retry cloud cleanup.');
    } finally {
      setCleanupLoading(false);
    }
  }
  React.useEffect(() => {
    const activeJobs = cleanupJobs.filter(job => job.status !== 'completed');
    if (!activeJobs.length) return undefined;
    const timer = window.setInterval(() => {
      activeJobs.forEach(job => {
        if (job.status === 'failed') void retryCleanupJob(job.id);
        else void refreshCleanupJob(job.id);
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [cleanupJobs]);
  async function saveEdit() {
    if (!selectedClient || !editForm.name.trim()) { setEditError('Client name is required.'); return; }
    if (!editForm.countryId) { setEditError('Please select a supported country.'); return; }
    setEditSaving(true); setEditError('');
    try {
      const saved: any = await updateClient(selectedClient.id, editForm as any);
      const updated = { ...selectedClient, name: saved.name || editForm.name.trim(), entityType: saved.entity_type || editForm.entityType, countryId: saved.country_id || editForm.countryId, country: saved.country_name || selectedClient.country, short: (saved.name || editForm.name).slice(0, 3).toUpperCase(), gstin: saved.gstin || '', pan: saved.pan || '', svc: Array.isArray(saved.filing_types) ? saved.filing_types : editForm.filingTypes, filingTypes: Array.isArray(saved.filing_types) ? saved.filing_types : editForm.filingTypes, contact: saved.email || '', phone: saved.phone || '' };
      dispatch({ type: 'UPDATE_CLIENT', client: updated });
      setSelectedClient(updated);
      if (saved.portalAccessReset) {
        setPortalAccessEnabled(false);
        setPortalInviteLink(saved.portalInviteLink || '');
        if (saved.portalInviteDeliveryStatus === 'sent') {
          setPortalMessage(`Portal email changed from ${selectedClient.contact || 'not set'} to ${saved.email}. The previous portal login was disconnected, existing documents were kept, and a fresh invitation was sent to the client's linked Telegram chat. The client must create a new account using ${saved.email}.`);
        } else if (saved.portalInviteLink) {
          setPortalMessage(`Portal email changed from ${selectedClient.contact || 'not set'} to ${saved.email}. The previous portal login was disconnected and existing documents were kept. Copy the fresh invitation below and send it privately to the client so they can create a new account using ${saved.email}.`);
        } else {
          setPortalMessage(`Portal email changed to ${saved.email || 'the new address'}. The previous portal login was disconnected and existing documents were kept. Create a fresh invitation link below and send it privately to the client.`);
        }
      }
      setPortalError(saved.portalAccessWarning || '');
      setEditingClient(false);
      emitToast({ kind: 'success', title: 'Client updated', message: `${updated.name} was updated successfully.`, eventType: 'client.updated', entityType: 'client', entityId: updated.id });
    } catch (err: any) {
      const message = err.message || 'Could not update client.';
      setEditError(message);
      emitToast({ kind: 'error', title: 'Client could not be updated', message, eventType: 'client.update_failed', entityType: 'client', entityId: selectedClient?.id || null });
    }
    finally { setEditSaving(false); }
  }
  return (
    <>
      <div className="ph" data-tour="clients-intro"><div><p>Everyone you file for, with their services and current workload.</p></div><button className="btn pri" onClick={() => setShowAdd(true)}>+ Add client</button></div>
      {portalNotice && <div className="ob-error" role="status">{portalNotice}</div>}
      {(cleanupJobs.length > 0 || cleanupError) && <div className="vault-lifecycle-panel card" aria-label="Client cleanup jobs">
        <div><b>Client cloud cleanup</b><small>Deletion is queued in Supabase; it retries automatically if Storage is temporarily unavailable.</small></div>
        {cleanupError && <span className="ob-error" role="alert">{cleanupError}</span>}
        {cleanupSuccess && <span className="ob-success" role="status">{cleanupSuccess}</span>}
        {cleanupJobs.map(job => <div className="vault-cleanup-row" key={job.id} role="status">
          <span><b>{job.message}</b><small>Status: {job.status}</small>{job.error_message && job.status !== 'completed' && <small className="ob-error">Reason: {job.error_message}</small>}</span>
          <div className="vault-lifecycle-actions">
            <button className="btn sm" onClick={() => void refreshCleanupJob(job.id)} disabled={cleanupLoading}>{cleanupLoading ? 'Checking…' : 'Check status'}</button>
            {(job.status === 'failed' || job.status === 'retrying') && <button className="btn sm" onClick={() => void retryCleanupJob(job.id)} disabled={cleanupLoading}>Retry cleanup</button>}
          </div>
        </div>)}
      </div>}
      {!s.clients.length ? <section className="card client-empty-state" data-tour="clients-empty" aria-labelledby="clients-empty-title">
        <div className="client-empty-visual"><div className="client-empty-orb"><Icon name="users" size={28} /></div><span className="client-empty-spark client-empty-spark-one"><Icon name="check" size={11} /></span><span className="client-empty-spark client-empty-spark-two"><Icon name="file" size={11} /></span></div>
        <div className="client-empty-copy"><span className="eyebrow"><span className="eyebrow-dot" />CLIENT WORKSPACE</span><h2 id="clients-empty-title">Your client list starts here</h2><p>Add your first client to organize filings, secure documents, deadlines, and extraction work in one place.</p><button className="btn pri" onClick={() => setShowAdd(true)}><Icon name="users" size={14} />Add your first client</button></div>
        <div className="client-empty-steps" aria-label="What you can do with a client workspace"><div><span><Icon name="folder" size={14} /></span><b>Keep records together</b><small>Profile, tax IDs, and selected filings</small></div><div><span><Icon name="spark" size={14} /></span><b>Extract with confidence</b><small>Review documents against the right client</small></div><div><span><Icon name="check" size={14} /></span><b>Stay ahead of work</b><small>Deadlines and missing documents in view</small></div></div>
      </section> : <div className="grid g3" data-tour="clients-list">
        {s.clients.map((c) => {
          const mine = allTasks(s.tasks).filter((x) => x.t.client === c.id);
          const pct = mine.length ? Math.round((sum(mine, (x) => x.done) / sum(mine, (x) => x.total)) * 100) : 0;
          const m = missing(s.checks, c.id).length;
          return (
            <div key={c.id} className={`card ccard${portalCardStates[c.id]?.status === 'invitation_pending' ? ' portal-pending' : portalCardStates[c.id]?.status === 'invitation_expired' ? ' portal-expired' : portalCardStates[c.id]?.status === 'paused' || portalCardStates[c.id]?.status === 'revoked' ? ' portal-paused' : ''}`}>
              <div className="row">
                <span className="av lg" style={{ ['--t' as any]: c.tone }}>{c.short.slice(0, 2).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}><b>{c.name}</b><div className="mut" style={{ fontSize: 12 }}>{c.city}, {c.country}</div></div>
              </div>
              <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 6 }}>{c.svc.map((sv) => <span key={sv} className="chip blue">{sv}</span>)}</div>
              <div className="kvs" style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', margin: '12px 0', fontSize: 12.5 }}>
                <span className="mut">Tax ID</span><b className="mono">{c.gstin}</b>
                <span className="mut">Contact</span><b>{c.contact}</b>
                <span className="mut">Fee</span><b>{money(c.fee, c.cur)} / mo</b>
              </div>
              <div className="row" style={{ marginBottom: 5 }}><span className="mut2">Work completed</span><span className="sp" /><b>{pct}%</b></div>
              <div className="bar"><i style={{ width: pct + '%' }} /></div>
              <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 6 }}>
                {m ? <span className="chip amber">{m} documents missing</span> : <span className="chip green">All documents received</span>}
                {portalCardStates[c.id]?.status === 'invitation_pending' && <span className="chip portal-card-chip">Portal setup pending</span>}
                {portalCardStates[c.id]?.status === 'invitation_expired' && <span className="chip portal-card-chip">Portal invite expired</span>}
                {portalCardStates[c.id]?.status === 'account_created' && <span className="chip green">Portal created & connected</span>}
                {portalCardStates[c.id]?.status === 'paused' && <span className="chip amber">Portal temporarily paused</span>}
                {portalCardStates[c.id]?.status === 'revoked' && <span className="chip amber">Portal revoked · new account required</span>}
                {portalCardStates[c.id]?.status === 'unavailable' && <span className="chip amber">Portal status unavailable</span>}
              </div>
              {portalCardStates[c.id]?.link && <div className="portal-card-link"><input value={portalCardStates[c.id].link || ''} readOnly aria-label={`${c.name} portal link`} onFocus={event => event.currentTarget.select()} /><button className="btn xs" onClick={() => { void navigator.clipboard.writeText(portalCardStates[c.id].link || ''); setPortalCardCopied(c.id); window.setTimeout(() => setPortalCardCopied(current => current === c.id ? '' : current), 1400); }}>{portalCardCopied === c.id ? 'Copied' : 'Copy link'}</button></div>}
              <div className="row"><button className="btn sm" onClick={() => setSelectedClient(c)}>View details</button><button className="btn sm" onClick={() => { dispatch({ type: 'WA_CLIENT', id: c.id }); dispatch({ type: 'GO', page: 'whatsapp' }); }}><Icon name="chat" size={13} />Chat</button></div>
            </div>
          );
        })}
      </div>}
      {selectedClient && <div className="modal client-details-modal" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedClient(null); }}>
        <div className="card client-details-card">
          <div className="card-h client-details-header"><div><span className="eyebrow">{editingClient ? 'Edit client' : 'Client profile'}</span><h2>{editingClient ? 'Update client details' : selectedClient.name}</h2></div><div className="client-details-actions">{!editingClient && <button className="icon-btn edit-client-btn" onClick={startEditing} title="Edit client" aria-label="Edit client"><Icon name="pencil" size={16} /></button>}<button className="btn" onClick={() => { setEditingClient(false); setSelectedClient(null); }}>Close</button></div></div>
          <div className={'card-b' + (editingClient ? ' client-edit-body' : '')}>
            {editingClient ? <>
              <div className="client-edit-intro"><span className="av lg" style={{ ['--t' as any]: selectedClient.tone }}>{selectedClient.short.slice(0, 2).toUpperCase()}</span><div><b>Edit {selectedClient.name}</b><div className="mut">Keep the client profile accurate for filings and communication.</div></div></div>
              <div className="client-edit-grid">
                <label className="f">Client / firm name *<input className="modal-input" value={editForm.name} onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))} /></label>
                <label className="f">Entity type<select className="modal-input" value={editForm.entityType} onChange={e => setEditForm(prev => ({ ...prev, entityType: e.target.value }))}><option>Individual</option><option>Partnership</option><option>Pvt Ltd</option><option>LLP</option><option>Trust</option><option>HUF</option><option>OPC</option></select></label>
                <label className="f">PAN<input className="modal-input" maxLength={10} value={editForm.pan} onChange={e => setEditForm(prev => ({ ...prev, pan: e.target.value.toUpperCase() }))} /></label>
                <label className="f">GSTIN<input className="modal-input" maxLength={15} value={editForm.gstin} onChange={e => setEditForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))} /></label>
                <label className="f">Phone<input className="modal-input" value={editForm.phone} onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))} /></label>
                <label className="f">Email<input className="modal-input" type="email" value={editForm.email} onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))} /></label>
              </div>
              <FilingTypePicker countryId={editForm.countryId} selectedTypes={editForm.filingTypes} onCountryChange={value => setEditForm(prev => ({ ...prev, countryId: value, filingTypes: [] }))} onTypesChange={value => setEditForm(prev => ({ ...prev, filingTypes: value }))} />
              {editError && <div className="ob-error">{editError}</div>}
              <div className="client-edit-footer"><button className="btn danger" onClick={() => { setDeleteError(''); setDeleteConfirm(true); }}>Delete client</button><span className="sp" /><button className="btn gh" onClick={() => setEditingClient(false)}>Cancel</button><button className="btn pri" disabled={editSaving || deleteSaving} onClick={saveEdit}>{editSaving ? <><i className="spin" />Saving</> : <><Icon name="check" size={14} />Save changes</>}</button></div>
            </> : <>
            <div className="client-details-identity"><span className="av lg" style={{ ['--t' as any]: selectedClient.tone }}>{selectedClient.short.slice(0, 2).toUpperCase()}</span><div><b>{selectedClient.name}</b><div className="mut">{selectedClient.city}, {selectedClient.country}</div></div></div>
            <div className="client-details-grid">
              <div><span>Entity type</span><b>{selectedClient.entityType || 'Not specified'}</b></div>
              <div><span>PAN</span><b className="mono">{selectedClient.pan || 'Not provided'}</b></div>
              <div><span>GSTIN</span><b className="mono">{selectedClient.gstin || 'Not provided'}</b></div>
              <div><span>Phone</span><b>{selectedClient.phone || 'Not provided'}</b></div>
              <div className="full"><span>Email</span><b>{selectedClient.contact || 'Not provided'}</b></div>
            </div>
            <div className="client-details-section"><span className="eyebrow">Selected filings</span><div className="client-details-filings">{(selectedClient.filingTypes?.length ? selectedClient.filingTypes : selectedClient.svc).map(type => <span key={type} className="chip blue">{type}</span>)}</div></div>
            <div className="client-details-section client-portal-access">
              <span className="eyebrow">Secure client portal</span>
              <p>Clients upload documents here. Files are stored in the configured private Supabase Storage bucket.</p>
              {portalAccessLoading && <div className="portal-access-skeleton" aria-busy="true" aria-label="Checking client portal access"><span /><span /><span /></div>}
              {portalError && <div className="ob-error" role="alert">{portalError}</div>}
              {portalMessage && <div className="portal-success-message" role="status">{portalMessage}</div>}
              <div className={`row${portalAccessLoading ? ' portal-controls-hidden' : ''}`}>
                <span className={`chip ${portalStatus === 'account_created' ? 'green' : portalStatus === 'invitation_pending' ? 'portal-card-chip' : 'amber'}`}>
                  {portalAccessLoading ? 'Checking access…' : portalStatus === 'account_created' ? 'Portal account created' : portalStatus === 'paused' ? 'Portal temporarily paused' : portalStatus === 'revoked' ? 'Portal revoked · new account required' : portalStatus === 'invitation_pending' ? 'Invitation pending' : portalStatus === 'invitation_expired' ? 'Invitation expired' : 'Invitation required'}
                </span>
                <span className="sp" />
                <button className="btn sm" disabled={portalTelegramLoading || portalActionLoading || !portalTelegramLinked} onClick={() => void sendPortalLinkToTelegram()} title={!portalTelegramLinked ? 'Link this client to Telegram first' : undefined}>{portalTelegramLoading ? 'Sending…' : 'Send via Telegram'}</button>
                {portalAccessEnabled && <button className="btn sm" disabled={portalActionLoading || portalAccessLoading} onClick={() => void pauseOrResumeSelectedClientPortalAccess('pause')}>{portalActionLoading ? 'Please wait…' : 'Pause access'}</button>}
                {portalStatus === 'paused' && <button className="btn sm pri" disabled={portalActionLoading || portalAccessLoading} onClick={() => void pauseOrResumeSelectedClientPortalAccess('resume')}>{portalActionLoading ? 'Please wait…' : 'Resume access'}</button>}
                {portalAccessEnabled && <button className="btn sm danger" disabled={portalActionLoading || portalAccessLoading} onClick={() => void revokeSelectedClientPortalAccess()}>{portalActionLoading ? 'Please wait…' : 'Revoke permanently'}</button>}
                {(portalStatus === 'not_started' || portalStatus === 'revoked' || portalStatus === 'invitation_expired') && <button className="btn sm pri" disabled={portalActionLoading || portalAccessLoading || !selectedClient.contact.trim()} onClick={() => void inviteSelectedClientToPortal()} title={!selectedClient.contact.trim() ? 'Add an email address to this client first' : undefined}>{portalActionLoading ? 'Creating link…' : portalStatus === 'revoked' ? 'Create new secure account link' : 'Create secure invite link'}</button>}
              </div>
              {portalStatus === 'invitation_expired' && !portalAccessLoading && <div className="portal-expired-note" role="status">This invitation expired after 30 days. Create a fresh link before sending it.</div>}
              {portalInviteLink && <div className={`client-portal-invite-link${portalAccessLoading ? ' portal-controls-hidden' : ''}`}>
                <label htmlFor="portal-invite-link">{portalStatus === 'account_created' ? 'Client portal sign-in link' : 'Private account creation link · expires in 30 days'}</label>
                <div className="row">
                  <input id="portal-invite-link" value={portalInviteLink} readOnly onFocus={event => event.currentTarget.select()} aria-label="Private portal invitation link" />
                  <button className="btn sm" onClick={() => void copyPortalInviteLink()}>Copy</button>
                </div>
                <small>{portalStatus === 'account_created' ? 'Use this normal portal link for the client’s future sign-ins.' : 'Anyone holding this one-time link can create the client account. Send it only to the client through a private channel.'}</small>
              </div>}
            </div>
            </>}
          </div>
        </div>
      </div>}
      {deleteConfirm && selectedClient && <div className="modal delete-confirm-modal" onMouseDown={e => { if (e.target === e.currentTarget && !deleteSaving) setDeleteConfirm(false); }}>
        <div className="card delete-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="delete-client-title">
          <div className="delete-confirm-icon"><Icon name="trash" size={22} /></div>
          <span className="eyebrow">Permanent deletion</span>
          <h2 id="delete-client-title">Delete {selectedClient.name}?</h2>
          <p>This permanently removes the client, filing selections, documents, deadlines, messages, AI records, and private cloud documents. This action cannot be undone.</p>
          {deleteError && <div className="ob-error">{deleteError}</div>}
          <div className="delete-confirm-actions"><button className="btn gh" disabled={deleteSaving} onClick={() => setDeleteConfirm(false)}>Cancel</button><button className="btn danger" disabled={deleteSaving} onClick={permanentlyDeleteClient}>{deleteSaving ? <><i className="spin" />Deleting</> : 'Permanently delete'}</button></div>
        </div>
      </div>}
      {showAdd && <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) setShowAdd(false); }}>
        <ClientFormCard
          form={form}
          onChange={update}
          error={error}
          onDismiss={() => setShowAdd(false)}
        >
          <button className="btn gh" onClick={() => setShowAdd(false)}>Cancel</button>
          <button className="btn pri" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save client'}</button>
        </ClientFormCard>
      </div>}
    </>
  );
}

function OpenRouterSettings() {
  const [desktopApp] = React.useState(isDesktopApp());
  const [keySaved, setKeySaved] = React.useState(false);
  const [useLocalKey, setUseLocalKey] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [editingKey, setEditingKey] = React.useState(false);
  const [models, setModels] = React.useState<OpenRouterModel[]>([]);
  const [selectedModel, setSelectedModel] = React.useState('');
  const [loadingModels, setLoadingModels] = React.useState(true);
  const [fallbackSettings, setFallbackSettings] = React.useState<OpenRouterFallbackSettings>({ enabled: true, maxAttempts: 3 });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  React.useEffect(() => {
    let active = true;
    if (!desktopApp) {
      setLoadingModels(false);
      setUseLocalKey(false);
      return () => { active = false; };
    }

    try {
      setUseLocalKey(isUsingLocalOpenRouterKey());
      setFallbackSettings(getOpenRouterFallbackSettings());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not read the AI provider setting.');
    }

    hasOpenRouterApiKey()
      .then(saved => {
        if (!active) return;
        setKeySaved(saved);
        if (!saved && isUsingLocalOpenRouterKey()) {
          setUsingLocalOpenRouterKey(false);
          setUseLocalKey(false);
          setError('The saved OpenRouter key is unavailable. The app has switched back to the Orvexa AI service.');
        }
      })
      .catch(loadError => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not check secure key storage.');
      });

    fetchOpenRouterModels()
      .then(availableModels => {
        if (!active) return;
        setModels(availableModels);
        const savedModel = getSelectedOpenRouterModel();
        const nextModel = availableModels.some(model => model.id === savedModel)
          ? savedModel
          : availableModels[0].id;
        setSelectedModel(nextModel);
        setSelectedOpenRouterModel(nextModel);
      })
      .catch(loadError => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load OpenRouter models.');
          try {
            const previouslySelected = getSelectedOpenRouterModel();
            if (previouslySelected) {
              setSelectedModel(previouslySelected);
              setModels([{ id: previouslySelected, name: previouslySelected, context_length: 0 }]);
            }
          } catch {
            // The model catalog error is more useful than a second storage error here.
          }
        }
      })
      .finally(() => { if (active) setLoadingModels(false); });

    return () => { active = false; };
  }, []);

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey.startsWith('sk-or-v1-') || trimmedKey.length <= 'sk-or-v1-'.length || trimmedKey.length > 1024) {
      setError('Enter a valid OpenRouter API key beginning with sk-or-v1-.');
      setNotice('');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await saveOpenRouterApiKey(trimmedKey);
      setApiKey('');
      setKeySaved(true);
      setEditingKey(false);
      setNotice('OpenRouter key saved in Windows Credential Manager. OpenRouter will validate it when you make your first AI request.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the OpenRouter key securely.');
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      setUsingLocalOpenRouterKey(false);
      setUseLocalKey(false);
      await deleteOpenRouterApiKey();
      setKeySaved(false);
      setApiKey('');
      setEditingKey(false);
      setNotice('OpenRouter key removed from Windows Credential Manager.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the OpenRouter key.');
    } finally {
      setSaving(false);
    }
  }

  function toggleLocalKey() {
    const next = !useLocalKey;
    setError('');
    setNotice('');
    try {
      setUsingLocalOpenRouterKey(next);
      setUseLocalKey(next);
      setNotice(next
        ? 'Other supported AI requests will use your saved OpenRouter key. Chat also uses the saved key automatically.'
        : 'Other supported AI requests will use the current Orvexa AI service. Chat still uses a saved device key automatically.');
    } catch (settingError) {
      setError(settingError instanceof Error ? settingError.message : 'Could not update the AI provider setting.');
    }
  }

  function changeModel(model: string) {
    try {
      setSelectedOpenRouterModel(model);
      setSelectedModel(model);
      setError('');
      setNotice('OpenRouter model updated.');
    } catch (settingError) {
      setError(settingError instanceof Error ? settingError.message : 'Could not save the selected model.');
    }
  }

  function changeFallbackSettings(nextSettings: OpenRouterFallbackSettings) {
    try {
      setOpenRouterFallbackSettings(nextSettings);
      setFallbackSettings(nextSettings);
      setError('');
      setNotice('OpenRouter fallback settings updated.');
    } catch (settingError) {
      setError(settingError instanceof Error ? settingError.message : 'Could not save the fallback settings.');
    }
  }

  return (
    <section className="card ai-provider-card" aria-labelledby="ai-provider-title">
      <div className="card-h">
        <div><h2 id="ai-provider-title">AI provider</h2><p>Choose how this app sends AI requests.</p></div>
        <span className="chip cyan"><Icon name="spark" size={12} />OpenRouter</span>
      </div>
      <div className="card-b">
        <div className="fields-grid-2">
          <div className="ai-setting-field">
            <label htmlFor="ai-provider">Provider</label>
            <select id="ai-provider" className="sel" value="openrouter" disabled>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>
          <div className="ai-setting-field">
            <label htmlFor="ai-model">OpenRouter model</label>
            <select
              id="ai-model"
              className="sel"
              value={selectedModel}
              onChange={event => changeModel(event.target.value)}
              disabled={loadingModels || !models.length || saving}
            >
              {loadingModels && <option value="">Loading eligible models…</option>}
              {!loadingModels && !models.length && <option value="">No eligible models available</option>}
              {models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
            <small>This is the first model tried. If it has a temporary or model-specific error, enabled fallback can try other models.</small>
          </div>
        </div>

        <div className="setrow ai-fallback-row">
          <div className="tx">
            <b>Automatically try fallback models</b>
            <small>On temporary failures, try distinct models after your selected model. The first request counts toward the limit, and each attempt uses a separate OpenRouter request.</small>
          </div>
          <div className="ai-fallback-controls">
            <select
              id="ai-fallback-attempts"
              className="sel"
              value={fallbackSettings.maxAttempts}
              onChange={event => changeFallbackSettings({
                ...fallbackSettings,
                maxAttempts: Number(event.target.value) as OpenRouterFallbackSettings['maxAttempts'],
              })}
              disabled={!fallbackSettings.enabled || loadingModels || !models.length || saving}
              aria-label="Maximum model attempts"
            >
              <option value={2}>2 attempts</option>
              <option value={3}>3 attempts</option>
              <option value={5}>5 attempts</option>
            </select>
            <button
              className={'tg' + (fallbackSettings.enabled ? ' on' : '')}
              type="button"
              role="switch"
              aria-label="Automatically try fallback models"
              aria-checked={fallbackSettings.enabled}
              onClick={() => changeFallbackSettings({ ...fallbackSettings, enabled: !fallbackSettings.enabled })}
              disabled={loadingModels || !models.length || saving}
            />
          </div>
        </div>

        <form className="ai-key-form" onSubmit={saveKey}>
          <div className="ai-setting-field">
            <label htmlFor="openrouter-api-key">OpenRouter API key</label>
            <input
              id="openrouter-api-key"
              className="inp"
              type="password"
              value={keySaved && !editingKey && !apiKey ? '••••••••••••••••' : apiKey}
              onFocus={() => {
                if (keySaved && !editingKey) {
                  setEditingKey(true);
                  setApiKey('');
                }
              }}
              onChange={event => setApiKey(event.target.value)}
              onBlur={() => {
                if (editingKey && !apiKey) setEditingKey(false);
              }}
              placeholder={keySaved ? 'Enter a new key to replace the saved key' : 'Enter your OpenRouter API key for AI usage'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={!desktopApp || saving}
              aria-describedby="openrouter-key-help openrouter-settings-error"
            />
            <small id="openrouter-key-help">
              {keySaved ? 'A key is saved on this Windows device. Click the field to enter a replacement; the saved key is never displayed or sent to the Orvexa backend.' : 'Enter your own OpenRouter API key. It is saved only in Windows Credential Manager.'}
            </small>
          </div>
          <div className="ai-key-actions">
            <button className="btn pri" type="submit" disabled={!desktopApp || saving || !apiKey.trim()}>
              {saving ? 'Saving…' : keySaved ? 'Replace key' : 'Save key'}
            </button>
            {keySaved && <button className="btn" type="button" onClick={removeKey} disabled={saving}>Remove key</button>}
          </div>
        </form>

        <div className="ai-provider-warning" role="note">
          <Icon name="info" size={15} />
          <p>Your key stays on this device. Chat uses it automatically when saved. When enabled, automatic fallback tries other listed models after temporary or model-specific failures; it does not retry invalid keys or unsupported input. Prompts and images sent through local-key features go directly to OpenRouter. Local-key extraction accepts JPG, PNG, WEBP, and GIF images only.</p>
        </div>

        <div className="setrow ai-local-key-row">
          <div className="tx">
            <b>Use my local OpenRouter key</b>
            <small>Chat uses a saved device key automatically. This switch controls local OpenRouter routing for other supported AI requests.</small>
          </div>
          <button
            className={'tg' + (useLocalKey ? ' on' : '')}
            type="button"
            role="switch"
            aria-label="Use my local OpenRouter key"
            aria-checked={useLocalKey}
            onClick={toggleLocalKey}
            disabled={!desktopApp || !keySaved || !selectedModel || saving}
          />
        </div>

        {error && <div id="openrouter-settings-error" className="ai-provider-message error" role="alert">{error}</div>}
        {notice && <div className="ai-provider-message success" role="status">{notice}</div>}
        {!desktopApp && <div className="ai-provider-message" role="status">Secure key storage is available only in the Windows desktop app.</div>}
      </div>
    </section>
  );
}

export function SettingsPage({ onStartTour }: { onStartTour?: () => void } = {}) {
  const s = useAppState();
  const dispatch = useDispatch();
  const row = (title: string, desc: string, key: keyof typeof s.settings) => (
    <div className="setrow" key={key}>
      <div className="tx"><b>{title}</b><small>{desc}</small></div>
      <button className={'tg' + (s.settings[key] ? ' on' : '')} role="switch" aria-checked={s.settings[key]} onClick={() => dispatch({ type: 'SETTING_TOGGLE', key })} />
    </div>
  );

  return (
    <>
      <div className="ph" data-tour="settings-intro"><div><p>Connections, automation rules and security.</p></div></div>
      <OpenRouterSettings />
      <div className="card" data-tour="automation-settings">
        <div className="card-b">
          {row('Extract new bills automatically', 'Read every bill as soon as it reaches a client folder', 'autoExtract')}
          {row('Remind clients before deadlines', 'Schedule a document request before each due date', 'autoRemind')}
          {row('Ask me before anything is sent', 'Reminders wait for your approval unless turned off', 'approve')}
          {row('Block duplicate invoices', 'Flag an invoice number that already exists for the same party', 'dupes')}
        </div>
      </div>
      <section className="card tour-replay-card" data-tour="settings-replay">
        <div><h2>Need a refresher?</h2><p>Replay the guided tour of your dashboard, client work, documents, and assistant.</p></div>
        <button type="button" className="btn" onClick={onStartTour}><Icon name="refresh" size={14} />Replay app tour</button>
      </section>
    </>
  );
}
