# 07 — SPL Token Rewards ($PETZ)

> Target audience: developer building deep Solana expertise for job interviews and production work.

## Overview

The $PETZ token is a custom SPL token that pets earn for their owners through attentive care. It is implemented as a standard SPL Mint whose **authority is a PDA** — meaning no human holds a private key that can mint tokens arbitrarily. The program itself is the sole minting authority, and minting only happens through the `claim_daily_reward` instruction which enforces all game rules.

Key characteristics:

- **6 decimals** — same as USDC. `10_000_000` raw lamports = `10.0 PETZ`.
- **Earned daily** — one claim per pet per 24 hours (`86_400` seconds).
- **Reward scales with pet health** — base 10 PETZ, up to 25 PETZ for a perfectly cared-for pet.
- **Future use** — Item Shop (R2, deferred) will let owners spend $PETZ on consumables.

Source: `programs/pet-tamagotchi/src/instructions/token.rs`, `src/constants.rs`, `src/state.rs`.

---

## Account Architecture

Three PDAs form the backbone of the token system. Understanding each one is important for interviews because they illustrate different PDA use cases.

### `petz_mint` — seeds `[b"petz_mint"]`

This is the SPL `Mint` account itself, derived as a PDA. This is an unusual pattern worth remembering: instead of creating a regular keypair for the mint (which would require storing that keypair somewhere), the **mint address is fully determined by the program ID**. There is only ever one $PETZ mint, and it lives at a predictable address.

The account constraints at init time:

```rust
#[account(
    init,
    payer = authority,
    seeds = [b"petz_mint"],
    bump,
    mint::decimals = PETZ_DECIMALS,       // 6
    mint::authority = mint_authority,     // PDA, not a keypair
    mint::freeze_authority = mint_authority,
)]
pub petz_mint: Account<'info, Mint>,
```

Because `mint::authority` is set to the `mint_authority` PDA (not a wallet), the only way to mint tokens is through a CPI call signed by that PDA — which only the program can produce.

### `mint_authority` — seeds `[b"mint_authority"]`

This is the program's own authority account. It stores:

| Field | Type | Purpose |
|---|---|---|
| `bump` | `u8` | Cached bump for `mint_authority` PDA — used as signer in CPI |
| `mint_bump` | `u8` | Cached bump for `petz_mint` PDA (S-02 pattern) |
| `mint` | `Pubkey` | The mint address — verified via `has_one` on every claim |
| `total_minted` | `u64` | Global audit counter of all tokens ever minted |

The two cached bumps (`bump` and `mint_bump`) are stored at initialization time and reused on every `claim_daily_reward` call. This is the **S-02 pattern**: caching bumps avoids the runtime cost of re-deriving them on every instruction.

### `claim_state` — seeds `[b"claim_state", owner, pet_name]`

One per (owner, pet) pair. Tracks:

| Field | Type | Purpose |
|---|---|---|
| `owner` | `Pubkey` | Verified via `has_one` — prevents one user touching another's state |
| `pet` | `Pubkey` | The specific pet this state belongs to |
| `last_claim_ts` | `i64` | Unix timestamp of the last successful claim |
| `total_claims` | `u32` | Lifetime claim count (audit trail) |
| `bump` | `u8` | Cached PDA bump |
| `_padding` | `[u8; 7]` | Alignment to 8-byte boundary |

The `claim_state` is namespaced by both owner and pet name, so one owner with multiple pets gets separate ClaimState accounts. This is correct: each pet should track its own cooldown independently.

---

## `initialize_mint` Instruction

```rust
#[account(mut, constraint = authority.key() == DEPLOYER @ PetError::Unauthorized)]
pub authority: Signer<'info>,
```

The **deployer gate** (`constraint = authority.key() == DEPLOYER`) is a hardcoded pubkey check. This prevents an attacker from front-running the deployment transaction and calling `initialize_mint` themselves with a different authority — which would let them mint unlimited tokens. On Solana, any unsigned transaction can be observed in the mempool and replayed by a bot before the original sender's transaction lands.

The handler caches both bumps immediately and sets `total_minted = 0`:

```rust
mint_authority.bump = ctx.bumps.mint_authority;
mint_authority.mint_bump = ctx.bumps.petz_mint;   // S-02: cached for CPI use later
mint_authority.mint = ctx.accounts.petz_mint.key();
mint_authority.total_minted = 0;
```

---

## `init_claim_state(pet_name)` Instruction

Creates the per-pet claim tracker. The critical initialization detail is `last_claim_ts = 0`:

```rust
claim_state.last_claim_ts = 0;  // Unix epoch — intentional
```

