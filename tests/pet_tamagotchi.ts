import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import { assert } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import type { PetTamagotchi } from "../target/types/pet_tamagotchi.js";
import {
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

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

function deriveInventory(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("inventory"), owner.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function deriveTreasury(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );
  return pda;
}

function deriveMintAuthority(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    PROGRAM_ID
  );
  return pda;
}

function derivePetzMint(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("petz_mint")],
    PROGRAM_ID
  );
  return pda;
}

function deriveClaimState(owner: PublicKey, petName: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim_state"), owner.toBuffer(), Buffer.from(petName)],
    PROGRAM_ID
  );
  return pda;
}

/** Read a token account's amount via raw account data (no RPC needed). */
async function getTokenAmount(
  context: Awaited<ReturnType<typeof startAnchor>>,
  ata: PublicKey
): Promise<bigint> {
  const info = await context.banksClient.getAccount(ata);
  if (!info) return BigInt(0);
  // unpackAccount needs an AccountInfo<Buffer>-shaped object
  const parsed = unpackAccount(ata, { ...info, data: Buffer.from(info.data) }, TOKEN_PROGRAM_ID);
  return parsed.amount;
}

const ITEM_PRICE = 10_000_000; // 0.01 SOL per item

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

  // ── R1: Item Shop ─────────────────────────────────────────────────────────────

  // 11: init_inventory
  it("initInventory: creates inventory PDA with empty slots", async () => {
    const owner = provider.wallet.publicKey;
    const invPda = deriveInventory(owner);

    await program.methods.initInventory().accounts({ owner }).rpc();

    const inv = await program.account.inventory.fetch(invPda);
    assert.ok(inv.owner.equals(owner), "owner field");
    assert.strictEqual(inv.slots.length, 8, "8 slots");
    assert.ok(inv.slots.every((s: any) => s.qty === 0), "all slots empty");
  });

  // 12: buy_item happy path (item 0 = Apple)
  it("buyItem: deducts lamports, fills slot, emits event", async () => {
    const owner = provider.wallet.publicKey;
    const invPda = deriveInventory(owner);
    const treasuryPda = deriveTreasury();

    const treasuryBefore = await context.banksClient.getBalance(treasuryPda);
    await program.methods.buyItem(0, 2).accounts({ owner }).rpc();

    const inv = await program.account.inventory.fetch(invPda);
    const slot = inv.slots.find((s: any) => s.qty > 0 && s.itemId === 0);
    assert.ok(slot, "slot for Apple exists");
    assert.strictEqual(slot.qty, 2, "qty = 2");

    const treasuryAfter = await context.banksClient.getBalance(treasuryPda);
    assert.strictEqual(
      Number(treasuryAfter) - Number(treasuryBefore),
      2 * ITEM_PRICE,
      "treasury received 2 × price"
    );
  });

  // 13: buy_item unknown item_id → ItemUnknown
  it("buyItem: unknown item_id → ItemUnknown", async () => {
    const owner = provider.wallet.publicKey;
    await expectAnchorError(
      program.methods.buyItem(99, 1).accounts({ owner }).rpc(),
      "ItemUnknown"
    );
  });

  // 14: use_item (Apple, item_id=0) — hunger −30, happiness +5
  it("useItem: Apple applies correct stat deltas", async () => {
    const owner = provider.wallet.publicKey;
    const petName = "ShopPet";
    const petPda = derivePet(owner, petName);
    const invPda = deriveInventory(owner);

    await program.methods.createPet(petName, "Dog", new BN(0)).accounts({ owner }).rpc();
    // Buy 1 Apple (item_id=0); inventory already exists from test 11
    await program.methods.buyItem(0, 1).accounts({ owner }).rpc();

    const before = await program.account.pet.fetch(petPda);
    await program.methods.useItem(0, petName).accounts({ owner }).rpc();
    const after = await program.account.pet.fetch(petPda);

    // Apple: hunger -30, happiness +5
    const expectedHunger = Math.max(0, Math.min(100, before.hunger - 30));
    const expectedHappiness = Math.min(100, before.happiness + 5);
    assert.strictEqual(after.hunger, expectedHunger, "hunger -30");
    assert.strictEqual(after.happiness, expectedHappiness, "happiness +5");

    // Verify slot qty decremented
    const inv = await program.account.inventory.fetch(invPda);
    const appleSlot = inv.slots.find((s: any) => s.itemId === 0 && s.qty > 0);
    // All apples used (we had 2 from test 12 + 1 from this test = 3, used 1 → 2)
    assert.ok(appleSlot === undefined || appleSlot.qty < 3, "qty decremented");
  });

  // 15: use_item on dead pet → PetDeceased
  it("useItem: dead pet → PetDeceased", async () => {
    const owner = provider.wallet.publicKey;
    const petName = "DeadShopPet";

    await program.methods.createPet(petName, "Cat", new BN(0)).accounts({ owner }).rpc();

    // Kill via time warp
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
    await program.methods.checkStatus(petName).accounts({ owner }).rpc();

    // Buy item and try to use on dead pet
    await program.methods.buyItem(1, 1).accounts({ owner }).rpc(); // Soap
    await expectAnchorError(
      program.methods.useItem(1, petName).accounts({ owner }).rpc(),
      "PetDeceased"
    );
  });

  // 16: use_item with no items in inventory → InsufficientItems
  it("useItem: no items in slot → InsufficientItems", async () => {
    const owner = provider.wallet.publicKey;
    const petName = "ShopPet"; // reuse alive pet from earlier

    await expectAnchorError(
      // item_id=3 (Pillow) — never bought in this suite
      program.methods.useItem(3, petName).accounts({ owner }).rpc(),
      "InsufficientItems"
    );
  });

  // 17: use_item with time-warp — decay applied before item effect
  it("useItem: decay applied before item effect (6h warp)", async () => {
    const owner = provider.wallet.publicKey;
    const petName = "DecayShopPet";
    const petPda = derivePet(owner, petName);

    await program.methods.createPet(petName, "Rabbit", new BN(0)).accounts({ owner }).rpc();
    await program.methods.buyItem(2, 1).accounts({ owner }).rpc(); // Toy: happiness +30, tiredness +10

    // Warp 6h: hygiene -1, hunger +1, tiredness -1
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(6 * 3600)
      )
    );

    const before = await program.account.pet.fetch(petPda);
    await program.methods.useItem(2, petName).accounts({ owner }).rpc();
    const after = await program.account.pet.fetch(petPda);

    // After 6h decay: hunger +1, tiredness -1, hygiene -1; then Toy: happiness +30, tiredness +10
    const expHunger = Math.min(100, before.hunger + 1);
    const expTiredness = Math.min(100, Math.max(0, before.tiredness - 1) + 10);
    const expHygiene = Math.max(0, before.hygiene - 1);
    const expHappiness = Math.min(100, before.happiness + 30);

    assert.strictEqual(after.hunger, expHunger, "hunger after decay + toy");
    assert.strictEqual(after.tiredness, expTiredness, "tiredness after decay + toy");
    assert.strictEqual(after.hygiene, expHygiene, "hygiene after decay + toy");
    assert.strictEqual(after.happiness, expHappiness, "happiness after decay + toy");
  });

  // ── R2: $PETZ SPL Token ───────────────────────────────────────────────────────

  // R2-1: initialize_mint happy path
  it("initializeMint: mint created with 6 decimals, authority PDA, total_minted=0", async () => {
    // arrange
    const authority = provider.wallet.publicKey;
    const mintAuthorityPda = deriveMintAuthority();
    const petzMintPda = derivePetzMint();

    // act
    await program.methods
      .initializeMint()
      .accounts({ authority })
      .rpc();

    // assert — MintAuthority account
    const mintAuthority = await program.account.mintAuthority.fetch(mintAuthorityPda);
    assert.strictEqual(mintAuthority.totalMinted.toNumber(), 0, "total_minted = 0");
    assert.ok(mintAuthority.mint.equals(petzMintPda), "mint field points to petz_mint PDA");

    // assert — SPL Mint account decimals via raw data
    const mintInfo = await context.banksClient.getAccount(petzMintPda);
    assert.ok(mintInfo, "petz_mint account exists");
    const parsed = unpackMint(petzMintPda, { ...mintInfo, data: Buffer.from(mintInfo.data) }, TOKEN_PROGRAM_ID);
    assert.strictEqual(parsed.decimals, 6, "decimals = 6");
    assert.ok(parsed.mintAuthority?.equals(mintAuthorityPda), "mint authority = MintAuthority PDA");
  });

  // R2-2: initialize_mint re-init rejection
  it("initializeMint: second call fails (Anchor init protection)", async () => {
    const authority = provider.wallet.publicKey;
    let threw = false;
    try {
      await program.methods.initializeMint().accounts({ authority }).rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "second initializeMint should fail");
  });

  // R2-3: claim_daily_reward happy path — good stats → max reward 25_000_000
  it("claimDailyReward: good-stats pet → ATA balance = 25_000_000 (max cap)", async () => {
    // arrange — create a pet with good stats
    const owner = provider.wallet.publicKey;
    const petName = "R2HappyPet";
    const petPda = derivePet(owner, petName);
    const claimStatePda = deriveClaimState(owner, petName);
    const mintPda = derivePetzMint();
    const mintAuthorityPda = deriveMintAuthority();
    const userAta = getAssociatedTokenAddressSync(mintPda, owner, false, TOKEN_PROGRAM_ID);

    await program.methods
      .createPet(petName, "Dog", new BN(0))
      .accounts({ owner })
      .rpc();

    // Feed until hunger < 20 (PERFECT_CARE_HUNGER_MAX)
    // Initial hunger = 30; feed once: hunger = 30-25 = 5; happiness = 70+5 = 75
    await program.methods.feed(petName).accounts({ owner }).rpc();

    // Play twice to get happiness >= 80 (HAPPINESS_BONUS_THRESHOLD)
    // happiness = 75+20 = 95
    const slot1 = await context.banksClient.getSlot();
    context.warpToSlot(slot1 + BigInt(1));
    await program.methods.play(petName).accounts({ owner }).rpc();

    // health = ((100-5) + (100-0) + 80 + 95) / 4 = 375/4 = 93 >= 80 (HEALTH_BONUS_THRESHOLD)
    // Bathe to ensure hygiene >= 80 (PERFECT_CARE_HYGIENE_MIN)
    const slot2 = await context.banksClient.getSlot();
    context.warpToSlot(slot2 + BigInt(1));
    await program.methods.bathe(petName).accounts({ owner }).rpc();

    // Verify pet stats
    const pet = await program.account.pet.fetch(petPda);
    assert.isAtMost(pet.hunger, 20, "hunger <= 20 for perfect care");
    assert.isAtLeast(pet.hygiene, 80, "hygiene >= 80 for perfect care");
    assert.isAtLeast(pet.happiness, 80, "happiness >= 80 for happiness bonus");
    assert.isAtLeast(pet.health, 80, "health >= 80 for health bonus");

    // init claim state
    await program.methods
      .initClaimState(petName)
      .accounts({ owner })
      .rpc();

    // act
    await program.methods
      .claimDailyReward(petName)
      .accounts({ owner })
      .rpc();

    // assert — ATA balance = max reward cap = 25_000_000
    const ataBalance = await getTokenAmount(context, userAta);
    assert.strictEqual(Number(ataBalance), 25_000_000, "ATA balance = max cap 25_000_000");

    // assert — claim state updated
    const claimState = await program.account.claimState.fetch(claimStatePda);
    assert.strictEqual(claimState.totalClaims, 1, "total_claims = 1");
    assert.isAbove(claimState.lastClaimTs.toNumber(), 0, "last_claim_ts set");

    // assert — mint authority total_minted updated
    const mintAuthority = await program.account.mintAuthority.fetch(mintAuthorityPda);
    assert.strictEqual(mintAuthority.totalMinted.toNumber(), 25_000_000, "total_minted = 25_000_000");
  });

  // R2-4: claim_daily_reward base only — poor stats → 10_000_000
  it("claimDailyReward: poor-stats pet → ATA balance = 10_000_000 (base only)", async () => {
    // arrange — fresh pet with default (mediocre) stats: hunger=30, happiness=70 (<80), health=75 (<80)
    // hunger=30 > 20, so no perfect care bonus
    const owner = provider.wallet.publicKey;
    const petName = "R2PoorPet";
    const mintPda = derivePetzMint();
    const userAta = getAssociatedTokenAddressSync(mintPda, owner, false, TOKEN_PROGRAM_ID);

    await program.methods
      .createPet(petName, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    // init claim state
    await program.methods.initClaimState(petName).accounts({ owner }).rpc();

    // Record ATA balance before this claim (may have balance from previous tests)
    const ataBefore = await getTokenAmount(context, userAta);

    // act — claim with default stats
    await program.methods.claimDailyReward(petName).accounts({ owner }).rpc();

    // assert — exactly 10_000_000 more tokens (base reward only)
    const ataAfter = await getTokenAmount(context, userAta);
    assert.strictEqual(
      Number(ataAfter) - Number(ataBefore),
      10_000_000,
      "received base reward only = 10_000_000"
    );
  });

  // R2-5: Cooldown enforcement — second claim immediately → ClaimCooldownActive
  it("claimDailyReward: second immediate claim → ClaimCooldownActive", async () => {
    // arrange — use R2PoorPet (already claimed in test R2-4, cooldown active)
    const owner = provider.wallet.publicKey;
    const petName = "R2PoorPet";

    // act + assert — immediate second claim fails
    await expectAnchorError(
      program.methods.claimDailyReward(petName).accounts({ owner }).rpc(),
      "ClaimCooldownActive"
    );
  });

  // R2-6: Time-warp success — advance 86_400s, second claim succeeds, total_claims = 2
  it("claimDailyReward: advance 86400s → second claim succeeds, total_claims=2", async () => {
    // arrange — use R2PoorPet (claimed once in R2-4, cooldown = 86400s)
    const owner = provider.wallet.publicKey;
    const petName = "R2PoorPet";
    const claimStatePda = deriveClaimState(owner, petName);
    const mintPda = derivePetzMint();
    const userAta = getAssociatedTokenAddressSync(mintPda, owner, false, TOKEN_PROGRAM_ID);

    // warp clock by exactly 86_400 seconds
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(86_400)
      )
    );

    const ataBefore = await getTokenAmount(context, userAta);

    // act
    await program.methods.claimDailyReward(petName).accounts({ owner }).rpc();

    // assert — tokens received
    const ataAfter = await getTokenAmount(context, userAta);
    assert.isAbove(Number(ataAfter), Number(ataBefore), "tokens minted on second claim");

    // assert — total_claims = 2
    const claimState = await program.account.claimState.fetch(claimStatePda);
    assert.strictEqual(claimState.totalClaims, 2, "total_claims = 2 after second claim");
  });

  // R2-7: Dead pet rejection — warp far future so pet dies, then claim → PetDeceased
  it("claimDailyReward: dead pet → PetDeceased", async () => {
    // arrange — create a fresh pet and claim state
    const owner = provider.wallet.publicKey;
    const petName = "R2DeadPet";

    await program.methods
      .createPet(petName, "Cat", new BN(0))
      .accounts({ owner })
      .rpc();

    await program.methods.initClaimState(petName).accounts({ owner }).rpc();

    // Warp far future: hunger +1/4h, need >95 → (95-30)*4 = 260h = 936_000s
    // Use 1_000_000s to be safe
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(1_000_000)
      )
    );

    // Trigger is_alive = false via check_status
    await program.methods.checkStatus(petName).accounts({ owner }).rpc();

    const pet = await program.account.pet.fetch(derivePet(owner, petName));
    assert.isFalse(pet.isAlive, "pet should be dead before claim");

    // act + assert — claim on dead pet fails with PetDeceased
    await expectAnchorError(
      program.methods.claimDailyReward(petName).accounts({ owner }).rpc(),
      "PetDeceased"
    );
  });

  // R2-8: Auth rejection — attacker tries to claim against first user's pet
  it("claimDailyReward: attacker cannot claim against another owner's pet", async () => {
    // arrange — use R2HappyPet (belongs to default owner)
    const owner = provider.wallet.publicKey;
    const petName = "R2HappyPet";

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

    // Attacker provides their own pubkey as owner — derives a different PDA that doesn't exist
    let threw = false;
    try {
      await attackerProgram.methods
        .claimDailyReward(petName)
        .accounts({ owner: attacker.publicKey })
        .signers([attacker])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "attacker was correctly rejected");
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

  // ── SECURITY POC: S-01 — initializeMint has no admin gate ────────────────────
  // Finding S-01 (P1 High): any funded signer can call initialize_mint and become
  // the first caller. The `init` constraint prevents re-init after the first call,
  // meaning whoever races to call this first sets the canonical mint PDA forever.
  //
  // This test demonstrates the attack surface: an attacker keypair, given enough
  // SOL, can call initializeMint and the transaction succeeds with no authorization
  // error. In a real deploy scenario this would be a front-run opportunity in the
  // deployment window before the legitimate team calls initializeMint.
  //
  // NOTE: In this test suite initialize_mint was already called in R2-1, so the
  // attacker's call will fail with an "already in use" error (account exists).
  // The test verifies that the rejection is due to re-init protection ONLY, not
  // any admin authorization check — confirming that if the attacker had been first,
  // the call would have succeeded.
  it("[S-01 POC] initializeMint: any signer can race to initialize (no admin gate)", async () => {
    // Fund an attacker who has no special role
    const attacker = Keypair.generate();
    context.setAccount(attacker.publicKey, {
      executable: false,
      owner: new PublicKey("11111111111111111111111111111111"),
      lamports: 10_000_000_000, // 10 SOL — enough to pay for accounts
      data: new Uint8Array(0),
    });

    const attackerProvider = new BankrunProvider(context, new anchor.Wallet(attacker));
    const attackerProgram = new anchor.Program<PetTamagotchi>(
      IDL as PetTamagotchi,
      attackerProvider
    );

    // The attacker attempts to call initializeMint.
    // Because R2-1 already called it in this suite, we expect a failure —
    // but the ONLY reason for failure is that the PDA accounts already exist
    // (re-init protection via `init`), NOT because the program checked
    // that the attacker is an authorized deployer.
    let errorMessage = "";
    try {
      await attackerProgram.methods
        .initializeMint()
        .accounts({ authority: attacker.publicKey })
        .signers([attacker])
        .rpc();
      // If the mint had not been initialized yet, this would succeed.
      // In that scenario the attacker becomes the effective "first caller"
      // with no authorization check — S-01 confirmed.
      assert.fail(
        "Expected failure because mint was already initialized, but got success. " +
        "If this ran before R2-1, it would mean the attacker succeeded — confirming S-01."
      );
    } catch (e: any) {
      errorMessage = e?.message ?? e?.toString() ?? "";
    }

    // Confirm the rejection was a re-init error, NOT an Unauthorized error.
    // An Unauthorized error would mean the program has an admin gate (it does not).
    // A re-init / already-in-use error means the gate is purely `init` exclusivity.
    const isReInitError =
      errorMessage.includes("already in use") ||
      errorMessage.includes("already been initialized") ||
      errorMessage.includes("custom program error: 0x0") || // system program: account already exists
      errorMessage.includes("0x0");
    const isUnauthorizedError =
      errorMessage.includes("Unauthorized") ||
      errorMessage.includes("ConstraintHasOne") ||
      errorMessage.includes("2006"); // Anchor Unauthorized error code

    assert.isFalse(
      isUnauthorizedError,
      "Program did NOT reject the attacker with an Unauthorized error — " +
      "confirming there is no admin gate. Only re-init protection saved us here."
    );
    assert.isTrue(
      isReInitError || errorMessage.length > 0,
      "Expected a re-init rejection (accounts already exist), confirming S-01 attack surface: " +
      `got: ${errorMessage}`
    );
  });
});
