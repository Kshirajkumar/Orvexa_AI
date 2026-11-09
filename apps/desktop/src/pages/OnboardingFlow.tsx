/**
 * TaxFlow.AI — Onboarding Flow
 *
 * A premium onboarding shown to every new user
 * after their first login, until onboardingComplete = true.
 *
 * Personal profile and optional initial client setup.
 */

import { useState } from 'react';
import { useAppState, useDispatch } from '../state/store';
import { apiCompleteOnboarding, apiUpdateProfile, createClient } from '../lib/api';
import { ClientFormCard, type ClientFormValues } from '../components/ClientFormCard';
import { BrandLogo } from '../components/BrandLogo';

// ─── Client Row for adding clients inline ──────────────────────
interface ClientDraft extends ClientFormValues {
  id: string;
}

// ─── Main Onboarding Flow ──────────────────────────────────────
export function OnboardingFlow() {
  const state = useAppState();
  const dispatch = useDispatch();
  const user = state.currentUser!;

  const [name, setName] = useState(user.name || '');
  const [practiceType, setPracticeType] = useState(user.practiceType || 'Chartered Accountant (CA)');
  const [membershipNo, setMembershipNo] = useState(user.membershipNo || '');
  const [clients, setClients] = useState<ClientDraft[]>([]);
  const [step1Loading, setStep1Loading] = useState(false);
  const [step1Error, setStep1Error] = useState('');

  function addClient() {
    setClients(prev => [
      ...prev,
      { id: crypto.randomUUID(), name: '', entityType: 'Individual', pan: '', gstin: '', phone: '', email: '', countryId: '', filingTypes: [] }
    ]);
  }

  function updateClient(id: string, field: keyof ClientFormValues, value: string | string[]) {
    setClients(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  }

  function removeClient(id: string) {
    setClients(prev => prev.filter(c => c.id !== id));
  }

  // Save the profile and any clients added during onboarding.
  async function handleStep1Submit() {
    if (!name.trim()) { setStep1Error('Please enter your full name.'); return; }
    setStep1Loading(true);
    setStep1Error('');

    try {
      // Update profile in Supabase
      const profileRes = await apiUpdateProfile({ name: name.trim(), practiceType, membershipNo: membershipNo.trim() || undefined });
      if (!profileRes.success) throw new Error(profileRes.message || 'Failed to update profile');

      // Create each client
      const validClients = clients.filter(c => c.name.trim().length > 0);
      if (validClients.some(c => !c.countryId)) throw new Error('Please select a country for every client before continuing.');
      for (const c of validClients) {
        const created = await createClient({
          name: c.name.trim(),
          pan: c.pan.trim(),
          gstin: c.gstin.trim(),
          phone: c.phone.trim(),
          email: c.email.trim(),
          entityType: c.entityType,
          countryId: c.countryId,
          filingTypes: c.filingTypes,
          status: 'active'
        });
        if (!created) throw new Error(`Could not save client "${c.name.trim()}". Please try again.`);
      }

      const completion = await apiCompleteOnboarding();
      if (!completion.success) throw new Error(completion.message || 'Could not complete onboarding.');
      dispatch({ type: 'COMPLETE_ONBOARDING' });
    } catch (err: any) {
      setStep1Error(err.message || 'Something went wrong. Please try again.');
    } finally {
      setStep1Loading(false);
    }
  }

  return (
    <div className="ob-overlay">
      <div className="ob-card ob-slide-in">
        {/* Header */}
        <div className="ob-header">
          <div className="ob-logo">
            <BrandLogo className="onboarding-brand-logo" />
          </div>
        </div>

        {/* ── STEP 1: Profile & Clients ── */}
          <div className="ob-body">
            <h1 className="ob-title">Set Up Your Practice</h1>
            <p className="ob-subtitle">Let's configure your personal CA workspace and add your first clients so TaxFlow.AI is ready to go from day one.</p>

            <div className="ob-section-label">Your Practice Details</div>
            <div className="ob-form-grid">
              <input className="ob-input" placeholder="Your Full Name *" value={name} onChange={e => setName(e.target.value)} />
              <select className="ob-input ob-select" value={practiceType} onChange={e => setPracticeType(e.target.value)}>
                <option>Chartered Accountant (CA)</option>
                <option>Individual</option>
              </select>
              <input className="ob-input" placeholder="ICAI / Membership No. (optional)" value={membershipNo} onChange={e => setMembershipNo(e.target.value)} />
            </div>

            <div className="ob-section-label ob-mt">
              Your Clients
              <span className="ob-label-hint">Add some clients now or skip to add later</span>
            </div>
            <div className="ob-clients-list">
              {clients.map(c => (
                <ClientFormCard
                  key={c.id}
                  form={c}
                  onChange={(field, value) => updateClient(c.id, field, value)}
                  dismissLabel="Remove"
                  onDismiss={() => removeClient(c.id)}
                />
              ))}
              {clients.length === 0 && (
                <div className="ob-empty-clients">
                  <span>No clients added yet</span>
                </div>
              )}
            </div>
            <button className="ob-add-client-btn" onClick={addClient}>+ Add a Client</button>

            {step1Error && <div className="ob-error">{step1Error}</div>}

            <div className="ob-actions">
              <button className="ob-skip" onClick={() => void handleStep1Submit()}>Continue</button>
              <button className="ob-btn-primary" onClick={handleStep1Submit} disabled={step1Loading}>
                {step1Loading ? <span className="ob-spinner" /> : 'Save & Finish'}
              </button>
            </div>
          </div>

      </div>

      <style>{`
        .ob-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(ellipse at 20% 50%, rgba(99, 102, 241, 0.15) 0%, transparent 60%),
                      radial-gradient(ellipse at 80% 20%, rgba(16, 185, 129, 0.12) 0%, transparent 50%),
                      #0a0a0f;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 24px;
          overflow-y: auto;
        }

        .ob-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 24px;
          width: 100%;
          max-width: 760px;
          backdrop-filter: blur(24px);
          box-shadow: 0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
          overflow: hidden;
          transition: transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.35s;
        }

        .ob-slide-in  { transform: translateY(0);    opacity: 1; }
        .ob-slide-out { transform: translateY(-24px); opacity: 0; }

        .ob-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 28px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
          background: rgba(255,255,255,0.02);
        }

        .ob-logo { display: flex; align-items: center; }

        .ob-dots { display: flex; gap: 8px; }
        .ob-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.2);
          transition: all 0.3s;
        }
        .ob-dot.active { background: #6366f1; width: 24px; border-radius: 4px; }
        .ob-dot.done   { background: #10b981; }

        .ob-body { padding: 32px 28px 28px; }
        .ob-tour-body { padding-bottom: 20px; }

        .ob-step-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6366f1;
          background: rgba(99,102,241,0.12);
          border: 1px solid rgba(99,102,241,0.25);
          border-radius: 20px;
          padding: 4px 12px;
          margin-bottom: 14px;
        }

        .ob-title {
          font-size: 26px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
          margin: 0 0 10px;
          line-height: 1.2;
        }

        .ob-subtitle {
          font-size: 14.5px;
          color: rgba(255,255,255,0.6);
          margin: 0 0 24px;
          line-height: 1.6;
        }

        .ob-section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.4);
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ob-label-hint { font-size: 11px; font-weight: 400; text-transform: none; letter-spacing: 0; color: rgba(255,255,255,0.3); }
        .ob-mt { margin-top: 22px; }

        .ob-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .ob-input {
          width: 100%;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px 14px;
          color: #fff;
          font-size: 14px;
          outline: none;
          box-sizing: border-box;
          transition: border-color 0.2s, background 0.2s;
        }
        .ob-input::placeholder { color: rgba(255,255,255,0.3); }
        .ob-input:focus { border-color: rgba(99,102,241,0.6); background: rgba(255,255,255,0.09); }
        .ob-select { cursor: pointer; }
        .ob-select option { background: #1a1a2e; color: #fff; }

        .ob-clients-list { display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; padding-right: 2px; }
        .ob-empty-clients { text-align: center; padding: 16px; color: rgba(255,255,255,0.25); font-size: 13px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 10px; }

        .ob-client-row { display: flex; gap: 8px; align-items: flex-start; }
        .ob-client-fields { display: grid; grid-template-columns: 2fr 1fr 1.2fr 1.4fr 1fr; gap: 8px; flex: 1; }

        .ob-remove-btn {
          width: 34px; height: 38px;
          flex-shrink: 0;
          background: rgba(239,68,68,0.12);
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 8px;
          color: #ef4444;
          font-size: 12px;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s;
          margin-top: 1px;
        }
        .ob-remove-btn:hover { background: rgba(239,68,68,0.22); }

        .ob-add-client-btn {
          margin-top: 10px;
          background: none;
          border: 1px dashed rgba(99,102,241,0.4);
          border-radius: 10px;
          color: #6366f1;
          font-size: 13px;
          font-weight: 500;
          padding: 9px 16px;
          cursor: pointer;
          width: 100%;
          transition: background 0.2s, border-color 0.2s;
        }
        .ob-add-client-btn:hover { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.6); }

        .ob-error {
          margin-top: 12px;
          padding: 10px 14px;
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 10px;
          color: #fca5a5;
          font-size: 13px;
        }

        .ob-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 24px;
          gap: 12px;
        }
        .ob-actions-center { justify-content: center; }

        .ob-skip {
          background: none;
          border: none;
          color: rgba(255,255,255,0.4);
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          transition: color 0.2s;
        }
        .ob-skip:hover { color: rgba(255,255,255,0.7); }

        .ob-btn-primary {
          display: flex;
          align-items: center;
          gap: 8px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 12px;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          padding: 11px 24px;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 16px rgba(99,102,241,0.3);
          white-space: nowrap;
        }
        .ob-btn-primary:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(99,102,241,0.4); }
        .ob-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .ob-btn-large { font-size: 15px; padding: 13px 32px; }

        .ob-btn-secondary {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          color: rgba(255,255,255,0.8);
          font-size: 13px;
          font-weight: 500;
          padding: 10px 16px;
          cursor: pointer;
          transition: background 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ob-btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
        .ob-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

        .ob-spinner {
          display: inline-block;
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: ob-spin 0.7s linear infinite;
        }
        @keyframes ob-spin { to { transform: rotate(360deg); } }

        /* Vault step */
        .ob-vault-visual {
          display: flex;
          align-items: center;
          gap: 20px;
          background: rgba(16,185,129,0.06);
          border: 1px solid rgba(16,185,129,0.15);
          border-radius: 14px;
          padding: 20px 24px;
          margin-bottom: 20px;
        }
        .ob-vault-icon { font-size: 40px; }
        .ob-vault-lines { display: flex; flex-direction: column; gap: 6px; flex: 1; }
        .ob-vault-line {
          height: 8px;
          background: linear-gradient(90deg, rgba(16,185,129,0.4), rgba(16,185,129,0.1));
          border-radius: 4px;
          animation: ob-pulse 2s ease-in-out infinite;
        }
        .ob-vault-line.l1 { width: 70%; }
        .ob-vault-line.l2 { width: 90%; animation-delay: 0.3s; }
        .ob-vault-line.l3 { width: 55%; animation-delay: 0.6s; }
        @keyframes ob-pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }

        .ob-vault-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 20px;
        }
        .ob-vault-info-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(255,255,255,0.04);
          border-radius: 10px;
          font-size: 13px;
          color: rgba(255,255,255,0.65);
        }
        .ob-vault-info-icon { font-size: 16px; }

        .ob-vault-path-row { display: flex; gap: 10px; align-items: center; }
        .ob-vault-input { flex: 1; font-family: monospace; font-size: 13px; }

        .ob-vault-note { margin-top: 10px; color: var(--tx2); font-size: 12px; }
        .ob-vault-preview {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 10px;
          padding: 10px 14px;
          background: rgba(16,185,129,0.08);
          border: 1px solid rgba(16,185,129,0.2);
          border-radius: 10px;
          font-size: 13px;
          color: #6ee7b7;
        }
        .ob-vault-preview code { font-family: monospace; word-break: break-all; }

        .ob-vault-success {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 12px;
          padding: 12px 16px;
          background: rgba(16,185,129,0.12);
          border: 1px solid rgba(16,185,129,0.3);
          border-radius: 10px;
          color: #6ee7b7;
          font-size: 14px;
          font-weight: 500;
          animation: ob-fade-in 0.4s ease;
        }
        .ob-success-check {
          width: 24px; height: 24px;
          background: #10b981;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
        }

        /* Tour step */
        .ob-features-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 380px;
          overflow-y: auto;
          padding-right: 4px;
          margin-bottom: 8px;
        }

        .ob-feature-card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 14px 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.4s ease, transform 0.4s ease, background 0.2s;
        }
        .ob-feature-card.visible { opacity: 1; transform: translateY(0); }
        .ob-feature-card:hover { background: rgba(255,255,255,0.07); }

        .ob-feature-icon { font-size: 22px; flex-shrink: 0; margin-top: 1px; }
        .ob-feature-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 3px; }
        .ob-feature-desc { font-size: 12.5px; color: rgba(255,255,255,0.5); line-height: 1.5; }

        @keyframes ob-fade-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }

        /* Scrollbar */
        .ob-clients-list::-webkit-scrollbar,
        .ob-features-grid::-webkit-scrollbar { width: 4px; }
        .ob-clients-list::-webkit-scrollbar-track,
        .ob-features-grid::-webkit-scrollbar-track { background: transparent; }
        .ob-clients-list::-webkit-scrollbar-thumb,
        .ob-features-grid::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}
