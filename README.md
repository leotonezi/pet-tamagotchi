# Pet Tamagotchi

On-chain pet-care game built on Solana with Anchor. Own a virtual pet whose hunger, hygiene, happiness, and tiredness decay over real time. Neglect it and it dies.

## Features

- PDA-based pet accounts owned by their creator's wallet
- Six care instructions: feed, walk, bathe, sleep, play, check_status
- Time-based stat decay applied lazily on each interaction
- Death mechanics with post-mortem status reads
- TypeScript client with ASCII progress-bar status display
- 10-test suite using `anchor-bankrun` (no external validator)

## Prerequisites

| Tool | Version |
|------|---------|
| Rust | stable (1.75+) |
| Solana CLI | 1.18+ |
| Anchor CLI | 0.31+ |
| Node.js | 18+ |

Install Anchor CLI:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install latest && avm use latest
```

## Build

```bash
npm install
anchor build
```

## Test

```bash
anchor test
```

Runs all 10 bankrun tests — no local validator required.

## Deploy to localnet

```bash
# Terminal 1
solana-test-validator -r

# Terminal 2
anchor deploy
npx ts-node client/example.ts
```

`example.ts` creates a pet, runs a full daily care routine, and prints the pet's status with live transaction signatures.

## Project layout

```
programs/pet-tamagotchi/src/lib.rs   smart contract (~350 lines)
client/petClient.ts                  PetTamagotchiClient class
client/example.ts                    localnet demo
tests/pet_tamagotchi.ts              10 integration tests
```

## License

MIT
