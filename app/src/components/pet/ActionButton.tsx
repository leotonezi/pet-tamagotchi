interface ActionButtonProps {
  label: string;
  emoji: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ActionButton({
  label,
  emoji,
  onClick,
  disabled = false,
  loading = false,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex flex-col items-center gap-1 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:border-violet-600 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-2xl">{loading ? "⏳" : emoji}</span>
      <span>{label}</span>
    </button>
  );
}
