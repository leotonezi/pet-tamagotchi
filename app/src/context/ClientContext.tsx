import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { BrowserPetClient, type PetTamagotchiClient } from "../browserClient";

interface ClientCtx {
  client: PetTamagotchiClient | null;
  ready: boolean;
}

const ClientContext = createContext<ClientCtx>({ client: null, ready: false });

export function ClientProvider({ children }: { children: ReactNode }) {
  const { wallet, publicKey, signTransaction, signAllTransactions } =
    useWallet();
  const { connection } = useConnection();
  const [client, setClient] = useState<PetTamagotchiClient | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!publicKey || !wallet || !signTransaction || !signAllTransactions) {
      setClient(null);
      setReady(false);
      return;
    }

    const provider = new AnchorProvider(
      connection,
      {
        publicKey,
        signTransaction,
        signAllTransactions,
      },
      { commitment: "confirmed" }
    );

    const c = new BrowserPetClient(provider);
    setClient(c);
    setReady(true);
  }, [publicKey, wallet, signTransaction, signAllTransactions, connection]);

  return (
    <ClientContext.Provider value={{ client, ready }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): ClientCtx {
  return useContext(ClientContext);
}
