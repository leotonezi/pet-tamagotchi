---
id: 12-testing-bankrun
title: "Testing with bankrun and time-warp"
tags: [testing, bankrun, anchor-bankrun, mocha, chai, time-warp]
---

# Testing with bankrun and time-warp

## Why bankrun instead of solana-test-validator

The standard `anchor test` flow spins up `solana-test-validator`, which takes roughly 5 seconds to start and keeps a full local cluster process running for the life of the test suite. On top of that, every transaction waits for real block confirmation before your assertion can run.

`solana-bankrun` takes a completely different approach: it embeds a lightweight Solana runtime directly in-process as a native library. No external process, no port, no startup wait. A full test suite that would take 30+ seconds against a local validator runs in under 2 seconds with bankrun. Results are fully deterministic because there is no real clock progression between test steps.

The killer feature is `setClock`. In a real validator you cannot manipulate time without sleeping. With bankrun you can jump the Solana clock forward by any number of seconds in a single synchronous call, which makes time-sensitive tests (decay mechanics, cooldowns, expiry checks) both fast and precise.

## The setup chain

Three packages work together in this project:

- `solana-bankrun` — the core in-process runtime. Provides `BanksClient`, `Clock`, and `setClock`.
- `anchor-bankrun` — thin wrapper that makes `solana-bankrun` speak Anchor. Provides `startAnchor` and `BankrunProvider`.
- `@coral-xyz/anchor` — the main Anchor TypeScript library that provides `Program`, `AnchorError`, and method builders.

The `before` hook in the test suite sets everything up:

```ts
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import * as anchor from "@coral-xyz/anchor";

let context: Awaited<ReturnType<typeof startAnchor>>;
let provider: BankrunProvider;
let program: Program<PetTamagotchi>;

before(async () => {
  context = await startAnchor(".", [], []);
  provider = new BankrunProvider(context);
  anchor.setProvider(provider);
  program = new anchor.Program(IDL as PetTamagotchi, provider);
});
```

`startAnchor(".", [], [])` reads `Anchor.toml`, finds the program declared under `[programs.localnet]`, loads the compiled `.so` from `target/deploy/`, and deploys it to the in-process runtime. The return value is a `context` object that owns both the bank state and the clock. No `anchor deploy`, no running validator needed.

`BankrunProvider` implements the same interface as `AnchorProvider`, so the rest of the Anchor API (`program.methods`, `program.account.fetch`, `.rpc()`) works exactly as in production code.

## Mocha + Chai pattern

Tests are structured with `describe` / `it` blocks (Mocha) and `expect`/`assert` assertions (Chai). All `it` blocks within a single `describe` share the same `context`, meaning account state written in one test is visible to the next. This is intentional: tests build on each other (create pet in T1, feed it in T3, kill it in T9).

The test script in `package.json` and `Anchor.toml`:

```json
"test": "NODE_OPTIONS='--loader ts-node/esm' npx mocha -t 1000000 tests/**/*.ts"
```

Two things to note:
- `--loader ts-node/esm` is required because the project uses `"type": "module"` (ESM). Without this flag, `import` statements in TypeScript test files fail at runtime.
- `-t 1000000` sets a 1,000,000 ms timeout per test. This is not because tests are slow — they run in milliseconds. The large timeout exists to avoid Mocha killing a test that does a lot of sequential RPC calls, which in aggregate can take a few seconds.

## Key test helpers

Two helpers reduce repetition across every test in the suite.

### derivePet

```ts
function derivePet(owner: PublicKey, name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );
  return pda;
}
```

This mirrors the PDA derivation in the Rust program exactly. Every test calls this to get the expected account address before and after an instruction, then fetches it with `program.account.pet.fetch(pda)` to assert on the stored state.

### expectAnchorError

```ts
async function expectAnchorError(
  promise: Promise<unknown>,
  codeName: string
): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch (e: any) {
    threw = true;
    if (e instanceof AnchorError) {
      assert.strictEqual(e.error.errorCode.code, codeName, `Expected ${codeName}`);
      return;
    }
    assert.include(e?.message ?? "", codeName, `Expected message to include ${codeName}`);
    return;
  }
  if (!threw) assert.fail(`Expected error ${codeName} but call succeeded`);
}
```

