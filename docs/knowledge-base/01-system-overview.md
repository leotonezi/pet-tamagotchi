# 01 — System Overview

> Target audience: developer building deep Solana expertise for job interviews and production work.

## What Is This Project?

`pet-tamagotchi` is a Solana on-chain state machine that implements a virtual pet care game. Every pet is a **Program Derived Address (PDA)** account. Every interaction (feed, walk, bathe, sleep, play) is an on-chain instruction that mutates that account's stat fields. The game mechanics — time decay, health derivation, need flags — are enforced entirely by the Rust program. Nothing is stored off-chain.

This design choice is intentional and instructive: it means the game state is trustless, auditable, and composable. Any client — CLI, browser, or another program via CPI — operates against the same authoritative state.

---

## Full Tech Stack

| Layer | Technology | Version |
|---|---|---|
| On-chain program | Rust + Anchor | anchor-lang 0.31.0 |
| SPL token CPI | anchor-spl | 0.31.0 |
| Node client + tests | TypeScript + @coral-xyz/anchor | 0.30.x |
| Web UI framework | React + React Router | 18.3.1 / 6.26.2 |
| Web build tool | Vite + vite-plugin-node-polyfills | 5.4.2 |
| CSS | Tailwind CSS | 3.4.10 |
| Wallet connection | @solana/wallet-adapter-react | 0.15.35 |
| Wallet adapters | Phantom, Solflare, Backpack | bundled via wallet-adapter-wallets |
| SPL token client | @solana/spl-token | 0.4.14 |
| Test harness | solana-bankrun + anchor-bankrun | 0.4.0 / 0.5.0 |
| Test runner | Mocha + Chai | 10.x / 4.x |
| Toolchain manager | Anchor CLI | 0.31.1 (Anchor.toml) |

**Why bankrun instead of `anchor test`?** `solana-bankrun` runs the SBF program in-process using a lightweight simulation environment — no validator process, no port binding, no startup wait. Tests can warp the clock arbitrarily (critical for testing the 24-hour daily reward cooldown) and run in parallel without port conflicts. The tradeoff is that bankrun does not simulate full BPF compute budget enforcement the same way a real validator does.

**Why @coral-xyz/anchor 0.30 for clients against an 0.31 program?** The Anchor IDL format is stable across minor versions; the JavaScript SDK at 0.30 can consume IDL artifacts produced by the 0.31 Rust framework. Anchor intentionally maintains this compatibility to avoid forcing simultaneous upgrades of both sides.

---

## Repository Layout

```
pet-tamagotchi/
├── programs/pet-tamagotchi/src/   # On-chain Rust program
│   ├── lib.rs                     # Entry point; #[program] macro; instruction dispatch
│   ├── state.rs                   # Account structs (Pet, Inventory, MintAuthority, ClaimState)
│   ├── errors.rs                  # Custom error codes surfaced to clients
│   ├── events.rs                  # Anchor events emitted after each instruction
│   ├── constants.rs               # MAX_NAME_LEN, MAX_SPECIES_LEN, stat caps
│   ├── helpers.rs                 # Pure stat math (apply_stat_delta, compute_health, time decay)
│   ├── items.rs                   # Item catalog and effect lookup
│   └── instructions/              # One module per instruction group
│       ├── create_pet.rs
│       ├── pet_actions.rs         # feed / walk / bathe / sleep / play / check_status
│       ├── inventory.rs           # init_inventory / buy_item / use_item
│       ├── token.rs               # initialize_mint / init_claim_state / claim_daily_reward
│       └── breed.rs               # breed (R4)
├── target/
│   ├── idl/pet_tamagotchi.json    # Machine-generated ABI — source of truth for clients
│   └── types/pet_tamagotchi.ts   # Generated TypeScript types from the IDL
├── client/
│   └── petClient.ts               # Node.js client: loads IDL from disk with fs.readFileSync
├── tests/
│   └── pet_tamagotchi.ts          # Bankrun integration tests
├── app/                           # React web UI (separate npm workspace)
│   ├── src/
│   │   ├── main.tsx               # Provider tree: Connection > Wallet > ClientProvider > Router
│   │   ├── browserClient.ts       # Browser client: imports IDL statically via Vite alias
│   │   ├── constants.ts           # SOLANA_ENDPOINT (env var), item catalog, error messages
│   │   ├── context/ClientContext.tsx  # React context: creates AnchorProvider + BrowserPetClient
│   │   ├── hooks/                 # usePetActions, usePet, usePetList, useInventory, ...
│   │   ├── pages/                 # Route-level components (PetDetailPage, ShopPage, ...)
│   │   └── components/            # Reusable UI fragments
│   └── vite.config.ts             # Path aliases, node polyfills for Buffer/crypto
├── Anchor.toml                    # Cluster config (localnet), test script, program address
├── package.json                   # Root: test runner dependencies (mocha, bankrun, ts-node)
└── Cargo.toml                     # Rust workspace root
```

