use anchor_lang::prelude::*;
use crate::constants::{MAX_NAME_LEN, MAX_SPECIES_LEN, INVENTORY_SLOTS};

// ── Account ───────────────────────────────────────────────────────────────────

#[account]
pub struct Pet {
    pub owner:            Pubkey,   // 32
    pub name:             String,   // 4 + 32
    pub species:          String,   // 4 + 16
    pub birth_date:       i64,      // 8
    pub hunger:           u8,       // 1  — 0=satisfied, 100=starving
    pub tiredness:        u8,       // 1  — 0=rested, 100=exhausted
    pub hygiene:          u8,       // 1  — 0=filthy, 100=pristine
    pub happiness:        u8,       // 1  — 0=miserable, 100=delighted
    pub health:           u8,       // 1  — derived from other four
    pub needs_meal:       bool,     // 1
    pub needs_walk:       bool,     // 1
    pub needs_bath:       bool,     // 1
    pub is_alive:         bool,     // 1
    pub last_interaction: i64,      // 8
    pub bump:             u8,       // 1  — cached PDA bump
    pub version:          u8,       // 1  — reserved for R7 realloc migration
}

impl Pet {
    // 8 (disc) + 32 + 36 + 20 + 8 + 5×u8 + 4×bool + 8 + 1 + 1 = 123
    pub const MAX_SIZE: usize = 8 + 32 + (4 + MAX_NAME_LEN) + (4 + MAX_SPECIES_LEN) + 8 + 5 + 4 + 8 + 1 + 1;
}

#[account]
#[derive(Default)]
pub struct Inventory {
    pub owner: Pubkey,                      // 32
    pub slots: [ItemSlot; INVENTORY_SLOTS], // 8 × 3 = 24
    pub bump:  u8,                          // 1
}

impl Inventory {
    // 8 (disc) + 32 + 24 + 1 = 65
    pub const SIZE: usize = 8 + 32 + (INVENTORY_SLOTS * ItemSlot::SIZE) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct ItemSlot {
    pub item_id: u8,  // 1
    pub qty:     u16, // 2
}

impl ItemSlot {
    pub const SIZE: usize = 3;
}

// ── R2: Token account data ────────────────────────────────────────────────────

#[account]
pub struct MintAuthority {
    pub bump:         u8,     // 1
    pub mint_bump:    u8,     // 1 — cached petz_mint PDA bump (S-02)
    pub mint:         Pubkey, // 32
    pub total_minted: u64,    // 8
}

impl MintAuthority {
    // 8 (disc) + 1 + 1 + 32 + 8 = 50
    pub const SIZE: usize = 8 + 1 + 1 + 32 + 8; // 50 bytes data + 8 disc = 58
}

#[account]
pub struct ClaimState {
    pub owner:         Pubkey,  // 32
    pub pet:           Pubkey,  // 32
    pub last_claim_ts: i64,     // 8
    pub total_claims:  u32,     // 4
    pub bump:          u8,      // 1
    pub _padding:      [u8; 7], // 7
}

impl ClaimState {
    // 8 (disc) + 32 + 32 + 8 + 4 + 1 + 7 = 92 total
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 4 + 1 + 7;
}
