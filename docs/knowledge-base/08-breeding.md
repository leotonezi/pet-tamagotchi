# 08 — Breeding: On-Chain RNG, SlotHashes, and Parent Account Constraints

**Target audience**: Developer building deep Solana expertise for job interviews and production work.

## What Breeding Does

The `breed` instruction takes two live pets owned by the same wallet and creates a third pet PDA — the offspring. The offspring inherits stats from its parents through a bitwise selection driven by on-chain randomness, and its species string is a byte-level blend of both parents' species strings. No tokens are spent beyond the SOL rent for the new account.

This instruction demonstrates three advanced Solana patterns in a single handler: PDA aliasing prevention at the account constraint layer, raw sysvar memory reading, and deterministic pseudo-randomness using `hashv`.

Source: `/Users/leonardotonezi/Documents/github/pet-tamagotchi/programs/pet-tamagotchi/src/instructions/breed.rs`

---

## The `Breed` Account Context

```rust
#[derive(Accounts)]
#[instruction(name_a: String, name_b: String, offspring_name: String)]
pub struct Breed<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_a.as_bytes()],
        bump = pet_a.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_a.is_alive @ PetError::PetDeceased,
        constraint = pet_a.key() != pet_b.key() @ PetError::SameParent,
    )]
    pub pet_a: Account<'info, Pet>,

    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_b.as_bytes()],
        bump = pet_b.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_b.is_alive @ PetError::PetDeceased,
    )]
    pub pet_b: Account<'info, Pet>,

    #[account(
        init,
        seeds = [b"pet", owner.key().as_ref(), offspring_name.as_bytes()],
        bump,
        payer = owner,
        space = Pet::MAX_SIZE,
    )]
    pub offspring: Account<'info, Pet>,

    /// CHECK: address constraint pins this to the canonical SlotHashes sysvar.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
```

### Account-by-account breakdown

**`owner: Signer, mut`** — The wallet that owns both parents. Marked `mut` because it pays for the offspring's account rent via the System Program CPI inside `init`. Anchor automatically debits rent-exempt lamports from this signer.

**`pet_a`** — Parent A, loaded by PDA seeds `[b"pet", owner, name_a]`. Three constraints apply:
- `has_one = owner` — Anchor checks `pet_a.owner == owner.key()`. Prevents borrowing another wallet's pets.
- `constraint = pet_a.is_alive` — Dead pets cannot breed. Checked at deserialization time, before handler code runs.
- `constraint = pet_a.key() != pet_b.key()` — The SameParent guard (security fix B-01, detailed below).

**`pet_b`** — Parent B, loaded by seeds `[b"pet", owner, name_b]`. Same `has_one` and liveness constraints. Critically, the SameParent constraint is NOT duplicated here — it lives only on `pet_a`.

**`offspring`** — Created fresh with `init`. Seeds `[b"pet", owner, offspring_name]`. If a PDA with these seeds already exists, the Solana runtime rejects the transaction with "account already in use" before the handler runs. This means the same offspring name cannot be bred twice — you cannot overwrite an existing pet.

**`slot_hashes: UncheckedAccount`** — The SlotHashes sysvar, explained in depth below. Typed as `UncheckedAccount` (no automatic deserialization) and pinned to the canonical sysvar pubkey via the `address =` constraint.

---

## The SameParent Constraint: Why Account Level Beats Handler Code

A naive implementation would check `pet_a.key() != pet_b.key()` inside the handler body. This has a subtle vulnerability: before that check runs, Anchor has already deserialized both accounts. If the same account is passed for both `pet_a` and `pet_b`, Anchor may produce two mutable borrows of the same underlying account data — undefined behavior at the Rust borrow-checker level in unsafe contexts.

By placing the constraint directly on the `pet_a` account attribute, Anchor evaluates it during account loading, before the handler function body begins. The program never reaches handler code if the accounts alias. This is security fix B-01.

**Interview angle**: Solana's account model allows a caller to pass the same account pubkey multiple times in the accounts array. Programs must explicitly guard against this. The idiomatic defense is an Anchor `constraint =` at account level, not a runtime check in the instruction handler.

---

## The SlotHashes Sysvar: On-Chain Randomness

Solana does not have a native VRF (verifiable random function) at the program layer. The closest practical substitute for low-stakes randomness is the **SlotHashes sysvar** — a built-in account maintained by the runtime at the fixed address `SysvarS1otHashes111111111111111111111111111`.

### What SlotHashes contains

The sysvar stores a rolling history of recent slot block hashes. Each entry pairs a `u64` slot number with the 32-byte hash of that slot's block. The runtime updates this account after every block. Validators produce these hashes as part of block production, so they are not directly controllable by a program or its callers mid-transaction.

