# 03 — Accounts & PDAs

> Deep reference for all account types, byte layouts, PDA seed design, and the bump caching pattern. Interview-prep depth: every decision has a reason.

---

## What is a PDA?

A Program Derived Address is an address computed as:

```
SHA256(seeds || program_id || "ProgramDerivedAddress")
```

The critical property: the result is deliberately made to **fall off the Ed25519 elliptic curve**. Ed25519 is the curve Solana uses for keypairs. If a point is on the curve, a private key exists that can sign for it. If it is off the curve, no private key exists — no wallet can ever sign for it.

This means: **only the program itself can authorize actions on a PDA**, by passing signer seeds through `CpiContext::new_with_signer`. No external actor can forge a signature for that address.

Why this matters in practice:

- **Program-controlled accounts**: the program is the sole authority. No user can drain a treasury PDA or forge a mint signature, because they cannot produce a valid signature for the address.
- **Deterministic addressing**: given the same seeds and program ID, anyone (on-chain or off-chain) can recompute the address. No storage or lookup is needed to find a user's pet or inventory.
- **Namespace isolation**: different seed combinations produce different addresses. Two wallets owning pets with the same name get distinct PDAs because the owner pubkey is in the seed.

---

## The Bump

`SHA256(seeds || program_id || "ProgramDerivedAddress")` sometimes lands on the curve. To guarantee the result is off-curve, Solana appends a one-byte nonce called the **bump** and tries values from 255 down to 0:

```
try bump = 255: hash lands on curve → skip
try bump = 254: hash lands off curve → use this address and bump
```

The first bump value (highest, starting at 255) that produces an off-curve address is the **canonical bump**. The Solana SDK function `findProgramAddressSync` returns both the address and the canonical bump:

```typescript
const [address, bump] = PublicKey.findProgramAddressSync(seeds, programId);
```

In Rust / Anchor, the `bump` constraint in `#[account(...)]` tells the runtime to verify the PDA at a specific bump value rather than letting the caller supply an arbitrary one.

---

## Bump Caching Pattern

This is a critical interview topic and a real production concern.

### The problem

On every instruction that references a PDA, Anchor must verify the account is the correct PDA. Without a cached bump, Anchor re-grinds: it tries bump 255, 254, 253… until the hash matches the address in the transaction. In the worst case that is 256 hash iterations per account per instruction. On-chain compute is metered in compute units (CUs); unnecessary hashing burns them.

### The solution

**On `init`:** Anchor derives the canonical bump once and exposes it via `ctx.bumps.account_name`. Store it in the account data immediately:

```rust
// create_pet.rs
pet.bump = ctx.bumps.pet;

// inventory.rs
inv.bump = ctx.bumps.inventory;

// token.rs (two bumps stored in MintAuthority)
mint_authority.bump      = ctx.bumps.mint_authority;
mint_authority.mint_bump = ctx.bumps.petz_mint;  // S-02: cache the mint PDA bump too
```

**On subsequent calls:** supply the cached bump in the constraint so Anchor skips the grinding loop entirely:

```rust
// BuyItem, UseItem — reads inv.bump from account data, verifies in one step
#[account(
    mut,
    seeds = [b"inventory", owner.key().as_ref()],
    bump = inventory.bump,     // ← cached: O(1) verification
)]
pub inventory: Account<'info, Inventory>,
```

Compare to the un-cached form:

```rust
bump,    // ← no value: Anchor grinds up to 256 iterations
```

### Why both bumps are in MintAuthority

`MintAuthority` stores its own bump (`mint_authority.bump`) plus the `petz_mint` PDA bump (`mint_authority.mint_bump`). The `petz_mint` account is touched on every `claim_daily_reward` call. Caching its bump avoids one full re-grind per claim. This is labeled `S-02` in the codebase's security annotation scheme.

---

## Account Structures

### Pet — 123 bytes

Seeds: `[b"pet", owner(32 bytes), name(variable UTF-8)]`

| Field | Type | Bytes | Notes |
|---|---|---|---|
| discriminator | implicit | 8 | Anchor prepends 8-byte hash of account type name |
| `owner` | `Pubkey` | 32 | wallet that created and controls this pet |
| `name` | `String` | 4 + 32 | 4-byte length prefix + up to 32 bytes payload |
| `species` | `String` | 4 + 16 | 4-byte length prefix + up to 16 bytes payload |
| `birth_date` | `i64` | 8 | Unix timestamp at creation |
| `hunger` | `u8` | 1 | 0 = satisfied, 100 = starving |
| `tiredness` | `u8` | 1 | 0 = rested, 100 = exhausted |
| `hygiene` | `u8` | 1 | 0 = filthy, 100 = pristine |
| `happiness` | `u8` | 1 | 0 = miserable, 100 = delighted |
| `health` | `u8` | 1 | derived from the four stats above |
| `needs_meal` | `bool` | 1 | |
| `needs_walk` | `bool` | 1 | |
| `needs_bath` | `bool` | 1 | |
| `is_alive` | `bool` | 1 | false = pet is dead, most ix reject |
| `last_interaction` | `i64` | 8 | timestamp used for time-decay computation |
| `bump` | `u8` | 1 | cached canonical PDA bump |
| `version` | `u8` | 1 | reserved for R7 account migration (see below) |

