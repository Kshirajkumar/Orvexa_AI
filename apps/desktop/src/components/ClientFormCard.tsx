import React from 'react';
import { FilingTypePicker } from './FilingTypePicker';

export interface ClientFormValues {
  name: string;
  entityType: string;
  pan: string;
  gstin: string;
  phone: string;
  email: string;
  countryId: string;
  filingTypes: string[];
}

interface ClientFormCardProps {
  form: ClientFormValues;
  onChange: (field: keyof ClientFormValues, value: string | string[]) => void;
  error?: string;
  dismissLabel?: string;
  onDismiss?: () => void;
  children?: React.ReactNode;
}

export function ClientFormCard({
  form,
  onChange,
  error,
  dismissLabel,
  onDismiss,
  children,
}: ClientFormCardProps) {
  return (
    <div className="card client-form-card" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
      <div className="card-h">
        <h2>Add new client</h2>
        {onDismiss && <button className="btn gh" onClick={onDismiss}>{dismissLabel || 'Close'}</button>}
      </div>
      <div className="card-b">
        <div className="fields-grid-2">
          <label className="f">Client / firm name *<input className="modal-input" value={form.name} onChange={event => onChange('name', event.target.value)} /></label>
          <label className="f">Entity type<select className="modal-input" value={form.entityType} onChange={event => onChange('entityType', event.target.value)}><option>Individual</option><option>Partnership</option><option>Pvt Ltd</option><option>LLP</option><option>Trust</option><option>HUF</option><option>OPC</option></select></label>
          <label className="f">PAN<input className="modal-input" maxLength={10} value={form.pan} onChange={event => onChange('pan', event.target.value.toUpperCase())} /></label>
          <label className="f">GSTIN<input className="modal-input" maxLength={15} value={form.gstin} onChange={event => onChange('gstin', event.target.value.toUpperCase())} /></label>
          <label className="f">Phone<input className="modal-input" value={form.phone} onChange={event => onChange('phone', event.target.value)} /></label>
          <label className="f">Email<input className="modal-input" type="email" value={form.email} onChange={event => onChange('email', event.target.value)} /></label>
        </div>
        <FilingTypePicker
          countryId={form.countryId}
          selectedTypes={form.filingTypes}
          onCountryChange={value => {
            onChange('countryId', value);
            onChange('filingTypes', []);
          }}
          onTypesChange={value => onChange('filingTypes', value)}
        />
        {error && <div className="ob-error" style={{ marginTop: 14 }}>{error}</div>}
        {children && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20, gap: 8 }}>{children}</div>}
      </div>
    </div>
  );
}
