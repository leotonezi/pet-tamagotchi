import { useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { usePet } from "../hooks/usePet";
import { usePetActions } from "../hooks/usePetActions";
import { usePetEvents } from "../hooks/usePetEvents";
import { PET_POLL_INTERVAL_MS } from "../constants";
import { PetAvatar } from "../components/pet/PetAvatar";
import { StatGrid } from "../components/pet/StatGrid";
import { ActionPanel } from "../components/pet/ActionPanel";
import { DeathOverlay } from "../components/pet/DeathOverlay";
import { TxToastContainer } from "../components/shared/TxToast";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { ErrorBanner } from "../components/shared/ErrorBanner";

export function PetDetailPage() {
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : undefined;

  const { pet, loading, error, refresh } = usePet(decodedName);

  const stableRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const { mode } = usePetEvents(stableRefresh);

  const { feed, walk, bathe, sleep, play, checkStatus, toasts, dismissToast } =
    usePetActions(decodedName ?? "", stableRefresh);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/pets" className="text-sm text-violet-400 hover:underline">
          ← Back to pets
        </Link>
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!pet) return null;

  const needsBadges = [
    pet.needsMeal && { label: "Hungry", color: "bg-orange-900/50 text-orange-400" },
    pet.needsWalk && { label: "Needs walk", color: "bg-blue-900/50 text-blue-400" },
    pet.needsBath && { label: "Needs bath", color: "bg-cyan-900/50 text-cyan-400" },
  ].filter(Boolean) as { label: string; color: string }[];

  return (
    <div className="space-y-6">
      <Link to="/pets" className="text-sm text-violet-400 hover:underline">
        ← Back to pets
      </Link>

      {mode === "polling" && (
        <p className="text-xs text-slate-500">
          Live updates unavailable — polling every {PET_POLL_INTERVAL_MS / 1_000} s.
        </p>
      )}

      {!pet.isAlive && <DeathOverlay petName={pet.name} />}

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <PetAvatar happiness={pet.happiness} isAlive={pet.isAlive} size="lg" />
          <div className="flex-1 space-y-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="text-2xl font-bold text-slate-100">{pet.name}</h1>
              {!pet.isAlive && (
                <span className="rounded bg-red-900/60 px-2 py-0.5 text-xs text-red-400">
                  Deceased
                </span>
              )}
            </div>
            <p className="text-slate-500">{pet.species}</p>
            {needsBadges.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {needsBadges.map((b) => (
                  <span key={b.label} className={`rounded px-2 py-0.5 text-xs ${b.color}`}>
                    {b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={stableRefresh}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Refresh ↻
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Stats
        </h2>
        <StatGrid pet={pet} />
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">
        <ActionPanel
          petName={pet.name}
          isAlive={pet.isAlive}
          onFeed={feed}
          onWalk={walk}
          onBathe={bathe}
          onSleep={sleep}
          onPlay={play}
          onCheckStatus={checkStatus}
        />
      </div>

      <TxToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
