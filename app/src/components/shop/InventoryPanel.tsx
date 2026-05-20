import type { InventoryInfo } from "../../browserClient";
import { ITEMS } from "../../constants";

interface InventoryPanelProps {
  inventory: InventoryInfo | null;
  loading: boolean;
  pets: { name: string }[];
  onUseItem: (itemId: number, petName: string) => void;
}

export function InventoryPanel({
  inventory,
  loading,
  pets,
  onUseItem,
}: InventoryPanelProps) {
  if (loading) {
    return (
      <div className="text-sm text-slate-500 italic">Loading inventory…</div>
    );
  }

  if (!inventory) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-500 italic">
        No inventory yet — buy an item to initialise it automatically.
      </div>
    );
  }

  const nonEmpty = inventory.slots.filter((s) => s.qty > 0);

  if (nonEmpty.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-500 italic">
        Inventory is empty.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {nonEmpty.map((slot) => {
        const item = ITEMS.find((i) => i.id === slot.itemId);
        return (
          <div
            key={slot.itemId}
            className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3"
          >
            <span className="text-2xl">{item?.emoji ?? "?"}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-100">
                {item?.name ?? `Item #${slot.itemId}`}
              </p>
              <p className="text-xs text-slate-500">Qty: {slot.qty}</p>
            </div>
            {pets.length > 0 && (
              <select
                className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    onUseItem(slot.itemId, e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="" disabled>
                  Use on…
                </option>
                {pets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}
