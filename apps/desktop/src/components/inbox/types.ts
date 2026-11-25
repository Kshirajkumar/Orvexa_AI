import { inviteClientToPortal, type ClientPortalAccess, type MessageTemplate, type TelegramMessageSchedule } from '../../lib/api';
import { dayDiff, fDate, vnow } from '../../lib/format';

export const TELEGRAM_MIGRATION_COMMAND = 'Set-Location .\\services\\backend; npm run migrate:telegram';
export const TELEGRAM_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

export const TEMPLATE_COUNTRIES = [
  { code: 'IN', name: 'India' },
  { code: 'US', name: 'United States' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SG', name: 'Singapore' },
  { code: 'GB', name: 'United Kingdom' },
] as const;

export type TemplateCountryCode = typeof TEMPLATE_COUNTRIES[number]['code'];

function builtInTemplate(countryCode: TemplateCountryCode, key: string, name: string, cat: string, body: string): MessageTemplate {
  return {
    id: `default-${countryCode}-${key}`,
    user_id: null,
    template_key: key,
    name,
    cat,
    body,
    protected: true,
    source: 'default',
    country_code: countryCode,
  };
}

export const BUILT_IN_TEMPLATES: Record<TemplateCountryCode, MessageTemplate[]> = {
  IN: [
    builtInTemplate('IN', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('IN', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('IN', 'itr_return', 'ITR filing documents', 'Income tax', 'Hello {name}, please upload Form 16, 26AS/AIS, bank interest certificates, and investment proofs for your ITR: {portalLink}'),
    builtInTemplate('IN', 'gst_return', 'GST return documents', 'GST', 'Hello {name}, please upload your sales and purchase invoices, GSTR-2B, and expense records for {period}: {portalLink}'),
    builtInTemplate('IN', 'tds_form16', 'TDS / Form 16 request', 'TDS', 'Hello {name}, please upload your Form 16, TDS certificates, and 26AS/AIS for {period}: {portalLink}'),
    builtInTemplate('IN', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('IN', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  US: [
    builtInTemplate('US', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('US', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('US', 'individual_return', 'Individual tax return documents', 'Income tax', 'Hello {name}, please upload your W-2, 1099s, mortgage interest, deductions, and investment statements for {period}: {portalLink}'),
    builtInTemplate('US', 'business_return', 'Business tax return documents', 'Business tax', 'Hello {name}, please upload your income statement, balance sheet, bank statements, and 1099 records for {period}: {portalLink}'),
    builtInTemplate('US', 'estimated_tax', 'Quarterly estimated tax reminder', 'Payment', 'Hello {name}, your quarterly estimated tax payment is due on {due}. Please review the payment details with your CA.'),
    builtInTemplate('US', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('US', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  AE: [
    builtInTemplate('AE', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('AE', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('AE', 'vat_return', 'VAT return documents', 'VAT', 'Hello {name}, please upload your sales invoices, purchase invoices, VAT summary, and supporting records for {period}: {portalLink}'),
    builtInTemplate('AE', 'corporate_tax', 'Corporate tax documents', 'Corporate tax', 'Hello {name}, please upload your financial statements, trial balance, and corporate tax records for {period}: {portalLink}'),
    builtInTemplate('AE', 'trn_documents', 'TRN and registration documents', 'Compliance', 'Hello {name}, please upload your TRN certificate, trade licence, and registration documents securely here: {portalLink}'),
    builtInTemplate('AE', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('AE', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  SG: [
    builtInTemplate('SG', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('SG', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('SG', 'gst_return', 'GST return documents', 'GST', 'Hello {name}, please upload your sales records, purchase invoices, GST reconciliation, and supporting records for {period}: {portalLink}'),
    builtInTemplate('SG', 'corporate_tax', 'Corporate income tax documents', 'Income tax', 'Hello {name}, please upload your financial statements, tax computation, and supporting records for {period}: {portalLink}'),
    builtInTemplate('SG', 'ir8a', 'IR8A / payroll documents', 'Payroll', 'Hello {name}, please upload your IR8A, payroll summary, CPF records, and employee details for {period}: {portalLink}'),
    builtInTemplate('SG', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('SG', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
  GB: [
    builtInTemplate('GB', 'website_link', 'Website link', 'Links', 'Hello {name}, you can visit our client portal and website at: {portalLink}'),
    builtInTemplate('GB', 'portal_invite', 'Secure portal invitation', 'Client portal', 'Hello {name}, please review your tax documents and upload pending files securely here: {portalLink}'),
    builtInTemplate('GB', 'self_assessment', 'Self Assessment documents', 'Income tax', 'Hello {name}, please upload your P60/P45, P11D, bank interest, dividend, and investment records for {period}: {portalLink}'),
    builtInTemplate('GB', 'vat_return', 'VAT return documents', 'VAT', 'Hello {name}, please upload your sales invoices, purchase invoices, VAT reports, and MTD records for {period}: {portalLink}'),
    builtInTemplate('GB', 'mtd', 'Making Tax Digital records', 'Compliance', 'Hello {name}, please upload your digital bookkeeping reports and supporting records for {period}: {portalLink}'),
    builtInTemplate('GB', 'missing_document', 'Missing document follow-up', 'Utility', 'Hello {name}, we are still waiting for your {doc} for {period}. Please upload it securely here: {portalLink}'),
    builtInTemplate('GB', 'fee_reminder', 'Professional fee reminder', 'Payment', 'Hello {name}, this is a reminder for the professional fee invoice for {period}. Please complete payment at your convenience.'),
  ],
};

export function needsTelegramMigrationHelp(messages: string[]) {
  return messages.some((message) => /database table .* missing|database setup.*incomplete|migrations? are missing|required telegram database object/i.test(message));
}

export function dayLabel(d: Date) {
  const n = dayDiff(vnow(), d);
  return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fDate(d);
}

export function scheduledTimeLabel(schedule: TelegramMessageSchedule) {
  const value = schedule.next_run_at || schedule.scheduled_at;
  if (!value) return 'No upcoming send';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: schedule.timezone_name,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function getTemplateIcon(template: MessageTemplate) {
  if (template.template_key === 'website_link' || template.template_key === 'portal_link') return 'globe';
  if (template.template_key === 'portal_invite') return 'lock';
  if (template.template_key === 'docs') return 'scan';
  if (template.template_key === 'pending') return 'info';
  if (template.template_key === 'itr') return 'table';
  if (template.template_key === 'payment_reminder') return 'rupee';
  if (template.template_key === 'status_update') return 'check';
  if (template.template_key === 'onboarding') return 'users';
  if (template.cat === 'Payment') return 'rupee';
  if (template.cat === 'Client portal') return 'globe';
  if (template.cat === 'Links') return 'link';
  if (template.cat === 'Filing') return 'scan';
  if (template.cat === 'Reminder') return 'bell';
  return 'file';
}

export function templateUsesPortalLink(template: MessageTemplate): boolean {
  return template.template_key === 'website_link' || /\{(portalLink|websiteLink|link)\}/i.test(template.body);
}

export function formatEditTimeLeft(createdAt: string): string {
  const remainingMs = TELEGRAM_EDIT_WINDOW_MS - (Date.now() - new Date(createdAt).getTime());
  if (remainingMs <= 0) return '';
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(remainingMs / (60 * 1000)));
  return `${minutes}m left`;
}

export function fillTpl(body: string, name: string, portalLink?: string) {
  const link = portalLink || 'https://orvvexa.vercel.app/portal';
  return body.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'name') return name;
    if (k === 'period') return 'August 2026';
    if (k === 'due') return '20 Sep 2026';
    if (k === 'filing') return 'GSTR-3B';
    if (k === 'doc') return 'bank statement';
    if (k === 'portalLink' || k === 'websiteLink' || k === 'link') return link;
    return '—';
  });
}

export async function fillPortalTemplate(
  template: MessageTemplate,
  client: { id: string; contact: string },
  portalAccess: ClientPortalAccess | null,
) {
  const clientName = client.contact ? client.contact.split(' ')[0] : 'Client';
  const defaultPortalUrl = 'https://orvvexa.vercel.app/portal';
  const hasPortalAccount = Boolean(portalAccess && (portalAccess.status === 'account_created' || portalAccess.linked));

  if (template.template_key === 'portal_invite') {
    const invitation = await inviteClientToPortal(client.id);
    if (!invitation?.link) throw new Error('The client portal link could not be resolved. Please open the client profile and check portal access.');
    return fillTpl(template.body, clientName, invitation.link);
  }

  if (templateUsesPortalLink(template)) {
    if (!hasPortalAccount) {
      throw new Error('This client has not created a Client Portal account yet. Website portal link templates are only available after portal account creation.');
    }
    return fillTpl(template.body, clientName, portalAccess?.portalLink || defaultPortalUrl);
  }

  return fillTpl(template.body, clientName, defaultPortalUrl);
}
