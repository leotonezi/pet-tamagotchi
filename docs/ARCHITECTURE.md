# Architecture

## Account layout

```
Pet account (PDA)
├── owner            Pubkey      32
├── name             String      4 + 32  (max 32 bytes)
├── species          String      4 + 16  (max 16 bytes)
├── birth_date       i64          8      metadata only
├── hunger           u8           1      0=satisfied  100=starving
├── tiredness        u8           1      0=rested     100=exhausted
├── hygiene          u8           1      0=filthy     100=pristine
├── happiness        u8           1      0=miserable  100=delighted
├── health           u8           1      derived stat
├── needs_meal       bool         1
├── needs_walk       bool         1
├── needs_bath       bool         1
├── is_alive         bool         1
├── last_interaction i64          8
└── bump             u8           1
                              ──────
total (+ 8 discriminator)      122 bytes  (MAX_SIZE = 122)
```

## PDA seeds

```
["pet", owner_pubkey (32 bytes), name_bytes]
```

The name is part of the seed, so one wallet can own multiple pets with distinct names. The bump is cached in `pet.bump` and verified on every subsequent instruction (`bump = pet.bump`), which is cheaper and avoids canonical-bump grinding on each call.

## Instructions

| Instruction | Accounts context | Auth check | is_alive required |
|-------------|-----------------|------------|-------------------|
| `create_pet` | `CreatePet` | signer is payer/owner | — |
| `feed` | `PetAction` | `has_one = owner` | yes (constraint) |
| `walk` | `PetAction` | `has_one = owner` | yes |
| `bathe` | `PetAction` | `has_one = owner` | yes |
| `sleep` | `PetAction` | `has_one = owner` | yes |
| `play` | `PetAction` | `has_one = owner` | yes |
| `check_status` | `CheckStatus` | `has_one = owner` | no — detection is the point |

## Stat deltas per instruction

All mutations use saturating arithmetic and clamp to `0..=100`.

| Instruction | hunger | tiredness | hygiene | happiness |
|-------------|--------|-----------|---------|-----------|
| feed        | −25    |           |         | +5        |
| walk        | +5     | +10       | −5      | +15       |
| bathe       |        |           | +50     | +5        |
| sleep       | +5     | −50       |         |           |
| play        | +5     | +10       |         | +20       |

## Time-based decay

Applied lazily in `apply_time_decay` at the start of every instruction, using the delta from `last_interaction` to the current clock timestamp.

| Stat | Direction | Rate |
|------|-----------|------|
| hunger | increases | +1 per 4 hours |
| tiredness | decreases | −1 per 4 hours (natural rest) |
| hygiene | decreases | −1 per 6 hours |

Decay uses checked i64 subtraction for elapsed time (returns `MathOverflow` if the clock goes backwards) and saturating u8 arithmetic for stat updates.

## Health formula

```
health = ((100 − hunger) + (100 − tiredness) + hygiene + happiness) / 4
```

Computed as `u16` intermediate to avoid overflow, then cast to `u8`. Called in `refresh_needs_and_health` after every stat mutation.

## Need flag thresholds

| Flag | Condition |
|------|-----------|
| `needs_meal` | hunger > 70 |
| `needs_walk` | happiness < 60 |
| `needs_bath` | hygiene < 40 |

## Death thresholds

The pet dies (`is_alive = false`) if any of:

- `hunger > 95`
- `hygiene < 10`
- `happiness < 5`

Death is set in `refresh_needs_and_health`, which runs after every interaction and after `check_status`. Care instructions (`PetAction`) reject with `PetDeceased` if `is_alive` is already false. `check_status` has no such constraint and succeeds even after death.

## Initialization stats

```
hunger=30  tiredness=20  hygiene=80  happiness=70
```

`birth_date` is stored as metadata but is never used in decay calculations — decay always runs against `last_interaction`.

## Security model

1. **Owner binding** — `has_one = owner` in account constraints ensures only the wallet recorded in `pet.owner` can sign care instructions.
2. **PDA seed binding** — `owner.key()` is a seed, so the PDA address itself encodes the owner. Two independent checks must both pass.
3. **No re-init** — `init` (not `init_if_needed`) is used, so re-initialization attacks are impossible.
4. **Bump caching** — the canonical bump is stored in `pet.bump` and reused on every subsequent instruction, removing the need to re-derive it and preventing bump-grinding edge cases.
5. **Overflow safety** — `checked_*` for i64 time arithmetic; `saturating_*` for all u8 stat changes; intermediate health computation uses `u16`.

## Error codes

| Code | Meaning |
|------|---------|
| `NameEmpty` | Name string has zero length |
| `NameTooLong` | Name exceeds 32 bytes |
| `SpeciesTooLong` | Species exceeds 16 bytes |
| `PetDeceased` | Care instruction called on dead pet |
| `MathOverflow` | Clock subtraction underflowed |
| `Unauthorized` | Signer is not the recorded owner |

## Events

| Event | Fields |
|-------|--------|
| `PetCreated` | owner, name, species |
| `PetFed` | pet, hunger, happiness |
| `PetWalked` | pet, happiness, tiredness, hygiene, hunger |
| `PetBathed` | pet, hygiene, happiness |
| `PetSlept` | pet, tiredness, hunger |
| `PetPlayed` | pet, happiness, tiredness, hunger |
| `StatusChecked` | pet, health, is_alive |

## TypeScript client

`PetTamagotchiClient` in `client/petClient.ts` wraps the Anchor program. Key methods:

```ts
derivePetPda(owner, name)         // [PublicKey, bump]
createPet(name, species, birthDate?)
feedPet / walkPet / bathePet / sleepPet / playWithPet
checkStatus(name)                 // calls ix + fetches account
getPetInfo(name, owner?)          // fetch only, no ix
listPetsByOwner(owner)            // memcmp filter on owner field (offset 8)
PetTamagotchiClient.formatPetStatus(p)  // ASCII progress bars
```

PDA derivation uses `[Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)]`, matching the on-chain seeds exactly.