The `programs/` directory is the source of truth for the on-chain state machine. The `target/` directory is the artifact layer — nothing in `client/` or `app/` is authoritative; they are consumers of whatever `anchor build` produces.

---

## End-to-End Data Flow: "Feed Pet"

This traces a single button click all the way to an updated React UI.

```
1. User clicks "Feed" button
   └── PetDetailPage renders <button onClick={actions.feed}>

2. usePetActions.feed()
   └── calls act("Feed", () => client!.feedPet(petName))
   └── act() wraps in withToast() — shows a pending toast notification

3. BrowserPetClient.feedPet(name: string)
   └── this.program.methods
         .feed(name)                         // matches lib.rs: pub fn feed(...)
         .accounts({ owner: provider.wallet.publicKey })
         .rpc()
   // Anchor SDK resolves remaining accounts by looking up the IDL's
   // account constraints and deriving PDAs automatically.

4. Anchor SDK builds a Transaction
   └── serializes instruction data: [discriminator(8 bytes)] + [borsh(name)]
   └── populates account metas from IDL constraints
   └── calls provider.wallet.signTransaction(tx)

5. Wallet adapter signs
   └── Phantom/Solflare/Backpack prompts the user (or auto-signs in tests)
   └── Returns signed Transaction

6. SDK sends signed transaction to Solana RPC
   └── await connection.sendRawTransaction(...)
   └── await connection.confirmTransaction(..., "confirmed")

7. Solana runtime verifies and executes
   └── Checks account ownership (pet.owner == signer)
   └── Verifies PDA derivation: ["pet", owner, name] → matches stored bump
   └── Calls pet_tamagotchi::feed(ctx, name) handler in lib.rs

8. Rust handler executes (pet_actions.rs: handle_feed)
   └── apply_time_decay() — adjusts stats based on elapsed time since last_interaction
   └── apply_stat_delta() — decrements hunger by feed amount, clamps to [0, 100]
   └── compute_health()  — derives health from weighted average of all four stats
   └── sets pet.last_interaction = Clock::get()?.unix_timestamp
   └── emits FeedEvent { pet, owner, hunger, health, timestamp }
   └── Returns Ok(())

9. Client receives transaction signature
   └── withToast resolves — toast updates to "confirmed"
   └── onSuccess() callback fires in usePetActions

10. UI re-fetches pet state
    └── usePet hook calls client.getPetInfo(name)
    └── program.account.pet.fetch(pda) — single RPC call to read the account
    └── Returns deserialized PetInfo struct

11. React re-renders
    └── stat bars update with new hunger/health values
```

The key Solana-specific insight in step 7: the runtime does not need to "find" the account — the client already passed the derived PDA address as an account meta. The runtime only checks that the address matches the on-chain constraints declared in the `#[account]` macro. The bump check (`has_one`, `seeds`, `bump`) is what prevents spoofed accounts.

---

## Two Client Implementations

Both clients expose an identical method surface (`feedPet`, `walkPet`, `getPetInfo`, etc.) and share the same PDA derivation logic. They differ only in how they obtain the IDL.

### `client/petClient.ts` — Node.js Client

```typescript
// Loads IDL at runtime from the filesystem
const IDL = JSON.parse(
  readFileSync(join(__dirname, "../target/idl/pet_tamagotchi.json"), "utf-8")
) as PetTamagotchi;
```

**Why**: Node.js scripts and the Mocha test suite run after `anchor build` has written the IDL to `target/`. They use `fs.readFileSync` with an ESM-compatible `__dirname` shim (`fileURLToPath(import.meta.url)`). This is appropriate for a server/CI environment where the filesystem is available and the build output is a known path.

