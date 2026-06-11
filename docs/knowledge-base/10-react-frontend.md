# 10 — React Frontend: Wallet Adapter, Anchor Context, and Hooks

## Overview

The app is a Vite + React 18 SPA that talks to the on-chain program through `@coral-xyz/anchor`. The key architectural insight is the **layered provider tree**: each outer provider knows nothing about the inner ones, but the inner ones depend on what the outer ones expose. This ordering is intentional and non-negotiable.

---

## 1. The Provider Tree (`main.tsx`)

```
StrictMode
  ConnectionProvider (endpoint=SOLANA_ENDPOINT)
    WalletProvider (wallets=[], autoConnect)
      WalletModalProvider
        ClientProvider          ← our custom context
          BrowserRouter
            App
```

Each layer has a distinct responsibility:

**`ConnectionProvider`** — creates a `Connection` object pointed at the configured RPC endpoint and makes it available via the `useConnection()` hook. This is a long-lived object; React never recreates it unless `endpoint` changes. The endpoint defaults to `https://api.devnet.solana.com` and is overridden by `VITE_SOLANA_ENDPOINT` at build time.

**`WalletProvider`** — manages the lifecycle of the active wallet: detecting extension availability, connecting, disconnecting, signing. It exposes the `useWallet()` hook which returns `{ publicKey, connected, wallet, signTransaction, signAllTransactions, sendTransaction, ... }`. The `autoConnect` prop (passed without a value, so `true`) re-connects to whichever wallet was last used when the page reloads, using the wallet adapter's persisted local state.

**`WalletModalProvider`** — renders the "Connect Wallet" modal that lists registered adapters. It provides a `useWalletModal()` hook to programmatically open/close the dialog. This layer must be inside `WalletProvider` because the modal needs wallet state to know which adapters to list.

**`ClientProvider`** — our custom context (discussed in depth below). Must be inside both `ConnectionProvider` and `WalletProvider` because it reads from both.

**`BrowserRouter`** — React Router's history provider. Intentionally innermost so routing state does not interfere with any Solana hooks.

### Registered Wallet Adapters

```ts
const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new BackpackWalletAdapter(),   // from @solana/wallet-adapter-backpack
];
```

Each adapter is a class that wraps a wallet's proprietary browser extension API into the standard `WalletAdapter` interface from `@solana/wallet-adapter-base`. Phantom injects `window.solana`, Solflare injects `window.solflare`, Backpack injects `window.backpack` — each with its own quirks. The adapter pattern means the rest of the app never touches those extension APIs directly; it only calls `adapter.connect()`, `adapter.signTransaction()`, etc.

The `WalletAdapter` interface guarantees:
- `connect(): Promise<void>`
- `disconnect(): Promise<void>`
- `signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>`
- `signAllTransactions<T extends ...>(txs: T[]): Promise<T[]>`
- `publicKey: PublicKey | null`
- `connected: boolean`

---

## 2. `ClientProvider` and `useClient()` (`ClientContext.tsx`)

This is the glue between the Solana wallet state and the Anchor program client. The entire pattern fits in ~50 lines:

```ts
const { wallet, publicKey, signTransaction, signAllTransactions } = useWallet();
const { connection } = useConnection();

useEffect(() => {
  if (!publicKey || !wallet || !signTransaction || !signAllTransactions) {
    setClient(null);
    setReady(false);
    return;
  }

  const provider = new AnchorProvider(
    connection,
    { publicKey, signTransaction, signAllTransactions },
    { commitment: "confirmed" }
  );

  const c = new BrowserPetClient(provider);
  setClient(c);
  setReady(true);
}, [publicKey, wallet, signTransaction, signAllTransactions, connection]);
```

Key points:

