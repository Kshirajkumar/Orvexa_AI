import { getOpenRouterApiKey } from './localVault';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const USE_LOCAL_KEY_SETTING = 'taxflow_use_local_openrouter_key';
const MODEL_SETTING = 'taxflow_openrouter_model';
const REQUEST_TIMEOUT_MS = 60_000;

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
}

const FREE_VISION_MODELS: OpenRouterModel[] = [
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'NVIDIA Nemotron 3 Nano Omni', context_length: 0 },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'NVIDIA Nemotron 3.5 Super VL', context_length: 1_000_000 },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google Gemma 4 26B A4B', context_length: 262_144 },
  { id: 'qwen/qwen-2.5-vl-72b-instruct:free', name: 'Qwen 2.5 VL 72B', context_length: 0 },
  { id: 'meta-llama/llama-3.2-11b-vision-instruct:free', name: 'Llama 3.2 Vision 11B', context_length: 0 },
];

const JSON_OUTPUT_MODELS = new Set([
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-26b-a4b-it:free',
]);

export interface OpenRouterResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | MessagePart[];
};

export function isUsingLocalOpenRouterKey(): boolean {
  try {
    return localStorage.getItem(USE_LOCAL_KEY_SETTING) === 'true';
  } catch {
    throw new Error('Could not read the AI provider setting. No AI request was sent.');
  }
}

export function setUsingLocalOpenRouterKey(enabled: boolean): void {
  try {
    localStorage.setItem(USE_LOCAL_KEY_SETTING, String(enabled));
  } catch {
    throw new Error('Could not save the AI provider setting. Check the app storage permissions.');
  }
}

export function getSelectedOpenRouterModel(): string {
  try {
    return localStorage.getItem(MODEL_SETTING) || '';
  } catch {
    throw new Error('Could not read the selected OpenRouter model. No AI request was sent.');
  }
}

export function setSelectedOpenRouterModel(model: string): void {
  try {
    localStorage.setItem(MODEL_SETTING, model);
  } catch {
    throw new Error('Could not save the selected OpenRouter model. Check the app storage permissions.');
  }
}

export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  return FREE_VISION_MODELS.map(model => ({ ...model }));
}

function providerError(status: number): string {
  if (status === 401) return 'OpenRouter rejected this API key. Check the key in Settings and save it again.';
  if (status === 402) return 'OpenRouter could not process this request. Check the account balance and free-model availability.';
  if (status === 403) return 'OpenRouter denied this request. Check the key permissions and selected model.';
  if (status === 404) return 'This OpenRouter model is unavailable.';
  if (status === 413) return 'This image is too large for OpenRouter. Choose a smaller image.';
  if (status === 429) return 'OpenRouter rate limit reached. Wait a moment, then try again.';
  if (status >= 500) return 'OpenRouter is temporarily unavailable. Try again later.';
  return `OpenRouter rejected the request (HTTP ${status}). Check the selected model and input.`;
}

interface OpenRouterProviderError extends Error {
  providerStatus: number;
}

function providerResponseError(message: string, status = 502): OpenRouterProviderError {
  const error = new Error(message) as OpenRouterProviderError;
  error.providerStatus = status;
  return error;
}

async function requestOpenRouterModel(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  jsonOutput: boolean,
  timeoutMs: number,
  start: number,
): Promise<OpenRouterResult> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'TaxFlow.AI',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        temperature: jsonOutput ? 0.1 : 0.4,
        max_tokens: jsonOutput ? 4096 : 2048,
        ...(jsonOutput && JSON_OUTPUT_MODELS.has(model) ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch {
    globalThis.clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw providerResponseError('The OpenRouter model timed out.', 408);
    }
    throw new Error('Could not reach OpenRouter. Check your internet connection and try again.');
  }

  if (!response.ok) {
    globalThis.clearTimeout(timeout);
    throw providerResponseError(providerError(response.status), response.status);
  }

  let payload: {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    const timedOut = controller.signal.aborted;
    globalThis.clearTimeout(timeout);
    if (timedOut) {
      throw new Error('The OpenRouter request timed out. Try again with a smaller file or shorter prompt.');
    }
    throw providerResponseError('OpenRouter returned an invalid response.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    globalThis.clearTimeout(timeout);
    throw providerResponseError('OpenRouter returned an invalid response.');
  }
  const content = payload.choices?.[0]?.message?.content;
  globalThis.clearTimeout(timeout);
  const text = typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.map(part => typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text || '')
        : '').join('').trim()
      : '';
  if (!text) throw providerResponseError('The selected model returned no text.');
  if (jsonOutput) {
    try {
      const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const structured = JSON.parse(jsonText);
      if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
        throw new Error('Expected an object.');
      }
    } catch {
      throw providerResponseError('The selected model returned invalid structured JSON.');
    }
  }

  return {
    text,
    model,
    inputTokens: typeof payload.usage?.prompt_tokens === 'number' ? payload.usage.prompt_tokens : 0,
    outputTokens: typeof payload.usage?.completion_tokens === 'number' ? payload.usage.completion_tokens : 0,
    durationMs: Date.now() - start,
  };
}

