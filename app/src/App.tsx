import { Navigate, Route, Routes } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { type ReactNode } from "react";
import { AppShell } from "./components/layout/AppShell";
import { HomePage } from "./pages/HomePage";
import { PetListPage } from "./pages/PetListPage";
import { PetDetailPage } from "./pages/PetDetailPage";
import { ShopPage } from "./pages/ShopPage";
import { RewardsPage } from "./pages/RewardsPage";

function RequireWallet({ children }: { children: ReactNode }) {
  const { connected } = useWallet();
  if (!connected) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/pets"
          element={
            <RequireWallet>
              <PetListPage />
            </RequireWallet>
          }
        />
        <Route
          path="/pets/:name"
          element={
            <RequireWallet>
              <PetDetailPage />
            </RequireWallet>
          }
        />
        <Route
          path="/shop"
          element={
            <RequireWallet>
              <ShopPage />
            </RequireWallet>
          }
        />
        <Route
          path="/rewards"
          element={
            <RequireWallet>
              <RewardsPage />
            </RequireWallet>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