- The `useEffect` dependency array includes all wallet fields. When any one of them changes (connect/disconnect), the effect re-runs. On disconnect, all four become `null`/`undefined` so the guard at the top fires and the client is torn down.
- `AnchorProvider` takes `(connection, wallet, opts)`. The `wallet` argument is a plain object literal with three properties — it does not need to be the full adapter, just the signing surface that Anchor's transaction machinery requires.
- `commitment: "confirmed"` means `.rpc()` calls wait until ⅔ of validators have voted on the transaction before returning the signature. `"processed"` would return faster but the account data might not reflect the change yet. `"finalized"` would wait for full lockout (~32 slots) — too slow for interactive UI.
- `useClient()` returns `{ client: BrowserPetClient | null, ready: boolean }`. All page-level hooks check `ready` before calling any client methods.

---

## 3. `BrowserPetClient` vs Node Client (`browserClient.ts`)

The Node client at `client/petClient.ts` loads the IDL with `readFileSync` at runtime. That works for CLI tools and tests but `fs` does not exist in a browser bundle.

The browser client solves this with a static import:

```ts
import IDL from "@idl/pet_tamagotchi.json";
```

`@idl` is a Vite path alias configured in `vite.config.ts`:

```ts
resolve: {
  alias: {
    "@idl": path.resolve(__dirname, "../target/idl"),
  },
},
```

Vite resolves `@idl/pet_tamagotchi.json` at **build time** and bundles the JSON directly into the output. No file I/O at runtime, no Node modules in the browser bundle.

Both clients then construct:

```ts
this.program = new Program<PetTamagotchi>(IDL as unknown as PetTamagotchi, provider);
```

The generic `Program<T>` gives full type inference: `program.methods.feed(name)` autocompletes with the correct argument types, and `program.account.pet.fetch(pda)` returns the typed `Pet` struct from the IDL.

---

## 4. Vite Build Configuration (`vite.config.ts`)

Three pieces of config are essential for Solana to work in a browser:

**Node polyfills** — `@solana/web3.js` and `@coral-xyz/anchor` were written for Node and reference `Buffer`, `process`, `crypto`, etc. `vite-plugin-node-polyfills` shims these globals at bundle time:

```ts
nodePolyfills({
  include: ["buffer", "process", "stream", "util", "crypto"],
  globals: { Buffer: true, global: true, process: true },
})
```

Without this, the bundle throws `ReferenceError: Buffer is not defined` at runtime.

**Anchor browser flag** — Anchor has a code path gated on `process.env.ANCHOR_BROWSER`. Setting it disables parts of the library that assume a Node environment:

```ts
define: { "process.env.ANCHOR_BROWSER": JSON.stringify("true") }
```

**Manual chunk splitting** — Solana, wallet adapters, and React are each placed in their own chunk so the browser can cache them independently:

```ts
manualChunks: {
  "vendor-solana": ["@solana/web3.js", "@coral-xyz/anchor", "@solana/spl-token"],
  "vendor-wallets": ["@solana/wallet-adapter-react", ...],
  "vendor-react": ["react", "react-dom", "react-router-dom"],
}
```

---

## 5. React Router and `RequireWallet` (`App.tsx`)

All pages that require wallet connection are wrapped with a simple guard:

```ts
function RequireWallet({ children }: { children: ReactNode }) {
  const { connected } = useWallet();
  if (!connected) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

Route table:
| Path | Component | Guard |
|------|-----------|-------|
| `/` | `HomePage` | None |
| `/pets` | `PetListPage` | `RequireWallet` |
| `/pets/:name` | `PetDetailPage` | `RequireWallet` |
| `/shop` | `ShopPage` | `RequireWallet` |
| `/rewards` | `RewardsPage` | `RequireWallet` |
| `*` | Redirect to `/` | — |

`AppShell` is the layout route element — it renders the navigation bar and an `<Outlet />` for the matched child page.

---

## 6. Custom Hooks

### `usePet(petName)`

Calls `client.getPetInfo(petName, publicKey)` on mount and exposes a `refresh` callback. Does not poll on its own — it expects `usePetEvents` to trigger `refresh` on change.

### `usePetEvents(onUpdate, options)`

The most sophisticated hook. It attempts WebSocket-based event subscriptions first, then falls back to polling.

```
mount
  → addEventListener("petFed" | "petWalked" | "petBathed" | "petSlept" | "petPlayed")
  → start 8 s liveness timer

