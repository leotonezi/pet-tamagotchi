# Features & Roadmap

## Shipped (MVP)

- `create_pet` — initialize a PDA-bound pet with name, species, and birth date
- `feed` / `walk` / `bathe` / `sleep` / `play` — care instructions with stat deltas
- `check_status` — lazy time-decay application and health recompute; works post-mortem
- Time-based stat decay applied on every instruction (hunger, hygiene, tiredness)
- Death mechanics: three independent death conditions; dead pets emit status but reject care
- PDA security: owner binding in both account constraint and seed; bump caching
- TypeScript client (`PetTamagotchiClient`) with ASCII progress-bar status display
- 10-test bankrun suite (create, validation, each care instruction, time-warp decay, death, auth)
- `client/example.ts` localnet demo

## Roadmap

### R1 — Item Shop
`Inventory` PDA per owner, `ItemSlot` enum (treats, toys, shampoo), `use_item` instruction that applies larger stat bonuses than baseline care instructions. SPL Token payment optional at this tier.

### R2 — $PETZ Token
Mint-authority PDA, `anchor-spl` CPI, `claim_daily_reward` instruction that mints tokens for keeping a pet alive. Spend tokens in the Item Shop.

### R3 — Web UI
React + Wallet Adapter frontend consuming `petClient.ts`. Real-time stat display via Anchor event subscriptions. No on-chain changes needed.

### R4 — Breeding
`breed` instruction taking two live pets owned by the same wallet. Slot-hash RNG for stat inheritance. Produces a third pet PDA with blended stats and a combined species string.

### R5 — NFTs
Metaplex CPI on `create_pet` to mint a pet NFT. URI update on major life events (first bath, death, level-up). Pets are tradeable while the on-chain state remains the source of truth.

### R6 — Leaderboards
Off-chain indexer (Helius webhooks or Geyser plugin) writing events to Postgres. REST API exposing top-health and longest-lived leaderboards. No on-chain changes needed.

### R7 — Advanced health
`experience`, `level`, and `traits` bitfield fields on `Pet`. `realloc` migration instruction to grow existing accounts. Level unlocks higher stat caps and new care options.
