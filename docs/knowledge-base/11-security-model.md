# 11 — Security Model

This document covers every security mechanism in the pet-tamagotchi program.
Target audience: a developer preparing for Solana interviews or production audits.
Understanding this section deeply is the single highest-leverage preparation for
questions about Anchor program security.

---

## 1. Owner Binding — Two Independent Layers

Every instruction that mutates a pet account enforces ownership through two
completely independent mechanisms. Both must pass simultaneously. Defeating one
does not defeat the other.

### Layer 1 — `has_one` field check

```rust
has_one = owner @ PetError::Unauthorized,
```

Anchor reads `pet.owner` from on-chain account data and asserts it equals
`owner.key()` (the transaction signer). This is a runtime field comparison
against already-stored state.

### Layer 2 — Owner baked into the PDA seed

```rust
seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
```

The signer's public key is a seed component. Anchor re-derives the expected PDA
from these seeds and the bump, then asserts the result matches the account
address passed in the transaction. A different signer produces a different PDA
address — the account they try to pass does not exist at the derived address, so
the constraint fails before any handler code runs.

### Why both layers together

An attacker who owns a pet called "alpha" cannot act on another user's pet also
called "alpha" because:

- The PDA derivation uses the attacker's own key, producing a different address
  than the victim's pet.
- Even if they somehow found an address collision, `has_one` would still reject
  them because `pet.owner` stores the victim's pubkey, not theirs.

Neither layer alone is sufficient. `has_one` could theoretically be bypassed if
an attacker could craft an account with a forged `owner` field. The PDA seed
prevents that by making the address itself a function of the signer's identity.

---

## 2. No Re-initialization — `init` vs `init_if_needed`

Every account creation instruction uses `init`, not `init_if_needed`:

```rust
// create_pet.rs
#[account(init, payer = owner, space = Pet::MAX_SIZE, seeds = [...], bump)]
pub pet: Account<'info, Pet>,

// breed.rs (offspring)
#[account(init, seeds = [b"pet", owner.key().as_ref(), offspring_name.as_bytes()], ...)]
pub offspring: Account<'info, Pet>,
```

When Anchor processes `init`, it checks that the account does not already have
the 8-byte discriminator written to its first bytes. If the account already
exists with that discriminator, the runtime rejects the transaction with "account
already in use."

The attack this prevents: an adversary pre-creates a pet account with crafted
initial stats (e.g., `is_alive = false`, `health = 0`) and waits for the victim
to call `create_pet`. Without the `init` guard, `init_if_needed` would silently
skip initialization on an existing account, leaving the attacker's data in place.
With `init`, the transaction fails if the PDA is already occupied.

This applies to every stateful account in the program: `Pet`, `Inventory`,
`ClaimState`, and `MintAuthority`. The `breed` instruction's offspring account
also uses `init`, so a breeding slot cannot be silently hijacked.

---

## 3. Bump Caching — Preventing Bump-Grinding Attacks

Pet actions use the cached bump rather than re-deriving it:

```rust
// pet_actions.rs
bump = pet.bump,
```

The bump is stored in `pet.bump` at creation time (`pet.bump = ctx.bumps.pet`)
and read back on every subsequent access. Anchor still verifies that
`(seeds + cached_bump)` derives to the claimed account address. If an attacker
passes a fake account with a wrong bump stored in the `bump` field, the seeds
constraint fails — the derived address will not match the account being passed.

Re-deriving the bump on each call would also work, but caching has two
advantages: it saves one `find_program_address` call per transaction, and it
makes the validation path explicit. The same pattern is applied to `Inventory`
(`bump = inventory.bump`) and `MintAuthority` (`bump = mint_authority.bump`).

---

## 4. Arithmetic Safety — Overflow Strategy by Context

The program uses two distinct arithmetic strategies, chosen deliberately based on
whether overflow should be an error or clamped silently.

### `saturating_*` — for game stats (u8, 0–100)

```rust
// pet_actions.rs
pet.hunger = pet.hunger.saturating_add(hunger_gain).min(100);
pet.tiredness = pet.tiredness.saturating_sub(tired_loss);
pet.hygiene = pet.hygiene.saturating_add(50).min(100);
```

Stats are gameplay values. Clipping at the boundary (not panicking or erroring)
is the correct behavior — there is no meaningful distinction between "hunger = 99"
and "hunger = 100" from a security standpoint.

### `checked_*` — for counters and financial amounts (u16, u32, u64)