This means `now - 0` is always much larger than `86_400`, so the **first claim is immediately eligible** without any waiting period. If this were set to `now` (current timestamp), the user would be forced to wait 24 hours after account creation before their first claim — a poor user experience with no security benefit.

The `has_one = owner` constraint and `pet` pubkey storage mean the ClaimState is cryptographically bound to a specific pet and owner. Even if someone tried to reuse a ClaimState for a different pet, the `constraint = claim_state.pet == pet.key()` check in `claim_daily_reward` would reject it.

---

## `claim_daily_reward(pet_name)` — Full Instruction Flow

This instruction is the most complex in the token module. The full flow:

### Step 1: Cooldown Check

```rust
let elapsed = now
    .checked_sub(claim_state.last_claim_ts)
    .ok_or(PetError::MathOverflow)?;
require!(elapsed >= DAILY_CLAIM_COOLDOWN_SECS, PetError::ClaimCooldownActive);
```

`checked_sub` is used — not regular subtraction — because if the system clock somehow ran backward (malicious validator behavior or clock drift correction), naive subtraction would underflow a `i64` and produce a huge positive number, bypassing the cooldown. The `checked_sub` returns `None` on underflow, which is surfaced as `MathOverflow`.

### Step 2: Liveness Check

```rust
constraint = pet.is_alive @ PetError::PetDeceased,
```

This is enforced in the `Accounts` struct, not in the handler body. Anchor validates all constraints before the handler runs. A dead pet earns nothing.

### Step 3: Reward Computation

```rust
// constants: BASE_REWARD=10_000_000, all bonuses=5_000_000, MAX=25_000_000
let happiness_bonus = if pet.happiness >= 80 { HAPPINESS_BONUS } else { 0u64 };
let health_bonus    = if pet.health    >= 80 { HEALTH_BONUS    } else { 0u64 };
let perfect_care_bonus = if pet.hunger <= 20 && pet.hygiene >= 80 {
    PERFECT_CARE_BONUS
} else { 0u64 };

let amount = BASE_REWARD
    .saturating_add(happiness_bonus)
    .saturating_add(health_bonus)
    .saturating_add(perfect_care_bonus)
    .min(MAX_REWARD_PER_CLAIM);
```

`saturating_add` is used for intermediate sums because overflow before the `.min()` cap would silently drop to a lower value — which is acceptable here since the cap does the real limiting. The `.min(25_000_000)` ensures the cap is always respected even if new bonus types are added in the future.

Reward breakdown:

| Condition | Bonus |
|---|---|
| Always | 10.0 PETZ |
| `happiness >= 80` | +5.0 PETZ |
| `health >= 80` | +5.0 PETZ |
| `hunger <= 20` AND `hygiene >= 80` | +5.0 PETZ |
| **Maximum** | **25.0 PETZ** |

### Step 4: CPI `mint_to` with PDA Signer

This is the most interview-relevant part of the entire file.

```rust
let mint_authority_bump = ctx.accounts.mint_authority.bump;
let signer_seeds: &[&[&[u8]]] = &[&[b"mint_authority", &[mint_authority_bump]]];

token::mint_to(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint:      ctx.accounts.mint.to_account_info(),
            to:        ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        },
        signer_seeds,
    ),
    amount,
)?;
```

**Why `new_with_signer` and not `new`?** The SPL Token program requires the mint authority to sign the `MintTo` instruction. The `mint_authority` account is a PDA — it has no private key. PDAs sign by having the calling program pass `signer_seeds` to the runtime. The runtime re-derives the PDA address from those seeds and the program ID, verifies it matches the account passed as `authority`, and treats the account as a signer for the duration of that CPI call.

**The three levels of references in `signer_seeds`:**

```
&[                    // outer: list of signers
    &[                // middle: this signer's seeds
        b"mint_authority",
        &[mint_authority_bump],
    ]
]
```

- Outer `&[...]` — the list of PDAs that will sign. You can pass multiple PDAs here if a CPI requires multiple signers.
- Middle `&[...]` — all seeds for one specific PDA, in the same order they were used at creation.
- Inner elements — each individual seed as a byte slice (`&[u8]`). The bump is passed as `&[bump]` (a single-element slice) because it must be a `&[u8]`.

If the bump or seeds are wrong, the runtime will re-derive a different address and the CPI will fail with "not a signer" — not a panic or silent bug.

### Step 5: State Updates

```rust
claim_state.last_claim_ts = now;
claim_state.total_claims = claim_state.total_claims
    .checked_add(1)
    .ok_or(PetError::MathOverflow)?;

mint_authority.total_minted = mint_authority.total_minted
    .checked_add(amount)
    .ok_or(PetError::MathOverflow)?;
```

