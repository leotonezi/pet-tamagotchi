interface TokenBalanceProps {
  balance: number;
  loading: boolean;
}

export function TokenBalance({ balance, loading }: TokenBalanceProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-violet-800 bg-violet-950/40 px-6 py-4">
      <span className="text-3xl">🪙</span>
      <div>
        <p className="text-xs uppercase tracking-wider text-violet-400">
          $PETZ Balance
        </p>
        <p className="text-2xl font-bold text-violet-300">
          {loading ? "…" : balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
      </div>
    </div>
  );
}
