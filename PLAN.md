# Pet Tamagotchi — Development Plan

## Context

Repo is empty. `FIRST_INSTRUCTIONS.md` is the spec. Goal: build the full Anchor/Solana pet-care game — smart contract, TypeScript client, integration tests, and docs.

Scope: **backend only** (frontend React UI is post-MVP).

---

## Target Layout

```
pet-tamagotchi/
├── Anchor.toml
├── Cargo.toml                          # workspace
├── package.json
├── tsconfig.json
├── programs/pet-tamagotchi/
│   ├── Cargo.toml
│   ├── Xargo.toml
│   └── src/lib.rs                      # entire smart contract (~500 lines)
├── client/
│   ├── petClient.ts
│   └── example.ts
├── tests/
│   └── pet_tamagotchi.ts
└── migrations/deploy.ts
```

---

## Phase 0 — Scaffold & Toolchain

**Files to create:**
- `Anchor.toml` — points at localnet, declares program ID, wires test script
- `Cargo.toml` — workspace root with `overflow-checks = true` in release profile
- `programs/pet-tamagotchi/Cargo.toml` — crate with `anchor-lang = "0.30.0"`
- `programs/pet-tamagotchi/Xargo.toml`
- `programs/pet-tamagotchi/src/lib.rs` — empty stub with `declare_id!` + `#[program]`
- `package.json` — deps: `@coral-xyz/anchor ^0.30.0`, `chai`, `mocha`, `ts-mocha`, `ts-node`, `typescript`, `solana-bankrun`, `anchor-bankrun`
- `tsconfig.json` — `target: es2020`, `module: commonjs`, strict mode
- `migrations/deploy.ts`

**Done when:** `anchor build` succeeds on stub; `npm install` resolves.

---

## Phase 1 — Account State & Constants

All in `programs/pet-tamagotchi/src/lib.rs`.

### `Pet` account

```rust
#[account]
pub struct Pet {
    pub owner:            Pubkey,   // 32
    pub name:             String,   // 4 + 32 max (32-char limit)
    pub species:          String,   // 4 + 16 max (16-char limit)
    pub birth_date:       i64,      // 8  — metadata only, not used for decay
    pub hunger:           u8,       // 1  — 0=satisfied, 100=starving
    pub tiredness:        u8,       // 1  — 0=rested, 100=exhausted
    pub hygiene:          u8,       // 1  — 0=filthy, 100=pristine
    pub happiness:        u8,       // 1  — 0=miserable, 100=delighted
    pub health:           u8,       // 1  — derived from other four
    pub needs_meal:       bool,     // 1
    pub needs_walk:       bool,     // 1
    pub needs_bath:       bool,     // 1
    pub is_alive:         bool,     // 1
    pub last_interaction: i64,      // 8
    pub bump:             u8,       // 1  — cached PDA bump
}
// Pet::MAX_SIZE = 8 (disc) + 32 + 36 + 20 + 8 + 5×u8 + 4×bool + 8 + 1 = 117
```

### Init stats
```
hunger=30, tiredness=20, hygiene=80, happiness=70
```

### Interaction deltas (all saturating, clamp 0..=100)

| Instruction | Stat changes |
|-------------|-------------|
| feed  | hunger −25, happiness +5 |
| walk  | happiness +15, tired +10, hygiene −5, hunger +5 |
| bathe | hygiene +50 (max 100), happiness +5 |
| sleep | tired −50, hunger +5 |
| play  | happiness +20, tired +10, hunger +5 |

### Time-based decay (applied on each `check_status` call)

| Stat | Rate |
|------|------|
| hunger | +1 per 4 hours elapsed |
| tiredness | −1 per 4 hours elapsed |
| hygiene | −1 per 6 hours elapsed |

### Need flag thresholds
- `needs_meal` → hunger > 70
- `needs_walk` → happiness < 60
- `needs_bath` → hygiene < 40

### Death thresholds
- hunger > 95 **OR** hygiene < 10 **OR** happiness < 5

### Errors
```rust
NameTooLong, NameEmpty, SpeciesTooLong, PetDeceased, MathOverflow, Unauthorized
```

### Events
```rust
PetCreated, PetFed, PetWalked, PetBathed, PetSlept, PetPlayed, StatusChecked
```

**Done when:** `anchor build` clean; `Pet::MAX_SIZE` matches field-by-field byte sum.

---

## Phase 2 — `create_pet` Instruction

**PDA seeds:** `[b"pet", owner.key().as_ref(), name.as_bytes()]`

**Handler:**
1. Validate: name non-empty and ≤32 bytes, species ≤16 bytes
2. Populate Pet with init stats
3. `health = compute_health(hunger, tiredness, hygiene, happiness)` = `((100−hunger) + (100−tiredness) + hygiene + happiness) / 4`
4. `last_interaction = Clock::get()?.unix_timestamp`, `bump = ctx.bumps.pet`
5. Emit `PetCreated`

**Internal helpers:**
- `fn compute_health(hunger, tiredness, hygiene, happiness) -> u8`
- `fn apply_time_decay(pet: &mut Pet, now: i64) -> Result<()>` — checked i64 arithmetic; saturating u8 stat changes
- `fn refresh_needs_and_health(pet: &mut Pet)` — recompute health, need flags, is_alive
- `fn require_alive(pet: &Pet) -> Result<()>`

