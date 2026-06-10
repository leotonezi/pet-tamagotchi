import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { ClientProvider } from "./context/ClientContext";
import { SOLANA_ENDPOINT } from "./constants";
import App from "./App";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),
];

// Adapter components are typed against React 17's FC; cast to accept children.
const Conn = ConnectionProvider as unknown as (props: {
  endpoint: string;
  children: ReactNode;
}) => ReactNode;
const WalletProv = WalletProvider as unknown as (props: {
  wallets: (PhantomWalletAdapter | SolflareWalletAdapter | BackpackWalletAdapter)[];
  autoConnect: boolean;
  children: ReactNode;
}) => ReactNode;
const ModalProv = WalletModalProvider as unknown as (props: {
  children: ReactNode;
}) => ReactNode;

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <Conn endpoint={SOLANA_ENDPOINT}>
      <WalletProv wallets={wallets} autoConnect>
        <ModalProv>
          <ClientProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ClientProvider>
        </ModalProv>
      </WalletProv>
    </Conn>
  </StrictMode>
);
