# 09 — TypeScript Client

## Why a Client Library Exists

Raw Solana interactions require assembling `TransactionInstruction` objects manually: constructing discriminators, serializing arguments with Borsh, resolving every account address, and wiring up signers. Anchor generates an IDL that makes this automatable from TypeScript, but the setup is still repetitive — load the IDL, create a `Program` instance, derive PDAs, pick the right serialization for `i64` vs `u8`. The `PetTamagotchiClient` class in `client/petClient.ts` centralizes all of that so callers express intent (`client.feedPet("Fluffy")`) rather than plumbing.

The client is also where type safety lives. The generated `PetTamagotchi` type from `target/types/pet_tamagotchi.js` flows through the `Program<PetTamagotchi>` generic, giving the TypeScript compiler full knowledge of every instruction name, argument type, and account shape without any hand-written types.

---

## IDL Loading

```ts
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import type { PetTamagotchi } from "../target/types/pet_tamagotchi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IDL = JSON.parse(
  readFileSync(join(__dirname, "../target/idl/pet_tamagotchi.json"), "utf-8")
) as PetTamagotchi;
```

The project uses `"type": "module"` in `package.json`, meaning all `.ts` files compile to ESM. In ESM modules, the CommonJS globals `__filename` and `__dirname` are not available. The `fileURLToPath(import.meta.url)` shim reconstructs them from the module's own URL, which Node.js always provides.

The IDL is read from disk at runtime rather than bundled. This fits the ts-node/mocha test environment — there is no bundler step, so the JSON just has to exist on disk at the path relative to the compiled output. `anchor build` writes it to `target/idl/pet_tamagotchi.json` and the TypeScript types to `target/types/pet_tamagotchi.ts`.

The cast `as PetTamagotchi` is a type assertion, not validation. The actual type-checking relies on `anchor build` keeping the IDL and type file in sync.

---

## `PetTamagotchiClient` Class

```ts
export class PetTamagotchiClient {
  readonly program: Program<PetTamagotchi>;
  readonly provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new anchor.Program<PetTamagotchi>(IDL, provider);
  }
}
```

The constructor takes an `AnchorProvider`, which bundles three things:

- `Connection` — the JSON-RPC endpoint (localnet, devnet, mainnet)
- `Wallet` — a `Keypair` wrapped in an object that can sign transactions
- `ConfirmOptions` — commitment level (`"confirmed"` throughout this project)

`anchor.Program<PetTamagotchi>` is the central Anchor client object. It holds a reference to the IDL, the provider, and the program ID (read from the IDL). Every instruction call and account fetch goes through it. The generic type parameter ensures all method names and argument types are verified at compile time.

In `example.ts`, the provider is constructed for localnet:

```ts
const connection = new Connection("http://localhost:8899", "confirmed");
const payer = Keypair.generate();
const wallet = new Wallet(payer);
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
```

In tests using `solana-bankrun`, the provider is constructed similarly but wraps a `BanksClient` instead of a live RPC connection, enabling time-travel and deterministic state.

---

## PDA Derivation

Every on-chain account is at a Program Derived Address. The client exposes derivation methods that mirror the seeds in the Rust program exactly:

```ts
derivePetPda(owner: PublicKey, name: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
    this.program.programId
  );
}

deriveInventoryPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("inventory"), owner.toBuffer()],
    this.program.programId
  );
}

deriveTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    this.program.programId
  );
}

deriveMintAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    this.program.programId
  );
}

derivePetzMintPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("petz_mint")],
    this.program.programId
  );
}

deriveClaimStatePda(owner: PublicKey, petName: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("claim_state"), owner.toBuffer(), Buffer.from(petName)],
    this.program.programId
  );
}
```

`findProgramAddressSync` hashes the seeds + program ID with SHA-256 in a loop, incrementing a nonce until the result is off the ed25519 curve (ensuring no private key exists for it). It returns a tuple of `[address, bump]`. The bump is stored inside the on-chain account so the program can re-derive the signer PDA in CPIs without passing it as an argument.

**Critical invariant**: seeds here must be byte-for-byte identical to the `seeds` attribute in the Rust `#[account]` macro. A single character difference produces a completely different address, and the instruction will fail with `AccountNotInitialized` or a constraint violation.

---

## Calling Instructions

```ts
async createPet(name: string, species: string, birthDate: number): Promise<string> {
  return this.program.methods
    .createPet(name, species, new anchor.BN(birthDate))
    .accounts({ owner: this.provider.wallet.publicKey })
    .rpc();
}
```

The builder chain has three steps:

1. `.methods.createPet(...)` — selects the instruction and provides arguments. The types are enforced by the IDL generic.
2. `.accounts({ owner: ... })` — provides the "anchor point" accounts. Anchor's IDL encodes PDA seeds declaratively, so the client can derive pet, inventory, system program, etc. automatically from the seeds and the accounts you do provide. Only the accounts that cannot be derived (signers, non-PDA accounts) need to be passed explicitly.
3. `.rpc()` — builds the transaction, signs it with the provider wallet, submits it, and awaits confirmation. Returns the transaction signature string.

All care instructions (`feed`, `walk`, `bathe`, `sleep`, `play`) follow the same pattern, passing only `{ owner: provider.wallet.publicKey }` and the pet name as an instruction argument. Anchor resolves the pet PDA, system program, and any other required accounts from the IDL.

---

## Account Fetching

### Single account

```ts
async getPetInfo(name: string, owner?: PublicKey): Promise<PetInfo> {
  const ownerKey = owner ?? this.provider.wallet.publicKey;
  const [pda] = this.derivePetPda(ownerKey, name);
  const account = await this.program.account.pet.fetch(pda);
  return { publicKey: pda, ...account };
}
```

