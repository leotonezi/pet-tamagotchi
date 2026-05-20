import { useState } from "react";
import { usePetList } from "../hooks/usePetList";
import { PetCard } from "../components/pet/PetCard";
import { CreatePetModal } from "../components/pet/CreatePetModal";
import { LoadingSpinner } from "../components/shared/LoadingSpinner";
import { ErrorBanner } from "../components/shared/ErrorBanner";

export function PetListPage() {
  const { pets, loading, error, refresh } = usePetList();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">My Pets</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          + New Pet
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!loading && pets.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <span className="text-5xl">🐣</span>
          <p className="text-slate-400">
            You have no pets yet. Create your first one!
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Create a Pet
          </button>
        </div>
      )}

      {!loading && pets.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pets.map((pet) => (
            <PetCard key={pet.publicKey.toBase58()} pet={pet} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePetModal
          onClose={() => setShowCreate(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
