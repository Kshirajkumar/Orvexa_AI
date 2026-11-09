import { invoke, isTauri } from '@tauri-apps/api/core';

export interface LocalVaultStatus {
  vaultPath: string;
  deviceId: string;
}

export interface PendingLocalDocument {
  id: string;
  clientName: string;
  fileName: string;
  sha256: string;
  year: string;
  month: string;
  source: 'Telegram' | 'Portal';
}

export function isDesktopApp(): boolean {
  return isTauri();
}

export async function hasOpenRouterApiKey(): Promise<boolean> {
  if (!isDesktopApp()) return false;
  return invoke<boolean>('has_openrouter_api_key');
}

export async function saveOpenRouterApiKey(apiKey: string): Promise<void> {
  if (!isDesktopApp()) {
    throw new Error('OpenRouter keys can only be saved securely in the Windows desktop app.');
  }
  await invoke('save_openrouter_api_key', { apiKey });
}

export async function getOpenRouterApiKey(): Promise<string> {
  if (!isDesktopApp()) {
    throw new Error('OpenRouter keys are available only in the Windows desktop app.');
  }
  const apiKey = await invoke<string | null>('get_openrouter_api_key');
  if (!apiKey) throw new Error('No OpenRouter key is saved. Add one in Settings before using your local key.');
  return apiKey;
}

export async function deleteOpenRouterApiKey(): Promise<void> {
  if (!isDesktopApp()) {
    throw new Error('OpenRouter keys can only be removed from the Windows desktop app.');
  }
  await invoke('delete_openrouter_api_key');
}

export async function getLocalVaultStatus(): Promise<LocalVaultStatus | null> {
  return invoke<LocalVaultStatus | null>('get_local_vault_status');
}

export async function configureLocalVault(vaultPath: string): Promise<LocalVaultStatus> {
  return invoke<LocalVaultStatus>('configure_local_vault', { vaultPath });
}

export async function saveSyncedDocument(
  document: PendingLocalDocument,
  content: ArrayBuffer,
): Promise<void> {
  const chunkSize = 512 * 1024;
  for (let offset = 0; offset < content.byteLength; offset += chunkSize) {
    const length = Math.min(chunkSize, content.byteLength - offset);
    const chunk = Array.from(new Uint8Array(content, offset, length));
    await invoke<string | null>('save_synced_document_chunk', {
      documentId: document.id,
      clientName: document.clientName,
      year: document.year,
      month: document.month,
      fileName: document.fileName,
      offset,
      totalSize: content.byteLength,
      bytes: chunk,
      expectedSha256: document.sha256,
    });
  }
}
