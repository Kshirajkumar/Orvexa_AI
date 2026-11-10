// TaxFlow.AI — API Client Service (Production Grade)
// All API calls require Authorization header when user is authenticated.
import {
  extractWithOpenRouter,
  generateOpenRouterNoticeResponse,
  type OpenRouterFallbackCallback,
  isUsingLocalOpenRouterKey,
  sendOpenRouterChat,
  validateOpenRouterExtractionFile,
} from './openRouter';
import { hasOpenRouterApiKey } from './secureCredentials';

const API_ORIGIN = String(
  import.meta.env.VITE_API_URL
    || (import.meta.env.DEV
      ? 'http://127.0.0.1:5000'
      : import.meta.env.API_URL || 'https://taxflow-ai.onrender.com')
).replace(/\/$/, '');
const API_BASE_URL = `${API_ORIGIN}/api/v1`;

// ─── Types ─────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  practiceType: string;
  membershipNo?: string | null;
  role: string;
  onboardingComplete: boolean;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  token?: string;
  refreshToken?: string;
  user?: AuthUser;
  needsEmailConfirmation?: boolean;
  rateLimited?: boolean;
  secondsLeft?: number;
  remainingAttempts?: number;
}

// ─── Token helpers ─────────────────────────────────────────────
function getToken(): string | null {
  try {
    const raw = localStorage.getItem('taxflow_session');
    if (!raw) return null;
    return JSON.parse(raw).token || null;
  } catch { return null; }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

let refreshRequest: Promise<AuthResponse | null> | null = null;

function saveSessionTokens(response: AuthResponse): void {
  if (!response.token) return;
  try {
    const raw = localStorage.getItem('taxflow_session');
    const current = raw ? JSON.parse(raw) : {};
    localStorage.setItem('taxflow_session', JSON.stringify({
      ...current,
      ...(response.user ? { user: response.user } : {}),
      token: response.token,
      refreshToken: response.refreshToken || current.refreshToken,
    }));
  } catch {
    // Continue with the in-memory response if storage is unavailable.
  }
}

export async function refreshSession(): Promise<AuthResponse | null> {
  if (!refreshRequest) {
    let refreshToken: string | null = null;
    try {
      const raw = localStorage.getItem('taxflow_session');
      refreshToken = raw ? JSON.parse(raw).refreshToken || null : null;
    } catch {
      refreshToken = null;
    }

    if (!refreshToken) return null;

    refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        const data = await response.json() as AuthResponse;
        if (response.ok && data.success && data.token) {
          saveSessionTokens(data);
          return data;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

async function fetchTelegramJson(url: string, init: RequestInit, timeoutMs: number, operation: string): Promise<{ response: Response; json: any }> {
  const doFetch = async (headers: HeadersInit): Promise<{ response: Response; json: any }> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, { ...init, headers, signal: controller.signal });
      } catch {
        if (controller.signal.aborted) {
          const timeoutMessage = /Telegram (message|attachment) delivery/.test(operation)
            ? 'Delivery status is unknown. Check the conversation before retrying.'
            : 'Check the backend connection and try again.';
          throw new Error(`${operation} timed out after ${Math.round(timeoutMs / 1000)} seconds. ${timeoutMessage}`);
        }
        throw new Error(`${operation} could not reach the backend. Check your connection and try again.`);
      }

      let json: any;
      try {
        json = await response.json();
      } catch {
        throw new Error(`${operation} returned an invalid response (HTTP ${response.status}).`);
      }
      return { response, json };
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const initialHeaders = { ...authHeaders(), ...(init.headers as Record<string, string> || {}) };
  let result = await doFetch(initialHeaders);

  // If 401 Unauthorized or expired session message, try silent session refresh and retry once
  const isAuthError = result.response.status === 401 ||
    (!result.json.success && typeof result.json.message === 'string' && /session is invalid or has expired/i.test(result.json.message));

  if (isAuthError) {
    const refreshed = await refreshSession();
    if (refreshed?.token) {
      const requestHeaders = init.headers as Record<string, string> || {};
      const retriedHeaders = { ...requestHeaders, ...authHeaders() };
      if (requestHeaders['Content-Type']) retriedHeaders['Content-Type'] = requestHeaders['Content-Type'];
      result = await doFetch(retriedHeaders);
    } else {
      window.dispatchEvent(new CustomEvent('taxflow:session-expired'));
    }
  }

  return result;
}

export interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  message: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
  read_at?: string | null;
  created_at: string;
}

async function authRequest<T extends { success: boolean; message?: string }>(
  url: string,
  options: RequestInit,
  retryAfterSessionRefresh = false,
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(url, options);
  } catch {
    throw new Error(
      'The TaxFlow.AI backend could not be reached. Check your connection and try again.',
    );
  }

  if (retryAfterSessionRefresh && res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed?.token) {
      try {
        res = await fetch(url, {
          ...options,
          headers: { ...(options.headers as Record<string, string> || {}), ...authHeaders() },
        });
      } catch {
        throw new Error('The TaxFlow.AI backend could not be reached. Check your connection and try again.');
      }
    } else {
      window.dispatchEvent(new CustomEvent('taxflow:session-expired'));
    }
  }

  let data: T;
  try {
    data = await res.json() as T;
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`);
  }

  if (!res.ok && !data.message) {
    throw new Error(`The backend request failed (HTTP ${res.status}).`);
  }

  return data;
}

export interface Client {
  id: string;
  name: string;
  entityType: string;
  pan: string;
  gstin: string;
  phone: string;
  email: string;
  status: string;
  assignedCA?: string;
  filingStatus?: string;
  filingTypes?: string[];
  countryId?: string;
  countryName?: string;
  currencyCode?: string;
}

export interface SupportedCountry {
  id: string;
  country_code: string;
  country_name: string;
  tax_authority_name?: string;
  portal_name?: string;
  portal_url?: string;
  currency_code: string;
}

export interface FilingType {
  id: string;
  country_id: string;
  code: string;
  name: string;
  description?: string;
  filing_category?: string;
  filing_frequency?: string;
  output_format: string;
  accepted_file_types: string[];
  government_portal_name?: string;
  government_portal_url?: string;
  specification_version?: string;
  specification_url?: string;
  format_definition?: Record<string, unknown>;
  validation_rules?: Record<string, unknown>;
}

async function metadataRequest<T>(url: string, signal?: AbortSignal): Promise<T> {
  const headers = authHeaders();

  let response: Response;
  try {
    response = await fetch(url, { headers, signal });
  } catch {
    throw new Error('The backend is unavailable. Please check that TaxFlow.AI is running and try again.');
  }

  let payload: { success?: boolean; message?: string; data?: T };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${response.status}).`);
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || `Could not load reference data (HTTP ${response.status}).`);
  }
  return payload.data || ([] as unknown as T);
}

