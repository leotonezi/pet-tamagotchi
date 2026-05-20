/**
 * Browser-compatible Anchor client for pet-tamagotchi.
 *
 * The original client/petClient.ts uses Node.js `fs`/`url`/`path` to load the
 * IDL at runtime. In the browser we import the IDL statically and construct the
 * Anchor Program directly so none of those Node modules are needed.
 *
 * This is the ONLY file that references the IDL JSON and @coral-xyz/anchor
 * Program directly. All app code imports types and the client from here.
 */
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import IDL from "@idl/pet_tamagotchi.json";
import type { PetTamagotchi } from "../../target/types/pet_tamagotchi";

// ─── Account types ────────────────────────────────────────────────────────────

export interface ItemSlot {
  itemId: number;
  qty: number;
}

export interface InventoryInfo {
  publicKey: PublicKey;
  owner: PublicKey;
  slots: ItemSlot[];
  bump: number;
}

export interface ClaimStateInfo {
  publicKey: PublicKey;
  owner: PublicKey;
  pet: PublicKey;
  lastClaimTs: InstanceType<typeof BN>;
  totalClaims: number;
  bump: number;
}

export interface PetInfo {
  publicKey: PublicKey;
  owner: PublicKey;
  name: string;
  species: string;
  birthDate: InstanceType<typeof BN>;
  hunger: number;
  tiredness: number;
  hygiene: number;
  happiness: number;
  health: number;
  needsMeal: boolean;
  needsWalk: boolean;
  needsBath: boolean;
  isAlive: boolean;
  lastInteraction: InstanceType<typeof BN>;
  bump: number;
}

export const ITEM_NAMES: Record<number, string> = {
  0: "Apple",
  1: "Soap",
  2: "Toy",
  3: "Pillow",
};

// ─── Client ───────────────────────────────────────────────────────────────────

type PetTamagotchiProgram = Program<PetTamagotchi> & {
  addEventListener: (event: string, handler: (data: unknown) => void) => number;
  removeEventListener: (id: number) => Promise<void>;
};

export class BrowserPetClient {
  readonly program: PetTamagotchiProgram;
  readonly provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program<PetTamagotchi>(
      IDL as unknown as PetTamagotchi,
      provider
    ) as PetTamagotchiProgram;
  }

  // ── PDAs ──────────────────────────────────────────────────────────────────

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

  derivePetPda(owner: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
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

  getUserPetzAta(owner: PublicKey): PublicKey {
    const [mintPda] = this.derivePetzMintPda();
    return getAssociatedTokenAddressSync(
      mintPda,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  // ── Instructions ──────────────────────────────────────────────────────────

  async createPet(
    name: string,
    species: string,
    birthDate: number = Math.floor(Date.now() / 1000)
  ): Promise<string> {
    return this.program.methods
      .createPet(name, species, new BN(birthDate))
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async initInventory(): Promise<string> {
    return this.program.methods
      .initInventory()
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async buyItem(itemId: number, qty: number): Promise<string> {
    return this.program.methods
      .buyItem(itemId, qty)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async useItem(itemId: number, petName: string): Promise<string> {
    return this.program.methods
      .useItem(itemId, petName)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async feedPet(name: string): Promise<string> {
    return this.program.methods
      .feed(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async walkPet(name: string): Promise<string> {
    return this.program.methods
      .walk(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async bathePet(name: string): Promise<string> {
    return this.program.methods
      .bathe(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async sleepPet(name: string): Promise<string> {
    return this.program.methods
      .sleep(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async playWithPet(name: string): Promise<string> {
    return this.program.methods
      .play(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async checkStatus(name: string): Promise<PetInfo> {
    await this.program.methods
      .checkStatus(name)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
    return this.getPetInfo(name);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async getInventory(owner?: PublicKey): Promise<InventoryInfo> {
    const ownerKey = owner ?? this.provider.wallet.publicKey;
    const [pda] = this.deriveInventoryPda(ownerKey);
    const account = await this.program.account.inventory.fetch(pda);
    return {
      publicKey: pda,
      owner: account.owner,
      slots: (account.slots as { itemId: number; qty: number }[]).map((s) => ({
        itemId: s.itemId,
        qty: s.qty,
      })),
      bump: account.bump,
    };
  }

  async getPetInfo(name: string, owner?: PublicKey): Promise<PetInfo> {
    const ownerKey = owner ?? this.provider.wallet.publicKey;
    const [pda] = this.derivePetPda(ownerKey, name);
    const account = await this.program.account.pet.fetch(pda);
    return { publicKey: pda, ...account } as PetInfo;
  }

  async listPetsByOwner(owner: PublicKey): Promise<PetInfo[]> {
    const accounts = await this.program.account.pet.all([
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ]);
    return accounts.map((a) => ({
      publicKey: a.publicKey,
      ...(a.account as unknown as Omit<PetInfo, "publicKey">),
    }));
  }

  async initClaimState(petName: string): Promise<string> {
    return this.program.methods
      .initClaimState(petName)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async claimDailyReward(petName: string): Promise<string> {
    return this.program.methods
      .claimDailyReward(petName)
      .accounts({ owner: this.provider.wallet.publicKey })
      .rpc();
  }

  async fetchClaimState(
    owner: PublicKey,
    petName: string
  ): Promise<ClaimStateInfo | null> {
    const [pda] = this.deriveClaimStatePda(owner, petName);
    try {
      const account = await this.program.account.claimState.fetch(pda);
      return { publicKey: pda, ...account } as ClaimStateInfo;
    } catch {
      return null;
    }
  }

  async getPetzBalance(owner: PublicKey): Promise<number> {
    const ata = this.getUserPetzAta(owner);
    try {
      const tokenAccount = await getAccount(
        this.provider.connection,
        ata,
        "confirmed",
        TOKEN_PROGRAM_ID
      );
      return Number(tokenAccount.amount) / 1_000_000;
    } catch {
      return 0;
    }
  }
}

// Alias for convenience
export type PetTamagotchiClient = BrowserPetClient;
