# 06 — Item Shop: Catalog, Inventory, and Treasury CPI

Target audience: developer preparing for Solana interviews or production work.
Codebase: `programs/pet-tamagotchi/src/`

---

## 1. Item Catalog — `ITEMS` in `items.rs`

The entire catalog lives in a single `const` array:

```rust
// items.rs
pub struct ItemEffect {
    pub hunger_delta:    i16,
    pub hygiene_delta:   i16,
    pub happiness_delta: i16,
    pub tiredness_delta: i16,
    pub price_lamports:  u64,
}

//                      hunger  hygiene  happiness  tiredness  price (lamports)
pub const ITEMS: [ItemEffect; 4] = [
    ItemEffect { hunger_delta: -30, hygiene_delta:   0, happiness_delta:  5, tiredness_delta:   0, price_lamports: 10_000_000 }, // 0: Apple
    ItemEffect { hunger_delta:   0, hygiene_delta:  60, happiness_delta:  0, tiredness_delta:   0, price_lamports: 10_000_000 }, // 1: Soap
    ItemEffect { hunger_delta:   0, hygiene_delta:   0, happiness_delta: 30, tiredness_delta:  10, price_lamports: 10_000_000 }, // 2: Toy
    ItemEffect { hunger_delta:   5, hygiene_delta:   0, happiness_delta:  0, tiredness_delta: -60, price_lamports: 10_000_000 }, // 3: Pillow
];
```

Summary:

| ID | Name   | hunger | hygiene | happiness | tiredness | Price (SOL) |
|----|--------|--------|---------|-----------|-----------|-------------|
| 0  | Apple  | -30    | —       | +5        | —         | 0.01        |
| 1  | Soap   | —      | +60     | —         | —         | 0.01        |
| 2  | Toy    | —      | —       | +30       | +10       | 0.01        |
| 3  | Pillow | +5     | —       | —         | -60       | 0.01        |

**Why `const` array over `enum + match`?**

- **Single source of truth.** Adding a fifth item means appending one struct literal; there is no match arm to update in a separate location.
- **Auditor-friendly.** An auditor can read the entire catalog in one glance. A match expression scatters effect values across many arms.
- **O(1) lookup by item_id.** `ITEMS[item_id as usize]` is a direct array index — no branching, no hashing.
- **Deltas are typed as `i16`.** Stats are `u8` (0–100), but an item needs to both raise and lower them. `i16` is wide enough to hold any delta without overflow while remaining small on-chain (not stored — only in the binary).

**Items have larger effects than bare care instructions.** The `bathe` instruction adds +50 to hygiene; Soap adds +60. The extra effect rewards the player for spending SOL rather than simply interacting.

---

## 2. `Inventory` Account Design

```rust
// state.rs
#[account]
#[derive(Default)]
pub struct Inventory {
    pub owner: Pubkey,                      // 32
    pub slots: [ItemSlot; INVENTORY_SLOTS], // 8 × 3 = 24
    pub bump:  u8,                          // 1
}
// SIZE = 8 (discriminator) + 32 + 24 + 1 = 65 bytes

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct ItemSlot {
    pub item_id: u8,  // 1
    pub qty:     u16, // 2
}
// SIZE = 3 bytes
```

**Seeds: `[b"inventory", owner]`**

The PDA is keyed to the *owner wallet*, not to a specific pet. One inventory serves all of an owner's pets. This was a deliberate design choice for R4 Breeding: a bred pet must be fed from the same inventory as its parents — if inventory were per-pet, use-item would need cross-pet account logic. The wallet-level inventory avoids that entirely.

**Fixed array of 8 slots**

`INVENTORY_SLOTS = 8`. The array is embedded directly in the account struct. Consequences:

- **Predictable rent.** 65 bytes is rent-exempt at roughly 0.00089 SOL on mainnet. No realloc needed for R1.
- **No heap allocation.** A `Vec<ItemSlot>` would require dynamic space calculation; the fixed array makes `SIZE` a compile-time constant.
- **Slot semantics.** A slot is "empty" when `qty == 0`. `item_id` is undefined for empty slots and is not read.

**`qty: u16`** holds up to 65,535 units of a single item — far beyond any reasonable play session. Using `u8` (max 255) would be tight if a player bulk-buys, and the cost is only one extra byte per slot (24 total bytes for the array vs 16).

---

## 3. `init_inventory` Instruction

```rust
// inventory.rs — InitInventory context
#[account(
    init,
    payer = owner,
    space = Inventory::SIZE,
    seeds = [b"inventory", owner.key().as_ref()],
    bump,
)]
pub inventory: Account<'info, Inventory>,
```

Key properties:

- **`init` (not `init_if_needed`).** If the account already exists, the instruction fails with `AccountAlreadyInitialized`. This is the right default — `init_if_needed` silently succeeds on repeat calls and can mask bugs where client code accidentally calls setup twice.
- **No pet required.** The context only needs `owner` (signer) and `system_program`. Inventory is wallet-level infrastructure created once before any purchases.
- **Handler initializes all slots to default.**