**Manual size calculation** (from `state.rs`):

```rust
pub const MAX_SIZE: usize =
    8               // discriminator
    + 32            // owner: Pubkey
    + (4 + 32)      // name: String (length prefix + MAX_NAME_LEN)
    + (4 + 16)      // species: String (length prefix + MAX_SPECIES_LEN)
    + 8             // birth_date: i64
    + 5             // hunger + tiredness + hygiene + happiness + health (5 × u8)
    + 4             // needs_meal + needs_walk + needs_bath + is_alive (4 × bool)
    + 8             // last_interaction: i64
    + 1             // bump: u8
    + 1;            // version: u8
// = 123
```

The discriminator is included in `MAX_SIZE` because Anchor's `init` allocates `space = Pet::MAX_SIZE` bytes total — Anchor writes the discriminator into that allocation itself.

**Why not derive `space` automatically?** Anchor cannot automatically compute the size of `String` fields because strings are variable-length on the wire. The developer must account for the 4-byte Borsh length prefix plus the maximum content bytes. Getting this wrong wastes rent (too large) or causes deserialization panics (too small).

### The `version` field

`version: u8` is currently always written as `0`. It is reserved for a future R7 milestone that will perform an account realloc migration — for example, adding new fields to `Pet` without closing and re-creating all accounts. Solana's `realloc` instruction can extend an account's data in-place.

**Why add it now instead of later?** Adding a field later requires an on-chain migration instruction that: finds every existing `Pet` account (expensive), reallocates data, writes the new field, and bumps the version. If `version` is already present, the migration only needs to write a new value into an existing byte. If the field is absent, a migration must also shift all subsequent bytes, which risks data corruption if any byte layout calculation is off. Reserving the byte now costs one lamport of rent per account and prevents a painful structural migration later.

---

### Inventory — 65 bytes

Seeds: `[b"inventory", owner(32 bytes)]`

| Field | Type | Bytes | Notes |
|---|---|---|---|
| discriminator | implicit | 8 | |
| `owner` | `Pubkey` | 32 | must match signer on all mutations |
| `slots` | `[ItemSlot; 8]` | 24 | 8 fixed slots × 3 bytes each |
| `bump` | `u8` | 1 | cached PDA bump |

**ItemSlot — 3 bytes**

```rust
pub struct ItemSlot {
    pub item_id: u8,  // 1 byte — which item
    pub qty:     u16, // 2 bytes — quantity owned (little-endian)
}
```

**Why a fixed array instead of `Vec<ItemSlot>`?**

A `Vec` on-chain requires a 4-byte length prefix plus heap-allocated content — and crucially, if a user ever adds more items than the account was initially sized for, the program would need to call `realloc` to expand the account. That adds complexity, rent recalculation, and a new attack surface. A fixed array of 8 slots:

- Makes account size perfectly predictable at `init` time
- Eliminates realloc for the R1 milestone scope
- Keeps `Inventory::SIZE` a compile-time constant
- Costs 24 bytes regardless of how many slots are occupied

The trade-off is the 8-slot cap. If the game later needs more item types, a realloc migration extends the array.

---

### MintAuthority — 58 bytes total (50 data + 8 discriminator)

Seeds: `[b"mint_authority"]`

| Field | Type | Bytes | Notes |
|---|---|---|---|
| discriminator | implicit | 8 | |
| `bump` | `u8` | 1 | own PDA bump |
| `mint_bump` | `u8` | 1 | cached `petz_mint` PDA bump (S-02) |
| `mint` | `Pubkey` | 32 | address of the `petz_mint` account |
| `total_minted` | `u64` | 8 | audit counter of all tokens ever minted |

This account serves as the **mint authority** for the `$PETZ` SPL token. Because it is a PDA, only the program can sign CPI calls that mint tokens — no external wallet can ever mint `$PETZ` directly. The `mint_authority` PDA is passed as the `authority` field in `token::mint_to(...)`.

`total_minted` is an audit counter incremented with `checked_add` on every claim, making overflow a program error rather than silent wraparound.

---

### ClaimState — 92 bytes

Seeds: `[b"claim_state", owner(32 bytes), pet_name(variable)]`

