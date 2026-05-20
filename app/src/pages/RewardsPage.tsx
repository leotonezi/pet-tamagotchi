import { useState } from "react";
import { usePetList } from "../hooks/usePetList";
import { useClaimState } from "../hooks/useClaimState";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { useTxToast } from "../hooks/useTxToast";
import { useAnchorClient } from "../hooks/useAnchorClient";
import { TokenBalance } from "../components/rewards/TokenBalance";
import { ClaimButton } from "../components/rewards/ClaimButton";
import { TxToastContainer } from "../components/shared/TxToast";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";

export function RewardsPage() {
  const { pets, loading: petsLoading } = usePetList();
  const { client } = useAnchorClient();
  const { balance, loading: balLoading, refresh: refreshBalance } = useTokenBalance();
  const { toasts, withToast, dismissToast } = useTxToast();
  const [selectedPet, setSelectedPet] = useState<string>("");

  const petName = selectedPet || pets[0]?.name;

  const { claimState, refresh: refreshClaim } = useClaimState(petName);

  const [acting, setActing] = useState(false);

  const handleInitClaimState = async () => {
    if (!client || !petName) return null;
    setActing(true);
    const sig = await withToast("Initialize claim state", () =>
      client.initClaimState(petName)
    );
    setActing(false);
    if (sig) refreshClaim();
    return sig;
  };

  const handleClaim = async () => {
    if (!client || !petName) return null;
    setActing(true);
    const sig = await withToast("Claim daily $PETZ", () =>
      client.claimDailyReward(petName)
    );
    setActing(false);
    if (sig) {
      refreshClaim();
      refreshBalance();
    }
    return sig;
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Daily Rewards</h1>

      <TokenBalance balance={balance} loading={balLoading} />

      {petsLoading ? (
        <LoadingSpinner />
      ) : pets.length === 0 ? (
        <p className="text-slate-500">Create a pet first to claim daily rewards.</p>
      ) : (
        <div className="space-y-4">
          {pets.length > 1 && (
            <div>
              <label className="mb-1 block text-sm text-slate-400">
                Select pet
              </label>
              <select
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none"
                value={selectedPet || petName}
                onChange={(e) => setSelectedPet(e.target.value)}
              >
                {pets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-100">{petName}</h2>
              <p className="text-xs text-slate-500 mt-1">
                Earn bonus $PETZ based on your pet&apos;s happiness and health.
                Perfect care score awards a bonus multiplier!
              </p>
            </div>

            <ClaimButton
              petName={petName ?? ""}
              claimState={claimState}
              onInitClaimState={handleInitClaimState}
              onClaim={handleClaim}
              loading={acting}
            />
          </div>
        </div>
      )}

      <TxToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