---

## Phase 3 — Care Instructions (feed / walk / bathe / sleep / play)

**Shared `PetAction` accounts context:**
```rust
#[derive(Accounts)]
#[instruction(name: String)]
pub struct PetAction<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump  = pet.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet.is_alive @ PetError::PetDeceased,
    )]
    pub pet: Account<'info, Pet>,
}
```

**Each handler pattern:**
```
apply_time_decay → stat mutation → refresh_needs_and_health → last_interaction = now → emit event
```

---

## Phase 4 — `check_status` Instruction

Uses same seeds but **no `is_alive` constraint** — detection is the point.

1. If `pet.is_alive`: `apply_time_decay` then `refresh_needs_and_health` (may flip `is_alive = false`)
2. Update `last_interaction`
3. Emit `StatusChecked { health, is_alive }`

After death: care instructions reject with `PetDeceased`; `check_status` still succeeds.

---

## Phase 5 — Security Hardening Pass

- `has_one = owner` + owner in PDA seed = two independent layers
- `checked_*` for i64 time math; `saturating_*` for u8 stats
- `init` (not `init_if_needed`) → no re-init attack
- `bump` cached in account, reused with `bump = pet.bump`
- `birth_date` is metadata only — decay always uses `last_interaction`
- `cargo clippy -- -D warnings` must pass

---

## Phase 6 — TypeScript Client

### `client/petClient.ts` — `PetTamagotchiClient` class

```ts
derivePetPda(owner: PublicKey, name: string): [PublicKey, number]
createPet(name: string, species: string, birthDate?: number): Promise<string>
feedPet(name: string): Promise<string>
walkPet(name: string): Promise<string>
bathePet(name: string): Promise<string>
sleepPet(name: string): Promise<string>
playWithPet(name: string): Promise<string>
checkStatus(name: string): Promise<PetInfo>
getPetInfo(name: string, owner?: PublicKey): Promise<PetInfo>
listPetsByOwner(owner: PublicKey): Promise<PetInfo[]>   // memcmp filter on owner
static formatPetStatus(p: PetInfo): string              // ASCII progress bars
```

PDA derivation: `[Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)]`
IDL from `target/idl/pet_tamagotchi.json`.

### `client/example.ts`

Sequential demo against localnet: create pet → daily routine (feed/walk/play/bathe/sleep) → checkStatus → print formatted status.

---

## Phase 7 — Integration Tests

Use `anchor-bankrun` (time travel via clock warp; no external validator needed).

**10 tests:**

| # | Test | Expected |
|---|------|---------|
| 1 | `createPet` happy path | PDA exists, default stats, `PetCreated` event |
| 2 | `createPet` name too long | `NameTooLong` error |
| 3 | `feed` | hunger −25, happiness +5; `PetFed` event |
| 4 | `walk` | happiness ↑, tired ↑, hygiene ↓, hunger ↑; all clamped 0..100 |
| 5 | `bathe` near 100 hygiene | hygiene saturates at 100 |
| 6 | `sleep` near 0 tiredness | tiredness saturates at 0 |
| 7 | `play` near 100 happiness | happiness saturates at 100 |
| 8 | `checkStatus` + clock warp | time decay applied; stats drop correctly |
| 9 | Death mechanics | warp far future → `check_status` → `is_alive=false`; then `feed` → `PetDeceased` |
| 10 | Unauthorized signer | second keypair tries to feed → `Unauthorized` |

**Helpers:** `expectAnchorError(promise, codeName)`, `derivePet(owner, name)`.

**Done when:** `anchor test` exits 0; all 10 pass.

---

## Phase 8 — Local Deploy & Smoke

```bash
anchor build && anchor keys sync && anchor build
# terminal 1
solana-test-validator -r
# terminal 2
anchor deploy
npx ts-node client/example.ts   # prints real tx signatures + pet status
```

---

## Phase 9 — Docs

| File | Contents |
|------|---------|
| `README.md` | Pitch + install + build + test + deploy |
| `QUICKSTART.md` | 5-min copy-paste walkthrough |
| `ARCHITECTURE.md` | Account diagram, PDA seeds, decay math, stat clamping, security model, instruction table |
| `FEATURES.md` | Roadmap below |

---

## Roadmap (Post-MVP)

| Priority | Feature | Key work |
|----------|---------|---------|
| R1 | Item Shop | `Inventory` PDA, `ItemSlot` enum, `use_item` ix |
| R2 | SPL Token ($PETZ) | Mint authority PDA, `anchor-spl` CPI, `claim_daily_reward` |
| R3 | Web UI | React + Wallet Adapter, reuse `petClient.ts`, event subscriptions |
| R4 | Breeding | `breed` ix, slot-hash RNG, stat inheritance |
| R5 | NFTs | Metaplex CPI on `create_pet`, URI update on life events |
| R6 | Leaderboards | Off-chain indexer (Helius/Geyser) → Postgres + REST |
| R7 | Advanced health | `experience`, `level`, `traits` bitfield, `realloc` migration |

---

## Verification Checklist

```bash
anchor build                     # phases 0–5 — zero warnings/errors
cargo clippy -- -D warnings      # security pass — clean
anchor test                      # phase 7 — 10/10 pass
npx ts-node client/example.ts    # phase 8 — pet status printed with tx signatures
```
