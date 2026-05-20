import type { Toast } from "../../hooks/useTxToast";

interface TxToastProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function TxToastContainer({ toasts, onDismiss }: TxToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <TxToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function TxToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const statusStyles = {
    pending: "border-slate-600 bg-slate-800 text-slate-200",
    success: "border-green-700 bg-green-900/60 text-green-200",
    error: "border-red-700 bg-red-900/60 text-red-200",
  };

  const icons = { pending: "⏳", success: "✅", error: "❌" };

  return (
    <div
      className={`flex min-w-[240px] max-w-xs items-start gap-2 rounded-lg border px-4 py-3 shadow-lg text-sm ${statusStyles[toast.status]}`}
    >
      <span>{icons[toast.status]}</span>
      <div className="flex-1">
        <p>{toast.message}</p>
        {toast.txSig && (
          <a
            href={`https://explorer.solana.com/tx/${toast.txSig}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-xs underline opacity-70 hover:opacity-100"
          >
            View on Explorer
          </a>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        &#10005;
      </button>
    </div>
  );
}
