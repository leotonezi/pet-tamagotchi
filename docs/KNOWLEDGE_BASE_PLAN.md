# Knowledge Base — Documentation Plan

> Goal: deep-dive reference for every layer of the pet-tamagotchi Solana stack.
> Audience: Leo building mental model for Solana job interviews and production work.
> Each section = one standalone markdown file in `docs/knowledge-base/`.

---

## Section Map

| File | Title | Covers |
|------|-------|--------|
| `01-system-overview.md` | System Overview | Stack, repo layout, data-flow from wallet click to on-chain write |
| `02-anchor-program.md` | Anchor Program Anatomy | `declare_id!`, `#[program]`, `#[derive(Accounts)]`, IDL generation, module split |
| `03-accounts-and-pdas.md` | Accounts & PDAs | All 4 account types, byte layouts, PDA seed derivation, bump caching pattern |
| `04-instructions-care.md` | Care Instructions | `create_pet` + 6 care ix deep-dive: account contexts, handler flow, events |
| `05-game-mechanics.md` | Game Mechanics | Stat model, time decay math, health formula, need flags, death conditions |
| `06-item-shop.md` | Item Shop & Inventory | `Inventory` PDA, item catalog, `buy_item` SOL CPI, `use_item` effect application |
| `07-spl-token-rewards.md` | $PETZ Token & Rewards | Mint PDA, ATA, `anchor-spl` CPI `mint_to`, `ClaimState`, reward formula, cooldown |
| `08-breeding.md` | Breeding System | `breed` ix, SlotHashes sysvar, `hashv` RNG, stat inheritance, species blending |
| `09-typescript-client.md` | TypeScript Client | `PetTamagotchiClient`, IDL loading, `@coral-xyz/anchor` Program API, PDA helpers |
| `10-react-frontend.md` | React Frontend & Wallet | Wallet Adapter stack, `BrowserPetClient`, `ClientContext`, hooks, routing, Vite setup |
| `11-security-model.md` | Security Model | Owner binding layers, PDA security, saturating/checked math, re-init prevention |
| `12-testing-bankrun.md` | Testing with Bankrun | `anchor-bankrun`, `solana-bankrun`, `setClock` time-warp, test patterns, mocha setup |

---

## Cross-Cutting Themes (weave into each section)

- **PDA mental model**: address = hash(seeds + program_id). Seeds are the "namespace". Bump is the tweak that makes the hash land off the Ed25519 curve.
- **Anchor constraint system**: account-level constraints (`has_one`, `constraint =`, `seeds`, `bump`) run before handler code — security first.
- **Saturating vs checked arithmetic**: `saturating_*` for u8 stats (clamping is the desired behavior), `checked_*` for i64 time math and u64 token counters (overflow = program error).
- **CPI pattern**: `CpiContext::new` for unsigned, `CpiContext::new_with_signer` for PDA-signed. Always pass signer seeds as `&[&[&[u8]]]`.
- **Lazy state**: decay and health computed only when an instruction touches the account — no cranker needed.
- **Event-driven reads**: Anchor `#[event]` emits log-encoded data; clients parse with `program.addEventListener`.

---

## Section 1 — System Overview

**Stack:**
- Rust + Anchor 0.31.0 (on-chain)
- anchor-spl 0.31.0 (SPL token CPI)
- TypeScript + @coral-xyz/anchor 0.30 (Node client + tests)
- React 18 + Vite + Tailwind (web UI)
- @solana/wallet-adapter-react (wallet connection)
- solana-bankrun + anchor-bankrun (test harness, no validator)
- Mocha + Chai (test runner)

