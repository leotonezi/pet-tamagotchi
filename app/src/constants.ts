export const SOLANA_ENDPOINT =
  import.meta.env.VITE_SOLANA_ENDPOINT ?? "https://api.devnet.solana.com";

// Item definitions (IDs match on-chain)
export const ITEMS: { id: number; name: string; emoji: string; price: number }[] = [
  { id: 0, name: "Apple", emoji: "🍎", price: 10_000_000 },
  { id: 1, name: "Soap", emoji: "🧼", price: 10_000_000 },
  { id: 2, name: "Toy", emoji: "🎾", price: 10_000_000 },
  { id: 3, name: "Pillow", emoji: "🛏️", price: 10_000_000 },
];

export const ITEM_EFFECT: Record<number, string> = {
  0: "Reduces hunger",
  1: "Improves hygiene",
  2: "Boosts happiness",
  3: "Reduces tiredness",
};

// Anchor error code → user-friendly message
export const ANCHOR_ERROR_MESSAGES: Record<string, string> = {
  NameEmpty: "Pet name must not be empty.",
  NameTooLong: "Name must be 32 characters or less.",
  SpeciesTooLong: "Species must be 16 characters or less.",
  PetDeceased: "Your pet has passed away.",
  MathOverflow: "Arithmetic overflow — please try again.",
  Unauthorized: "Not authorized — you are not the pet owner.",
  InventoryFull: "Inventory is full.",
  ItemUnknown: "Unknown item.",
  InsufficientItems: "Not enough items in inventory.",
  InsufficientFunds: "Insufficient SOL to purchase this item.",
  ClaimCooldownActive: "Daily reward cooldown is still active. Come back tomorrow!",
  MintMismatch: "Mint account mismatch.",
  RewardOverflow: "Reward calculation overflowed.",
};

export const DAILY_REWARD_COOLDOWN_HOURS = 24;

export const WS_LIVENESS_TIMEOUT_MS = 8_000;
export const PET_POLL_INTERVAL_MS = 10_000;
