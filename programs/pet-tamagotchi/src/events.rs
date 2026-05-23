use anchor_lang::prelude::*;

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct PetCreated {
    pub owner:   Pubkey,
    pub name:    String,
    pub species: String,
}

#[event]
pub struct PetFed {
    pub pet:       Pubkey,
    pub hunger:    u8,
    pub happiness: u8,
}

#[event]
pub struct PetWalked {
    pub pet:       Pubkey,
    pub happiness: u8,
    pub tiredness: u8,
    pub hygiene:   u8,
    pub hunger:    u8,
}

#[event]
pub struct PetBathed {
    pub pet:       Pubkey,
    pub hygiene:   u8,
    pub happiness: u8,
}

#[event]
pub struct PetSlept {
    pub pet:       Pubkey,
    pub tiredness: u8,
    pub hunger:    u8,
}

#[event]
pub struct PetPlayed {
    pub pet:       Pubkey,
    pub happiness: u8,
    pub tiredness: u8,
    pub hunger:    u8,
}

#[event]
pub struct StatusChecked {
    pub pet:      Pubkey,
    pub health:   u8,
    pub is_alive: bool,
}

#[event]
pub struct ItemBought {
    pub owner:          Pubkey,
    pub item_id:        u8,
    pub qty:            u8,
    pub total_lamports: u64,
}

#[event]
pub struct ItemUsed {
    pub pet:       Pubkey,
    pub item_id:   u8,
    pub hunger:    u8,
    pub hygiene:   u8,
    pub happiness: u8,
    pub tiredness: u8,
}

#[event]
pub struct MintInitialized {
    pub mint:      Pubkey,
    pub authority: Pubkey,
    pub decimals:  u8,
    pub timestamp: i64,
}

#[event]
pub struct ClaimStateInitialized {
    pub owner:     Pubkey,
    pub pet:       Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DailyRewardClaimed {
    pub owner:              Pubkey,
    pub pet:                Pubkey,
    pub amount:             u64,
    pub base_amount:        u64,
    pub happiness_bonus:    u64,
    pub health_bonus:       u64,
    pub perfect_care_bonus: u64,
    pub total_claims:       u32,
    pub timestamp:          i64,
}