async function openRouterRequest(
  messages: OpenRouterMessage[],
  jsonOutput = false,
): Promise<OpenRouterResult> {
  const apiKey = await getOpenRouterApiKey();
  const selectedModel = getSelectedOpenRouterModel();
  if (!selectedModel) throw new Error('Choose a free vision model in Settings before using your local key.');
  if (!FREE_VISION_MODELS.some(candidate => candidate.id === selectedModel)) {
    throw new Error('The selected model is no longer supported. Choose one of the five available models in Settings.');
  }

  const start = Date.now();
  return requestOpenRouterModel(apiKey, selectedModel, messages, jsonOutput, REQUEST_TIMEOUT_MS, start);
}

export async function sendOpenRouterChat(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<OpenRouterResult> {
  if (!Array.isArray(messages) || !messages.length || messages.length > 20 || messages.some(message =>
    !message
    || !['user', 'assistant'].includes(message.role)
    || typeof message.content !== 'string'
    || !message.content.trim()
    || message.content.length > 8000)) {
    throw new Error('Chat history must contain 1–20 messages, with no message longer than 8,000 characters.');
  }
  if (messages.reduce((total, message) => total + message.content.length, 0) > 40_000) {
    throw new Error('Chat history is too long. Start a new conversation and try again.');
  }
  return openRouterRequest(messages);
}

export async function generateOpenRouterNoticeResponse(payload: {
  noticeText: string;
  section?: string;
}): Promise<OpenRouterResult> {
  if (!payload.noticeText.trim() || payload.noticeText.length > 50_000) {
    throw new Error('Notice text must contain 1–50,000 characters.');
  }
  return openRouterRequest([
    {
      role: 'system',
      content: 'You draft clear, professional responses to Indian tax notices for review by a qualified tax professional. Do not invent facts, claim to file returns, or claim to contact government portals. Flag missing information.',
    },
    {
      role: 'user',
      content: `Draft a response to this notice${payload.section ? ` under ${payload.section}` : ''}:\n\n${payload.noticeText}`,
    },
  ]);
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The selected file could not be read. Please choose it again.'));
    reader.readAsDataURL(file);
  });
}

const EXTRACTION_PROMPTS: Record<string, string> = {
  GST: 'Extract this GST invoice into a JSON object with invoice_number, invoice_date, vendor_name, vendor_gstin, buyer_gstin, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_gst, grand_total, place_of_supply, hsn_codes, and line_items. Use numbers for amounts/rates, arrays for list fields, empty strings or null for missing values, and never infer unreadable details.',
  IncomeTax: 'Extract this income-tax document into a JSON object with document_type, assessment_year, pan, taxpayer_name, gross_total_income, deductions_80c, deductions_80d, other_deductions, taxable_income, tax_payable, tds_deducted, advance_tax, and refund_due. Use numbers for amounts, empty strings or null for missing values, and never infer unreadable details.',
  Form16: 'Extract this Form 16 into a JSON object with employer_name, employer_tan, employee_name, employee_pan, assessment_year, gross_salary, hra_exemption, lta_exemption, standard_deduction, professional_tax, section_80c, section_80d, net_taxable_income, tax_deducted, surcharge, cess, and total_tds. Use numbers for amounts, empty strings or null for missing values, and never infer unreadable details.',
  BankStatement: 'Extract this bank statement summary into a JSON object with bank_name, account_holder, account_number, ifsc, period_from, period_to, opening_balance, closing_balance, total_credits, total_debits, and transaction_count. Use numbers for amounts/counts, empty strings or null for missing values, and never infer unreadable details.',
  Notice: 'Extract this tax notice into a JSON object with notice_type, section, notice_date, due_date, authority, taxpayer_name, pan, assessment_year, demand_amount, reason, and action_required. Use numbers for amounts, empty strings or null for missing values, and never infer unreadable details.',
  General: 'Extract the financial and tax details from this document as a JSON object. Use concise field names, numbers for amounts, empty strings or null for missing values, and never infer unreadable details.',
};

export async function extractWithOpenRouter(file: File, category: string): Promise<OpenRouterResult & { extractedData: Record<string, unknown> }> {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Files larger than 20 MB cannot be sent to OpenRouter. Choose a smaller image or PDF.');
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type || ({
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
  } as Record<string, string>)[extension || ''] || '';
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
    throw new Error('Local OpenRouter vision mode accepts JPG, PNG, WEBP, or GIF images only. Turn off the local key setting to use the standard extraction service for this file type.');
  }

  const prompt = EXTRACTION_PROMPTS[category] || EXTRACTION_PROMPTS.General;
  const dataUrl = await fileDataUrl(file);
  const media: MessagePart = { type: 'image_url', image_url: { url: dataUrl } };
  const result = await openRouterRequest([{
    role: 'user',
    content: [
      { type: 'text', text: `${prompt}\nReturn only a JSON object. If a value cannot be read, use null or an empty string; do not guess.` },
      media,
    ],
  }], true);

  let extractedData: unknown;
  try {
    const jsonText = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    extractedData = JSON.parse(jsonText);
  } catch {
    throw new Error('OpenRouter did not return valid structured JSON. Retry the extraction or choose another vision model.');
  }
  if (!extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData)) {
    throw new Error('OpenRouter returned JSON in an unexpected format. Retry the extraction.');
  }
  return { ...result, extractedData: extractedData as Record<string, unknown> };
}
