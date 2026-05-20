import { ITEMS } from "../../constants";
import { ItemCard } from "./ItemCard";

interface ItemGridProps {
  onBuy: (itemId: number, qty: number) => void;
  disabled?: boolean;
}

export function ItemGrid({ onBuy, disabled }: ItemGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {ITEMS.map((item) => (
        <ItemCard
          key={item.id}
          id={item.id}
          name={item.name}
          emoji={item.emoji}
          price={item.price}
          onBuy={(qty) => onBuy(item.id, qty)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
