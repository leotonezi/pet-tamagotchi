# 02 — Anchor Program Deep Dive

Target audience: developer preparing for Solana interviews or production work.
Codebase: `programs/pet-tamagotchi/src/`

---

## 1. What Anchor Is and Why We Use It

Raw Solana programs are written against the `solana_program` crate. You get a single
entrypoint — `process_instruction(program_id, accounts, instruction_data)` — and you
implement everything yourself: deserializing the instruction discriminator, iterating
the account slice, checking owner/signer/writable flags, computing expected PDA
addresses, initializing account data. It is verbose and error-prone.

Anchor wraps all of that behind proc-macros. The macros:

- **generate the entrypoint** and route transactions to handler functions by name
- **generate account validation code** that runs before your handler body
- **generate the IDL** (a JSON description of every instruction and account type)
- **enforce security invariants** (owner checks, signer checks, discriminator checks)
  that raw programs must write by hand

The cost is macro compile-time overhead and a small runtime dependency (`anchor-lang`).
For almost every production program the trade-off is worth it: the macros eliminate
entire bug categories (missing signer check, wrong account owner, etc.).

This project uses **anchor-lang 0.31.0** (`Cargo.toml` line 20).

---

## 2. `declare_id!`

```rust
// lib.rs:4
declare_id!("CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC");
```

This macro does two things:

1. **Embeds the program ID as a compile-time constant** (`ID: Pubkey`) inside the
   crate, so other parts of the code can reference `crate::ID` without hard-coding
   a string.
2. **Enables a runtime check**: Anchor's generated entrypoint verifies that the
   `program_id` argument passed in by the Solana runtime matches this declared value.
   If they differ, the transaction is rejected before any handler code runs.

**Where the ID comes from.** Running `anchor build` for the first time generates a
keypair under `target/deploy/pet_tamagotchi-keypair.json`. The public key of that
keypair becomes the program ID. `Anchor.toml` records it:

```toml
# Anchor.toml:9
[programs.localnet]
pet_tamagotchi = "CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC"
```

When you `anchor deploy`, the Solana runtime assigns the program to that address.
Subsequent builds must reproduce the same keypair (or update both `declare_id!` and
`Anchor.toml` together). Mismatching them causes the runtime check to fire and every
transaction to fail.

---

## 3. `#[program]` — Entrypoint and Dispatch

```rust
// lib.rs:47-116
#[program]
pub mod pet_tamagotchi {
    use super::*;

    pub fn create_pet(ctx: Context<CreatePet>, name: String, species: String, birth_date: i64) -> Result<()> {
        instructions::create_pet::handle_create_pet(ctx, name, species, birth_date)
    }

    pub fn breed(ctx: Context<Breed>, name_a: String, name_b: String, offspring_name: String) -> Result<()> {
        instructions::breed::handle_breed(ctx, name_a, name_b, offspring_name)
    }
    // ... every other instruction
}
```

The `#[program]` macro generates:

- A BPF-compatible `entrypoint!` that receives raw `(program_id, accounts, data)`.
- A dispatcher that reads the first 8 bytes of `data` as a **discriminator** — a
  hash of the instruction name — and calls the matching function.
- Deserialization of the remaining bytes into the typed arguments (`name`, `species`,
  `birth_date`, etc.) using Borsh.
- Construction of the `Context<T>` value, which wraps the validated accounts struct
  and the `bumps` map.

Every public function in the module becomes one on-chain instruction. The function
signature (`ctx: Context<T>, ...args`) is the source of truth for what the IDL
exposes.

---

## 4. `#[derive(Accounts)]` — Account Validation Before Handler

```rust
// create_pet.rs:10-24
#[derive(Accounts)]
#[instruction(name: String)]         // makes `name` available to constraint expressions
pub struct CreatePet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Pet::MAX_SIZE,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub pet: Account<'info, Pet>,

    pub system_program: Program<'info, System>,
}
```

`#[derive(Accounts)]` generates an implementation of `anchor_lang::Accounts` for the
struct. That implementation:

1. Iterates the incoming account slice and maps each positional account to the named
   field.
