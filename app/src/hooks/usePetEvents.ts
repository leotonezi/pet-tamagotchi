import { useEffect, useRef, useState } from "react";
import { useAnchorClient } from "./useAnchorClient";
import { WS_LIVENESS_TIMEOUT_MS, PET_POLL_INTERVAL_MS } from "../constants";


export interface UsePetEventsOptions {
  livenessTimeoutMs?: number;
  pollIntervalMs?: number;
}

export type UsePetEventsMode = "initializing" | "ws" | "polling";

export interface UsePetEventsResult {
  mode: UsePetEventsMode;
}

export function usePetEvents(
  onUpdate: () => void,
  options?: UsePetEventsOptions,
): UsePetEventsResult {
  const { livenessTimeoutMs = WS_LIVENESS_TIMEOUT_MS, pollIntervalMs = PET_POLL_INTERVAL_MS } =
    options ?? {};

  const { client, ready } = useAnchorClient();
  const [mode, setMode] = useState<UsePetEventsMode>("initializing");

  const livenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsAliveRef = useRef<boolean>(false);

  const onUpdateRef = useRef(onUpdate);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!client || !ready) return;

    let cancelled = false;

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
          onUpdateRef.current();
          wsAliveRef.current = true;

          setMode((current) => {
            if (current === "polling") {
              // Polling is a one-way latch for this mount. Once degraded, we do not
              // recover to ws mode. User must navigate away and back to re-attempt ws.
              return current;
            }
            // Transition to ws: clear liveness timer and any poll interval
            if (livenessTimerRef.current !== null) {
              clearTimeout(livenessTimerRef.current);
              livenessTimerRef.current = null;
            }
            if (pollIntervalRef.current !== null) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            return "ws";
          });
        });
        ids.push(id);
      } catch {
        // Event listener not supported in this environment — skip
      }
    }

    if (import.meta.env.DEV) {
      console.debug("[usePetEvents] wsListenerCount:", ids.length);
    }

    livenessTimerRef.current = setTimeout(() => {
      if (cancelled || wsAliveRef.current || pollIntervalRef.current !== null) return;
      setMode("polling");
      pollIntervalRef.current = setInterval(() => onUpdateRef.current(), pollIntervalMs);
    }, livenessTimeoutMs);

    return () => {
      cancelled = true;
      for (const id of ids) {
        program.removeEventListener(id).catch(() => {});
      }
      if (livenessTimerRef.current !== null) {
        clearTimeout(livenessTimerRef.current);
        livenessTimerRef.current = null;
      }
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      wsAliveRef.current = false;
    };
  }, [client, ready, livenessTimeoutMs, pollIntervalMs]);

  return { mode };
}