```rust
pub(crate) fn handle_init_inventory(ctx: Context<InitInventory>) -> Result<()> {
    let inv = &mut ctx.accounts.inventory;
    inv.owner = ctx.accounts.owner.key();
    inv.slots = [ItemSlot::default(); INVENTORY_SLOTS]; // item_id=0, qty=0
    inv.bump = ctx.bumps.inventory;
    Ok(())
}
```

The bump is stored in the account so later instructions can verify the PDA cheaply with `bump = inventory.bump` instead of re-deriving it.

---

## 4. `buy_item(item_id: u8, qty: u8)` — SOL Transfer via CPI

```rust
pub(crate) fn handle_buy_item(ctx: Context<BuyItem>, item_id: u8, qty: u8) -> Result<()> {
    require!(item_id < ITEMS.len() as u8, PetError::ItemUnknown);
    require!(qty > 0, PetError::InsufficientItems);

    let effect = &ITEMS[item_id as usize];
    let total_lamports = effect.price_lamports
        .checked_mul(qty as u64)
        .ok_or(PetError::MathOverflow)?;

    let buyer_lamports = ctx.accounts.owner.lamports();
    require!(buyer_lamports >= total_lamports, PetError::InsufficientFunds);

    // Transfer SOL to treasury PDA
    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to:   ctx.accounts.treasury.to_account_info(),
            },
        ),
        total_lamports,
    )?;
    // ... inventory slot update ...
}
```

**Why CPI, not direct lamport manipulation?**

Solana allows programs to directly mutate `account.lamports()` under certain conditions. However:

1. **System program accounting.** The system program maintains the canonical ledger. Going around it via direct mutation can leave the runtime in an inconsistent state and is rejected if the account is owned by System (as a wallet is).
2. **Correctness.** CPI goes through `system_program::transfer`, which validates that the `from` account is a signer, that it has enough lamports, and that the sum of lamports across all accounts is conserved. Those checks run for free.
3. **Auditability.** A reviewer seeing `CpiContext::new(...)` immediately recognizes the SOL transfer pattern. Direct lamport writes require understanding the surrounding invariants.

**Checked arithmetic.**

`checked_mul` returns `None` on overflow; the `?` maps it to `PetError::MathOverflow`. This prevents a malicious input like `item_id=0, qty=255` from silently computing a wrapped total that is lower than the actual cost.

**Inventory slot logic.**

```rust
let slot = inv.slots.iter_mut().find(|s| s.qty > 0 && s.item_id == item_id);
if let Some(s) = slot {
    s.qty = s.qty.checked_add(qty as u16).ok_or(PetError::MathOverflow)?;
} else {
    let empty = inv.slots.iter_mut().find(|s| s.qty == 0);
    let empty = empty.ok_or(PetError::InventoryFull)?;
    empty.item_id = item_id;
    empty.qty = qty as u16;
}
```

Two-phase lookup: first try to stack onto an existing slot for that item; only claim a new slot if none exists. This keeps the 8-slot cap meaningful — buying more of an item you already own does not consume an extra slot.

**Treasury PDA.**

```rust
// BuyItem context
#[account(
    mut,
    seeds = [b"treasury"],
    bump,
)]
pub treasury: UncheckedAccount<'info>,
```

Seeds `[b"treasury"]` are hard-coded in the account constraint. The user cannot substitute a different address — Anchor re-derives the PDA from the seeds and rejects any `treasury` key that does not match. `UncheckedAccount` is used because the treasury receives SOL and does not store typed Anchor account data (it has no discriminator); the `/// CHECK:` doc comment explains why it is safe.

---

## 5. `use_item(item_id: u8, pet_name: String)` — Stat Application

```rust
// UseItem context
pub inventory: Account<'info, Inventory>, // has_one = owner
pub pet:       Account<'info, Pet>,       // has_one = owner, constraint = pet.is_alive
```

Both `inventory` and `pet` carry `has_one = owner`. Anchor validates `inventory.owner == ctx.accounts.owner.key()` and `pet.owner == ctx.accounts.owner.key()` before the handler runs. This means the owner field in each account is checked — a caller cannot pass someone else's inventory against their own pet, or vice versa.

**Handler flow:**

