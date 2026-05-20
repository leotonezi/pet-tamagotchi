import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function WalletButton() {
  return (
    <WalletMultiButton
      style={{
        background: "rgb(109 40 217)",
        borderRadius: "0.5rem",
        fontSize: "0.875rem",
        padding: "0.5rem 1rem",
        height: "auto",
      }}
    />
  );
}
