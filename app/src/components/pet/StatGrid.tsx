import { StatBar } from "./StatBar";
import type { PetInfo } from "../../browserClient";

interface StatGridProps {
  pet: PetInfo;
}

export function StatGrid({ pet }: StatGridProps) {
  return (
    <div className="space-y-3">
      <StatBar label="Hunger" value={pet.hunger} colorClass="bg-orange-500" />
      <StatBar
        label="Tiredness"
        value={pet.tiredness}
        colorClass="bg-blue-500"
      />
      <StatBar
        label="Hygiene"
        value={pet.hygiene}
        colorClass="bg-cyan-500"
      />
      <StatBar
        label="Happiness"
        value={pet.happiness}
        colorClass="bg-yellow-400"
      />
      <StatBar label="Health" value={pet.health} colorClass="bg-green-500" />
    </div>
  );
}
