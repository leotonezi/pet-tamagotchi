import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ClaimStateInfo } from "../browserClient";
import { useAnchorClient } from "./useAnchorClient";

export function useClaimState(petName: string | undefined) {
  const { client, ready } = useAnchorClient();
  const { publicKey } = useWallet();
  const [claimState, setClaimState] = useState<ClaimStateInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !ready || !publicKey || !petName) return;
    setLoading(true);
    try {
      const cs = await client.fetchClaimState(publicKey, petName);
      setClaimState(cs);
    } catch {
      setClaimState(null);
    } finally {
      setLoading(false);
    }
  }, [client, ready, publicKey, petName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { claimState, loading, refresh };
}
