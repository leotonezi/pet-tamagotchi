# R3 Open Issues — React Web UI

**Date:** 2026-05-20  
**Milestone:** R3 (React Web UI)  
**Status:** Open

---

## Issue 1 — Bundle size: no chunk splitting

**Severity:** Low  
**File:** `app/vite.config.ts`

Single JS bundle is ~793 KB (237 KB gzipped). Solana wallet adapters, Anchor, and app code are all in one chunk. Large initial load for users on slow connections.

**Fix:** Add `build.rollupOptions.output.manualChunks` to `vite.config.ts`:

```ts
manualChunks: {
  "vendor-solana": ["@solana/web3.js", "@coral-xyz/anchor", "@solana/spl-token"],
  "vendor-wallets": ["@solana/wallet-adapter-react", "@solana/wallet-adapter-react-ui", "@solana/wallet-adapter-wallets"],
  "app": ["react", "react-dom", "react-router-dom"],
}
```

---

## Issue 2 — Backpack wallet not wired

**Severity:** Low  
**File:** `app/src/main.tsx`, `app/package.json`

`@solana/wallet-adapter-backpack` was added to `package.json` but `BackpackWalletAdapter` is not in the wallets array in `main.tsx`. Backpack users cannot connect.

**Fix:**

```bash
# Verify package is installed
cd app && npm ls @solana/wallet-adapter-backpack
```

Then in `main.tsx`:
```ts
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),  // add this
];
```

---

## Issue 3 — No `.env` file for network configuration

**Severity:** Low  
**File:** `app/` root

`VITE_SOLANA_ENDPOINT` fallback in `constants.ts` points to devnet. No `.env.local` exists for switching to localnet during development. Developer must know to set the env var manually or the app silently hits devnet.

**Fix:** Create `app/.env.example`:

```
VITE_SOLANA_ENDPOINT=https://api.devnet.solana.com
# For localnet: VITE_SOLANA_ENDPOINT=http://127.0.0.1:8899
```

Add `app/.env.local` to `.gitignore` (already covered by root `.gitignore` if `*.local` is ignored — verify).

---

## Issue 4 — Event subscriptions unreliable on public RPC

**Severity:** Medium  
**File:** `app/src/hooks/usePetEvents.ts`

`client.program.addEventListener` uses WebSocket. Public devnet RPC endpoints (`api.devnet.solana.com`) frequently drop WebSocket connections or do not support program log subscriptions reliably. `usePetEvents` silently catches failures, so users see no live updates without knowing why.

**Fix options (pick one):**

1. **Polling fallback** — if `addEventListener` throws or no event arrives within N seconds, fall back to `setInterval(() => refresh(), 5000)` in `PetDetailPage`.
2. **Private RPC** — document that live events require a WebSocket-capable RPC (Helius, QuickNode, Triton). Add a `VITE_RPC_WS_ENDPOINT` env var separate from the HTTP endpoint.
3. **Disable events, poll only** — simplest; remove `usePetEvents` and replace with a 10-second poll in `PetDetailPage`. Revisit at R6 when the indexer is available.

Recommended: option 1 (polling fallback). Keeps events when RPC supports them, degrades gracefully otherwise.