export function fetchSupportedCountries(): Promise<SupportedCountry[]> {
  return metadataRequest<SupportedCountry[]>(`${API_BASE_URL}/metadata/countries`);
}

export function fetchFilingTypes(countryId: string, signal?: AbortSignal): Promise<FilingType[]> {
  return metadataRequest<FilingType[]>(
    `${API_BASE_URL}/metadata/filing-types?countryId=${encodeURIComponent(countryId)}`,
    signal
  );
}

export interface DocumentItem {
  id: string;
  clientId: string;
  clientName: string;
  fileName: string;
  fileType: string;
  fileSize?: string;
  category: string;
  source: string;
  status: string;
  created_at?: string;
  uploadDate: string;
  confidenceScore: number;
  extractedData?: any;
}

export interface WhatsAppMessage {
  id: string;
  clientId?: string;
  senderPhone: string;
  senderName: string;
  direction: 'inbound' | 'outbound';
  messageType: 'text' | 'document' | 'image';
  body: string;
  timestamp: string;
  status: string;
}

export interface TelegramMessage {
  id: string;
  client_id: string;
  provider_message_id: string;
  direction: 'inbound' | 'outbound';
  chat_id: string;
  sender_user_id?: string | null;
  body: string;
  message_type: string;
  delivery_status: string;
  created_at: string;
}

export interface ComplianceTask {
  id: string;
  clientId: string;
  clientName: string;
  formType: string;
  dueDate: string;
  status: string;
  progress: number;
  assignedTo: string;
}

// ─── Auth API ──────────────────────────────────────────────────

