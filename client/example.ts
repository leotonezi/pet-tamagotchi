import anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { PetTamagotchiClient } from "./petClient.js";

const { AnchorProvider, Wallet } = anchor;

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const payer = Keypair.generate();
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const airdrop = await connection.requestAirdrop(payer.publicKey, 2_000_000_000);
  await connection.confirmTransaction(airdrop, "confirmed");

  const client = new PetTamagotchiClient(provider);
  const name = "Fluffy";
  const species = "Dog";

  console.log("=== Creating pet ===");
  const createTx = await client.createPet(name, species);
  console.log("tx:", createTx);

  console.log("\n=== Daily routine ===");
  console.log("feed: ", await client.feedPet(name));
  console.log("walk: ", await client.walkPet(name));
  console.log("play: ", await client.playWithPet(name));
  console.log("bathe:", await client.bathePet(name));
  console.log("sleep:", await client.sleepPet(name));

  console.log("\n=== Status ===");
  const pet = await client.checkStatus(name);
  console.log(PetTamagotchiClient.formatPetStatus(pet));

  console.log("\n=== All pets by owner ===");
  const all = await client.listPetsByOwner(payer.publicKey);
  console.log(`Found ${all.length} pet(s)`);
}

main().catch(console.error);