`checked_add` (not `saturating_add`) is used here because these are **audit counters**. If they overflow, the right behavior is to halt with an error, not silently wrap or saturate. The distinction between `saturating_add` (for intermediate bonus math with a cap) and `checked_add` (for counters that must never wrap) is a common interview topic.

---

## ATA (Associated Token Account)

The `user_ata` is declared with `init_if_needed`:

```rust
#[account(
    init_if_needed,
    payer = owner,
    associated_token::mint = mint,
    associated_token::authority = owner,
)]
pub user_ata: Account<'info, TokenAccount>,
```

`init_if_needed` is safe here because ATA addresses are deterministic: `ATA(mint, owner)` always maps to exactly one address. An attacker cannot provide a substitute account at a different address because Anchor validates the ATA derivation constraints (`associated_token::mint` and `associated_token::authority`) before accepting the account. The feature requires `anchor-lang` to be compiled with `features = ["init-if-needed"]` (see `Cargo.toml`).

On the client side, the ATA address is computed without a network call:

```typescript
// client/petClient.ts
getUserPetzAta(owner: PublicKey): PublicKey {
    const [mintPda] = this.derivePetzMintPda();
    return getAssociatedTokenAddressSync(mintPda, owner, false,
        TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

async getPetzBalance(owner: PublicKey): Promise<number> {
    const ata = this.getUserPetzAta(owner);
    const tokenAccount = await getAccount(this.provider.connection, ata, "confirmed", TOKEN_PROGRAM_ID);
    return Number(tokenAccount.amount) / 1_000_000;  // 6 decimals
}
```

---

## The `anchor-spl` Crate

`anchor-spl = { version = "0.31.0", features = ["token", "associated_token"] }` (Cargo.toml) provides:

| Type / function | What it replaces |
|---|---|
| `Token` | Raw program account for SPL Token program |
| `Mint` | Typed wrapper for SPL Mint accounts |
| `TokenAccount` | Typed wrapper for SPL token accounts (ATAs) |
| `AssociatedToken` | Raw program account for Associated Token program |
| `token::mint_to()` | Hand-written `invoke_signed` with raw account infos |
| `MintTo { ... }` | Manual construction of the CPI accounts struct |

Without `anchor-spl`, every SPL token CPI call requires manually constructing `AccountMeta` arrays, calling `invoke_signed`, and casting raw `AccountInfo` bytes. The crate eliminates this boilerplate while keeping the same underlying behavior.

---

## Security Properties Worth Knowing

| Property | Mechanism |
|---|---|
| Only deployer can init mint | `constraint = authority.key() == DEPLOYER` hardcoded pubkey |
| Tokens can only be minted by this program | Mint authority is a PDA — no private key exists |
| One claim per 24h per pet | `checked_sub` elapsed check + `last_claim_ts` update |
| Dead pets cannot earn | `constraint = pet.is_alive` in Accounts struct |
| ClaimState cannot be shared across pets | `constraint = claim_state.pet == pet.key()` cross-link check |
| Counters never silently wrap | `checked_add` on `total_claims` and `total_minted` |
| No 24h wait on first claim | `last_claim_ts = 0` at init — intentional, documented |

---

## Common Interview Questions

**Q: How does a PDA "sign" a CPI if it has no private key?**

A: It doesn't sign cryptographically. Instead, the calling program passes `signer_seeds` to `CpiContext::new_with_signer`. The Solana runtime verifies that the seeds + program ID re-derive to the same address as the account marked as signer, and then grants that account signer privilege for the duration of the CPI. This is called "PDA signing" but it is really the runtime vouching for the account on behalf of the program.

**Q: When is `init_if_needed` safe to use?**

A: When the account address is fully determined by constraints Anchor validates (like an ATA), so a caller cannot substitute a different pre-existing account. It is dangerous when the address is user-supplied with no derivation check, because an attacker could pass a previously drained account and the instruction would skip re-initialization.

**Q: Why store the bump in the account instead of passing it as an argument?**

A: Passing bumps as instruction arguments requires the client to know the correct bump, which is a footgun. Storing it on-chain at `init` time means the program always uses the canonical bump, and the client never needs to compute it. This also eliminates a class of attacks where a caller passes a different bump to derive a different (attacker-controlled) address.

**Q: What is the difference between `saturating_add` and `checked_add`?**

A: `saturating_add` clamps at the type max without erroring — appropriate for intermediate math that has a `.min()` cap applied afterward. `checked_add` returns `None` on overflow — appropriate for counters and balances where overflow is always a bug that must surface as an error, not be silently ignored.
