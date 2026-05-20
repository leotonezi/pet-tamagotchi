import { useEffect } from "react";
import { useAnchorClient } from "./useAnchorClient";

/**
 * Subscribes to care events (PetFed, PetWalked, PetBathed, PetSlept, PetPlayed)
 * and calls onUpdate whenever any fires.
 *
 * Events confirmed to exist in the IDL: PetFed, PetWalked, PetBathed, PetSlept, PetPlayed.
 * (PetStatUpdated does NOT exist in the IDL — do not subscribe to it.)
 */
export function usePetEvents(onUpdate: () => void) {
  const { client, ready } = useAnchorClient();

  useEffect(() => {
    if (!client || !ready) return;

    const program = client.program;

    const ids: number[] = [];

    const events = [
      "petFed",
      "petWalked",
      "petBathed",
      "petSlept",
      "petPlayed",
    ] as const;

    for (const ev of events) {
      try {
        const id = program.addEventListener(ev, () => {
          onUpdate();
        });
        ids.push(id);
      } catch {
        // Event listener not supported in this environment — skip
      }
    }

    return () => {
      for (const id of ids) {
        program.removeEventListener(id).catch(() => {});
      }
    };
  }, [client, ready, onUpdate]);
}