export async function apiSignup(data: {
  name: string;
  email: string;
  password: string;
  practiceType?: string;
  membershipNo?: string;
}): Promise<AuthResponse> {
  return authRequest<AuthResponse>(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  return authRequest<AuthResponse>(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
}

export async function apiVerifyAccountDeletionPassword(password: string): Promise<{ success: boolean; message?: string; challenge?: string; expiresIn?: number; token?: string; refreshToken?: string }> {
  const result = await authRequest<{ success: boolean; message?: string; challenge?: string; expiresIn?: number; token?: string; refreshToken?: string }>(`${API_BASE_URL}/auth/delete-account/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ password })
  }, true);
  if (result?.success && result.token) {
    saveSessionTokens({ success: true, token: result.token, refreshToken: result.refreshToken });
  }
  return result;
}

export async function apiConfirmAccountDeletion(challenge: string, confirmation: string): Promise<{ success: boolean; message?: string }> {
  // Deletion challenge already proves authentication — do NOT retry on 401
  // so we never fire taxflow:session-expired during the deletion flow.
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/auth/delete-account/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, confirmation })
    });
  } catch {
    throw new Error('The TaxFlow.AI backend could not be reached. Check your connection and try again.');
  }
  let data: { success: boolean; message?: string };
  try {
    data = await res.json();
  } catch {
    throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`);
  }
  if (!res.ok && !data.message) {
    throw new Error(`Account deletion request failed (HTTP ${res.status}).`);
  }
  return data;
}

export async function apiForgotPassword(email: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return res.json();
}

export async function apiGetMe(): Promise<AuthResponse> {
  let res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed?.token) {
      res = await fetch(`${API_BASE_URL}/auth/me`, { headers: authHeaders() });
    }
  }
  return res.json();
}

export async function apiGetMeWithToken(token: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return res.json();
}

export async function fetchNotifications(): Promise<{ data: NotificationItem[]; unreadCount: number }> {
  const headers = authHeaders();
  const response = await fetch(`${API_BASE_URL}/notifications?limit=20`, { headers });
  let payload: { success?: boolean; data?: NotificationItem[]; unreadCount?: number; message?: string };
  try { payload = await response.json(); } catch { throw new Error(`The notification service returned an invalid response (HTTP ${response.status}).`); }
  if (!response.ok || !payload.success) throw new Error(payload.message || `Could not load notifications (HTTP ${response.status}).`);
  return { data: payload.data || [], unreadCount: payload.unreadCount || 0 };
}

export async function markNotificationsRead(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/notifications/read`, { method: 'POST', headers: authHeaders() });
  if (!response.ok) throw new Error(`Could not mark notifications as read (HTTP ${response.status}).`);
}

export async function apiUpdateProfile(data: {
  name?: string;
  practiceType?: string;
  membershipNo?: string;
}): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE_URL}/auth/profile`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(data)
  });
  return res.json();
}

export async function apiCompleteOnboarding(): Promise<{ success: boolean; message?: string }> {
  return authRequest(
    `${API_BASE_URL}/auth/onboarding-complete`,
    { method: 'POST', headers: authHeaders(), body: '{}' },
    true,
  );
}

export interface ClientPortalAccess {
  enabled: boolean;
  linked: boolean;
  email: string | null;
  createdAt: string | null;
}

export async function fetchClientPortalAccess(clientId: string): Promise<ClientPortalAccess> {
  const response = await authRequest<{
    success: boolean;
    message?: string;
    data?: ClientPortalAccess;
  }>(
    `${API_BASE_URL}/client-portal/clients/${encodeURIComponent(clientId)}/access`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.success || !response.data) {
    throw new Error(response.message || 'Could not load client portal access.');
  }
  return response.data;
}

export async function inviteClientToPortal(clientId: string): Promise<{ email: string; link: string; expiresAt: string }> {
  const response = await authRequest<{
    success: boolean;
    message?: string;
    data?: { email: string; link: string; expiresAt: string };
  }>(
    `${API_BASE_URL}/client-portal/clients/${encodeURIComponent(clientId)}/invite`,
    { method: 'POST', headers: authHeaders(), body: '{}' },
  );
  if (!response.success || !response.data) {
    throw new Error(response.message || 'Could not create the client portal invitation.');
  }
  return response.data;
}

export async function revokeClientPortalAccess(clientId: string): Promise<void> {
  const response = await authRequest<{ success: boolean; message?: string }>(
    `${API_BASE_URL}/client-portal/clients/${encodeURIComponent(clientId)}/access`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.success) {
    throw new Error(response.message || 'Could not revoke client portal access.');
  }
}

// ─── Client API ────────────────────────────────────────────────

export async function fetchClients(): Promise<Client[]> {
  const request = () => authRequest<{ success: boolean; message?: string; data?: Client[] }>(
    `${API_BASE_URL}/clients`,
    { headers: authHeaders() },
  );
  let response = await request();
  if (!response.success && /session is invalid or has expired/i.test(response.message || '')) {
    const refreshed = await refreshSession();
    if (refreshed?.token) {
      response = await request();
    } else {
      window.dispatchEvent(new CustomEvent('taxflow:session-expired'));
    }
  }
  if (!response.success || !Array.isArray(response.data)) {
    throw new Error(response.message || 'The backend returned an invalid client list.');
  }
  return response.data;
}

