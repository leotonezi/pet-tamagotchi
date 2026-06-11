# Knowledge Base — pet-tamagotchi

Deep-dive reference for every layer of the stack. Written at interview-prep depth: explains WHY, not just WHAT.

---

## Navigation

| # | File | What you'll learn |
|---|------|-------------------|
| 01 | [System Overview](01-system-overview.md) | Full stack, repo layout, end-to-end data flow from wallet click to on-chain write |
| 02 | [Anchor Program Anatomy](02-anchor-program.md) | `declare_id!`, `#[program]`, `#[derive(Accounts)]`, IDL generation, constraint system |
| 03 | [Accounts & PDAs](03-accounts-and-pdas.md) | All account types with byte layouts, PDA seed derivation, bump caching pattern |
| 04 | [Care Instructions](04-instructions-care.md) | `create_pet` + 6 care instructions: account contexts, handler flow, events |
| 05 | [Game Mechanics](05-game-mechanics.md) | Stat model, time decay math, health formula, need flags, death conditions |
| 06 | [Item Shop & Inventory](06-item-shop.md) | `Inventory` PDA, item catalog, SOL CPI transfer, `use_item` effect application |
| 07 | [$PETZ Token & Rewards](07-spl-token-rewards.md) | Mint PDA, ATA, `anchor-spl` CPI `mint_to`, `ClaimState`, reward formula, cooldown |
| 08 | [Breeding System](08-breeding.md) | `breed` ix, SlotHashes sysvar, `hashv` RNG, stat inheritance, species blending |
| 09 | [TypeScript Client](09-typescript-client.md) | `PetTamagotchiClient`, IDL loading, Anchor `Program` API, PDA helpers, BN types |
| 10 | [React Frontend & Wallet](10-react-frontend.md) | Wallet Adapter stack, `BrowserPetClient`, `ClientContext`, hooks, Vite setup |
| 11 | [Security Model](11-security-model.md) | Owner binding layers, arithmetic safety, re-init prevention, known residual risks |
| 12 | [Testing with Bankrun](12-testing-bankrun.md) | `anchor-bankrun`, `setClock` time-warp, `expectAnchorError`, test patterns |

---

## Solana Interview Priority

If short on time, read these first:

1. **[03 — Accounts & PDAs](03-accounts-and-pdas.md)** — PDAs are the foundation of everything on Solana
2. **[11 — Security Model](11-security-model.md)** — every interview asks about owner checks and re-init attacks
3. **[07 — $PETZ Token & Rewards](07-spl-token-rewards.md)** — CPI `mint_to` with PDA signer is a core pattern
4. **[02 — Anchor Program Anatomy](02-anchor-program.md)** — constraint system runs before your code
5. **[12 — Testing with Bankrun](12-testing-bankrun.md)** — `setClock` time-warp is unique Solana knowledge

---

## Key Mental Models

**PDAs**: `hash(seeds + program_id)` lands off Ed25519 curve → no private key → only the program signs.

**Anchor constraints**: `has_one`, `seeds`, `constraint =` all run before the handler body. Security is declarative.

**Arithmetic**: `saturating_*` for u8 game stats (clamping = correct behavior). `checked_*` for i64 time math and u64 token amounts (overflow = error).

**CPI**: `CpiContext::new` for normal calls. `CpiContext::new_with_signer` when a PDA must sign — pass `&[&[&[u8]]]` signer seeds.

**Lazy state**: time decay and health computed only when an instruction touches the account. No crank needed.
