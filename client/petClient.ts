import type { AnchorProvider, Program } from "@coral-xyz/anchor";
import anchor from "@coral-xyz/anchor";

type BN = InstanceType<typeof anchor.BN>;
import { PublicKey } from "@solana/web3.js";
import type { PetTamagotchi } from "../target/types/pet_tamagotchi.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IDL = JSON.parse(
  readFileSync(join(__dirname, "../target/idl/pet_tamagotchi.json"), "utf-8")
) as PetTamagotchi;

export interface PetInfo {
  publicKey: PublicKey;
  owner: PublicKey;
  name: string;
  species: string;
  birthDate: BN;
  hunger: number;
  tiredness: number;
  hygiene: number;
  happiness: number;
  health: number;
  needsMeal: boolean;
  needsWalk: boolean;
  needsBath: boolean;
  isAlive: boolean;
  lastInteraction: BN;
  bump: number;
}

export class PetTamagotchiClient {
  readonly program: Program<PetTamagotchi>;
  readonly provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new anchor.Program<PetTamagotchi>(IDL, provider);
  }

  derivePetPda(owner: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pet"), owner.toBuffer(), Buffer.from(name)],
      this.program.programId
    );
  }

  async createPet(
    name: string,
    species: string,
    birthDate: number = Math.floor(Date.now() / 1000)
  ): Promise<string> {
    return this.program.methods
      .createPet(name, species, new anchor.BN(birthDate))
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

  async getPetInfo(name: string, owner?: PublicKey): Promise<PetInfo> {
    const ownerKey = owner ?? this.provider.wallet.publicKey;
    const [pda] = this.derivePetPda(ownerKey, name);
    const account = await this.program.account.pet.fetch(pda);
    return { publicKey: pda, ...account };
  }

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

  static formatPetStatus(p: PetInfo): string {
    const bar = (val: number): string => {
      const filled = Math.round(val / 10);
      return "█".repeat(filled) + "░".repeat(10 - filled);
    };
    const needs = [
      p.needsMeal ? "meal" : null,
      p.needsWalk ? "walk" : null,
      p.needsBath ? "bath" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return [
      `Pet Status: ${p.name} the ${p.species}`,
      `Status:    ${p.isAlive ? "Alive" : "Deceased"}`,
      `Hunger:    [${bar(p.hunger)}] ${p.hunger}%`,
      `Tiredness: [${bar(p.tiredness)}] ${p.tiredness}%`,
      `Hygiene:   [${bar(p.hygiene)}] ${p.hygiene}%`,
      `Happiness: [${bar(p.happiness)}] ${p.happiness}%`,
      `Health:    [${bar(p.health)}] ${p.health}%`,
      `Needs:     ${needs || "nothing"}`,
    ].join("\n");
  }
}