```rust
// inventory.rs — lamport total for a purchase
let total_lamports = effect.price_lamports
    .checked_mul(qty as u64)
    .ok_or(PetError::MathOverflow)?;

// token.rs — claim counters
claim_state.total_claims = claim_state.total_claims
    .checked_add(1)
    .ok_or(PetError::MathOverflow)?;
mint_authority.total_minted = mint_authority.total_minted
    .checked_add(amount)
    .ok_or(PetError::MathOverflow)?;
```

Silent wrapping on a counter or a lamport calculation would be a real exploit:
- `price_lamports * qty` wrapping to a small number would let an attacker buy
  large quantities for near-zero SOL.
- `total_minted` wrapping to zero would hide how much $PETZ has been minted from
  any off-chain auditing tool.
- `total_claims` wrapping allows a single account to claim as if it had never
  claimed before.

### u16 intermediate in `compute_health`

```rust
// helpers.rs
let score = (100u16.saturating_sub(hunger as u16)
    + 100u16.saturating_sub(tiredness as u16)
    + hygiene as u16
    + happiness as u16)
    / 4;
```

The sum of four u8 values can reach 400. A u8 intermediate would overflow at
255. The u16 intermediate holds the full range (max 400) and the division result
(max 100) fits safely back into u8.

### `checked_sub` in `apply_time_decay`

```rust
// helpers.rs
let elapsed_secs = now
    .checked_sub(pet.last_interaction)
    .ok_or(PetError::MathOverflow)?;
```

The i64 subtraction returns `MathOverflow` if `last_interaction` is in the
future (clock manipulation in tests, or a clock sysvar bug). This prevents the
decay function from treating a negative elapsed time as a large positive number.

---

## 5. Deployer Gate on `initialize_mint`

```rust
// token.rs
#[account(mut, constraint = authority.key() == DEPLOYER @ PetError::Unauthorized)]
pub authority: Signer<'info>,
```

```rust
// constants.rs
pub const DEPLOYER: Pubkey = pubkey!("JECoRyH53YqQcACYmB5eQNGqhwdSwRTdyWVD7X4wTEmN");
```

The $PETZ mint can only be initialized by the hard-coded deployer public key.
Without this gate, any wallet could race to call `initialize_mint` first and
become the de-facto mint authority, minting arbitrary $PETZ tokens to themselves.

The `init` constraint on `mint_authority` and `petz_mint` means this can only be
called once (re-initialization is blocked). After the first successful call, no
one — including the deployer — can call `initialize_mint` again.

**Known maintenance risk:** The DEPLOYER constant must be updated before mainnet
deployment if the deployer wallet changes. There is no on-chain mechanism to
rotate it post-deployment; a program upgrade would be required.

---

## 6. PDA as Treasury — No Private Key Attack Surface

```rust
// inventory.rs
/// CHECK: treasury PDA receives SOL; verified by seeds constraint
#[account(mut, seeds = [b"treasury"], bump)]
pub treasury: UncheckedAccount<'info>,
```

The treasury is a PDA with no private key. SOL flows in via
`system_program::transfer` CPI. No wallet can sign on behalf of a PDA, so funds
cannot be extracted by stealing a key. The treasury address is fully determined
by `[b"treasury"]` + program ID — the user does not supply the treasury address,
so they cannot redirect payment to an attacker-controlled account.

The `UncheckedAccount` type is used here because Anchor cannot deserialize a raw
SOL-holding PDA as a typed account. The `seeds` constraint provides the identity
check. The comment on the field documents exactly why this is safe — a pattern
required by `anchor_lint` and expected in audits.

---

## 7. `init_if_needed` Exception — Associated Token Account

```rust
// token.rs
#[account(
    init_if_needed,
    payer = owner,
    associated_token::mint = mint,
    associated_token::authority = owner,
)]
pub user_ata: Account<'info, TokenAccount>,
```

This is the only account in the program that uses `init_if_needed`. It is safe
for a specific structural reason: an Associated Token Account address is
fully determined by `(mint, owner)` via `findAssociatedTokenAddress`. An attacker
cannot substitute a pre-existing account at a different address, because the
constraint itself derives the expected address from the mint and owner in the
same transaction context.

If `init_if_needed` were used on a non-ATA account with user-supplied seeds, an
attacker could pre-create that account with crafted data and the instruction
would skip initialization, leaving the malicious data intact. The ATA derivation
rule eliminates that ambiguity.

---

## 8. `UncheckedAccount` — When and Why

Two accounts in the program use `UncheckedAccount`:

**Treasury (inventory.rs):**
```rust
/// CHECK: treasury PDA receives SOL; verified by seeds constraint
#[account(mut, seeds = [b"treasury"], bump)]
pub treasury: UncheckedAccount<'info>,
```

