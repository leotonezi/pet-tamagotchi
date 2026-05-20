import { useClient } from "../context/ClientContext";
import type { PetTamagotchiClient } from "../browserClient";

export function useAnchorClient(): {
  client: PetTamagotchiClient | null;
  ready: boolean;
} {
  return useClient();
}
