import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PetInfo } from "../browserClient";
import { useAnchorClient } from "./useAnchorClient";

export function usePetList() {
  const { client, ready } = useAnchorClient();
  const { publicKey } = useWallet();
  const [pets, setPets] = useState<PetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !ready || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listPetsByOwner(publicKey);
      setPets(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, ready, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { pets, loading, error, refresh };
}
