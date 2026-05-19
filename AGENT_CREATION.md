# Agent Roster — pet-tamagotchi

Reviewed by Claude Opus. Last updated: 2026-05-19.

---

## Agent Roles

### 1. `roadmap-planner`
Produces interface-level specs for a roadmap item: instruction signatures, account list, PDA seeds, events, error codes, test matrix. **No Rust code.** Output feeds `anchor-builder`.

### 2. `anchor-builder`
Implements on-chain instructions in `programs/pet-tamagotchi/src/lib.rs`. Runs `anchor build`, commits `target/idl/pet_tamagotchi.json` and `target/types/pet_tamagotchi.ts`. Done condition: `anchor build` green + IDL committed. Owns IDL regen — no other agent touches `target/`.

### 3. `bankrun-tester`
Writes behavioral tests in `tests/pet_tamagotchi.ts`: stat deltas, time-warp (bankrun `setClock`), happy paths, documented errors. **Must start after `anchor-builder` finishes** (tests import `../target/types/pet_tamagotchi.js`). Runs parallel with `ts-client-updater`.

### 4. `ts-client-updater`
Extends `client/petClient.ts` and `client/example.ts` after on-chain changes. Keeps PDA derivation, IDL types, and method signatures in sync. Runs parallel with `bankrun-tester` after `anchor-builder` finishes.

### 5. `security-auditor`
Read-only on `programs/`. Produces structured findings: `(finding, severity, file:line, suggested fix)`. May add tests or comments, never edits instructions. If P0/P1 found, loops back to `anchor-builder` (max 2 loops).

### 6. `spl-integrator` *(activate before R2)*
Handles `anchor-spl` and Metaplex CPI patterns: mint authority PDAs, ATA creation, `transfer_checked`, decimals, Token-2022 vs legacy. Isolated from base Anchor work.

### 7. `migration-planner` *(activate before R7)*
Plans account `realloc`, discriminator versioning, zero-copy migration, rent top-up. Owns the `version: u8` field strategy and any `MAX_SIZE` changes.

### 8. `frontend` *(activate at R3)*
React + Wallet Adapter + Anchor event subscriptions. Separate toolchain from `ts-client-updater`.

### 9. `indexer` *(activate at R6)*
Helius webhooks / Geyser plugin + Postgres + REST API. Fully off-chain, no overlap with on-chain agents.

---

## Spawn Pattern

```
roadmap-planner
  └─► anchor-builder          (Rust + anchor build + IDL commit)
        ├─► bankrun-tester     (parallel)
        └─► ts-client-updater  (parallel)
              └─► security-auditor
                    └─► anchor-builder  (only if P0/P1, max 2 loops)
```

---

## Pre-R1 Required Changes

1. **Add `version: u8` to `Pet`** — preempts R7 realloc. Bump `MAX_SIZE` from 122 to 123. Add comment noting future migration path.
2. Confirm `Anchor.toml` and `anchor-lang` in `Cargo.toml` match (devops check).

---

## R1 Item Shop — Specification

### New accounts

| Account | PDA seeds | Notes |
|---------|-----------|-------|
| `Inventory` | `[b"inventory", owner.key()]` | Per-owner, not per-pet. Supports R4 breeding. |
| `Treasury` | `[b"treasury"]` | Hard-derived in account context. Never user-passed. |

`Inventory` layout:
```
owner:   Pubkey        32
slots:   [ItemSlot; 8] 8×3 = 24   (ItemSlot { item_id: u8, qty: u16 })
bump:    u8            1
                       ──
total (+ 8 disc)       65 bytes
```

Fixed array — no `Vec`. Predictable rent, no realloc needed for R1.

### Item catalog

```rust
#[repr(u8)]
pub enum ItemId { Apple=0, Soap=1, Toy=2, Pillow=3 }

pub const ITEMS: [ItemEffect; 4] = [
//              hunger  hygiene  happiness  tiredness  price_lamports
    ItemEffect {  -30,     0,       +5,         0,     10_000_000 },  // Apple
    ItemEffect {    0,   +60,        0,         0,     10_000_000 },  // Soap
    ItemEffect {    0,     0,      +30,       +10,     10_000_000 },  // Toy
    ItemEffect {   +5,     0,        0,       -60,     10_000_000 },  // Pillow
];
```

Centralised effect table — auditor-friendly, single source of truth.

### Instructions

| Instruction | Auth | Liveness | Notes |
|-------------|------|----------|-------|
| `init_inventory` | signer = owner | — | `init` (not `init_if_needed`). Re-init blocked by discriminator. |
| `buy_item(item_id: u8, qty: u8)` | `has_one = owner` | — | Debit lamports via `system_program::transfer` CPI to Treasury PDA. |
| `use_item(item_id: u8, pet_name: String)` | `has_one = owner` on both pet + inventory | yes | Apply decay + effects + `refresh_needs_and_health`. Reject dead pet. |

### Events

```rust
ItemBought { owner: Pubkey, item_id: u8, qty: u8, total_lamports: u64 }
ItemUsed    { pet: Pubkey, item_id: u8, hunger: u8, hygiene: u8, happiness: u8, tiredness: u8 }
```

### Errors

```
InventoryFull       no empty slot available
ItemUnknown         item_id out of range
InsufficientItems   qty in slot < requested
InsufficientFunds   lamports < price × qty
```

### Payment

SOL via `system_program::transfer` CPI to Treasury PDA. SPL Token payment deferred to R2.

---

## Security Checklist (R1)

Drawn from auditor review:

- [ ] Inventory PDA seeds = `[b"inventory", owner]` — not per-pet
- [ ] Treasury PDA hard-derived in account context — no user-passed treasury
- [ ] Lamport debit via `system_program::transfer` CPI (not direct lamport mutation)
- [ ] `init` on `Inventory` (not `init_if_needed`) — re-init blocked by discriminator
- [ ] `bump` cached in `Inventory.bump`, reused with `bump = inventory.bump`
- [ ] `has_one = owner` on every authenticated account (Inventory + Pet in `use_item`)
- [ ] `use_item` rejects `pet.is_alive == false`
- [ ] Item effects that could trigger death conditions are tested explicitly

---

## Pre-existing Concerns (from auditor)

These apply to existing code, not R1 additions:

| # | Concern | Severity | Location |
|---|---------|----------|----------|
| 1 | `apply_time_decay` runs only when `is_alive`; death realized lazily on next interaction | Design / intentional — document it | `lib.rs:106` |
| 2 | Back-to-back instructions in one tx only apply decay once (first updates `last_interaction`) | Design — will surprise R4 breeding | `apply_time_decay` |
| 3 | `MAX_SIZE` is manually computed (122) — fragile vs `InitSpace` derive macro | Low | `lib.rs:230` |
| 4 | `PetCreated` event carries full `name` + `species` strings — CU cost at scale | Low | `lib.rs:253` |
