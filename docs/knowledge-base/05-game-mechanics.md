# 05 — Game Mechanics: Stats, Decay, Health, and Death

Target audience: developer building deep Solana/Anchor expertise for interviews and production work.

---

## The Four Core Stats

Every `Pet` account stores four `u8` fields whose valid range is `0..=100`. All mutations use saturating arithmetic so the values can never overflow their semantic bounds.

| Field | 0 means | 100 means | Mutated by |
|---|---|---|---|
| `hunger` | satisfied | starving | feed (−25), walk (+5), play (+5), sleep (+5), decay (+1/4 h) |
| `tiredness` | rested | exhausted | sleep (−50), walk (+10), play (+10), decay (−1/4 h) |
| `hygiene` | filthy | pristine | bathe (+50), walk (−5), decay (−1/6 h) |
| `happiness` | miserable | delighted | play (+20), walk (+15), feed (+5), bathe (+5) |
| `health` | — | — | derived, never directly set |

`health` is a stored field but it is computed and overwritten in `refresh_needs_and_health` after every stat mutation — it is never written independently.

---

## Initialization Values

```
hunger=30  tiredness=20  hygiene=80  happiness=70
```

The pet starts in a slightly hungry but otherwise healthy state. This is intentional game design: the opening state gives the player something to do immediately (feed the pet) without creating an emergency. The asymmetry between tiredness (20, well-rested) and hunger (30, beginning to want food) mimics waking up in the morning.

`birth_date` is stored as metadata but plays no role in decay. All time-based calculations use `last_interaction`, which is set at the end of every instruction (including `check_status`).

---

## Lazy Time-Based Decay

The program has no keeper bot, cron job, or off-chain cranker. Instead, time decay is applied lazily at the **start** of every instruction call, immediately after reading the clock:

```rust
pub fn apply_time_decay(pet: &mut Pet, now: i64) -> Result<()> {
    let elapsed_secs = now
        .checked_sub(pet.last_interaction)
        .ok_or(PetError::MathOverflow)?;

    if elapsed_secs <= 0 {
        return Ok(());
    }

    // SECURITY [S-01 P2]: truncation bug if elapsed > 65535 hours (~2730 days).
    // At multiples of 65536h the cast wraps to 0, zeroing all decay deltas.
    let hours = (elapsed_secs / 3600) as u16;

    let hunger_gain  = (hours / 4).min(100) as u8;
    let tired_loss   = (hours / 4).min(100) as u8;
    let hygiene_loss = (hours / 6).min(100) as u8;

    pet.hunger    = pet.hunger.saturating_add(hunger_gain).min(100);
    pet.tiredness = pet.tiredness.saturating_sub(tired_loss);
    pet.hygiene   = pet.hygiene.saturating_sub(hygiene_loss);

    Ok(())
}
```

**Why `checked_sub` on the i64 timestamp?** Solana's `Clock` sysvar is trusted, but a paranoid guard against validator clock skew or test harness bugs is cheap. If `now < last_interaction` the subtraction would underflow on an i64 cast, producing a nonsensically large elapsed time and corrupting all stats. `checked_sub` returns `None` in that case, which maps to `MathOverflow` and aborts the transaction.

**Why `saturating_*` on u8 stats?** Saturating is the correct game semantic: if the pet is at hunger=100 and decay tries to add more, capping at 100 is exactly the desired behavior. A `checked_add` returning an error would be wrong — the pet is already starving, and that should trigger death, not an error code.

**Decay rates:**
- Hunger: +1 per 4 hours — getting hungry is the primary pressure
- Tiredness: -1 per 4 hours — rest naturally while idle (tiredness decreases without sleep)
- Hygiene: -1 per 6 hours — slower drift, bath needed less often

**Known issue S-01 (P2, deferred):** `(elapsed_secs / 3600) as u16` silently truncates if elapsed time exceeds 65535 hours (~2730 days). At exact multiples of 65536 hours, the cast wraps to 0 and all decay deltas become 0, making a neglected pet immune to further stat degradation. The fix is to use `u32` for `hours` (covers ~4 million days) or clamp before casting.

---

## Health Formula

`health` is a derived u8 computed after every interaction:

```rust
pub fn compute_health(hunger: u8, tiredness: u8, hygiene: u8, happiness: u8) -> u8 {
    let score = (100u16.saturating_sub(hunger as u16)
        + 100u16.saturating_sub(tiredness as u16)
        + hygiene as u16
        + happiness as u16)
        / 4;
    score as u8
}
```

Written out as math:

```
health = ((100 - hunger) + (100 - tiredness) + hygiene + happiness) / 4
```

**Why the inversion?** Hunger and tiredness are "bad when high" stats. The formula normalizes all four inputs into the same polarity (higher = better contribution), then averages them. When hunger=100 the first term contributes 0; when hunger=0 it contributes 100 — the full weight.

**Why `u16` intermediate?** Each of the four terms can be at most 100. The sum can reach 400. A `u8` intermediate would overflow before the division. The cast to `u16` before any addition prevents this. The final result fits in a `u8` because division by 4 guarantees it is at most 100.

**Interview insight:** This is the classic "widening-then-narrowing" pattern. In Anchor/Rust you do the widening explicitly because the type system forces it. In Solidity you would use `uint16` for the same reason — overflow in Solidity pre-0.8 would wrap silently; Anchor's saturating arithmetic is explicit.