export async function createClient(clientData: Partial<Client>): Promise<Client | null> {
  const payload = {
      name: clientData.name,
      entity_type: clientData.entityType === 'Private Limited' ? 'Pvt Ltd' : (clientData.entityType === 'Other' ? 'Individual' : clientData.entityType),
      pan: clientData.pan || null,
      gstin: clientData.gstin || null,
      phone: clientData.phone || `not-provided-${crypto.randomUUID()}`,
      email: clientData.email || null,
      country_id: clientData.countryId || null,
      assigned_ca: clientData.assignedCA || null,
      filing_types: clientData.filingTypes || [],
  };
  try {
    const res = await fetch(`${API_BASE_URL}/clients`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    let json: any;
    try { json = await res.json(); } catch { throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`); }
    if (!res.ok || !json.success) throw new Error(json.message || `Failed to save client (HTTP ${res.status}).`);

    return json.data;
  } catch (err: any) {
    if (err instanceof TypeError) {
      throw new Error('The TaxFlow.AI backend is not reachable. Start the app with “npm run dev:full” and try again.');
    }
    throw err;
  }
}

export async function updateClient(clientId: string, clientData: Partial<Client>): Promise<Client> {
  const res = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      name: clientData.name,
      entity_type: clientData.entityType,
      pan: clientData.pan || null,
      gstin: clientData.gstin || null,
      phone: clientData.phone || null,
      email: clientData.email || null,
      country_id: clientData.countryId || null,
      filing_types: clientData.filingTypes || [],
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.message || `Failed to update client (HTTP ${res.status}).`);

  return json.data;
}

export async function deleteClient(clientId: string): Promise<{ id: string; name: string; cleanupWarning?: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch {
    throw new Error('The TaxFlow.AI backend is unavailable. Nothing was deleted.');
  }
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The backend returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not delete the client (HTTP ${res.status}).`);

  return json.data;
}

export interface DocumentTreeEntry {
  name: string;
  type: 'folder' | 'file';
  documentId?: string;
  size?: number;
  modifiedAt: string;
  children?: DocumentTreeEntry[];
}

export interface DocumentTreeResponse {
  clientId: string;
  clientName: string;
  entries: DocumentTreeEntry[];
}

export interface CloudDocumentSearchResult {
  documentId: string;
  clientId: string;
  clientName: string;
  fileName: string;
  size: number;
  modifiedAt: string;
}

export interface TelegramSearchResult {
  id: string;
  clientId: string;
  clientName: string;
  body: string;
  createdAt: string;
}

export async function searchCloudDocuments(query: string, signal?: AbortSignal): Promise<CloudDocumentSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${API_BASE_URL}/documents/search?${params}`, { headers: authHeaders(), signal });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`Cloud document search returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not search cloud documents (HTTP ${res.status}).`);
  return Array.isArray(json.data) ? json.data : [];
}

export async function searchTelegramMessages(query: string, signal?: AbortSignal): Promise<TelegramSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${API_BASE_URL}/telegram/search?${params}`, { headers: authHeaders(), signal });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`Telegram search returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not search Telegram messages (HTTP ${res.status}).`);
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchCloudDocumentFile(documentId: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/file`, {
      headers: authHeaders(),
    });
  } catch {
    throw new Error('The backend is unavailable. The cloud document could not be opened.');
  }
  if (!res.ok) {
    let message = `Could not open the cloud document (HTTP ${res.status}).`;
    try {
      const json = await res.json();
      message = json.message || message;
    } catch { /* Keep the status-based error. */ }
    throw new Error(message);
  }
  return res.blob();
}

export async function fetchClientDocumentTree(clientId: string): Promise<DocumentTreeResponse> {
  const headers = authHeaders();
  const res = await fetch(`${API_BASE_URL}/clients/${encodeURIComponent(clientId)}/documents/tree`, { headers });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`Cloud document listing returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not load cloud documents (HTTP ${res.status}).`);
  return json.data;
}

export async function deleteCloudDocument(documentId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch {
    throw new Error('The backend is unavailable. The cloud document was not deleted.');
  }

  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The cloud document endpoint returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `The file could not be deleted (HTTP ${res.status}).`);
}

// ─── Documents API ─────────────────────────────────────────────

export async function fetchDocuments(clientId?: string): Promise<DocumentItem[]> {
  try {
    const url = clientId ? `${API_BASE_URL}/documents?clientId=${clientId}` : `${API_BASE_URL}/documents`;
    const headers = authHeaders();
    const res = await fetch(url, { headers });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch documents', err);
    return [];
  }
}

export async function fetchClientDocuments(clientId: string, signal?: AbortSignal): Promise<DocumentItem[]> {
  const headers = authHeaders();
  const res = await fetch(`${API_BASE_URL}/documents?clientId=${encodeURIComponent(clientId)}`, { headers, signal });
  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The client document list returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `Could not load this client's files (HTTP ${res.status}).`);
  return Array.isArray(json.data) ? json.data : [];
}

