import type { RefObject } from 'react';
import { Icon } from '../Icon';
import type { MessageTemplate } from '../../lib/api';
import type { Client } from '../../types';
import { TEMPLATE_COUNTRIES, fillTpl, getTemplateIcon, type TemplateCountryCode } from './types';

function TemplateCardSkeleton() {
  return (
    <article className="card tpl wa-template-skeleton-card" aria-hidden="true">
      <div className="wa-template-skeleton-header">
        <div className="wa-skeleton-shimmer wa-template-skeleton-icon" />
        <div className="wa-skeleton-shimmer wa-template-skeleton-title" />
        <div className="wa-skeleton-shimmer wa-template-skeleton-chip" />
      </div>
      <div className="wa-template-skeleton-body">
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '92%' }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '78%' }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-line" style={{ width: '60%' }} />
      </div>
      <div className="wa-template-skeleton-footer">
        <div className="wa-skeleton-shimmer wa-template-skeleton-btn" style={{ width: 64 }} />
        <div className="wa-skeleton-shimmer wa-template-skeleton-btn" style={{ width: 92 }} />
      </div>
    </article>
  );
}

interface TemplatesPanelProps {
  client?: Client;
  templatesLoading: boolean;
  templateError: string;
  onDismissError: () => void;
  defaultTemplatesList: MessageTemplate[];
  dbDefaultTemplatesCount: number;
  privateTemplates: MessageTemplate[];
  templateCountry: TemplateCountryCode;
  onTemplateCountryChange: (code: TemplateCountryCode) => void;
  applyingTemplateId: string;
  onApplyTemplate: (template: MessageTemplate) => void;
  onStartEdit: (template?: MessageTemplate) => void;
  onRemoveTemplate: (template: MessageTemplate) => void;
  // Editor Modal
  templateEditorOpen: boolean;
  editingTemplate: MessageTemplate | null;
  templateForm: { name: string; cat: string; body: string };
  onTemplateFormChange: (updater: (prev: { name: string; cat: string; body: string }) => { name: string; cat: string; body: string }) => void;
  templateSaving: boolean;
  templateBodyRef: RefObject<HTMLTextAreaElement>;
  onInsertToken: (token: string) => void;
  onCloseEditor: () => void;
  onSaveTemplate: () => void;
}

