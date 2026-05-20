interface StatBarProps {
  label: string;
  value: number; // 0-100
  colorClass?: string;
}

export function StatBar({
  label,
  value,
  colorClass = "bg-violet-500",
}: StatBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{clamped}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-700">
        <div
          className={`h-2 rounded-full transition-all ${colorClass}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