2. Evaluates every constraint attribute in declaration order.
3. Returns an error if any constraint fails — **the handler body never executes**.

This is the core Anchor security model: constraints are a gate, not hints.

---

## 5. Constraint Attributes — Each One Explained

### `init`

Allocates a new account on-chain. Anchor calls `system_program::create_account` via
CPI, then writes the 8-byte discriminator and zeroes the rest. Fails if the account
already exists (the runtime returns "account already in use"), which blocks
re-initialization attacks. Used for `pet`, `offspring`, `mint_authority`, `claim_state`.

### `mut`

Marks the account writable in the account-meta list. Anchor checks that the runtime
actually passed it as writable; if not, the tx fails. Required any time you modify
account data or lamports.

### `seeds` + `bump`

```rust
seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
bump,
```

Anchor derives the expected PDA from the provided seeds and the program ID, then
verifies the account passed in by the client matches that address. `bump` (without a
value) tells Anchor to find and store the canonical bump in `ctx.bumps.pet`. With
`bump = pet.bump` (a stored value), Anchor skips the derivation loop and verifies
directly — cheaper and preferred after the first init.

### `has_one`

```rust
// breed.rs:29
has_one = owner @ PetError::Unauthorized,
```

Shorthand for `constraint = pet_a.owner == owner.key()`. Anchor reads the named field
from the account data and checks it equals the key of the field with the same name in
the accounts struct. Used everywhere a stored Pubkey must match a signer to prevent
one user operating another user's account.

### `constraint =`

Arbitrary boolean expression evaluated at validation time:

```rust
// breed.rs:31
constraint = pet_a.key() != pet_b.key() @ PetError::SameParent,
constraint = pet_a.is_alive @ PetError::PetDeceased,
```

The `@ ErrorVariant` suffix sets the error returned on failure. Without it, Anchor
returns a generic constraint error with no context — always include the `@` suffix in
production code.

### `payer`

```rust
payer = owner,
```

Specifies which account's lamports pay for the rent-exempt balance of a new account.
Only valid alongside `init`. The payer must be a `mut` signer.

### `space`

```rust
space = Pet::MAX_SIZE,
```

Number of bytes to allocate. Anchor adds 8 bytes for the discriminator automatically
on top of this value — `Pet::MAX_SIZE` is computed without the discriminator:

```rust
// state.rs:28
pub const MAX_SIZE: usize = 8 + 32 + (4 + MAX_NAME_LEN) + (4 + MAX_SPECIES_LEN) + 8 + 5 + 4 + 8 + 1 + 1;
//                          ^disc  ^owner  ^name String      ^species String        ^birth ^stats ^bools ^ts ^bump+ver
```

Under-allocating `space` causes the program to panic when writing account data.
Over-allocating wastes SOL in rent.

### `init_if_needed`

```rust
// token.rs:107-113
#[account(
    init_if_needed,
    payer = owner,
    associated_token::mint = mint,
    associated_token::authority = owner,
)]
pub user_ata: Account<'info, TokenAccount>,
```

Initializes the account only if it does not yet exist; if it already exists, loads it
as normal. Used for Associated Token Accounts because users may already hold PETZ
tokens. This constraint requires the `init-if-needed` feature flag in `Cargo.toml`:

```toml
# Cargo.toml:20
anchor-lang = { version = "0.31.0", features = ["init-if-needed"] }
```

The feature is gated deliberately — `init_if_needed` can be dangerous if the
discriminator is not checked on load. For ATAs it is safe because the ATA address is
fully determined by `(mint, owner)`, preventing substitution.

---

## 6. The Module Split: Why `lib.rs` Delegates to `instructions/`

`lib.rs` contains only the `#[program]` dispatch module plus re-exports. Every
handler lives in a dedicated file under `instructions/`:

```
instructions/
  mod.rs          — declares submodules, re-exports Breed (only one with wildcard)
  breed.rs        — Breed accounts struct + handle_breed
  create_pet.rs   — CreatePet accounts struct + handle_create_pet
  inventory.rs    — BuyItem, InitInventory, UseItem + handlers
  pet_actions.rs  — PetAction, CheckStatus + handlers
  token.rs        — InitializeMint, InitClaimState, ClaimDailyReward + handlers
```

