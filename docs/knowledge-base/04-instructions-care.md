# 04 — Care Instructions

> Deep-dive on `create_pet` and the six care instructions. Covers account contexts, Anchor constraints, handler execution order, stat arithmetic, and events. Interview-prep level — explains *why*, not just *what*.

---

## 1. `create_pet` — Account Context

```rust
#[derive(Accounts)]
#[instruction(name: String)]          // (A)
pub struct CreatePet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,         // (B)
    #[account(
        init,                         // (C)
        payer = owner,
        space = Pet::MAX_SIZE,        // (D)
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub pet: Account<'info, Pet>,
    pub system_program: Program<'info, System>,
}
```

**A — `#[instruction(name: String)]`**

Anchor's `#[derive(Accounts)]` macro processes the struct at compile time. When a constraint refers to an instruction argument (`name.as_bytes()` in the seeds), the macro needs to know the argument's type so it can deserialize it from the instruction data before evaluating the constraint. The `#[instruction(...)]` attribute is how you expose those parameters to the constraint system. Without it, the `seeds` expression would not compile — `name` would be out of scope.

The same attribute is used on every context that embeds `name` in the seed path (`PetAction`, `CheckStatus`) for the same reason.

**B — `owner: Signer<'info>` with `mut`**

`Signer` verifies that the account's ed25519 private key signed the transaction. Marking it `mut` is required because `payer = owner` means lamports will be deducted from this account to fund the new PDA. If it were not marked `mut`, Anchor would reject the account before the handler runs.

**C — `init`**

`init` is one of Anchor's most important account constraints. It:
1. Verifies the account does not already exist (discriminator is zero).
2. Invokes the System Program's `create_account` CPI to allocate `space` bytes and transfer `rent_exempt_minimum` lamports from `payer`.
3. Writes Anchor's 8-byte discriminator (`sha256("account:Pet")[..8]`) as the first 8 bytes, binding the account to this program and struct type.

Why **not** `init_if_needed`? That variant skips step 1 — if the account already exists it acts as a no-op on allocation. An attacker who pre-creates an account with crafted data, or who calls `create_pet` a second time, can overwrite a live pet's owner and stats. `init` forces a hard failure if the account exists, making re-initialization attacks impossible. Always prefer `init` for accounts that should be created exactly once.

**D — `space = Pet::MAX_SIZE`**

Anchor uses this number to compute the minimum lamport balance required for rent exemption (2 years of rent). The formula is `rent_per_byte_year * space * 2 * safety_margin`, applied by the runtime. If you undersize `space`, you either get an allocation error or — worse — later writes silently truncate. `Pet::MAX_SIZE` is computed from the sum of all field sizes plus the 8-byte discriminator, with the string fields sized at their maximum byte length (`4 + MAX_NAME_LEN` because Anchor serializes strings as a 4-byte length prefix followed by the UTF-8 bytes).

---

## 2. `create_pet` Handler Flow

```rust
pub(crate) fn handle_create_pet(
    ctx: Context<CreatePet>,
    name: String,
    species: String,
    birth_date: i64,
) -> Result<()> {
    // 1. Validate inputs
    require!(!name.is_empty(), PetError::NameEmpty);
    require!(name.len() <= MAX_NAME_LEN, PetError::NameTooLong);
    require!(!species.is_empty(), PetError::SpeciesTooLong);
    require!(species.len() <= MAX_SPECIES_LEN, PetError::SpeciesTooLong);
    require!(species.is_ascii(), PetError::SpeciesNotAscii);

    // 2. Initial stats (hardcoded balanced values)
    let hunger    = 30u8;   // low hunger = just fed
    let tiredness = 20u8;   // low tiredness = well rested
    let hygiene   = 80u8;   // high hygiene = freshly bathed
    let happiness = 70u8;   // moderate happiness

    // 3. Write fields
    let pet = &mut ctx.accounts.pet;
    pet.owner       = ctx.accounts.owner.key();
    pet.name        = name.clone();
    pet.species     = species.clone();
    pet.birth_date  = birth_date;          // (E)
    pet.hunger      = hunger;
    pet.tiredness   = tiredness;
    pet.hygiene     = hygiene;
    pet.happiness   = happiness;
    pet.health      = compute_health(hunger, tiredness, hygiene, happiness); // (F)
    pet.needs_meal  = hunger > 70;         // false at birth
    pet.needs_walk  = happiness < 60;      // false at birth
    pet.needs_bath  = hygiene < 40;        // false at birth
    pet.is_alive    = true;
    pet.last_interaction = now;
    pet.bump        = ctx.bumps.pet;       // (G)

    emit!(PetCreated { owner: pet.owner, name, species });
    Ok(())
}
```

