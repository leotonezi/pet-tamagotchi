import type { ClaimStateInfo } from "../../browserClient";
import { DAILY_REWARD_COOLDOWN_HOURS } from "../../constants";

interface ClaimButtonProps {
  claimState: ClaimStateInfo | null;
  onInitClaimState: () => Promise<string | null>;
  onClaim: () => Promise<string | null>;
  loading?: boolean;
  petName: string;
}

function nextClaimTime(lastClaimTs: number): Date {
  return new Date((lastClaimTs + DAILY_REWARD_COOLDOWN_HOURS * 3600) * 1000);
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function ClaimButton({
  claimState,
  onInitClaimState,
  onClaim,
  loading,
  petName,
}: ClaimButtonProps) {
  if (!claimState) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-400">
          Claim state not initialized for <strong>{petName}</strong>. Set it up first.
        </p>
        <button
          onClick={onInitClaimState}
          disabled={loading}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Initializing…" : "Initialize Claim State"}
        </button>
      </div>
    );
  }

  const lastTs = claimState.lastClaimTs.toNumber();
  const next = lastTs === 0 ? null : nextClaimTime(lastTs);
  const now = Date.now();
  const canClaim = !next || next.getTime() <= now;
  const remaining = next ? Math.max(0, next.getTime() - now) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div>
          <p className="text-xs text-slate-500">Total claims</p>
          <p className="font-semibold text-slate-200">{claimState.totalClaims}</p>
        </div>
        {next && !canClaim && (
          <div>
            <p className="text-xs text-slate-500">Next claim in</p>
            <p className="font-semibold text-orange-400">{formatDuration(remaining)}</p>
          </div>
        )}
      </div>
      <button
        onClick={onClaim}
        disabled={loading || !canClaim}
        className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Claiming…" : canClaim ? "Claim Daily $PETZ" : "Cooldown active"}
      </button>
    </div>
  );
}