**Why this split.** `lib.rs` must remain the `#[program]` entry point (the macro
generates the entrypoint there), but nothing forces the handler logic to live there.
Keeping everything in one file causes merge conflicts and hard-to-navigate diffs.
Delegating to `instructions/` means each instruction is independently reviewable.
Handlers are `pub(crate)` — visible to `lib.rs` but not to downstream crates — which
prevents the internal API from being treated as a stable surface.

---

## 7. The `pub(crate) use instructions::breed::__client_accounts_breed` Pattern

```rust
// lib.rs:30-45
pub(crate) use instructions::breed::__client_accounts_breed;
pub(crate) use instructions::create_pet::__client_accounts_create_pet;
// ... one per instruction
```

When `#[derive(Accounts)]` processes a struct in a submodule, it generates a
`__client_accounts_<name>` module inside that submodule. The `#[program]` macro, which
runs in `lib.rs`, emits code that references `crate::__client_accounts_breed` — at the
crate root, not at `crate::instructions::breed::__client_accounts_breed`. Without the
`pub(crate) use` re-exports, the `#[program]` macro's generated code would not compile
because the path it expects does not exist.

This is an Anchor implementation detail, not application logic. Every project that
splits instructions into submodules needs these re-exports.

---

## 8. IDL Generation

Running `anchor build` produces:

- `target/idl/pet_tamagotchi.json` — machine-readable description of every
  instruction (name, arguments, account list, discriminator) and every account type
  (name, field names, field types).
- `target/types/pet_tamagotchi.ts` — TypeScript types derived from the IDL, consumed
  by the Anchor TS client.

The IDL is the **contract between on-chain and off-chain code**. A TypeScript client
constructs transactions by calling:

```ts
await program.methods.createPet(name, species, birthDate)
  .accounts({ owner, pet, systemProgram })
  .rpc();
```

The Anchor TS library reads the IDL to know the discriminator bytes, the Borsh
serialization of arguments, and the expected account order. If the IDL is stale (i.e.,
you changed the program but did not rebuild), the client sends incorrectly-shaped
transactions that the on-chain program rejects.

The IDL file should always be committed alongside the program source so reviewers can
see the public interface without running a build.

---

## 9. `#[instruction(...)]` — Making Instruction Arguments Available to Seeds

```rust
// create_pet.rs:11
#[instruction(name: String)]
pub struct CreatePet<'info> { ... }
```

Account constraint expressions are evaluated before the handler body, so instruction
arguments are not yet in scope as Rust variables. `#[instruction(name: String)]`
tells Anchor to deserialize the `name` argument from the transaction data before
evaluating constraints, making it available in seed expressions:

```rust
seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
```

Without `#[instruction(name: String)]`, referencing `name` in a seed would be a
compile error. Only list the arguments you actually need in constraint expressions —
in `breed.rs` all three argument names appear because `name_a`, `name_b`, and
`offspring_name` each seed a different PDA:

```rust
// breed.rs:19
#[instruction(name_a: String, name_b: String, offspring_name: String)]
```

---

## Interview Checklist

| Question | Where to look |
|---|---|
| How does Anchor route a transaction to the right handler? | Discriminator in `#[program]`, first 8 bytes of instruction data |
| What happens if you pass the wrong account to a PDA seed? | `seeds` constraint rejects it before handler runs |
| Why is `init` safer than `init_if_needed`? | `init` rejects existing accounts; `init_if_needed` must be combined with discriminator check |
| Where does the program ID come from? | Keypair at `target/deploy/pet_tamagotchi-keypair.json`, recorded in `Anchor.toml` |
| What is the discriminator? | First 8 bytes of the sha256 of `"global:<instruction_name>"` |
| Why re-export `__client_accounts_*` at crate root? | `#[program]` macro generates `crate::__client_accounts_<name>` references |
| What is `bump` stored in account data for? | Avoids re-deriving the canonical bump on every subsequent instruction — cheaper CPI signing |