| Field | Type | Bytes | Notes |
|---|---|---|---|
| discriminator | implicit | 8 | |
| `owner` | `Pubkey` | 32 | wallet claiming rewards |
| `pet` | `Pubkey` | 32 | the specific pet this claim state tracks |
| `last_claim_ts` | `i64` | 8 | Unix timestamp of most recent claim |
| `total_claims` | `u32` | 4 | audit counter |
| `bump` | `u8` | 1 | cached PDA bump |
| `_padding` | `[u8; 7]` | 7 | alignment to 8-byte boundary |

The padding aligns the total to 92 bytes, which is a multiple of 8 — keeping the account size at a clean boundary for potential future field additions.

`last_claim_ts` is initialized to `0` (Unix epoch) rather than `Clock::get()?.unix_timestamp`. This is intentional: the first claim should be available immediately after account creation, not after a 24-hour wait. With `last_claim_ts = 0`, the expression `now - 0 >= 86_400` is always true for any real-world timestamp.

---

### petz_mint — 82 bytes (SPL Mint)

Seeds: `[b"petz_mint"]`

This is a standard SPL `Mint` account, 82 bytes as defined by the SPL Token program. Its address is a PDA owned by this program, so only the `mint_authority` PDA (also owned by this program) can sign mint operations. The program stores the `petz_mint` bump inside `MintAuthority.mint_bump` to avoid re-grinding on every `claim_daily_reward`.

---

### Treasury — no account data

Seeds: `[b"treasury"]`

The treasury is a bare PDA that receives SOL when users call `buy_item`. It stores no fields — it is just an address that the program controls. Because it is a PDA, only this program can authorize transfers out of it (future withdrawal instruction would use `invoke_signed` with `[b"treasury", &[bump]]` as signer seeds).

---

## Multi-Pet Ownership

A single wallet can own many pets because the **pet name is part of the seed**:

```
Pet "Rex"  → SHA256([b"pet", wallet_pubkey, b"Rex",  bump, program_id])
Pet "Luna" → SHA256([b"pet", wallet_pubkey, b"Luna", bump, program_id])
```

These are completely different addresses. Creating a second pet with the same name would attempt to `init` an already-initialized account, which Anchor rejects. The name acts as a per-owner namespace.

---

## Client-Side PDA Derivation

The TypeScript client mirrors the on-chain seeds exactly:

```typescript
// petClient.ts
derivePetPda(owner: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
        this.program.programId
    );
}

deriveInventoryPda(owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("inventory"), owner.toBuffer()],
        this.program.programId
    );
}

deriveClaimStatePda(owner: PublicKey, petName: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("claim_state"), owner.toBuffer(), Buffer.from(petName)],
        this.program.programId
    );
}

deriveMintAuthorityPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("mint_authority")],
        this.program.programId
    );
}

derivePetzMintPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("petz_mint")],
        this.program.programId
    );
}

deriveTreasuryPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("treasury")],
        this.program.programId
    );
}
```

`findProgramAddressSync` is synchronous — it grinds locally in JavaScript without an RPC call. The derived address is passed to `program.methods.foo().accounts({...})`, where Anchor's client serializes it into the transaction's account list. The on-chain program then re-verifies the address using its own `seeds` + `bump` constraints.

---

## The `listPetsByOwner` Memcmp Filter

To fetch all pets for a given wallet without knowing their names, the client uses a `memcmp` filter against the raw account data:

```typescript
async listPetsByOwner(owner: PublicKey): Promise<PetInfo[]> {
    const accounts = await this.program.account.pet.all([
        {
            memcmp: {
                offset: 8,              // skip the 8-byte discriminator
                bytes: owner.toBase58(), // match 32-byte owner pubkey
            },
        },
    ]);
    return accounts.map((a) => ({ publicKey: a.publicKey, ...a.account }));
}
```

Why offset 8: Anchor writes the 8-byte discriminator at the very start of every account's data. The `owner: Pubkey` field is the first declared field in `Pet`, so it starts at byte 8. The RPC node applies the filter server-side — only accounts whose bytes at `[8..40]` match the owner pubkey are returned. This is far cheaper than fetching all `Pet` accounts and filtering client-side.

This filter works correctly only because `owner` is the first field in the struct. If fields were reordered, the offset would need to change — a subtle maintenance hazard worth knowing.

---

## Summary Table

| Account | Seeds | Size | Bump Cached? |
|---|---|---|---|
| `Pet` | `[b"pet", owner, name]` | 123 bytes | yes — `pet.bump` |
| `Inventory` | `[b"inventory", owner]` | 65 bytes | yes — `inventory.bump` |
| `MintAuthority` | `[b"mint_authority"]` | 58 bytes | yes — `mint_authority.bump` + `mint_authority.mint_bump` |
| `ClaimState` | `[b"claim_state", owner, pet_name]` | 92 bytes | yes — `claim_state.bump` |
| `petz_mint` | `[b"petz_mint"]` | 82 bytes (SPL Mint) | via `mint_authority.mint_bump` |
| `Treasury` | `[b"treasury"]` | no data | no (no stored state) |