**Repo layout:**
```
programs/pet-tamagotchi/src/
  lib.rs            — program entry, re-exports, #[program] macro
  state.rs          — account structs (Pet, Inventory, MintAuthority, ClaimState)
  instructions/
    create_pet.rs   — CreatePet context + handler
    pet_actions.rs  — PetAction, CheckStatus contexts + 6 handlers
    inventory.rs    — InitInventory, BuyItem, UseItem contexts + handlers
    token.rs        — InitializeMint, InitClaimState, ClaimDailyReward
    breed.rs        — Breed context + handler
  helpers.rs        — apply_stat_delta, compute_health, apply_time_decay, refresh_needs_and_health
  items.rs          — ITEMS const catalog (ItemEffect array)
  constants.rs      — limits, PETZ token constants, DEPLOYER pubkey
  errors.rs         — PetError enum
  events.rs         — all #[event] structs

client/
  petClient.ts      — PetTamagotchiClient (Node.js, reads IDL from disk)
  example.ts        — localnet demo script

app/src/
  main.tsx          — wallet adapter providers stack
  browserClient.ts  — BrowserPetClient (browser, IDL imported statically)
  context/ClientContext.tsx — AnchorProvider + BrowserPetClient React context
  hooks/            — usePet, usePetActions, usePetEvents, useInventory, etc.
  pages/            — HomePage, PetListPage, PetDetailPage, ShopPage, RewardsPage
  components/       — pet/, shop/, rewards/, layout/, shared/

tests/
  pet_tamagotchi.ts — bankrun integration tests

target/
  idl/pet_tamagotchi.json  — generated IDL (source of truth for clients)
  types/pet_tamagotchi.ts  — generated TypeScript types
```

**Data flow (wallet action → chain):**
1. User clicks button in React page
2. Page calls hook (e.g. `usePetActions.feed`)
3. Hook calls `client.feedPet(name)` on `BrowserPetClient`
4. `BrowserPetClient` calls `program.methods.feed(name).accounts({owner}).rpc()`
5. Anchor client serializes ix via IDL, appends PDA accounts (derived client-side)
6. Wallet adapter signs tx, sends to RPC
7. Solana runtime verifies account constraints (seeds, has_one, constraint =)
8. Handler runs: time decay → stat delta → refresh → emit event
9. Tx confirmed; hook re-fetches account and updates React state

---

## Section 3 — Accounts & PDAs — byte layouts

| Account | Seeds | MAX_SIZE |
|---------|-------|----------|
| `Pet` | `[b"pet", owner, name]` | 123 bytes |
| `Inventory` | `[b"inventory", owner]` | 65 bytes |
| `MintAuthority` | `[b"mint_authority"]` | 50 bytes data + 8 disc |
| `ClaimState` | `[b"claim_state", owner, pet_name]` | 92 bytes |
| `petz_mint` (Mint) | `[b"petz_mint"]` | standard SPL Mint = 82 bytes |
| `Treasury` | `[b"treasury"]` | receives SOL, no data |

**Bump caching pattern** (important interview topic):
- On `init`, Anchor derives the canonical bump and stores it in `ctx.bumps.account_name`.
- Save it: `account.bump = ctx.bumps.account_name`.
- On subsequent calls: `bump = account.bump` in the constraint — Anchor verifies the PDA at that exact bump rather than re-grinding.
- Cost saving: bump grinding searches up to 255 bumps; caching removes that search on every subsequent ix.

---

## Section 7 — $PETZ Token Reward Formula

```
base = 10_000_000 (micro-PETZ)
+ happiness_bonus  = 5_000_000  if happiness >= 80
+ health_bonus     = 5_000_000  if health >= 80
+ perfect_care_bonus = 5_000_000 if hunger <= 20 AND hygiene >= 80
cap = 25_000_000 (max per claim)
cooldown = 86_400 seconds (24h)
```

PETZ decimals = 6, so 10_000_000 raw = 10.0 PETZ.

---

## Section 8 — Breeding RNG Detail

```rust
hashv(&[
    &slot_hash_bytes[16..48],   // 32-byte first slot hash
    owner.key().as_ref(),
    pet_a.key().as_ref(),
    pet_b.key().as_ref(),
    offspring_name.as_bytes(),
])
.to_bytes()[0]  // single byte, 8 bits → 4 stat-inheritance decisions
```

Bits 0,1,2,3 each select parent A (0) or parent B (1) for hunger, tiredness, hygiene, happiness.

Species blending: take first half of parent A's ASCII species bytes + second half of parent B's.

---

## Agents To Spawn

One agent per section. Each agent:
- Reads the relevant source files
- Writes `docs/knowledge-base/<N>-<slug>.md`
- No new code — documentation only
- Depth: interview-prep level. Explain WHY, not just WHAT.

Parallelizable: all 12 sections are independent — spawn all at once.
