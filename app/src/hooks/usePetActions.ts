import { useCallback } from "react";
import { useAnchorClient } from "./useAnchorClient";
import { useTxToast } from "./useTxToast";

export function usePetActions(petName: string, onSuccess?: () => void) {
  const { client } = useAnchorClient();
  const { toasts, withToast, dismissToast } = useTxToast();

  const act = useCallback(
    (label: string, fn: () => Promise<string>) =>
      withToast(label, fn).then((sig) => {
        if (sig) onSuccess?.();
        return sig;
      }),
    [withToast, onSuccess]
  );

  const feed = useCallback(
    () => act("Feed", () => client!.feedPet(petName)),
    [act, client, petName]
  );

  const walk = useCallback(
    () => act("Walk", () => client!.walkPet(petName)),
    [act, client, petName]
  );

  const bathe = useCallback(
    () => act("Bathe", () => client!.bathePet(petName)),
    [act, client, petName]
  );

  const sleep = useCallback(
    () => act("Sleep", () => client!.sleepPet(petName)),
    [act, client, petName]
  );

  const play = useCallback(
    () => act("Play", () => client!.playWithPet(petName)),
    [act, client, petName]
  );

  const checkStatus = useCallback(
    () =>
      act("Check status", async () => {
        await client!.checkStatus(petName);
        return "ok";
      }),
    [act, client, petName]
  );

  return { feed, walk, bathe, sleep, play, checkStatus, toasts, dismissToast };
}