---

## Need Flags

`refresh_needs_and_health` sets three boolean flags after recomputing health:

```rust
pub fn refresh_needs_and_health(pet: &mut Pet) {
    pet.health     = compute_health(pet.hunger, pet.tiredness, pet.hygiene, pet.happiness);
    pet.needs_meal = pet.hunger > 70;
    pet.needs_walk = pet.happiness < 60;
    pet.needs_bath = pet.hygiene < 40;

    if pet.hunger > 95 || pet.hygiene < 10 || pet.happiness < 5 {
        pet.is_alive = false;
    }
}
```

The thresholds:
- `needs_meal`: hunger > 70 — the pet is noticeably hungry but not yet in danger
- `needs_walk`: happiness < 60 — below the midpoint, the pet is sad
- `needs_bath`: hygiene < 40 — well below midpoint, starting to smell

These flags are stored on-chain so a UI or indexer can display status badges without recomputing thresholds off-chain. They are always in sync with the raw stats because `refresh_needs_and_health` is a single function called as the final step after every mutation.

---

## Death Conditions

Any one of the following permanently kills the pet:

| Condition | Threshold |
|---|---|
| Starvation | hunger > 95 |
| Disease | hygiene < 10 |
| Depression | happiness < 5 |

`is_alive = false` is a write with no corresponding "revive" path — there is no instruction to set it back to `true`. Once set, it is permanent.

The `PetAction` context enforces the liveness constraint at the account validation layer:

```rust
constraint = pet.is_alive @ PetError::PetDeceased,
```

This runs before the handler body. A dead pet's `feed`, `walk`, `bathe`, `sleep`, and `play` instructions all abort at the account constraint stage with `PetDeceased`, not inside the handler.

`check_status` uses the `CheckStatus` context instead, which has no `is_alive` constraint. The handler skips decay and refresh on a dead pet (there is nothing to update) but still emits a `StatusChecked` event with `is_alive: false` and updates `last_interaction`. This is intentional: observing a dead pet should always succeed.

---

## `apply_stat_delta` — The Item Helper

Basic care instructions use hardcoded saturating arithmetic. The `use_item` instruction needs signed deltas because items can reduce stats (e.g., an apple reduces hunger). A shared helper handles the signed-to-unsigned promotion:

```rust
pub fn apply_stat_delta(stat: u8, delta: i16) -> u8 {
    let result = (stat as i16).saturating_add(delta);
    result.clamp(0, 100) as u8
}
```

Why `i16` and not `i8`? An `i8` delta would cap at ±127, which is fine for most items but could be limiting if a future item has a large single-direction effect. Using `i16` widens the range while still fitting comfortably in a stack word. The `saturating_add` on `i16` prevents signed overflow during the intermediate arithmetic; the `clamp(0, 100)` enforces game bounds before casting back to `u8`.

The item catalog uses this helper:

```rust
pub struct ItemEffect {
    pub hunger_delta:    i16,
    pub hygiene_delta:   i16,
    pub happiness_delta: i16,
    pub tiredness_delta: i16,
    pub price_lamports:  u64,
}
```

Items: Apple (hunger −30, happiness +5), Soap (hygiene +60), Toy (happiness +30, tiredness +10), Pillow (tiredness −60, hunger +5). All priced at 10,000,000 lamports (0.01 SOL).

---

## The Instruction Execution Order

Every care instruction follows the same four-step pattern:

1. Read clock: `let now = Clock::get()?.unix_timestamp`
2. Apply time decay: `apply_time_decay(pet, now)?`
3. Apply instruction-specific stat deltas (saturating arithmetic)
4. Recompute derived state: `refresh_needs_and_health(pet)`
5. Commit timestamp: `pet.last_interaction = now`

Step 5 is deliberately last. If `refresh_needs_and_health` causes death (step 4), the timestamp is still committed — dead pets still have a valid `last_interaction`. This matters for `check_status`, which uses the timestamp to avoid reapplying decay on a dead pet.

**Back-to-back instruction quirk:** Two instructions in the same transaction both call `apply_time_decay(pet, now)` with the same clock value (Solana clock is per-slot, not per-instruction). The first instruction applies decay for elapsed time since `last_interaction`. The second instruction sets `now` against the updated `last_interaction = now` written by the first, so `elapsed_secs = 0` and no additional decay is applied. This is a documented design quirk: batching two care actions in one transaction incurs decay only once. It is not a security issue — the player gets a small optimization, not an unfair stat bypass.

---

## Key Interview Takeaways

- **Lazy state**: No keeper required. On-chain state is always valid as of the last interaction. Apply-on-read is a common Solana pattern for time-based mechanics.
- **Saturating vs checked arithmetic**: Use `saturating_*` when the boundary is a valid game state (clamping), `checked_*` when the boundary represents an error (clock underflow).
- **u16 intermediate for sum-of-u8**: Any time you sum more than two `u8` values, widen first.
- **Constraint-layer vs handler-layer guards**: `is_alive` is enforced in account constraints for care instructions — the handler never runs at all for a dead pet. `check_status` intentionally omits the constraint.
- **Single source of truth**: `refresh_needs_and_health` is the only place health, need flags, and death are written. Calling it after every mutation prevents stale derived state.