if first event arrives within 8 s → mode = "ws" (clear timer)
if timer fires with no events      → mode = "polling" (setInterval every 10 s)
```

Once degraded to polling, the mode is a one-way latch for that mount. The user must navigate away and back to re-attempt WebSocket mode. This prevents oscillation between modes when network conditions are marginal.

Anchor's `program.addEventListener` subscribes to program log lines over WebSocket and deserializes matching event structs. Each subscription returns an integer ID used for cleanup via `program.removeEventListener(id)`. Cleanup is handled in the effect's return function.

### `usePetActions(petName, onSuccess)`

Wraps the five interaction methods (`feedPet`, `walkPet`, `bathePet`, `sleepPet`, `playWithPet`) plus `checkStatus`. Each action calls `withToast(label, fn)` which:

1. Adds a "pending" toast immediately
2. Awaits the transaction
3. Updates the toast to "success" with the tx signature, or "error" with a user-friendly message

### `useTxToast()`

Manages a `Toast[]` state array. Error messages are extracted from the raw Anchor error string by scanning `ANCHOR_ERROR_MESSAGES`:

```ts
for (const [name, msg] of Object.entries(ANCHOR_ERROR_MESSAGES)) {
  if (raw.includes(name)) { friendly = msg; break; }
}
```

Anchor errors surface as strings like `"Error Code: PetDeceased. Error Number: 6003. Error Message: ..."`. Scanning for the code name is more reliable than parsing the full message format.

---

## 7. Environment Variables

Vite's env var system requires the `VITE_` prefix for any variable exposed to client code:

```ts
// constants.ts
export const SOLANA_ENDPOINT =
  import.meta.env.VITE_SOLANA_ENDPOINT ?? "https://api.devnet.solana.com";
```

`import.meta.env` is Vite's replacement for `process.env`. Variables are statically substituted at build time — the final bundle contains the string literal, not a runtime lookup. This means the endpoint is baked in per-build; to switch from devnet to mainnet you rebuild with a different env var.

---

## 8. Interview Prep: High-Value Questions

**"Walk me through how a transaction gets signed in a Solana React app."**

The wallet adapter wraps the browser extension's signing API. When `program.methods.feed(name).rpc()` is called, Anchor builds a `Transaction`, serializes it, and calls `provider.wallet.signTransaction(tx)`. That goes to `WalletProvider` which delegates to the active adapter (e.g., Phantom), which calls `window.solana.signTransaction(tx)` — the extension pops up a confirmation dialog, the user approves, and the signed bytes come back. Anchor then submits the signed transaction to the RPC node via `connection.sendRawTransaction()` and polls for confirmation.

**"Why is `AnchorProvider` constructed inside a `useEffect`?"**

Because `publicKey` and the signing functions are only stable references after the wallet connects. Constructing the provider at module scope would capture `null` values. The `useEffect` re-runs whenever wallet state changes, ensuring the provider always holds live, valid references.

**"What does `autoConnect` actually do?"**

`WalletProvider` persists the last-connected wallet name to `localStorage`. On reload, it reads that key and calls `adapter.connect()` automatically for that adapter, which in turn calls the extension's `connect()` method. The extension restores the session without another approval dialog (unless the user has since revoked the site's permission).

**"Why do wallet adapters exist at all? Why not call `window.solana` directly?"**

Standardization and portability. Phantom's API differs from Solflare's; Backpack has yet another shape. The adapter pattern gives every wallet the same interface so the app doesn't need conditional branches for each wallet. Adding a new wallet means adding one adapter — zero changes to application code.
