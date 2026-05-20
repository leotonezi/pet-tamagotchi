import { useCallback, useState } from "react";
import { ANCHOR_ERROR_MESSAGES } from "../constants";

export type ToastStatus = "pending" | "success" | "error";

export interface Toast {
  id: number;
  status: ToastStatus;
  message: string;
  txSig?: string;
}

let _id = 0;

export function useTxToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { ...toast, id }]);
    if (toast.status !== "pending") {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    }
    return id;
  }, []);

  const updateToast = useCallback((id: number, update: Partial<Toast>) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...update } : t))
    );
    if (update.status && update.status !== "pending") {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Wrap an async transaction call with toast feedback.
   * Returns the tx signature on success, or null on failure.
   */
  const withToast = useCallback(
    async (
      label: string,
      fn: () => Promise<string>
    ): Promise<string | null> => {
      const id = addToast({ status: "pending", message: `${label}…` });
      try {
        const sig = await fn();
        updateToast(id, {
          status: "success",
          message: `${label} confirmed!`,
          txSig: sig,
        });
        return sig;
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : String(e);
        // Try to extract Anchor error name
        let friendly = raw;
        for (const [name, msg] of Object.entries(ANCHOR_ERROR_MESSAGES)) {
          if (raw.includes(name)) {
            friendly = msg;
            break;
          }
        }
        updateToast(id, { status: "error", message: friendly });
        return null;
      }
    },
    [addToast, updateToast]
  );

  return { toasts, withToast, dismissToast };
}
