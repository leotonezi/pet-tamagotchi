use anchor_lang::prelude::*;

// ── Core limits ────────────────────────────────────────────────────────────────

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SPECIES_LEN: usize = 16;
pub const INVENTORY_SLOTS: usize = 8;

// ── R2: $PETZ Token constants ─────────────────────────────────────────────────

// S-01: hard-coded deployer gate — only this key may call initialize_mint.
// TODO: replace with actual deployer pubkey before mainnet if different from current wallet.
pub const DEPLOYER: Pubkey = pubkey!("JECoRyH53YqQcACYmB5eQNGqhwdSwRTdyWVD7X4wTEmN");

pub const PETZ_DECIMALS: u8 = 6;
pub const DAILY_CLAIM_COOLDOWN_SECS: i64 = 86_400;
pub const BASE_REWARD: u64 = 10_000_000;
pub const HAPPINESS_BONUS: u64 = 5_000_000;
pub const HEALTH_BONUS: u64 = 5_000_000;
pub const PERFECT_CARE_BONUS: u64 = 5_000_000;
pub const MAX_REWARD_PER_CLAIM: u64 = 25_000_000;
pub const HAPPINESS_BONUS_THRESHOLD: u8 = 80;
pub const HEALTH_BONUS_THRESHOLD: u8 = 80;
pub const PERFECT_CARE_HUNGER_MAX: u8 = 20;
pub const PERFECT_CARE_HYGIENE_MIN: u8 = 80;
