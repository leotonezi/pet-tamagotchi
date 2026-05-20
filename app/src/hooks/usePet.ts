import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PetInfo } from "../browserClient";
import { useAnchorClient } from "./useAnchorClient";

export function usePet(petName: string | undefined) {
  const { client, ready } = useAnchorClient();
  const { publicKey } = useWallet();
  const [pet, setPet] = useState<PetInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !ready || !petName || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const info = await client.getPetInfo(petName, publicKey);
      setPet(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, ready, petName, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pet, loading, error, refresh };
}
