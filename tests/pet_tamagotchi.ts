import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import { assert } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import type { PetTamagotchi } from "../target/types/pet_tamagotchi.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const IDL = JSON.parse(
  readFileSync(join(process.cwd(), "target/idl/pet_tamagotchi.json"), "utf-8")
);

const PROGRAM_ID = new PublicKey("CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC");

function derivePet(owner: PublicKey, name: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
    PROGRAM_ID
  );
  return pda;
}

async function expectAnchorError(
  promise: Promise<unknown>,
  codeName: string
): Promise<void> {
  let threw = false;
  let errMsg = "";
  try {
    await promise;
  } catch (e: any) {
    threw = true;
    if (e instanceof AnchorError) {
      assert.strictEqual(
        e.error.errorCode.code,
        codeName,
        `Expected ${codeName}, got ${e.error.errorCode.code}`
      );
      return;
    }
    errMsg = e?.message ?? e?.toString() ?? "";
    assert.include(errMsg, codeName, `Expected message to include ${codeName}`);
    return;
  }
  if (!threw) assert.fail(`Expected error ${codeName} but call succeeded`);
}

describe("pet_tamagotchi", () => {
  let context: Awaited<ReturnType<typeof startAnchor>>;
  let provider: BankrunProvider;
  let program: Program<PetTamagotchi>;

  before(async () => {
    context = await startAnchor(".", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = new anchor.Program(IDL as PetTamagotchi, provider);
  });

  // ── 1: createPet happy path ──────────────────────────────────────────────────
  it("createPet: PDA exists, default stats, is_alive=true", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Buddy";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Dog", new BN(0))
      .accounts({ owner })
      .rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.ok(pet.isAlive, "pet is alive");
    assert.strictEqual(pet.hunger, 30, "hunger");
    assert.strictEqual(pet.tiredness, 20, "tiredness");
    assert.strictEqual(pet.hygiene, 80, "hygiene");
    assert.strictEqual(pet.happiness, 70, "happiness");
    // health = ((100-30) + (100-20) + 80 + 70) / 4 = 300/4 = 75
    assert.strictEqual(pet.health, 75, "health");
    assert.ok(pet.owner.equals(owner), "owner field");
    assert.strictEqual(pet.name, name, "name field");
    assert.strictEqual(pet.species, "Dog", "species field");
  });

  // ── 2: createPet empty name → NameEmpty
  // Note: NameTooLong is unreachable through standard client — a 33-byte name seed
  // exceeds Solana's 32-byte-per-seed limit so the PDA derivation fails first.
  // NameEmpty uses a 0-byte seed (valid) so the error propagates from the program.
  it("createPet: empty name → NameEmpty", async () => {
    const owner = provider.wallet.publicKey;

    await expectAnchorError(
      program.methods
        .createPet("", "Cat", new BN(0))
        .accounts({ owner })
        .rpc(),
      "NameEmpty"
    );
  });

  // ── 3: feed ──────────────────────────────────────────────────────────────────
  it("feed: hunger −25, happiness +5", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Feeder";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    await program.methods.feed(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.strictEqual(pet.hunger, 5, "hunger: 30-25=5");
    assert.strictEqual(pet.happiness, 75, "happiness: 70+5=75");
  });

  // ── 4: walk ──────────────────────────────────────────────────────────────────
  it("walk: happiness +15, tired +10, hygiene −5, hunger +5; all in 0..100", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Walker";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Dog", new BN(0))
      .accounts({ owner })
      .rpc();

    await program.methods.walk(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.strictEqual(pet.happiness, 85, "happiness: 70+15=85");
    assert.strictEqual(pet.tiredness, 30, "tiredness: 20+10=30");
    assert.strictEqual(pet.hygiene, 75, "hygiene: 80-5=75");
    assert.strictEqual(pet.hunger, 35, "hunger: 30+5=35");
    for (const [k, v] of Object.entries({
      happiness: pet.happiness,
      tiredness: pet.tiredness,
      hygiene: pet.hygiene,
      hunger: pet.hunger,
    })) {
      assert.isAtLeast(v as number, 0, `${k} >= 0`);
      assert.isAtMost(v as number, 100, `${k} <= 100`);
    }
  });

  // ── 5: bathe near 100 hygiene ────────────────────────────────────────────────
  it("bathe: hygiene saturates at 100 (80+50=130 → 100)", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Bather";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    await program.methods.bathe(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.strictEqual(pet.hygiene, 100, "hygiene saturated at 100");
    assert.strictEqual(pet.happiness, 75, "happiness: 70+5=75");
  });

  // ── 6: sleep near 0 tiredness ────────────────────────────────────────────────
  it("sleep: tiredness saturates at 0 (20-50=-30 → 0)", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Sleeper";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Dog", new BN(0))
      .accounts({ owner })
      .rpc();

    await program.methods.sleep(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.strictEqual(pet.tiredness, 0, "tiredness saturated at 0");
    assert.strictEqual(pet.hunger, 35, "hunger: 30+5=35");
  });

  // ── 7: play near 100 happiness ───────────────────────────────────────────────
  it("play: happiness saturates at 100 (70+20+20=110 → 100)", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Player";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Rabbit", new BN(0))
      .accounts({ owner })
      .rpc();

    // two plays: 70 → 90 → 110 (clamped 100); warpToSlot between to change blockhash
    await program.methods.play(name).accounts({ owner }).rpc();
    const currentSlot = await context.banksClient.getSlot();
    context.warpToSlot(currentSlot + BigInt(1));
    await program.methods.play(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.strictEqual(pet.happiness, 100, "happiness saturated at 100");
  });

  // ── 8: checkStatus + clock warp ──────────────────────────────────────────────
  it("checkStatus: 24h warp applies correct time decay", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Decayer";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    const before = await program.account.pet.fetch(petPda);

    // Warp clock +24 hours
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(24 * 3600)
      )
    );

    await program.methods.checkStatus(name).accounts({ owner }).rpc();

    const after = await program.account.pet.fetch(petPda);

    // 24h: hunger +1/4h = +6; tiredness -1/4h = -6; hygiene -1/6h = -4
    assert.strictEqual(after.hunger, before.hunger + 6, "hunger +6 after 24h");
    assert.strictEqual(after.tiredness, before.tiredness - 6, "tiredness -6 after 24h");
    assert.strictEqual(after.hygiene, before.hygiene - 4, "hygiene -4 after 24h");
    assert.ok(after.isAlive, "pet still alive");
  });

  // ── 9: death mechanics ───────────────────────────────────────────────────────
  it("death: far-future warp → is_alive=false; feed → PetDeceased", async () => {
    const owner = provider.wallet.publicKey;
    const name = "Mortal";
    const petPda = derivePet(owner, name);

    await program.methods
      .createPet(name, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    // Warp 400h: hunger gain = 400/4 = 100 → 30+100=130 → clamped 100 (>95 → death)
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(400 * 3600)
      )
    );

    // check_status has no is_alive constraint — detects death
    await program.methods.checkStatus(name).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(petPda);
    assert.isFalse(pet.isAlive, "pet should be dead");

    // Care instructions reject dead pets
    await expectAnchorError(
      program.methods.feed(name).accounts({ owner }).rpc(),
      "PetDeceased"
    );
  });

  // ── 10: unauthorized signer ───────────────────────────────────────────────────
  it("unauthorized: attacker cannot interact with another owner's pet", async () => {
    const owner = provider.wallet.publicKey;
    const name = "SecretPet";

    await program.methods
      .createPet(name, "Dog", new BN(0))
      .accounts({ owner })
      .rpc();

    // Fund attacker keypair
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, {
      executable: false,
      owner: new PublicKey("11111111111111111111111111111111"),
      lamports: 1_000_000_000,
      data: new Uint8Array(0),
    });

    const attackerProvider = new BankrunProvider(context, new anchor.Wallet(attacker));
    const attackerProgram = new anchor.Program<PetTamagotchi>(
      IDL as PetTamagotchi,
      attackerProvider
    );

    // Attacker uses their own key as owner → Anchor derives a different PDA (doesn't exist)
    let threw = false;
    try {
      await attackerProgram.methods
        .feed(name)
        .accounts({ owner: attacker.publicKey })
        .signers([attacker])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "attacker was correctly rejected");
  });
});