export interface DocumentUploadResponse {
  data?: {
    id: string;
    client_id: string;
    file_name: string;
    file_size_kb?: number;
    created_at?: string;
  };
  message?: string;
  source?: string;
}

export async function uploadDocument(payload: {
  clientId: string;
  fileName: string;
  fileType: string;
  category: string;
  assessmentYear?: string;
  fileBase64?: string;
  source?: string;
}): Promise<DocumentUploadResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/documents`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error('The TaxFlow.AI backend is unavailable. Start the backend and try again.');
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`The backend returned an invalid upload response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    throw new Error(json.message || `The file could not be uploaded (HTTP ${res.status}).`);
  }

  return json;
}

export function getDocumentFileUrl(docId: string): string {
  return `${API_BASE_URL}/documents/${encodeURIComponent(docId)}/file`;
}

export async function fetchDocumentPreview(documentId: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(getDocumentFileUrl(documentId), { headers: authHeaders(), signal });
  } catch {
    throw new Error('The original file could not be reached. Check the backend connection.');
  }
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message || ''; } catch {}
    throw new Error(message || `The original file could not be opened (HTTP ${res.status}).`);
  }
  return res.blob();
}

export async function verifyDocumentExtraction(documentId: string, verifiedBy = 'CA Admin', correctedData?: Record<string, unknown>) {
  try {
    const res = await fetch(`${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/verify`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ verifiedBy, correctedData })
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.message || `Could not save the reviewed extraction (HTTP ${res.status}).`);

    return json;
  } catch (err) {
    console.error('Failed to verify document', err);
    return null;
  }
}

export async function processDocumentExtraction(
  documentId: string,
  category = 'General',
  file?: File,
  onFallback?: OpenRouterFallbackCallback,
  clientName?: string,
  createdAt?: string,
  clientId?: string,
  useLocalKey = isUsingLocalOpenRouterKey(),
) {
  if (useLocalKey) {
    if (!file) {
      throw new Error('The local OpenRouter key needs the original image. Choose a JPG, PNG, WEBP, or GIF image and retry.');
    }
    validateOpenRouterExtractionFile(file);
    const extraction = await extractWithOpenRouter(file, category, onFallback);
    const saved = await authRequest<{
      success: boolean;
      message?: string;
      data?: Record<string, unknown>;
    }>(
      `${API_BASE_URL}/extraction/save`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          documentId,
          category,
          extractedData: extraction.extractedData,
          model: extraction.model,
          inputTokens: extraction.inputTokens,
          outputTokens: extraction.outputTokens,
          durationMs: extraction.durationMs,
          clientName,
          createdAt,
          clientId,
        }),
      },
      true,
    );
    if (!saved.success || !saved.data) {
      throw new Error(saved.message || 'The extraction was generated, but could not be saved to this client record.');
    }
    return {
      success: true,
      source: 'openrouter',
      message: saved.message || 'Document extracted with your local OpenRouter key.',
      data: saved.data,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/extraction/process`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ documentId, category }),
    });
  } catch {
    throw new Error('The extraction service is unavailable. The uploaded file is still safe in private Supabase Storage.');
  }

  let json: any;
  try { json = await res.json(); } catch { throw new Error(`The extraction service returned an invalid response (HTTP ${res.status}).`); }
  if (!res.ok || !json.success) throw new Error(json.message || `AI extraction failed (HTTP ${res.status}).`);

  return json;
}

// ─── WhatsApp API ──────────────────────────────────────────────

export async function fetchWhatsAppMessages(): Promise<WhatsAppMessage[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/whatsapp/messages`, { headers: authHeaders() });
    const json = await res.json();
    if (!Array.isArray(json.data)) return [];
    return json.data.map((message: Record<string, unknown>) => ({
      id: String(message.id || ''),
      clientId: String(message.client_id || message.clientId || ''),
      senderPhone: String(message.sender_phone || message.senderPhone || ''),
      senderName: String(message.sender_name || message.senderName || ''),
      direction: message.direction === 'outbound' ? 'outbound' : 'inbound',
      messageType: message.message_type === 'document' || message.message_type === 'image'
        ? message.message_type
        : message.messageType === 'document' || message.messageType === 'image'
          ? message.messageType
          : 'text',
      body: String(message.body || ''),
      timestamp: String(message.created_at || message.timestamp || ''),
      status: String(message.status || 'received'),
    }));
  } catch (err) {
    console.warn('Failed to fetch WhatsApp messages', err);
    return [];
  }
}