**Used by**: `tests/pet_tamagotchi.ts`, `client/example.ts`, CLI scripts.

### `app/src/browserClient.ts` — Browser Client

```typescript
// Imported statically — Vite bundles it at build time
import IDL from "@idl/pet_tamagotchi.json";
import type { PetTamagotchi } from "../../target/types/pet_tamagotchi";
```

**Why**: Browsers have no `fs` module. The IDL must be bundled with the application at build time. The `@idl` alias is configured in `vite.config.ts` to resolve to `target/idl/pet_tamagotchi.json`. When Vite builds the app, the JSON is inlined into the JavaScript bundle. This also means the browser bundle is always locked to the IDL version present at build time — you cannot hot-swap the program without rebuilding the frontend.

**Why `vite-plugin-node-polyfills`**: Anchor's JavaScript SDK and `@solana/web3.js` depend on Node built-ins (`Buffer`, `crypto`, `stream`). Vite is a browser bundler and does not include these by default. The polyfills plugin shims them so Anchor works in the browser.

---

## How the IDL Connects Everything

```
anchor build
  └── Compiles Rust → .so BPF binary
  └── Generates target/idl/pet_tamagotchi.json    ← ABI descriptor
  └── Generates target/types/pet_tamagotchi.ts    ← TypeScript type exports

IDL JSON contains:
  - instruction names + argument types + discriminators
  - account struct layouts (field names, types, sizes)
  - custom error codes
  - event definitions

Both clients import the IDL and pass it to new Program<PetTamagotchi>(IDL, provider).
The Anchor SDK uses the IDL to:
  - serialize instruction arguments (borsh encoding)
  - deserialize account data back into typed objects
  - resolve account constraints (PDA seeds, `has_one` checks)
  - generate the 8-byte discriminator for each instruction
```

The discriminator is `sha256("global:<instruction_name>")[0..8]`. It is the first 8 bytes of every instruction's data. The runtime uses it to route to the correct handler. If a client sends the wrong discriminator, the program returns an error before executing any handler logic.

---

## Localnet vs. Devnet

**Anchor.toml** declares `cluster = "localnet"` under `[provider]`. This governs `anchor build`, `anchor deploy`, and `anchor test` — they all target a local validator at `127.0.0.1:8899` by default. The program address `CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC` declared under `[programs.localnet]` is the canonical address used in IDL generation.

**The web app** reads the endpoint from an environment variable:

```typescript
// app/src/constants.ts
export const SOLANA_ENDPOINT =
  import.meta.env.VITE_SOLANA_ENDPOINT ?? "https://api.devnet.solana.com";
```

The default falls back to devnet so that a deployed build works without configuration. For local development, `app/.env.local` sets `VITE_SOLANA_ENDPOINT=http://127.0.0.1:8899`. Vite statically replaces `import.meta.env.*` at build time — the string is embedded in the JS bundle, not evaluated at runtime.

This split means the on-chain toolchain (Anchor CLI) and the browser app have independent network configurations, which is the correct pattern. A misconfigured `.env.local` is the most common source of "my transaction isn't being found" bugs during local development.

---

## Account Model Quick Reference

| Account | PDA Seeds | Size | Purpose |
|---|---|---|---|
| `Pet` | `["pet", owner, name]` | 123 bytes | Core pet state: stats, flags, timestamps |
| `Inventory` | `["inventory", owner]` | 65 bytes | 8 item slots (item_id + qty) |
| `MintAuthority` | `["mint_authority"]` | 50 bytes | Controls PETZ token minting |
| `ClaimState` | `["claim_state", owner, pet_name]` | 92 bytes | Tracks daily reward cooldown per pet |
| `petz_mint` (SPL) | `["petz_mint"]` | SPL Mint | The PETZ fungible token mint PDA |

All PDAs store their bump seed in a `bump: u8` field. This is the canonical Anchor pattern: derive the bump once at account creation, store it, then pass it back in subsequent instructions via `bump = pet.bump` in the account constraint. This avoids re-deriving the canonical bump on every call and eliminates one `find_program_address` invocation per instruction.