**E — `birth_date` is metadata only.** The parameter is accepted and stored so the client can display "born on X" in the UI. Time decay is always computed from `last_interaction`, never from `birth_date`. If decay were anchored to `birth_date`, a brand-new pet would immediately accumulate days of penalty whenever the client passed a past timestamp. Separating the two concerns lets `birth_date` be a user-supplied label while `last_interaction` is always set to the trusted on-chain clock.

**F — `compute_health` at creation.** Health is a derived value, not a stored input. Computing it immediately ensures the account is consistent from byte 1 — if a client were to read the account immediately after `create_pet`, they'd see a correct health score rather than a stale zero.

**G — Bump caching.** After `init` derives the canonical bump (the highest value 0–255 that places the PDA off the Ed25519 curve), Anchor exposes it in `ctx.bumps.pet`. Storing it avoids re-grinding on every subsequent instruction. The re-use is validated by writing `bump = pet.bump` in the `PetAction` constraint, which tells Anchor "use this exact byte, don't search." See section 03 for the full bump-caching rationale.

---

## 3. Shared `PetAction` Context

All five mutation instructions (feed, walk, bathe, sleep, play) share one context:

```rust
#[derive(Accounts)]
#[instruction(name: String)]
pub struct PetAction<'info> {
    pub owner: Signer<'info>,              // (H)
    #[account(
        mut,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump = pet.bump,                   // (I)
        has_one = owner @ PetError::Unauthorized,  // (J)
        constraint = pet.is_alive @ PetError::PetDeceased,  // (K)
    )]
    pub pet: Account<'info, Pet>,
}
```

**H — `owner: Signer`** is not `mut` here because no lamport transfers happen in care actions.

**I — `bump = pet.bump`** loads the stored bump from the deserialized account and passes it directly to the PDA re-derivation check. Anchor re-derives the PDA from seeds + program_id + bump and verifies it matches `pet`'s key. If an attacker substitutes a different account, the derived address won't match and the transaction fails before the handler executes.

**J — `has_one = owner`** is Anchor shorthand for `assert_eq!(pet.owner, owner.key())`. It checks the *stored* owner field against the *signer* account key. This is the access-control gate: you cannot call care actions on someone else's pet.

**Double-binding security:** The `has_one = owner` check and the `seeds` derivation using `owner.key()` are two *independent* checks that together are stronger than either alone:

- Seeds-only: prevents substituting a foreign PDA, but a bug that stored the wrong owner field could bypass authorization.
- `has_one`-only: prevents unauthorized calls, but without seeds verification an attacker could construct a PDA with a different owner's key baked into the seeds.

Together, they ensure both the PDA address and the stored owner field are consistent with the transaction signer.

**K — `constraint = pet.is_alive`** runs before the handler. Dead pets are rejected at the constraint layer — no handler code executes, no state is mutated, and the caller gets `PetDeceased` immediately. This is the right place for this check: constraint failures cost minimal compute and the rejection is unambiguous.

---

## 4. Care Handler Pattern

Every care handler follows the same five-step sequence:

```
1. Clock::get()?.unix_timestamp      — read trusted on-chain time
2. apply_time_decay(pet, now)        — lazy decay since last interaction
3. stat mutation (saturating_*)      — apply the action's effect, clamped 0-100
4. refresh_needs_and_health(pet)     — recompute derived fields, possibly kill pet
5. pet.last_interaction = now        — advance the decay baseline
6. emit!(EventName { ... })          — log final stat snapshot
```

**Why `saturating_*` arithmetic?** Stats are `u8` (0–255), but the game domain clamps to 0–100. `saturating_add` and `saturating_sub` on `u8` would clamp at 255/0 rather than 100/0, so most additions also chain `.min(100)`. Subtractions use `saturating_sub` (which stops at 0) without a floor `.max(0)` because that floor is already the saturating behavior. The result: no stat can ever overflow or underflow, and no `checked_*` error is needed — clamping is the *correct* game behavior, not an error condition.

**Why lazy decay?** There is no crank or background process updating pets on a schedule. Decay is computed only when a transaction touches the account. `last_interaction` records when the account was last written; on the next write, `apply_time_decay` computes the elapsed hours and degrades stats proportionally. This design requires zero off-chain infrastructure at the cost of making stat reads slightly stale between interactions.

---

## 5. Stat Deltas per Instruction

| Instruction | hunger | tiredness | hygiene | happiness |
|-------------|--------|-----------|---------|-----------|
| `feed`      | -25    | —         | —       | +5        |
| `walk`      | +5     | +10       | -5      | +15       |
| `bathe`     | —      | —         | +50     | +5        |
| `sleep`     | +5     | -50       | —       | —         |
| `play`      | +5     | +10       | —       | +20       |

All values are clamped to [0, 100] via saturating arithmetic. Note that `hunger` is a penalty stat — high hunger is bad — so `feed` *subtracts* from it. Same convention applies to `tiredness`.

