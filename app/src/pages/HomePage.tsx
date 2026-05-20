import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "../components/layout/WalletButton";

export function HomePage() {
  const { connected } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (connected) {
      navigate("/pets", { replace: true });
    }
  }, [connected, navigate]);

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
      <div className="text-8xl select-none">🐾</div>
      <div className="space-y-3">
        <h1 className="text-4xl font-bold text-slate-100">Pet Tamagotchi</h1>
        <p className="max-w-md text-slate-400">
          Raise virtual pets on Solana. Feed, walk, bathe, and play with them.
          Earn <strong className="text-violet-400">$PETZ</strong> tokens for
          daily care!
        </p>
      </div>
      <WalletButton />
      <p className="text-sm text-slate-600">
        Connect your Solana wallet to get started
      </p>
    </div>
  );
}