Usage pattern:

```ts
await expectAnchorError(
  program.methods.feed(name).accounts({ owner }).rpc(),
  "PetDeceased"
);
```

This helper handles both `AnchorError` (structured errors from Anchor's error codec) and plain `Error` objects (where the error name is embedded in the message string). The fallback to `assert.include` on the message string matters for some bankrun edge cases where errors are not fully deserialized.

## Time-warp tests: the killer feature

The Solana `Clock` sysvar exposes `unix_timestamp` (an `i64`) to programs. Bankrun lets you overwrite this value at will. After calling `context.setClock(...)`, the very next transaction sent through `context.banksClient` will see the new timestamp when the program calls `Clock::get()?.unix_timestamp`.

Full pattern from the T8 (decay) test:

```ts
// Read the current clock
const clock = await context.banksClient.getClock();

// Build a new Clock with unixTimestamp advanced by 24 hours
context.setClock(
  new Clock(
    clock.slot,
    clock.epochStartTimestamp,
    clock.epoch,
    clock.leaderScheduleEpoch,
    clock.unixTimestamp + BigInt(24 * 3600)  // i64 in Rust → BigInt in TS
  )
);

// The next instruction sees the new timestamp
await program.methods.checkStatus(name).accounts({ owner }).rpc();

const after = await program.account.pet.fetch(petPda);
// 24h: hunger +1/4h = +6; tiredness -1/4h = -6; hygiene -1/6h = -4
assert.strictEqual(after.hunger, before.hunger + 6);
```

Important details:
- `unixTimestamp` is `BigInt` on the TypeScript side because it maps to `i64` in Rust, which exceeds JavaScript's safe integer range for large values.
- `setClock` is synchronous. The new clock takes effect for all subsequent transactions without any await.
- `clock.slot`, `clock.epoch`, and the other fields are passed through unchanged unless your test specifically needs to manipulate them.
- `context.warpToSlot(slot + BigInt(1))` is a related helper that advances the slot counter, which changes the blockhash. This is used in the play saturation test to avoid a duplicate blockhash rejection when sending two transactions in rapid succession.

## The core test suite

### T1 — createPet happy path
Creates a pet named "Buddy" with species "Dog". Asserts the PDA exists, all stats match init values (`hunger=30, tiredness=20, hygiene=80, happiness=70`), `health=75` (derived as `((100-hunger) + (100-tiredness) + hygiene + happiness) / 4`), and `is_alive=true`.

### T2 — createPet validation
Attempts to create a pet with an empty name string. Expects `NameEmpty` error. (A name longer than 32 bytes cannot even reach the program — Solana rejects PDA seeds over 32 bytes at the client level before the transaction is sent.)

### T3 — feed
Creates "Feeder", feeds once. Asserts `hunger: 30 - 25 = 5` and `happiness: 70 + 5 = 75`.

### T4 — walk
Creates "Walker", walks once. Asserts `happiness: 70 + 15 = 85`, `tiredness: 20 + 10 = 30`, `hygiene: 80 - 5 = 75`, `hunger: 30 + 5 = 35`. Also asserts all values remain in `[0, 100]`.

### T5 — bathe near max hygiene
Creates "Bather" (hygiene starts at 80), bathes once (`+50`). Asserts hygiene saturates at 100 rather than wrapping to 130 (saturating arithmetic in Rust: `u8::saturating_add`).

### T6 — sleep near min tiredness
Creates "Sleeper" (tiredness starts at 20), sleeps once (`-50`). Asserts tiredness saturates at 0 rather than underflowing.

### T7 — play to max happiness
Creates "Player", plays twice (each play adds 20 happiness). Uses `context.warpToSlot(currentSlot + BigInt(1))` between plays to change the blockhash. Asserts happiness saturates at 100.

### T8 — checkStatus with clock warp
Creates "Decayer", records stats, advances the clock +24 hours, calls `checkStatus`, then asserts the exact decay amounts: hunger `+6` (1 per 4 hours), tiredness `-6`, hygiene `-4` (1 per 6 hours). The pet remains alive.

### T9 — death mechanics
Creates "Mortal", advances clock +400 hours (hunger gain = 400/4 = 100; clamped to 100, which exceeds the death threshold of 95), calls `checkStatus`. Asserts `is_alive=false`. Then attempts to feed the dead pet and expects `PetDeceased`.

### T10 — unauthorized signer
Creates "SecretPet" under the default wallet. Generates an attacker keypair, funds it via `context.setAccount(...)`, builds a separate `BankrunProvider` and `Program` for the attacker. Attacker calls `feed` with their own public key as owner — Anchor derives a different PDA (which does not exist), so the transaction fails.

## Funding test accounts in bankrun

Unlike a real validator where you need `requestAirdrop`, bankrun lets you inject arbitrary account state directly:

```ts
const attacker = Keypair.generate();
context.setAccount(attacker.publicKey, {
  executable: false,
  owner: new PublicKey("11111111111111111111111111111111"),
  lamports: 1_000_000_000,  // 1 SOL
  data: new Uint8Array(0),
});
```

This is also how you can pre-seed any account state for edge-case tests without going through an on-chain instruction.

## Reading raw account data

Bankrun does not have a live RPC endpoint, so helpers like `connection.getTokenAccountBalance()` that go through HTTP are not available. Instead, read raw account data and decode it:

```ts
async function getTokenAmount(
  context: Awaited<ReturnType<typeof startAnchor>>,
  ata: PublicKey
): Promise<bigint> {
  const info = await context.banksClient.getAccount(ata);
  if (!info) return BigInt(0);
  const parsed = unpackAccount(
    ata,
    { ...info, data: Buffer.from(info.data) },
    TOKEN_PROGRAM_ID
  );
  return parsed.amount;
}
```

`context.banksClient.getAccount(pubkey)` returns the raw `AccountInfo` bytes. SPL token helpers like `unpackAccount` and `unpackMint` from `@solana/spl-token` decode those bytes without needing an RPC call.

## R4 breed tests

The breed instruction adds four test scenarios:

- **R4-1 happy path**: creates "BreedAlpha" (Dog) and "BreedBeta" (Cat), calls `breed(nameA, nameB, offspringName)`. Fetches both parents and the offspring. Asserts each offspring stat (`hunger`, `tiredness`, `hygiene`, `happiness`) is equal to the corresponding stat of one of the two parents — inheritance is per-stat, not averaged. Species is a blend of the two parent species strings (each contributing half its characters).

- **R4-2 dead parent**: kills "DeadParentA" via a 400-hour clock warp and `checkStatus`, then attempts to breed it. Expects `PetDeceased`.

- **R4-3 same-parent guard (B-01)**: calls `breed(sameName, sameName, offspringName)`. Expects `SameParent`. This guards against a parent self-breeding via PDA aliasing — even though Anchor loads the account twice (both reads, so no double-borrow), the handler-level `require!` fires before any state is written.

- **R4-4 re-init protection (B-03)**: attempts to breed where `offspring_name` resolves to an already-existing pet PDA. Anchor's `init` constraint (not `init_if_needed`) rejects the instruction. The existing account is fetched before and after and asserted to be unchanged.

## Anchor events in bankrun

Bankrun does not support WebSocket subscriptions. To verify events emitted by instructions, there are two approaches:

1. Parse the transaction logs returned by `context.banksClient`. Anchor encodes events as base64 strings prefixed with `Program log: ` — look for entries that match your event discriminator.
2. Use `program.simulate(...)` instead of `.rpc()`. The simulate call returns transaction metadata including logs without committing the transaction, which is useful for reading event payloads without side effects.

In practice, most tests in this suite assert on account state rather than event payloads, because account state is easier to query and less brittle than log parsing.

## File references

- `/Users/leonardotonezi/Documents/github/pet-tamagotchi/tests/pet_tamagotchi.ts` — entire test suite (single file, ~1100 lines)
- `/Users/leonardotonezi/Documents/github/pet-tamagotchi/package.json` — `anchor-bankrun ^0.5.0`, `solana-bankrun ^0.4.0`, mocha and chai versions
- `/Users/leonardotonezi/Documents/github/pet-tamagotchi/Anchor.toml` — `[scripts] test = ...` with `--loader ts-node/esm` and `-t 1000000`
- `/Users/leonardotonezi/Documents/github/pet-tamagotchi/target/types/pet_tamagotchi.ts` — generated IDL types imported as `PetTamagotchi`
