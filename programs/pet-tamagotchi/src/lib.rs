#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

declare_id!("CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC");

pub mod constants;
pub mod errors;
pub mod events;
pub mod helpers;
pub mod instructions;
pub mod items;
pub mod state;

pub use constants::*;
pub use errors::*;
pub use events::*;
pub use items::*;
pub use state::*;
pub use helpers::{apply_stat_delta, apply_time_decay, compute_health, refresh_needs_and_health};
pub use instructions::{
    create_pet::CreatePet,
    pet_actions::{CheckStatus, PetAction},
    inventory::{BuyItem, InitInventory, UseItem},
    token::{ClaimDailyReward, InitClaimState, InitializeMint},
};

// Re-export Anchor-generated internal modules so the #[program] macro can find
// them at crate root via `crate::__client_accounts_*`.
pub(crate) use instructions::create_pet::__client_accounts_create_pet;
pub(crate) use instructions::pet_actions::{
    __client_accounts_check_status,
    __client_accounts_pet_action,
};
pub(crate) use instructions::inventory::{
    __client_accounts_buy_item,
    __client_accounts_init_inventory,
    __client_accounts_use_item,
};
pub(crate) use instructions::token::{
    __client_accounts_claim_daily_reward,
    __client_accounts_init_claim_state,
    __client_accounts_initialize_mint,
};

#[program]
pub mod pet_tamagotchi {
    use super::*;

    pub fn feed(ctx: Context<PetAction>, name: String) -> Result<()> {
        instructions::pet_actions::handle_feed(ctx, name)
    }

    pub fn walk(ctx: Context<PetAction>, name: String) -> Result<()> {
        instructions::pet_actions::handle_walk(ctx, name)
    }

    pub fn bathe(ctx: Context<PetAction>, name: String) -> Result<()> {
        instructions::pet_actions::handle_bathe(ctx, name)
    }

    pub fn sleep(ctx: Context<PetAction>, name: String) -> Result<()> {
        instructions::pet_actions::handle_sleep(ctx, name)
    }

    pub fn play(ctx: Context<PetAction>, name: String) -> Result<()> {
        instructions::pet_actions::handle_play(ctx, name)
    }

    pub fn check_status(ctx: Context<CheckStatus>, name: String) -> Result<()> {
        instructions::pet_actions::handle_check_status(ctx, name)
    }

    pub fn init_inventory(ctx: Context<InitInventory>) -> Result<()> {
        instructions::inventory::handle_init_inventory(ctx)
    }

    pub fn buy_item(ctx: Context<BuyItem>, item_id: u8, qty: u8) -> Result<()> {
        instructions::inventory::handle_buy_item(ctx, item_id, qty)
    }

    pub fn use_item(ctx: Context<UseItem>, item_id: u8, pet_name: String) -> Result<()> {
        instructions::inventory::handle_use_item(ctx, item_id, pet_name)
    }

    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        instructions::token::handle_initialize_mint(ctx)
    }

    pub fn init_claim_state(ctx: Context<InitClaimState>, pet_name: String) -> Result<()> {
        instructions::token::handle_init_claim_state(ctx, pet_name)
    }

    pub fn claim_daily_reward(ctx: Context<ClaimDailyReward>, pet_name: String) -> Result<()> {
        instructions::token::handle_claim_daily_reward(ctx, pet_name)
    }

    pub fn create_pet(
        ctx: Context<CreatePet>,
        name: String,
        species: String,
        birth_date: i64,
    ) -> Result<()> {
        instructions::create_pet::handle_create_pet(ctx, name, species, birth_date)
    }
}