### Memory layout

```
Offset 0..8    — u64 (little-endian): count of entries in the list
Offset 8..16   — u64: slot number of the most recent entry
Offset 16..48  — [u8; 32]: block hash of that most recent slot
Offset 48..56  — u64: slot number of the second entry
Offset 56..88  — [u8; 32]: block hash of the second entry
...
```

To read the most recent hash you need bytes 16 through 48 — skip 8 bytes for the count, skip 8 bytes for the slot number, then read 32 bytes of hash. The minimum buffer size to safely do this is `8 + 8 + 32 = 48` bytes.

### Why raw byte access instead of typed deserialization

Anchor provides `Sysvar<'info, SlotHashes>` for some sysvars, but SlotHashes can hold up to 512 entries and its full deserialization allocates a large Vec. Programs that only need the most recent hash read the raw bytes instead:

```rust
let data = ctx.accounts.slot_hashes.try_borrow_data()?;
let hash_bytes: &[u8] = if data.len() >= MIN_SLOT_HASHES_LEN {
    &data[16..48]
} else {
    // localnet fallback — predictable, remove before mainnet
    &Clock::get()?.slot.to_le_bytes()[..]
};
```

`try_borrow_data()` borrows the account's raw byte buffer. Slicing `[16..48]` extracts exactly the 32-byte hash. The `UncheckedAccount` type is used because no automatic deserialization is needed — the `address =` constraint provides the security guarantee that this is the real sysvar and not an attacker-controlled account.

**Interview angle**: If an interviewer asks "how do you read a sysvar without paying for full deserialization?" — this is the answer. `try_borrow_data()` on an `UncheckedAccount` pinned by address constraint, then manual byte slicing. Know the layout: 8-byte count, then pairs of (8-byte slot, 32-byte hash).

---

## RNG via `hashv`

`solana_program::hash::hashv` computes SHA-256 over an arbitrary number of byte slices concatenated in order. It is the same hash function the runtime uses internally. Passing multiple slices avoids allocating a combined buffer.

```rust
hashv(&[
    hash_bytes,                          // 32-byte slot hash (on-chain entropy)
    ctx.accounts.owner.key().as_ref(),   // owner pubkey — tx-unique
    ctx.accounts.pet_a.key().as_ref(),   // parent A PDA
    ctx.accounts.pet_b.key().as_ref(),   // parent B PDA
    offspring_name.as_bytes(),           // offspring name
])
.to_bytes()[0]  // take only the first byte of the 32-byte SHA-256 output
```

The result is a `Hash` struct. `.to_bytes()` returns `[u8; 32]`. Index `[0]` extracts one byte — 8 bits. Only the low 4 bits of that byte are used (one bit per stat), so the selection space is 16 patterns.

**Why mixing in owner/parent keys helps**: Without the sysvar hash, an attacker could brute-force `offspring_name` strings entirely offline to find a name that produces their desired 4-bit pattern. The slot hash — which is unknown until the block is finalized — makes this impossible during the slot. However, the hash is readable from a previous block, so a sufficiently motivated attacker can still enumerate names after observing the slot hash (~16 SHA-256 operations on average to hit any target pattern). This is the residual risk B-05-R; the production fix is a commit-reveal scheme deferred to R8+.

---

## Stat Inheritance: Bitmasking the RNG Byte

Each of the four stats is independently inherited from one of the two parents based on a single bit of the RNG byte:

```rust
let hunger    = if rng_byte & 0x01 == 0 { pet_a.hunger    } else { pet_b.hunger    };
let tiredness = if rng_byte & 0x02 == 0 { pet_a.tiredness } else { pet_b.tiredness };
let hygiene   = if rng_byte & 0x04 == 0 { pet_a.hygiene   } else { pet_b.hygiene   };
let happiness = if rng_byte & 0x08 == 0 { pet_a.happiness } else { pet_b.happiness };
```

| Bit | Mask   | Stat       | 0 = from A | 1 = from B |
|-----|--------|------------|------------|------------|
| 0   | `0x01` | hunger     | pet_a      | pet_b      |
| 1   | `0x02` | tiredness  | pet_a      | pet_b      |
| 2   | `0x04` | hygiene    | pet_a      | pet_b      |
| 3   | `0x08` | happiness  | pet_a      | pet_b      |

Each stat is an independent Bernoulli draw. There is no weighted average — the offspring gets the exact value from one parent, not a blend. This means an offspring can be born with high hunger from parent A and high happiness from parent B simultaneously.

---

## Species Blending

Species strings are treated as ASCII byte arrays and split at the midpoint:

