import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { useAppState, useDispatch } from '../state/store';
import {
  approveInvoiceReview,
  fetchDocumentPreview,
  InvoiceReviewError,
  verifyDocumentExtraction,
  type InvoiceDuplicate,
} from '../lib/api';

const NUMERIC_FIELDS = new Set([
  'taxable_value', 'cgst_rate', 'cgst_amount', 'sgst_rate', 'sgst_amount',
  'igst_rate', 'igst_amount', 'total_gst', 'grand_total', 'quantity',
  'unit_price', 'gst_rate', 'total_amount',
  'gross_total_income', 'deductions_80c', 'deductions_80d', 'other_deductions',
  'taxable_income', 'tax_payable', 'tds_deducted', 'advance_tax', 'refund_due',
  'gross_salary', 'hra_exemption', 'lta_exemption', 'standard_deduction',
  'professional_tax', 'section_80c', 'section_80d', 'net_taxable_income',
  'tax_deducted', 'surcharge', 'cess', 'total_tds', 'opening_balance',
  'closing_balance', 'total_credits', 'total_debits', 'transaction_count',
  'demand_amount',
]);
const JSON_FIELDS = new Set(['hsn_codes', 'line_items']);

function labelFor(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function printable(value: unknown) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value ?? '');
}

function differs(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

export function ExtractionReviewPage() {
  const s = useAppState();
  const dispatch = useDispatch();
  const review = s.ui.review || { documentId: '', clientId: '', fileName: '', category: '', extractedData: {} };
  const [fields, setFields] = useState<Record<string, unknown>>(review.extractedData || {});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [loadingFile, setLoadingFile] = useState(true);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(false);
  const [duplicate, setDuplicate] = useState<InvoiceDuplicate | null>(null);
  const [duplicateExact, setDuplicateExact] = useState(false);
  const [retryTargetId, setRetryTargetId] = useState<string | undefined>();
  const client = s.clients.find(item => item.id === review.clientId);
  const entries = useMemo(() => Object.entries(fields), [fields]);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const isInvoice = review.category === 'GST';

  useEffect(() => {
    const initialFields = review.extractedData || {};
    setFields(initialFields);
    setEditValues(Object.fromEntries(Object.entries(initialFields).map(([key, value]) => [key, printable(value)])));
    setFieldErrors({});
    setApproved(false);
    setPendingSave(false);
    setMessage('');
    setDuplicate(null);
    setLoadingFile(true);
    setFileError('');
    setPreviewUrl('');
    setPreviewType('');
    if (!review.documentId) {
      setLoadingFile(false);
      setFileError('No extraction document was selected.');
      return;
    }

    const controller = new AbortController();
    let objectUrl = '';
    fetchDocumentPreview(review.documentId, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
      setPreviewType(blob.type || 'application/octet-stream');
    }).catch(error => {
      if (error?.name !== 'AbortError') setFileError(error?.message || 'The original file could not be opened.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingFile(false);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [review.documentId, review.extractedData]);

  function updateField(key: string, value: string) {
    setEditValues(previous => ({ ...previous, [key]: value }));
    setDuplicate(null);
    setDuplicateExact(false);
    setRetryTargetId(undefined);
    setPendingSave(false);
    setMessage('');
    setFieldErrors(previous => {
      const next = { ...previous };
      delete next[key];
      return next;
    });

    if (JSON_FIELDS.has(key) || (fields[key] !== null && typeof fields[key] === 'object')) {
      try {
        setFields(previous => ({ ...previous, [key]: JSON.parse(value) }));
      } catch {
        setFieldErrors(previous => ({ ...previous, [key]: 'Enter valid JSON for this list.' }));
      }
      return;
    }
    if (NUMERIC_FIELDS.has(key)) {
      if (!value.trim()) {
        setFields(previous => ({ ...previous, [key]: null }));
        return;
      }
      const number = Number(value);
      if (!Number.isFinite(number)) {
        setFieldErrors(previous => ({ ...previous, [key]: 'Enter a valid number.' }));
        return;
      }
      setFields(previous => ({ ...previous, [key]: number }));
      return;
    }
    setFields(previous => ({ ...previous, [key]: value || null }));
  }

  async function approve(existingInvoiceId?: string) {
    if (!review.documentId || saving || approved || hasFieldErrors) return;
    setSaving(true);
    setMessage('');
    try {
      if (isInvoice) {
        const result = await approveInvoiceReview(review.documentId, fields, existingInvoiceId || retryTargetId);
        if (result.code === 'DUPLICATE_EXACT' || result.code === 'DUPLICATE_MATCH') {
          setDuplicate(result.data?.invoice || null);
          setDuplicateExact(result.code === 'DUPLICATE_EXACT');
          setMessage(result.message);
          return;
        }
        if (result.code === 'PENDING_REVIEW_DATA') {
          if (!result.data?.reviewedData) throw new Error('The saved review data could not be restored. Keep this page open and retry.');
          setFields(result.data.reviewedData);
          setEditValues(Object.fromEntries(Object.entries(result.data.reviewedData).map(([key, value]) => [key, printable(value)])));
          setFieldErrors({});
          setDuplicate(null);
          setDuplicateExact(false);
          setPendingSave(true);
          setMessage(result.message);
          return;
        }
        setApproved(true);
        setPendingSave(false);
        setMessage(result.message || 'Invoice and review history saved successfully.');
        window.setTimeout(() => {
          dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' });
          dispatch({ type: 'GO', page: 'extract' });
        }, 650);
        return;
      }

      const result = await verifyDocumentExtraction(review.documentId, s.currentUser?.name || 'CA Admin', fields);
      if (!result?.success) throw new Error('The reviewed extraction could not be saved.');
      setApproved(true);
      setMessage('Reviewed data saved to the client record.');
      window.setTimeout(() => {
        dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' });
        dispatch({ type: 'GO', page: 'extract' });
      }, 650);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Approval failed. Please try again.');
      if (error instanceof InvoiceReviewError && error.retryable) {
        setPendingSave(true);
        setRetryTargetId(existingInvoiceId || retryTargetId);
      }
    } finally {
      setSaving(false);
    }
  }

  function leaveReview(page: 'extract' | 'files' = 'extract') {
    if (saving) return;
    dispatch({ type: 'CLEAR_EXTRACTION_REVIEW' });
    dispatch({ type: 'GO', page });
  }

  const differences = duplicate
    ? entries.filter(([key, value]) => differs(value, duplicate.data[key]))
    : [];

  if (!review.documentId) {
    return <div className="review-page">
      <div className="ph review-header">
        <div><div className="eyebrow review-eyebrow"><span className="review-orange-dot" />QUALITY CONTROL · AI EXTRACTION</div><h1>AI Data Extraction Review</h1><p>Open a completed extraction from the Extraction page to begin review.</p></div>
        <button className="btn pri" onClick={() => leaveReview()}><Icon name="scan" size={14} />Open Extraction</button>
      </div>
      <div className="card review-empty review-empty-card"><Icon name="table" size={24} /><b>No extraction is waiting for review</b><span>Run AI extraction first, then compare its editable values with the original file.</span></div>
    </div>;
  }

  return <div className="review-page">
    <div className="ph review-header">
      <div><div className="eyebrow review-eyebrow"><span className="review-orange-dot" />QUALITY CONTROL · AI EXTRACTION</div><h1>Review invoice data</h1><p>Compare every value with the original before approving it for the client record.</p></div>
      <div className="review-header-actions">
        <span className={'chip ' + (approved ? 'green' : 'amber')}>{approved ? <><Icon name="check" size={12} />Human verified</> : <><span className="warning-dot" />Review required</>}</span>
        <button className="btn gh" onClick={() => leaveReview()} disabled={saving || pendingSave}><Icon name="chev" size={14} className="review-back-icon" />Back to extraction</button>
      </div>
    </div>
    <div className="review-meta card">
      <div className="review-file-icon"><Icon name="file" size={20} /></div>
      <div><b>{review.fileName || 'Extraction document'}</b><small>{client?.name || 'Selected client'} · {review.category || 'Document'} · Original stored privately</small></div>
      <span className="review-meta-id mono">{review.documentId}</span>
    </div>
    <div className="review-tabs">
      <button className="review-tab active"><Icon name="table" size={15} />Extracted data <span>{entries.length} fields</span></button>
      <button className="review-tab"><Icon name="file" size={15} />Original document</button>
    </div>
    <div className="review-grid">
      <section className="card review-data-panel">
        <div className="card-h">
          <div><span className="section-kicker">EDITABLE FIELDS</span><h2>Check and correct values</h2></div>
          <span className="review-confidence"><i />AI confidence is not calibrated</span>
        </div>
        <div className="card-b">
          {entries.length ? <div className="review-fields">
            {entries.map(([key, value]) => {
                      const isJson = JSON_FIELDS.has(key) || (value !== null && typeof value === 'object');
                      const isNumber = NUMERIC_FIELDS.has(key) || typeof value === 'number';
              const isMissing = value === null || value === '';
              return <label className="review-field" key={key}>
                <span>{labelFor(key)}{isMissing && <em className="review-missing">Needs review</em>}</span>
                {isJson
                  ? <textarea aria-label={labelFor(key)} aria-invalid={Boolean(fieldErrors[key])} value={editValues[key] ?? printable(value)} onChange={event => updateField(key, event.target.value)} rows={5} disabled={pendingSave || saving} />
                  : <input aria-label={labelFor(key)} aria-invalid={Boolean(fieldErrors[key])} type={isNumber ? 'number' : 'text'} step={isNumber ? 'any' : undefined} value={editValues[key] ?? printable(value)} onChange={event => updateField(key, event.target.value)} disabled={pendingSave || saving} />}
                {fieldErrors[key] && <small className="review-field-error" role="alert">{fieldErrors[key]}</small>}
              </label>;
            })}
          </div> : <div className="review-empty"><Icon name="table" size={21} /><b>No extracted fields available</b><span>Return to extraction and run the AI pipeline again.</span></div>}
          <div className="review-footer">
            <div className="review-note"><Icon name="bell" size={14} /><span>AI confidence is not calibrated yet. Verify names, tax IDs, dates, line items, and totals against the source.</span></div>
            <button className="btn pri review-approve" disabled={!entries.length || saving || approved || hasFieldErrors} onClick={() => void approve()}>
              <Icon name={saving ? 'refresh' : approved ? 'check' : 'check'} size={14} className={saving ? 'ic spin' : 'ic'} />
              {saving ? 'Saving invoice securely…' : approved ? 'Review complete' : pendingSave ? 'Retry save' : 'Review & approve'}
            </button>
          </div>
          {saving && <div className="review-save-progress" role="status" aria-live="polite"><span className="review-save-spinner" /><div><b>Finishing secure save</b><small>Saving the invoice record, review history, and private Extracted-folder file. Keep this page open.</small></div></div>}
          {duplicate && <div className="review-duplicate" role="alert">
            <div className="review-duplicate-heading"><Icon name="bell" size={17} /><div><b>{duplicateExact ? 'Duplicate file detected' : 'Possible duplicate invoice'}</b><span>{duplicateExact ? 'This source file is already attached to an approved invoice. Nothing was added or changed.' : 'An invoice with this supplier and invoice number already exists. Nothing has been changed yet.'}</span></div></div>
            <div className="review-duplicate-record"><b>{duplicate.vendorName || 'Supplier not recorded'}</b><span>Invoice {duplicate.invoiceNumber || 'number not recorded'}{duplicate.vendorGstin ? ` · GSTIN ${duplicate.vendorGstin}` : ''}</span></div>
            {differences.length > 0 && <div className="review-differences"><b>Values that differ from the existing invoice</b>{differences.slice(0, 8).map(([key, value]) => <div key={key}><span>{labelFor(key)}</span><small>Existing: {printable(duplicate.data[key]) || 'Not recorded'}</small><small>Review: {printable(value) || 'Not recorded'}</small></div>)}</div>}
            <div className="review-duplicate-actions">
              <button className="btn gh" onClick={() => leaveReview()} disabled={saving}>Keep existing · leave review</button>
              <button className="btn pri" onClick={() => void approve(duplicate.id)} disabled={saving || hasFieldErrors}><Icon name="check" size={14} />Update existing invoice</button>
            </div>
          </div>}
          {message && !duplicate && <div className={'extract-message ' + (approved ? 'success' : 'error')} role={approved ? 'status' : 'alert'}><Icon name={approved ? 'check' : 'x'} size={14} />{message}</div>}
        </div>
      </section>
      <section className="card review-source-panel">
        <div className="card-h"><div><span className="section-kicker">SOURCE DOCUMENT</span><h2>Original file</h2></div><span className="chip blue">Read only</span></div>
        <div className="review-source-body">
          {loadingFile ? <div className="review-file-loading"><i /><i /><i /><span>Opening protected file…</span></div>
            : fileError ? <div className="review-empty error"><Icon name="x" size={21} /><b>Could not open source file</b><span>{fileError}</span><button className="btn sm" onClick={() => leaveReview('files')}>Open Client Folders</button></div>
              : previewType === 'application/pdf' ? <iframe title="Original extraction document" src={previewUrl} />
                : previewType.startsWith('image/') ? <img src={previewUrl} alt="Original extraction document" />
                  : <div className="review-empty"><Icon name="file" size={21} /><b>Preview is not available</b><span>This file type is securely stored, but cannot be rendered inside the review panel.</span></div>}
        </div>
      </section>
    </div>
  </div>;
}
