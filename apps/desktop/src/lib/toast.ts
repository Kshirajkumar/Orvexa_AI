export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastPayload {
  kind: ToastKind;
  title: string;
  message: string;
  eventType?: string;
  entityType?: string | null;
  entityId?: string | null;
  persisted?: boolean;
}

export interface ToastItem extends ToastPayload {
  id: string;
}

export const TOAST_EVENT = 'taxflow:toast';

export function emitToast(payload: ToastPayload): void {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }));
}
