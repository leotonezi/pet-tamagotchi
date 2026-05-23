# Refactor — Split lib.rs into modules

**Date:** 2026-05-22  
**Milestone:** R4 (refactor / housekeeping)  
**Status:** Open

---

## Issue 1 — lib.rs is a 904-line monolith; split into modules

**Severity:** Medium  
**File:** `programs/pet-tamagotchi/src/lib.rs`

`lib.rs` mixes constants, account structs, instruction contexts, instruction logic, error codes, events, item catalog, and helpers in a single 904-line file. Finding anything requires scrolling; adding R4+ features worsens the problem.

**Proposed module layout:**

```
programs/pet-tamagotchi/src/
├── lib.rs              # declare_id!, #[program] mod, pub use re-exports only
├── constants.rs        # MAX_NAME_LEN, PETZ_DECIMALS, DEPLOYER, reward thresholds
├── errors.rs           # PetError enum
├── events.rs           # all #[event] structs
├── state.rs            # Pet, Inventory, ItemSlot, MintAuthority, ClaimState
├── items.rs            # ItemEffect, ITEMS catalog
├── helpers.rs          # apply_stat_delta, compute_health, apply_time_decay, refresh_needs_and_health
└── instructions/
    ├── mod.rs          # re-exports all instruction modules
    ├── pet_actions.rs  # feed, walk, bathe, sleep, play, check_status
    ├── inventory.rs    # init_inventory, buy_item, use_item  (+ BuyItem/UseItem/InitInventory contexts)
    ├── token.rs        # initialize_mint, init_claim_state, claim_daily_reward  (+ R2 contexts)
    └── create_pet.rs   # create_pet  (+ CreatePet context)
```

**Why this split:**

- `state.rs` — account data structs are referenced everywhere; isolating them breaks circular deps
- `instructions/` — one file per feature area; adding R4 instructions touches one file
- `helpers.rs` — pure functions; easy to unit-test in isolation once extracted
- `items.rs` — item catalog changes independently of game logic

**Acceptance criteria:**

- `anchor build` passes with zero warnings after the split
- All existing tests pass unchanged
- No public API changes (IDL unchanged)
- Each file is ≤150 lines
