import { invoke, isTauri } from '@tauri-apps/api/core';

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