---

## 6. `CheckStatus` — No `is_alive` Constraint

```rust
pub struct CheckStatus<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [...],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
        // intentionally no: constraint = pet.is_alive
    )]
    pub pet: Account<'info, Pet>,
}
```

The handler conditionally applies decay only when the pet is still alive:

```rust
pub(crate) fn handle_check_status(ctx: Context<CheckStatus>, _name: String) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let pet = &mut ctx.accounts.pet;
    if pet.is_alive {
        apply_time_decay(pet, now)?;
        refresh_needs_and_health(pet);
    }
    pet.last_interaction = now;
    emit!(StatusChecked { pet: pet.key(), health: pet.health, is_alive: pet.is_alive });
    Ok(())
}
```

Post-mortem status checks are a valid product requirement — the owner should be able to see their deceased pet's final stats. Blocking `check_status` with an `is_alive` guard would force the frontend to handle a `PetDeceased` error instead of cleanly rendering a dead-pet view. The conditional inside the handler provides the right behavior: alive pets get decayed and refreshed, dead pets return their frozen state unchanged.

---

## 7. The `_name` Parameter in Handlers

```rust
pub(crate) fn handle_feed(ctx: Context<PetAction>, _name: String) -> Result<()> {
```

The `name` parameter is consumed by the `#[instruction(name: String)]` macro to populate `name.as_bytes()` in the seeds constraint. By the time execution reaches the handler body, the Accounts validation has already used `name` to verify and load `pet`. The handler has no further need for the string — it operates on `ctx.accounts.pet` directly. The leading underscore suppresses Rust's unused-variable warning while making the intent explicit: "this parameter exists for the macro, not the handler logic."

---

## 8. Events Reference

| Event | Emitted by | Fields |
|-------|-----------|--------|
| `PetCreated` | `create_pet` | `owner: Pubkey`, `name: String`, `species: String` |
| `PetFed` | `feed` | `pet: Pubkey`, `hunger: u8`, `happiness: u8` |
| `PetWalked` | `walk` | `pet: Pubkey`, `happiness: u8`, `tiredness: u8`, `hygiene: u8`, `hunger: u8` |
| `PetBathed` | `bathe` | `pet: Pubkey`, `hygiene: u8`, `happiness: u8` |
| `PetSlept` | `sleep` | `pet: Pubkey`, `tiredness: u8`, `hunger: u8` |
| `PetPlayed` | `play` | `pet: Pubkey`, `happiness: u8`, `tiredness: u8`, `hunger: u8` |
| `StatusChecked` | `check_status` | `pet: Pubkey`, `health: u8`, `is_alive: bool` |

Events are emitted via `emit!()`, which encodes the struct as a base64 log line prefixed with `Program log: `. The Anchor TypeScript client exposes `program.addEventListener("PetFed", callback)`, which parses these logs using the IDL's event definitions. Events carry the *post-mutation* stat values — always the final state after decay and the action's delta have been applied.

The `PetCreated` event identifies the pet by `owner + name` (no `Pubkey` field) because the PDA address itself can be derived client-side. All care-action events carry `pet: Pubkey` (the PDA address) for direct account lookup without re-deriving.

---

## Interview Flashcards

**Q: Why does `CreatePet` need `system_program`?**
A: The `init` constraint CPIs into the System Program to create the account. Anchor requires any account that will be CPI'd into to be passed explicitly in the context.

**Q: What is the re-initialization attack and how does `init` prevent it?**
A: An attacker creates a PDA account out-of-band (or calls `create_pet` twice) with crafted data — for example, setting `owner` to their own key. `init` checks that the account's discriminator is zero (uninitialized). If it's non-zero, the constraint fails immediately, so the attacker's pre-populated data is never accepted.

**Q: Explain the double-binding pattern on `PetAction`.**
A: `seeds = [b"pet", owner.key().as_ref(), ...]` ensures the PDA was derived using the current signer's key — a substitute PDA derived under a different owner won't match. `has_one = owner` additionally verifies the *stored* `pet.owner` field equals the signer. Both checks must pass independently, eliminating a class of subtle bugs where one check could be satisfied while the other is bypassed.

**Q: Why store `bump` in the account rather than re-deriving it?**
A: Canonical bump derivation (`find_program_address`) iterates from 255 downward until a valid off-curve point is found — potentially 255 iterations. Caching the bump reduces that to a single `create_program_address` call (no search) on every subsequent instruction, saving compute units and eliminating non-determinism.

**Q: Why is `birth_date` stored but never used for decay?**
A: It is metadata for display purposes. Decay is always relative to `last_interaction` (the last on-chain write), not the birth timestamp. Using `birth_date` for decay would penalize pets for historical time even if they were just created, and would be susceptible to client-supplied timestamp manipulation.
