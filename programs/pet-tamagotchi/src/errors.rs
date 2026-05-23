use anchor_lang::prelude::*;

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum PetError {
    #[msg("Pet name must not be empty")]
    NameEmpty,
    #[msg("Pet name exceeds 32 characters")]
    NameTooLong,
    #[msg("Species exceeds 16 characters")]
    SpeciesTooLong,
    #[msg("This pet has passed away")]
    PetDeceased,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Caller is not the pet owner")]
    Unauthorized,
    #[msg("Inventory is full")]
    InventoryFull,
    #[msg("Unknown item ID")]
    ItemUnknown,
    #[msg("Not enough items in inventory")]
    InsufficientItems,
    #[msg("Insufficient SOL to purchase item")]
    InsufficientFunds,
    #[msg("Daily reward claim cooldown is still active")]
    ClaimCooldownActive,
    #[msg("Mint account does not match expected mint")]
    MintMismatch,
    #[msg("Reward amount calculation overflowed")]
    RewardOverflow,
}
