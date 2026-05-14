import { ref, markRaw } from "vue";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  confirmDanger?: boolean;
  cancelLabel?: string;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

// Module-scope singleton — nur eine Instanz aktiv
export const _pendingConfirm = ref<PendingConfirm | null>(null);

export function useConfirm() {
  function confirm(options: string | ConfirmOptions): Promise<boolean> {
    const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
    return new Promise((resolve) => {
      _pendingConfirm.value = markRaw({ ...opts, resolve }) as PendingConfirm;
    });
  }

  function _accept() {
    _pendingConfirm.value?.resolve(true);
    _pendingConfirm.value = null;
  }

  function _cancel() {
    _pendingConfirm.value?.resolve(false);
    _pendingConfirm.value = null;
  }

  return { confirm, _accept, _cancel };
}
