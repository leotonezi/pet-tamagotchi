import { useInventory } from "../hooks/useInventory";
import { usePetList } from "../hooks/usePetList";
import { useShopActions } from "../hooks/useShopActions";
import { ItemGrid } from "../components/shop/ItemGrid";
import { InventoryPanel } from "../components/shop/InventoryPanel";
import { TxToastContainer } from "../components/shared/TxToast";
import { ErrorBanner } from "../components/shared/ErrorBanner";

export function ShopPage() {
  const { inventory, loading: invLoading, refresh: refreshInv, error } = useInventory();
  const { pets } = usePetList();

  const { initInventory, buyItem, useItem, toasts, dismissToast } =
    useShopActions(refreshInv);

  const handleBuy = async (itemId: number, qty: number) => {
    if (!inventory) {
      const sig = await initInventory();
      if (!sig) return;
    }
    await buyItem(itemId, qty);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">Shop</h1>

      {error && <ErrorBanner message={error} />}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Items for sale
        </h2>
        <ItemGrid onBuy={handleBuy} />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Your inventory
        </h2>
        <InventoryPanel
          inventory={inventory}
          loading={invLoading}
          pets={pets}
          onUseItem={(itemId, petName) => useItem(itemId, petName)}
        />
      </section>

      <TxToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