export interface WhatsAppStatus {
  connected: boolean;
  configured: boolean;
  message?: string;
  phoneNumberId?: string;
}

export async function fetchWhatsAppStatus(): Promise<WhatsAppStatus> {
  try {
    const res = await fetch(`${API_BASE_URL}/whatsapp/status`, { headers: authHeaders() });
    const json = await res.json();
    return {
      connected: Boolean(json.connected),
      configured: Boolean(json.configured),
      message: json.message,
      phoneNumberId: json.phoneNumberId,
    };
  } catch {
    return { connected: false, configured: false, message: 'WhatsApp backend service is unreachable.' };
  }
}

export async function sendWhatsAppManualMessage(clientId: string, toPhone: string, message: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/whatsapp/send`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, toPhone, message }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.message || `Failed to send WhatsApp message (HTTP ${res.status}).`);
  }
}

export interface TelegramStatus {
  connected: boolean;
  bot?: { username?: string; name?: string };
  message?: string;
  diagnostics?: {
    expectedWebhookUrl: string | null;
    webhookUrl: string | null;
    webhookMatchesThisService: boolean | null;
    webhookPendingUpdates: number;
    webhookLastError: string | null;
    webhookLastErrorAt?: string | null;
    telegramSchemaReady: boolean;
    clientPortalInvitesReady: boolean;
    storageBucket: string | null;
    storageBucketReady: boolean;
    webhookAutoConfigureEnabled: boolean;
    webhookIngress?: 'direct' | 'relay' | 'unconfigured';
    warnings: string[];
  };
}

export async function fetchTelegramStatus(): Promise<TelegramStatus> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/status`, { headers: authHeaders() }, 20000, 'Telegram status check');
  if (!res.ok || !json.success) throw new Error(json.message || `Telegram status failed (HTTP ${res.status}).`);
  return json;
}

export async function createTelegramLink(clientId: string): Promise<{ link: string; expiresAt: string }> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/clients/${encodeURIComponent(clientId)}/link`, { method: 'POST', headers: authHeaders(), body: '{}' }, 30000, 'Telegram connection');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to create Telegram link (HTTP ${res.status}).`);
  return json;
}

export async function fetchTelegramMessages(clientId: string): Promise<{ linked: boolean; messages: TelegramMessage[] }> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/clients/${encodeURIComponent(clientId)}/messages?limit=200`, { headers: authHeaders() }, 30000, 'Telegram conversation');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to load Telegram conversation (HTTP ${res.status}).`);
  return { linked: Boolean(json.linked), messages: json.data || [] };
}

export async function sendTelegramMessage(clientId: string, message: string, requestId: string = crypto.randomUUID()): Promise<TelegramMessage> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/send`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ clientId, message, approved: true, requestId }) }, 60000, 'Telegram message delivery');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to send Telegram message (HTTP ${res.status}).`);
  if (!json.data || typeof json.data.id !== 'string') {
    throw new Error('Telegram sent the message, but the backend did not return its saved conversation message.');
  }
  return json.data;
}

export interface TelegramUnreadSummary {
  counts: Record<string, number>;
  total: number;
}

export interface TelegramPreview {
  client_id: string;
  body: string;
  message_type: string;
  direction: 'inbound' | 'outbound';
  created_at: string;
}

export async function fetchTelegramUnread(): Promise<TelegramUnreadSummary> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/unread`, { headers: authHeaders() }, 10000, 'Telegram unread summary');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to load Telegram unread counts (HTTP ${res.status}).`);
  return { counts: json.counts || {}, total: Number(json.total) || 0 };
}

export async function fetchTelegramPreviews(): Promise<Record<string, TelegramPreview>> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/previews`, { headers: authHeaders() }, 10000, 'Telegram message previews');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to load Telegram message previews (HTTP ${res.status}).`);
  return json.data || {};
}