`program.account.pet.fetch(pda)` sends a `getAccountInfo` RPC call, reads the raw bytes, strips the 8-byte discriminator (a hash of the account type name), and deserializes the remaining bytes using the IDL's Borsh layout. The result is a strongly-typed object. Spreading it alongside `publicKey` builds the `PetInfo` interface.

### Filtered bulk fetch

```ts
async listPetsByOwner(owner: PublicKey): Promise<PetInfo[]> {
  const accounts = await this.program.account.pet.all([
    {
      memcmp: {
        offset: 8,
        bytes: owner.toBase58(),
      },
    },
  ]);
  return accounts.map((a) => ({ publicKey: a.publicKey, ...a.account }));
}
```

`program.account.pet.all(filters)` maps to the `getProgramAccounts` RPC method with `dataSize` and `memcmp` filters applied server-side. The offset `8` skips the Anchor discriminator. At offset 8 is the `owner` field (a `PublicKey`, always 32 bytes). `bytes` is the base58-encoded value to compare against. The validator node filters accounts before returning them, so only matching accounts cross the wire.

This pattern is how all Solana indexing works at the RPC level. For production apps, you would use an indexer (Helius, The Graph) rather than `getProgramAccounts`, because it scans all program accounts on every call.

---

## `BN` (BigNumber)

JavaScript's `number` type is a 64-bit float, which can represent integers exactly only up to 2^53. Solana uses `i64` and `u64` for timestamps, token amounts, and counters — values that can exceed that range. Anchor uses the `bn.js` library to represent these as arbitrary-precision integers.

```ts
// Passing an i64 argument
new anchor.BN(birthDate)

// Reading an i64 field from a fetched account
cs.lastClaimTs.toNumber()   // safe only if value fits in JS number
new Date(cs.lastClaimTs.toNumber() * 1000).toISOString()
```

Fields typed as `BN` in `PetInfo` and `ClaimStateInfo`: `birthDate`, `lastInteraction`, `lastClaimTs`, `totalMinted`. Treat them as opaque until you explicitly call `.toNumber()`, `.toString()`, or arithmetic methods (`.add()`, `.mul()`, etc.).

---

## SPL Token Helpers

```ts
getUserPetzAta(owner: PublicKey): PublicKey {
  const [mintPda] = this.derivePetzMintPda();
  return getAssociatedTokenAddressSync(
    mintPda,
    owner,
    false,          // allowOwnerOffCurve: false = owner must be a normal wallet
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

async getPetzBalance(owner: PublicKey): Promise<number> {
  const ata = this.getUserPetzAta(owner);
  const tokenAccount = await getAccount(
    this.provider.connection,
    ata,
    "confirmed",
    TOKEN_PROGRAM_ID
  );
  return Number(tokenAccount.amount) / 1_000_000;
}
```

The Associated Token Account (ATA) address is deterministic: `hash(owner, TOKEN_PROGRAM_ID, mint)`. `getAssociatedTokenAddressSync` computes it locally without an RPC call. `getAccount` then fetches the on-chain token account and returns `amount` as a `bigint` (the raw integer including decimals).

The PETZ mint has 6 decimal places, so `1_000_000` raw units equals 1.000000 PETZ. Dividing by `1_000_000` converts to human-readable form. The method catches errors and returns `0` if the ATA does not exist (user has never received tokens).

---

## `formatPetStatus` — ASCII Progress Bars

```ts
static formatPetStatus(p: PetInfo): string {
  const bar = (val: number): string => {
    const filled = Math.round(val / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  };
  // ...
  return [
    `Hunger:    [${bar(p.hunger)}] ${p.hunger}%`,
    // ...
  ].join("\n");
}
```

Stats are `u8` values on-chain (0–100). The bar function maps them to a 10-character display: `Math.round(val / 10)` filled blocks, the rest empty. This is a static method — it operates on already-fetched data and does not touch the network.

---

## The `example.ts` Demo

`example.ts` shows the complete localnet workflow in sequence:

1. Generate a fresh keypair and airdrop 2 SOL to fund transactions.
2. Construct `AnchorProvider` pointing at `http://localhost:8899`.
3. Instantiate `PetTamagotchiClient`.
4. Call `createPet` → `feedPet` → `walkPet` → `playWithPet` → `bathePet` → `sleepPet` in sequence, logging each transaction signature.
5. Call `checkStatus` (an on-chain instruction that refreshes state) then `formatPetStatus`.
6. Call `listPetsByOwner` to demonstrate the memcmp filter.
7. Initialize the PETZ mint, init a claim state account, claim the daily reward, and print the balance.

Each step awaits the previous transaction's confirmation before proceeding. On localnet with `"confirmed"` commitment this is fast (single-slot confirmation), but the sequential pattern is intentional — many instructions depend on state written by the prior transaction.

---

## Interview Checklist

| Topic | What to Know |
|---|---|
| `Program<T>` generic | IDL type flows into methods/accounts for compile-time safety |
| `.methods.X().accounts({}).rpc()` | Three-step builder; `.rpc()` signs and sends |
| `findProgramAddressSync` | Deterministic PDA derivation; seeds must match on-chain exactly |
| `program.account.X.fetch(pda)` | Deserializes a single account using IDL Borsh layout |
| `program.account.X.all(filters)` | `getProgramAccounts` with memcmp; offset 8 skips discriminator |
| `memcmp` filter | Server-side byte comparison; base58-encoded for public keys |
| `anchor.BN` | Required for `i64`/`u64`; use `.toNumber()` only for display |
| ATA derivation | `getAssociatedTokenAddressSync` is local; no RPC needed |
| Token decimals | Raw `amount` is an integer; divide by `10^decimals` for display |
| ESM `__dirname` shim | `fileURLToPath(import.meta.url)` reconstructs path in ESM modules |