```rust
let a_bytes = pet_a.species.as_bytes();
let b_bytes = pet_b.species.as_bytes();
let half_a = a_bytes.len() / 2;
let mut species_bytes: Vec<u8> = a_bytes[..half_a].to_vec();
species_bytes.extend_from_slice(&b_bytes[b_bytes.len() / 2..]);
species_bytes.truncate(MAX_SPECIES_LEN);  // 16 bytes max
let blended_species = String::from_utf8(species_bytes)
    .unwrap_or_else(|_| pet_a.species.clone());
```

**Why ASCII validation comes first (B-08)**: UTF-8 allows multi-byte character sequences. If a species string contained a 3-byte character and you split the byte array at the midpoint, you might cut through the middle of that sequence, producing invalid UTF-8. `String::from_utf8` would then return an error. The `is_ascii()` check at the top of the handler ensures every byte is in the range 0..=127, so any byte-level split produces valid UTF-8. The `unwrap_or_else` is purely defensive — it can never trigger after an ASCII-validated input, but it prevents a panic if the invariant is ever violated by a future code path.

The empty-species guard (`if blended_species.is_empty()`) handles the edge case where both parents have zero-length species strings, falling back to parent A's species.

---

## Offspring Initialization

```rust
offspring.needs_meal       = false;
offspring.needs_walk       = false;
offspring.needs_bath       = false;
offspring.is_alive         = true;
// ...
refresh_needs_and_health(offspring);
```

The offspring starts with all need flags cleared. `refresh_needs_and_health` then recomputes needs and health from the inherited stat values:

- `needs_meal = hunger > 70`
- `needs_walk = happiness < 60`
- `needs_bath = hygiene < 40`
- Health = `(100 - hunger + 100 - tiredness + hygiene + happiness) / 4`
- If `hunger > 95 || hygiene < 10 || happiness < 5` → `is_alive = false` (stillbirth)

A pet can be born dead if it inherits extreme stats from neglected parents. The `PetBorn` event includes the `is_alive` field reflecting the post-refresh state (fix B-09), so callers can detect a stillbirth from the event log without re-querying on-chain state.

`offspring.version` is left at the Rust default of `0`. This is intentional per the R7 spec, which reserves the version field for a future migration marker.

---

## `init` vs `init_if_needed`: Re-initialization Prevention

The offspring account uses `init`, not `init_if_needed`. This is a deliberate security choice (B-03). With `init`, the Solana runtime rejects the transaction with an "account already in use" error if the PDA derived from `[b"pet", owner, offspring_name]` already exists. The same offspring name cannot be used to overwrite an existing pet. With `init_if_needed`, a second call with the same name would silently succeed and reinitialize the account — a critical exploit for any game that tracks pets as unique entities.

---

## Known Security Residuals

**B-05-R (P2)**: Attacker can enumerate `offspring_name` values offline after observing the current slot hash (~16 SHA-256 ops on average) to cherry-pick any of the 16 stat-inheritance patterns. All four inputs besides the slot hash are attacker-controlled. Production fix: commit-reveal scheme (deferred to R8+).

**B-06 (P3)**: The localnet fallback uses `Clock::get()?.slot.to_le_bytes()` when the SlotHashes buffer is shorter than 48 bytes. `Clock::slot` is publicly observable and predictable by validators. This branch must be removed or `cfg`-gated before mainnet deployment.

**B-02 (P2)**: No `version == 0` constraint on either parent. If a future R7 migration marks migrated pets with `version = 1` and changes the account layout, an older `breed` client can load migrated parents and read fields at wrong offsets. The fix is to add `constraint = pet_a.version == 0` guards when the R7 migration ships.

---

## Interview Cheat Sheet

| Topic | Key Point |
|---|---|
| SlotHashes layout | 8-byte count → 8-byte slot → 32-byte hash. Bytes `[16..48]` = most recent hash. |
| Why `UncheckedAccount` for sysvar | Avoids expensive Vec allocation from full deserialization; `address =` constraint provides security. |
| `hashv` | SHA-256 over multiple `&[u8]` slices without allocation. Returns `Hash`; `.to_bytes()[0]` extracts one byte. |
| Aliasing defense | Put `pet_a.key() != pet_b.key()` on the account attribute, not in handler code. Evaluated before any borrows. |
| `init` vs `init_if_needed` | `init` = runtime rejects if PDA exists. `init_if_needed` = silently reinitializes. Use `init` for unique assets. |
| Stillbirth | `refresh_needs_and_health` runs post-init and can set `is_alive = false` on inherited extreme stats. |
| ASCII species requirement | Byte-splitting UTF-8 mid-sequence produces invalid bytes. ASCII guarantees every byte is a valid split point. |
