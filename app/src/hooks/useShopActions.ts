import { useCallback } from "react";
import { useAnchorClient } from "./useAnchorClient";
import { useTxToast } from "./useTxToast";

export function useShopActions(onSuccess?: () => void) {
  const { client } = useAnchorClient();
  const { toasts, withToast, dismissToast } = useTxToast();

  const initInventory = useCallback(
    () =>
      withToast("Init inventory", () => client!.initInventory()).then((sig) => {
        if (sig) onSuccess?.();
        return sig;
      }),
    [withToast, client, onSuccess]
  );

  const buyItem = useCallback(
    (itemId: number, qty: number) =>
      withToast(`Buy item`, () => client!.buyItem(itemId, qty)).then((sig) => {
        if (sig) onSuccess?.();
        return sig;
      }),
    [withToast, client, onSuccess]
  );

  const useItem = useCallback(
    (itemId: number, petName: string) =>
      withToast(`Use item on ${petName}`, () =>
        client!.useItem(itemId, petName)
      ).then((sig) => {
        if (sig) onSuccess?.();
        return sig;
      }),
    [withToast, client, onSuccess]
  );

  return { initInventory, buyItem, useItem, toasts, dismissToast };
}
