import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { InventoryInfo } from "../browserClient";
import { useAnchorClient } from "./useAnchorClient";

export function useInventory() {
  const { client, ready } = useAnchorClient();
  const { publicKey } = useWallet();
  const [inventory, setInventory] = useState<InventoryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !ready || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const inv = await client.getInventory(publicKey);
      setInventory(inv);
    } catch {
      // Inventory may not be initialized yet
      setInventory(null);
    } finally {
      setLoading(false);
    }
  }, [client, ready, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { inventory, loading, error, refresh };
}