The seeds constraint provides identity verification. `UncheckedAccount` is used
because this account holds raw lamports, not a typed Anchor struct. The check
comment is the documented justification.

**SlotHashes sysvar (breed.rs):**
```rust
/// CHECK: verified by address constraint against the canonical SlotHashes sysvar id.
#[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
pub slot_hashes: UncheckedAccount<'info>,
```

The `address =` constraint pins this account to the canonical sysvar public key.
No attacker can substitute their own account here — the address is hard-pinned.
`UncheckedAccount` is used because Anchor's sysvar API does not expose
`SlotHashes` as a first-class typed constraint in the version of anchor-lang
used here, so the data is read manually via `try_borrow_data()`.

The rule: `UncheckedAccount` is acceptable when (a) another constraint fully
verifies the account's identity and (b) the field comment explicitly documents
why no deserialization check is needed.

---

## 9. SameParent Guard in Breeding

```rust
// breed.rs
constraint = pet_a.key() != pet_b.key() @ PetError::SameParent,
```

This constraint appears on `pet_a` at the account validation level, before any
handler code runs. If a user passes the same PDA for both parent slots, Anchor
rejects the transaction immediately with `SameParent`.

There is a secondary protection: Anchor's borrow checker would also refuse to
hand out two simultaneous mutable references to the same account. The explicit
constraint is defense-in-depth — it produces a clear, meaningful error code
rather than an opaque borrow error, and it fires even if the accounts are
passed as read-only.

---

## 10. Known Residual Risks

These are documented, accepted risks — not oversights. Each has a code comment
in the relevant file.

**S-01 — u16 truncation in `apply_time_decay` (helpers.rs:35)**

```rust
let hours = (elapsed_secs / 3600) as u16;
```

After 65,535 hours (approximately 2,730 days) without interaction, the cast
wraps to zero. All time-decay deltas become zero. A pet that should be dead
continues to survive. The fix is to use u32 (covers over 4 million days) or
clamp before casting. This is a latent game logic correctness issue, not an
immediate financial exploit, but it could be triggered maliciously by a user who
wants to keep a neglected pet alive indefinitely.

**B-05-R — RNG manipulable via offspring_name enumeration (breed.rs:89-116)**

The `hashv` input includes the `offspring_name`, which is fully attacker-controlled.
An attacker can enumerate candidate offspring names offline (~16 SHA-256
operations on average) to hit any of the 16 possible bit patterns in the RNG
byte, selecting exactly which stats the offspring inherits from which parent.
The SlotHashes input raises the manipulation cost compared to a raw clock-based
approach, but does not eliminate the attack. A commit-reveal scheme is the
production fix (deferred to R8+).

**B-02 — No version constraint on breed parents (breed.rs:12-16)**

The `Pet.version` field is reserved for a future migration (R7). If a future
migration writes `version = 1` and changes the account layout, the `breed`
instruction will load migrated parents without detecting the version mismatch,
potentially reading fields at wrong offsets. The fix is to add
`constraint = pet_a.version == 0` guards when R7 ships.

**B-06 — Localnet SlotHashes fallback uses predictable clock slot (breed.rs:103-107)**

```rust
// fallback when SlotHashes sysvar is too short (localnet edge case)
&Clock::get()?.slot.to_le_bytes()[..]
```

The clock slot is publicly predictable. This path should be removed or
`cfg`-gated before any production deployment.

---

## Summary — Defense Matrix

| Threat | Mechanism | Where |
|---|---|---|
| Unauthorized pet mutation | `has_one = owner` + PDA seed includes owner | `pet_actions.rs`, `inventory.rs`, `breed.rs` |
| Account re-initialization | `init` discriminator check | All account creation instructions |
| Bump substitution | `bump = pet.bump` cached + seeds verification | All `mut` pet accesses |
| Integer overflow in payments | `checked_mul` | `inventory.rs:88` |
| Counter wraparound | `checked_add` on u32/u64 | `token.rs:237,243` |
| Stat overflow in health calc | u16 intermediate | `helpers.rs:13` |
| Mint authority race | `DEPLOYER` pubkey gate | `token.rs:20`, `constants.rs:13` |
| Treasury address substitution | Hard-derived PDA, no user input | `inventory.rs:40-47` |
| ATA substitution | `associated_token` constraints | `token.rs:107-113` |
| Sysvar substitution | `address = slot_hashes::id()` | `breed.rs:63` |
| Self-breeding | `pet_a.key() != pet_b.key()` at account level | `breed.rs:31` |