```rust
pub(crate) fn handle_use_item(ctx: Context<UseItem>, item_id: u8, _pet_name: String) -> Result<()> {
    // 1. Validate item_id and find slot with qty > 0
    let slot = inv.slots.iter_mut()
        .find(|s| s.qty > 0 && s.item_id == item_id)
        .ok_or(PetError::InsufficientItems)?;
    slot.qty -= 1;

    let effect = ITEMS[item_id as usize];

    // 2. Apply time decay first (stat state must reflect elapsed time)
    apply_time_decay(pet, now)?;

    // 3. Apply item effects using apply_stat_delta
    pet.hunger    = apply_stat_delta(pet.hunger,    effect.hunger_delta);
    pet.hygiene   = apply_stat_delta(pet.hygiene,   effect.hygiene_delta);
    pet.happiness = apply_stat_delta(pet.happiness, effect.happiness_delta);
    pet.tiredness = apply_stat_delta(pet.tiredness, effect.tiredness_delta);

    // 4. Recalculate health and need flags — item can kill the pet
    refresh_needs_and_health(pet);
    pet.last_interaction = now;
}
```

**`apply_stat_delta`** handles negative deltas cleanly:

```rust
// helpers.rs
pub fn apply_stat_delta(stat: u8, delta: i16) -> u8 {
    let result = (stat as i16).saturating_add(delta);
    result.clamp(0, 100) as u8
}
```

Casting `u8` to `i16` before adding prevents underflow. `clamp(0, 100)` enforces the game's stat range. No explicit positive/negative branching needed — the same function handles +60 hygiene from Soap and -30 hunger from Apple.

**Items can kill the pet.** After applying effects, `refresh_needs_and_health` runs:

```rust
// helpers.rs
pub fn refresh_needs_and_health(pet: &mut Pet) {
    pet.health = compute_health(pet.hunger, pet.tiredness, pet.hygiene, pet.happiness);
    // ...
    if pet.hunger > 95 || pet.hygiene < 10 || pet.happiness < 5 {
        pet.is_alive = false;
    }
}
```

The Toy raises tiredness by 10. If a pet is already at 95 tiredness... wait — tiredness does not appear in the death condition. But consider: Pillow adds +5 hunger. A pet at 91 hunger that receives a Pillow reaches 96 — past the 95 threshold — and dies. Items are not purely beneficial; their side effects are meaningful.

---

## 6. Why the Treasury PDA Exists

The treasury is a program-derived account that only the program can authorize spending from. It has no private key. This serves several purposes:

- **Decentralized fee collection.** SOL from purchases accumulates in a program-controlled account. No single developer wallet receives funds; the program's governance can decide how to spend them.
- **Future extensibility.** A future `withdraw_treasury` instruction, gated behind a multisig or governance vote, can drain funds to operational addresses without modifying the core program logic.
- **No custodial risk.** The treasury cannot be drained by a stolen developer key — only by a signed program instruction, which can be inspected on-chain.

In contrast to a mutable authority pubkey stored in some config account, the treasury PDA address is fully deterministic from the program ID. Any client can compute it: `PublicKey.findProgramAddressSync([Buffer.from("treasury")], programId)`.

---

## 7. Frontend Integration

```typescript
// client/petClient.ts
async initInventory(): Promise<string> {
    return this.program.methods.initInventory()
        .accounts({ owner: this.provider.wallet.publicKey })
        .rpc();
}

async buyItem(itemId: number, qty: number): Promise<string> {
    return this.program.methods.buyItem(itemId, qty)
        .accounts({ owner: this.provider.wallet.publicKey })
        .rpc();
}

async useItem(itemId: number, petName: string): Promise<string> {
    return this.program.methods.useItem(itemId, petName)
        .accounts({ owner: this.provider.wallet.publicKey })
        .rpc();
}

async getInventory(owner?: PublicKey): Promise<InventoryInfo> {
    const [pda] = this.deriveInventoryPda(ownerKey);
    const account = await this.program.account.inventory.fetch(pda);
    return { publicKey: pda, ...account };
}
```

Anchor's TypeScript client auto-resolves remaining accounts (inventory PDA, treasury PDA) from the IDL's `seeds` definitions — the caller only provides `owner`. The `app/src/constants.ts` file mirrors the on-chain catalog for display purposes (names, emojis, price labels), keeping UI rendering free of RPC calls for static data.

---

## Interview Talking Points

**"How does the program prevent buying a fake item?"**
`require!(item_id < ITEMS.len() as u8, PetError::ItemUnknown)` bounds-checks before the array index. Any `item_id >= 4` returns an error before any state is modified.

**"Why not store items in a separate on-chain account?"**
The catalog is immutable program logic. Storing it on-chain would cost rent and add an extra account to every instruction. A `const` array is zero-cost at runtime and auditable at compile time.

**"What stops a user from sending SOL to an arbitrary treasury address?"**
The `treasury` account in `BuyItem` is constrained by `seeds = [b"treasury"]` and `bump`. Anchor re-derives the PDA server-side and rejects any submitted key that does not match. The user cannot substitute a different recipient.

**"How does Anchor enforce the owner relationship between inventory and pet?"**
Both accounts carry `has_one = owner`. Anchor emits a check equivalent to `require!(account.owner == ctx.accounts.owner.key(), PetError::Unauthorized)` before the handler body runs. The signer must be the recorded owner of both accounts simultaneously.
