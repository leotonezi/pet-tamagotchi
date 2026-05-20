import { useState } from "react";
import { useAnchorClient } from "../../hooks/useAnchorClient";
import { useTxToast } from "../../hooks/useTxToast";
import { TxToastContainer } from "../shared/TxToast";

interface CreatePetModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreatePetModal({ onClose, onCreated }: CreatePetModalProps) {
  const { client } = useAnchorClient();
  const { toasts, withToast, dismissToast } = useTxToast();
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || submitting) return;
    setSubmitting(true);
    const sig = await withToast("Create pet", () =>
      client.createPet(name.trim(), species.trim())
    );
    setSubmitting(false);
    if (sig) {
      setTimeout(() => {
        onCreated();
        onClose();
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-100">
          Create a New Pet
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="pet-name">
              Pet name <span className="text-slate-600">(max 32 chars)</span>
            </label>
            <input
              id="pet-name"
              type="text"
              maxLength={32}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Buddy"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400" htmlFor="pet-species">
              Species <span className="text-slate-600">(max 16 chars)</span>
            </label>
            <input
              id="pet-species"
              type="text"
              maxLength={16}
              required
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              placeholder="Cat"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !species.trim()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Pet"}
            </button>
          </div>
        </form>
      </div>
      <TxToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
