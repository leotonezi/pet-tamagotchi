import { Link } from "react-router-dom";
import type { PetInfo } from "../../browserClient";
import { PetAvatar } from "./PetAvatar";
import { StatBar } from "./StatBar";

interface PetCardProps {
  pet: PetInfo;
}

export function PetCard({ pet }: PetCardProps) {
  return (
    <Link
      to={`/pets/${encodeURIComponent(pet.name)}`}
      className="block rounded-xl border border-slate-700 bg-slate-900 p-4 transition-all hover:border-violet-600 hover:shadow-lg hover:shadow-violet-900/20"
    >
      <div className="flex items-center gap-4">
        <PetAvatar happiness={pet.happiness} isAlive={pet.isAlive} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold text-slate-100">{pet.name}</h2>
            {!pet.isAlive && (
              <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-xs text-red-400">
                Deceased
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{pet.species}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <StatBar label="Happiness" value={pet.happiness} colorClass="bg-yellow-400" />
        <StatBar label="Health" value={pet.health} colorClass="bg-green-500" />
      </div>
      {(pet.needsMeal || pet.needsWalk || pet.needsBath) && (
        <div className="mt-3 flex flex-wrap gap-1">
          {pet.needsMeal && (
            <span className="rounded bg-orange-900/50 px-2 py-0.5 text-xs text-orange-400">
              Hungry
            </span>
          )}
          {pet.needsWalk && (
            <span className="rounded bg-blue-900/50 px-2 py-0.5 text-xs text-blue-400">
              Needs walk
            </span>
          )}
          {pet.needsBath && (
            <span className="rounded bg-cyan-900/50 px-2 py-0.5 text-xs text-cyan-400">
              Needs bath
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