export async function markTelegramClientRead(clientId: string): Promise<void> {
  const { response: res, json } = await fetchTelegramJson(`${API_BASE_URL}/telegram/clients/${encodeURIComponent(clientId)}/read`, { method: 'POST', headers: authHeaders() }, 10000, 'Mark client read');
  if (!res.ok || !json.success) throw new Error(json.message || `Unable to mark Telegram messages as read (HTTP ${res.status}).`);
}

// ─── Compliance API ────────────────────────────────────────────

export async function fetchComplianceTasks(): Promise<ComplianceTask[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/deadlines`, { headers: authHeaders() });
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.warn('Failed to fetch compliance tasks', err);
    return [];
  }
}

// ─── Generate API ──────────────────────────────────────────────

export async function generateNoticeResponse(payload: {
  clientId: string;
  noticeText: string;
  section?: string;
}, onFallback?: OpenRouterFallbackCallback) {
  if (isUsingLocalOpenRouterKey()) {
    const result = await generateOpenRouterNoticeResponse(payload, onFallback);
    return {
      success: true,
      source: 'openrouter',
      data: { draftText: result.text, model: result.model },
    };
  }

  const res = await fetch(`${API_BASE_URL}/generate/notice-response`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  let json: { success?: boolean; message?: string; [key: string]: unknown };
  try {
    json = await res.json() as typeof json;
  } catch {
    throw new Error(`The notice response service returned an invalid response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json.success) {
    throw new Error(json.message || `Could not generate the notice response (HTTP ${res.status}).`);
  }
  return json;
}

// ─── Health ────────────────────────────────────────────────────

// ─── Message Templates ─────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  template_key?: string | null;
  user_id?: string | null;
  source?: 'default' | 'private';
  country_code?: string | null;
  name: string;
  cat: string;
  body: string;
  protected?: boolean;
}

export async function fetchTemplates(): Promise<MessageTemplate[]> {
  const response = await authRequest<{ success: boolean; message?: string; data?: MessageTemplate[] }>(
    `${API_BASE_URL}/templates`,
    { method: 'GET', headers: authHeaders() },
    true,
  );
  if (!response.success) throw new Error(response.message || 'Could not load templates.');
  return response.data || [];
}

export async function createTemplate(data: { name: string; cat: string; body: string }): Promise<MessageTemplate> {
  const response = await authRequest<{ success: boolean; message?: string; data?: MessageTemplate }>(
    `${API_BASE_URL}/templates`,
    { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) },
  );
  if (!response.success || !response.data) throw new Error(response.message || 'Could not create template.');
  return response.data;
}