export function TemplatesPanel({
  client,
  templatesLoading,
  templateError,
  onDismissError,
  defaultTemplatesList,
  dbDefaultTemplatesCount,
  privateTemplates,
  templateCountry,
  onTemplateCountryChange,
  applyingTemplateId,
  onApplyTemplate,
  onStartEdit,
  onRemoveTemplate,
  templateEditorOpen,
  editingTemplate,
  templateForm,
  onTemplateFormChange,
  templateSaving,
  templateBodyRef,
  onInsertToken,
  onCloseEditor,
  onSaveTemplate,
}: TemplatesPanelProps) {
  return (
    <div id="inbox-panel-templates" className="inbox-tab-panel" data-tour="inbox-templates" role="tabpanel" aria-labelledby="inbox-tab-templates">
      <div className="wa-tpl-header">
        <div className="wa-tpl-header-left">
          <span className="wa-tpl-header-icon"><Icon name="file" size={18} /></span>
          <div>
            <h2 className="wa-tpl-title">Message Templates</h2>
            <p className="wa-tpl-subtitle">Built-in templates are available by country. Private templates are loaded only for your account.</p>
          </div>
        </div>
        {!templateEditorOpen && (
          <button className="btn sm pri" onClick={() => onStartEdit()}>
            <Icon name="plus" size={13} />New template
          </button>
        )}
      </div>

      {templateError && (
        <div className="wa-reminders-notice-card wa-reminders-notice-error" role="alert">
          <Icon name="info" size={14} />
          <span>{templateError}</span>
          <button className="btn sm gh wa-reminders-notice-dismiss" onClick={onDismissError}>✕</button>
        </div>
      )}

      {templateEditorOpen && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !templateSaving) onCloseEditor();
          }}
        >
          <section className="mbox wa-tpl-editor-modal-card" style={{ width: 'min(760px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }} role="form" aria-label="Template Editor">
            <div className="wa-tpl-editor-heading" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div className="wa-tpl-editor-heading-left">
                <span className="wa-tpl-editor-icon">
                  <Icon name={editingTemplate ? 'pencil' : 'spark'} size={18} />
                </span>
                <div>
                  <h3 className="wa-tpl-editor-title" id="template-modal-title">
                    {editingTemplate ? `Editing: ${editingTemplate.name}` : 'Create New Template'}
                    <span className="chip violet sm"><Icon name="lock" size={10} /> Your Private Template</span>
                  </h3>
                  <p className="wa-tpl-editor-sub">
                    Saved privately to your account · Loaded and visible only for you
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, fontSize: 14 }}
                onClick={onCloseEditor}
                disabled={templateSaving}
                aria-label="Close template editor"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="wa-tpl-form-grid">
              <div className="wa-tpl-input-wrap">
                <label htmlFor="template-name">
                  <Icon name="file" size={13} /> Template Name
                </label>
                <input
                  id="template-name"
                  className="inp"
                  maxLength={200}
                  placeholder="e.g. Monthly GST Filing Reminder"
                  value={templateForm.name}
                  onChange={(e) => onTemplateFormChange((c) => ({ ...c, name: e.target.value }))}
                />
              </div>
              <div className="wa-tpl-input-wrap">
                <label htmlFor="template-category">
                  <Icon name="sliders" size={13} /> Category Section
                </label>
                <select
                  id="template-category"
                  className="sel"
                  value={templateForm.cat}
                  onChange={(e) => onTemplateFormChange((c) => ({ ...c, cat: e.target.value }))}
                >
                  {['Client portal', 'Utility', 'Links', 'Filing', 'Payment', 'Reminder', 'General'].map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="wa-tpl-instruction-banner">
              <div className="wa-tpl-instruction-header">
                <span className="wa-tpl-instruction-badge">
                  <Icon name="spark" size={11} /> Auto-Personalization
                </span>
                <span className="wa-tpl-instruction-title">Dynamic Client Message Placeholders</span>
              </div>
              <p className="wa-tpl-instruction-text">
                When sending messages or reminders, Orvexa automatically replaces these <strong>&#123;tags&#125;</strong> with the selected client's actual data. <strong>Click any placeholder below to insert it at your cursor:</strong>
              </p>
              <div className="wa-tpl-tokens-grid">
                {([
                  ['{name}', 'Client Name', 'Replaced with client first name (e.g. Rajesh)'],
                  ['{portalLink}', 'Portal / Website Link', 'Client portal website or private link'],
                  ['{period}', 'Filing Period', 'Filing period (e.g. August 2026)'],
                  ['{due}', 'Due Date', 'Upcoming deadline date (e.g. 20 Sep 2026)'],
                  ['{doc}', 'Document Name', 'Requested document (e.g. bank statement)'],
                  ['{filing}', 'Filing Type', 'Form or filing type (e.g. GSTR-3B, ITR-1)'],
                ] as const).map(([token, label, desc]) => (
                  <button
                    key={token}
                    type="button"
                    className="wa-tpl-token-card"
                    title={`Click to insert ${token} at cursor position`}
                    onClick={() => onInsertToken(token)}
                  >
                    <div className="wa-tpl-token-card-top">
                      <code className="wa-tpl-token-code">{token}</code>
                      <span className="wa-tpl-token-name">{label}</span>
                    </div>
                    <span className="wa-tpl-token-desc">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="wa-tpl-body-preview-grid">
              <div className="wa-tpl-input-wrap">
                <label htmlFor="template-body">
                  <Icon name="chat" size={13} /> Message Body Text
                  <span className="wa-tpl-char-count">{templateForm.body.length} / 5000 characters</span>
                </label>
                <textarea
                  ref={templateBodyRef}
                  id="template-body"
                  className="inp"
                  rows={7}
                  maxLength={5000}
                  placeholder="Type your message text here. Click the placeholders above to insert {name}, {portalLink}, etc."
                  value={templateForm.body}
                  onChange={(e) => onTemplateFormChange((c) => ({ ...c, body: e.target.value }))}
                />
              </div>
              <div className="wa-tpl-live-preview">
                <div className="wa-tpl-preview-header">
                  <Icon name="globe" size={13} />
                  <span>Live Client Message Preview</span>
                </div>
                <div className="wa-tpl-preview-bubble">
                  {templateForm.body.trim()
                    ? fillTpl(templateForm.body, client?.contact?.split(' ')[0] || 'Rajesh')
                    : <span className="wa-tpl-preview-empty">Your personalized message preview will appear here in real-time as you type...</span>}
                </div>
              </div>
            </div>

            <div className="wa-tpl-editor-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn gh" onClick={onCloseEditor} disabled={templateSaving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn pri"
                onClick={onSaveTemplate}
                disabled={templateSaving || !templateForm.name.trim() || !templateForm.body.trim()}
              >
                {templateSaving
                  ? <><span className="spin spin-light" />Saving…</>
                  : <><Icon name="check" size={13} />{editingTemplate ? 'Update template' : 'Save Private Template'}</>}
              </button>
            </div>
          </section>
        </div>
      )}

      {templatesLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="wa-tpl-section-label" style={{ opacity: 0.7 }}>
            <div className="wa-skeleton-shimmer" style={{ width: 140, height: 26, borderRadius: 20 }} />
            <div className="wa-skeleton-shimmer" style={{ width: 180, height: 14, borderRadius: 4 }} />
          </div>
          <div className="wa-template-grid" role="status" aria-label="Loading templates">
            {[...Array(6)].map((_, i) => <TemplateCardSkeleton key={i} />)}
          </div>
        </div>
      )}

      {!templatesLoading && defaultTemplatesList.length > 0 && (
        <>
          <div className="wa-tpl-section-label">
            <span className="wa-tpl-section-badge green">
              <Icon name="globe" size={12} /> Shared Default Templates
            </span>
            <span className="wa-tpl-section-desc">
              {dbDefaultTemplatesCount > 0
                ? 'Loaded from database · Shared with all users in your practice'
                : 'Built into Orvexa · Select a country to change the message set'}
            </span>
          </div>
          {dbDefaultTemplatesCount === 0 && (
            <div className="wa-tpl-country-control" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, maxWidth: 340 }}>
              <label className="f" htmlFor="template-country">Template country</label>
              <select
                id="template-country"
                className="sel"
                value={templateCountry}
                onChange={(event) => onTemplateCountryChange(event.target.value as TemplateCountryCode)}
              >
                {TEMPLATE_COUNTRIES.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            </div>
          )}
          <div className="wa-template-grid">
            {defaultTemplatesList.map((template) => (
              <article className="card tpl wa-template-card wa-template-card--shared" key={template.id}>
                <div className="wa-template-card-header">
                  <span className="wa-tpl-card-icon">
                    <Icon name={getTemplateIcon(template)} size={16} />
                  </span>
                  <div className="wa-tpl-card-meta">
                    <b className="wa-tpl-card-name">{template.name}</b>
                    <div className="wa-tpl-card-chips">
                      <span className="chip blue sm">{template.cat}</span>
                      <span className="chip green sm"><Icon name="globe" size={10} /> Shared Default</span>
                    </div>
                  </div>
                </div>
                <p className="wa-tpl-card-preview">
                  {fillTpl(template.body, client?.contact?.split(' ')[0] || 'Client')}
                </p>
                <div className="wa-template-footer">
                  <span className="sp" />
                  <button
                    className="btn sm pri"
                    onClick={() => onApplyTemplate(template)}
                    disabled={!!applyingTemplateId}
                  >
                    {applyingTemplateId === template.id
                      ? <><span className="spin spin-light" />Preparing…</>
                      : <><Icon name="send" size={12} />Use in Chat</>}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {!templatesLoading && (
        <>
          <div className="wa-tpl-section-label">
            <span className="wa-tpl-section-badge violet">
              <Icon name="lock" size={12} /> Your Private Templates
            </span>
            <span className="wa-tpl-section-desc">Only visible and loaded for your account</span>
          </div>
          {privateTemplates.length === 0 ? (
            <div className="wa-private-tpl-empty">
              <div className="wa-private-tpl-empty-icon"><Icon name="lock" size={22} /></div>
              <div className="wa-private-tpl-empty-text">
                <b>No private templates created yet</b>
                <p>Templates you create with "+ New template" are saved privately to your account and loaded exclusively for you.</p>
              </div>
              <button className="btn sm pri" onClick={() => onStartEdit()}>
                <Icon name="plus" size={13} />Create Private Template
              </button>
            </div>
          ) : (
            <div className="wa-template-grid">
              {privateTemplates.map((template) => (
                <article className="card tpl wa-template-card wa-template-card--private" key={template.id}>
                  <div className="wa-template-card-header">
                    <span className="wa-tpl-card-icon">
                      <Icon name={getTemplateIcon(template)} size={16} />
                    </span>
                    <div className="wa-tpl-card-meta">
                      <b className="wa-tpl-card-name">{template.name}</b>
                      <div className="wa-tpl-card-chips">
                        <span className="chip blue sm">{template.cat}</span>
                        <span className="chip violet sm"><Icon name="lock" size={10} /> Your Private Template</span>
                      </div>
                    </div>
                  </div>
                  <p className="wa-tpl-card-preview">
                    {fillTpl(template.body, client?.contact?.split(' ')[0] || 'Client')}
                  </p>
                  <div className="wa-template-footer">
                    <button className="btn sm" onClick={() => onStartEdit(template)}>
                      <Icon name="pencil" size={12} />Edit
                    </button>
                    <button
                      className="btn sm gh"
                      onClick={() => onRemoveTemplate(template)}
                      disabled={template.protected}
                      title={template.protected ? 'Protected templates cannot be deleted' : 'Delete template'}
                    >
                      <Icon name="trash" size={12} />Delete
                    </button>
                    <span className="sp" />
                    <button
                      className="btn sm pri"
                      onClick={() => onApplyTemplate(template)}
                      disabled={!!applyingTemplateId}
                    >
                      {applyingTemplateId === template.id
                        ? <><span className="spin spin-light" />Preparing…</>
                        : <><Icon name="send" size={12} />Use in Chat</>}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
