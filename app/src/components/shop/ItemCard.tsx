import { ITEM_EFFECT } from "../../constants";

interface ItemCardProps {
  id: number;
  name: string;
  emoji: string;
  price: number; // lamports
  onBuy: (qty: number) => void;
  disabled?: boolean;
}

export function ItemCard({ id, name, emoji, price, onBuy, disabled }: ItemCardProps) {
  const solPrice = (price / 1_000_000_000).toFixed(3);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="text-4xl">{emoji}</span>
        <div>
          <h3 className="font-semibold text-slate-100">{name}</h3>
          <p className="text-xs text-slate-500">{ITEM_EFFECT[id] ?? ""}</p>
        </div>
      </div>
      <p className="text-sm text-violet-400 font-medium">{solPrice} SOL each</p>
      <div className="flex gap-2">
        {[1, 5, 10].map((qty) => (
          <button
            key={qty}
            onClick={() => onBuy(qty)}
            disabled={disabled}
            className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-200 hover:border-violet-600 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Buy {qty}
          </button>
        ))}
      </div>
    </div>
  );
}