export async function updateTemplate(templateId: string, data: { name?: string; cat?: string; body?: string }): Promise<MessageTemplate> {
  const response = await authRequest<{ success: boolean; message?: string; data?: MessageTemplate }>(
    `${API_BASE_URL}/templates/${encodeURIComponent(templateId)}`,
    { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(data) },
  );
  if (!response.success || !response.data) throw new Error(response.message || 'Could not update template.');
  return response.data;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await authRequest<{ success: boolean; message?: string }>(
    `${API_BASE_URL}/templates/${encodeURIComponent(templateId)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.success) throw new Error(response.message || 'Could not delete template.');
}

export interface SupportedCountryTimezone {
  country_id: string;
  country_code: string;
  country_name: string;
  timezone_name: string;
  is_default: boolean;
}

export interface TelegramMessageSchedule {
  id: string;
  client_id: string;
  template_id: string | null;
  message_body: string;
  repeat_mode: 'once' | 'daily';
  timezone_name: string;
  scheduled_at: string | null;
  local_time: string | null;
  next_run_at: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'failed';
  attempt_count: number;
  occurrence_count: number;
  last_sent_at: string | null;
  last_error: string | null;
  created_at: string;
  client?: { id: string; name: string; country_id: string };
}

const FALLBACK_COUNTRY_TIMEZONES: SupportedCountryTimezone[] = [
  { country_id: '10000000-0000-4000-8000-000000000001', country_code: 'IN', country_name: 'India', timezone_name: 'Asia/Kolkata', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/New_York', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Chicago', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Denver', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000002', country_code: 'US', country_name: 'United States', timezone_name: 'America/Los_Angeles', is_default: false },
  { country_id: '10000000-0000-4000-8000-000000000003', country_code: 'AE', country_name: 'United Arab Emirates', timezone_name: 'Asia/Dubai', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000004', country_code: 'SG', country_name: 'Singapore', timezone_name: 'Asia/Singapore', is_default: true },
  { country_id: '10000000-0000-4000-8000-000000000005', country_code: 'GB', country_name: 'United Kingdom', timezone_name: 'Europe/London', is_default: true },
];

export async function fetchSupportedCountryTimezones(): Promise<SupportedCountryTimezone[]> {
  const response = await authRequest<{ success: boolean; message?: string; data?: SupportedCountryTimezone[] }>(
    `${API_BASE_URL}/schedules/timezones`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.success) throw new Error(response.message || 'Could not load country time zones.');
  return response.data || FALLBACK_COUNTRY_TIMEZONES;
}

export async function fetchTelegramSchedules(): Promise<TelegramMessageSchedule[]> {
  const response = await authRequest<{ success: boolean; message?: string; data?: TelegramMessageSchedule[] }>(
    `${API_BASE_URL}/schedules`,
    { method: 'GET', headers: authHeaders() },
  );
  if (!response.success) throw new Error(response.message || 'Could not load scheduled reminders.');
  return response.data || [];
}

export async function createTelegramSchedule(data: {
  clientId: string;
  templateId?: string;
  messageBody: string;
  repeatMode: 'once' | 'daily';
  timezoneName: string;
  scheduledLocal?: string;
  localTime?: string;
}): Promise<TelegramMessageSchedule> {
  // Built-in templates use stable symbolic keys (for example, "itr"); only
  // persisted private templates have UUIDs accepted by the schedules table.
  const payload = {
    ...data,
    ...(data.templateId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.templateId)
      ? { templateId: data.templateId }
      : { templateId: undefined }),
  };
  let response = await authRequest<{ success: boolean; message?: string; data?: TelegramMessageSchedule }>(
    `${API_BASE_URL}/schedules`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    },
  );
  if (!response.success || !response.data) throw new Error(response.message || 'Could not create scheduled reminder.');
  return response.data;
}

export async function cancelTelegramSchedule(scheduleId: string): Promise<void> {
  const response = await authRequest<{ success: boolean; message?: string }>(
    `${API_BASE_URL}/schedules/${encodeURIComponent(scheduleId)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!response.success) throw new Error(response.message || 'Could not cancel scheduled reminder.');
}

export async function retryTelegramSchedule(scheduleId: string): Promise<void> {
  const response = await authRequest<{ success: boolean; message?: string }>(
    `${API_BASE_URL}/schedules/${encodeURIComponent(scheduleId)}/retry`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!response.success) throw new Error(response.message || 'Could not retry scheduled reminder.');
}

export async function sendChatMessage(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  onFallback?: OpenRouterFallbackCallback,
) {
  const hasSavedLocalKey = await hasOpenRouterApiKey();
  if (hasSavedLocalKey || isUsingLocalOpenRouterKey()) {
    const result = await sendOpenRouterChat(messages, onFallback);
    return { text: result.text, model: result.model };
  }

  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 35000);
  try {
    response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: authHeaders(),
      signal: controller.signal,
      body: JSON.stringify({ messages }),
    });
    // Chat may remain open beyond the short access-token lifetime. Refresh
    // once on 401, then retry with the rotated token before showing an AI
    // failure to the user.
    if (response.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed?.token) {
        response = await fetch(`${API_BASE_URL}/chat`, {
          method: 'POST',
          headers: authHeaders(),
          signal: controller.signal,
          body: JSON.stringify({ messages }),
        });
      }
    }
  } catch {
    window.clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new Error('The AI request timed out. Please try again.');
    }
    throw new Error('The AI service could not be reached. Check your connection and try again.');
  }

  let json: any;
  try {
    json = await response.json();
  } catch {
    if (controller.signal.aborted) {
      throw new Error('The AI request timed out. Please try again.');
    }
    throw new Error(`The AI service returned an invalid response (HTTP ${response.status}).`);
  } finally {
    window.clearTimeout(timeout);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`The AI service returned an invalid response (HTTP ${response.status}).`);
  }
  if (response.status === 401) {
    throw new Error('Your session has expired. Please sign in again, then retry your message.');
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    const waitMessage = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Please try again in about ${Math.ceil(retryAfter / 60)} minute${retryAfter >= 120 ? 's' : ''}.`
      : ' Please try again later.';
    throw new Error(`${json.message || 'The AI chat limit has been reached.'}${waitMessage}`);
  }
  if (!response.ok || !json.success) throw new Error(json.message || `The AI request failed (HTTP ${response.status}).`);
  if (json.source !== 'gemini' || typeof json.data?.text !== 'string' || !json.data.text.trim()) {
    throw new Error('The AI service returned an invalid response. Please try again.');
  }
  return json.data as { text: string; model: string };
}
