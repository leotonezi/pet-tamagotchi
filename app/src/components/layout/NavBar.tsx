import { NavLink } from "react-router-dom";
import { WalletButton } from "./WalletButton";
import { useWallet } from "@solana/wallet-adapter-react";

const links = [
  { to: "/pets", label: "My Pets" },
  { to: "/shop", label: "Shop" },
  { to: "/rewards", label: "Rewards" },
];

export function NavBar() {
  const { connected } = useWallet();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        <NavLink to="/" className="flex items-center gap-2 font-bold text-violet-400">
          <span className="text-xl">🐾</span>
          <span className="hidden sm:inline">Pet Tamagotchi</span>
        </NavLink>

        {connected && (
          <nav className="flex flex-1 items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-violet-900/50 text-violet-300"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="ml-auto">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
