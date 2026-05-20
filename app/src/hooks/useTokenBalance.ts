import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorClient } from "./useAnchorClient";

export function useTokenBalance() {
  const { client, ready } = useAnchorClient();
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !ready || !publicKey) return;
    setLoading(true);
    try {
      const bal = await client.getPetzBalance(publicKey);
      setBalance(bal);
    } catch {
      setBalance(0);
    } finally {
      setLoading(false);
    }
  }, [client, ready, publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { balance, loading, refresh };
}
