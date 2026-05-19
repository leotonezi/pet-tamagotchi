#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount},
};

declare_id!("CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC");

// ── Constants ─────────────────────────────────────────────────────────────────

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SPECIES_LEN: usize = 16;
pub const INVENTORY_SLOTS: usize = 8;

// ── R2: $PETZ Token constants ─────────────────────────────────────────────────
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

// ── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod pet_tamagotchi {
    use super::*;

    pub fn feed(ctx: Context<PetAction>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;
        pet.hunger = pet.hunger.saturating_sub(25);
        pet.happiness = pet.happiness.saturating_add(5).min(100);
        refresh_needs_and_health(pet);
        pet.last_interaction = now;
        emit!(PetFed {
            pet: pet.key(),
            hunger: pet.hunger,
            happiness: pet.happiness,
        });
        Ok(())
    }

    pub fn walk(ctx: Context<PetAction>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;
        pet.happiness = pet.happiness.saturating_add(15).min(100);
        pet.tiredness = pet.tiredness.saturating_add(10).min(100);
        pet.hygiene = pet.hygiene.saturating_sub(5);
        pet.hunger = pet.hunger.saturating_add(5).min(100);
        refresh_needs_and_health(pet);
        pet.last_interaction = now;
        emit!(PetWalked {
            pet: pet.key(),
            happiness: pet.happiness,
            tiredness: pet.tiredness,
            hygiene: pet.hygiene,
            hunger: pet.hunger,
        });
        Ok(())
    }

    pub fn bathe(ctx: Context<PetAction>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;
        pet.hygiene = pet.hygiene.saturating_add(50).min(100);
        pet.happiness = pet.happiness.saturating_add(5).min(100);
        refresh_needs_and_health(pet);
        pet.last_interaction = now;
        emit!(PetBathed {
            pet: pet.key(),
            hygiene: pet.hygiene,
            happiness: pet.happiness,
        });
        Ok(())
    }

    pub fn sleep(ctx: Context<PetAction>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;
        pet.tiredness = pet.tiredness.saturating_sub(50);
        pet.hunger = pet.hunger.saturating_add(5).min(100);
        refresh_needs_and_health(pet);
        pet.last_interaction = now;
        emit!(PetSlept {
            pet: pet.key(),
            tiredness: pet.tiredness,
            hunger: pet.hunger,
        });
        Ok(())
    }

    pub fn play(ctx: Context<PetAction>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;
        pet.happiness = pet.happiness.saturating_add(20).min(100);
        pet.tiredness = pet.tiredness.saturating_add(10).min(100);
        pet.hunger = pet.hunger.saturating_add(5).min(100);
        refresh_needs_and_health(pet);
        pet.last_interaction = now;
        emit!(PetPlayed {
            pet: pet.key(),
            happiness: pet.happiness,
            tiredness: pet.tiredness,
            hunger: pet.hunger,
        });
        Ok(())
    }

    pub fn check_status(ctx: Context<CheckStatus>, _name: String) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        if pet.is_alive {
            apply_time_decay(pet, now)?;
            refresh_needs_and_health(pet);
        }
        pet.last_interaction = now;
        emit!(StatusChecked {
            pet: pet.key(),
            health: pet.health,
            is_alive: pet.is_alive,
        });
        Ok(())
    }

    pub fn init_inventory(ctx: Context<InitInventory>) -> Result<()> {
        let inv = &mut ctx.accounts.inventory;
        inv.owner = ctx.accounts.owner.key();
        inv.slots = [ItemSlot::default(); INVENTORY_SLOTS];
        inv.bump = ctx.bumps.inventory;
        Ok(())
    }

    pub fn buy_item(ctx: Context<BuyItem>, item_id: u8, qty: u8) -> Result<()> {
        require!(item_id < ITEMS.len() as u8, PetError::ItemUnknown);
        require!(qty > 0, PetError::InsufficientItems);

        let effect = &ITEMS[item_id as usize];
        let total_lamports = effect.price_lamports
            .checked_mul(qty as u64)
            .ok_or(PetError::MathOverflow)?;

        let buyer_lamports = ctx.accounts.owner.lamports();
        require!(buyer_lamports >= total_lamports, PetError::InsufficientFunds);

        // Transfer SOL to treasury PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            total_lamports,
        )?;

        let inv = &mut ctx.accounts.inventory;

        // Find existing slot for item or an empty slot
        let slot = inv.slots.iter_mut().find(|s| s.qty > 0 && s.item_id == item_id);
        if let Some(s) = slot {
            s.qty = s.qty.checked_add(qty as u16).ok_or(PetError::MathOverflow)?;
        } else {
            let empty = inv.slots.iter_mut().find(|s| s.qty == 0);
            let empty = empty.ok_or(PetError::InventoryFull)?;
            empty.item_id = item_id;
            empty.qty = qty as u16;
        }

        emit!(ItemBought {
            owner: ctx.accounts.owner.key(),
            item_id,
            qty,
            total_lamports,
        });
        Ok(())
    }

    pub fn use_item(ctx: Context<UseItem>, item_id: u8, _pet_name: String) -> Result<()> {
        require!(item_id < ITEMS.len() as u8, PetError::ItemUnknown);

        let inv = &mut ctx.accounts.inventory;
        let slot = inv
            .slots
            .iter_mut()
            .find(|s| s.qty > 0 && s.item_id == item_id)
            .ok_or(PetError::InsufficientItems)?;
        slot.qty -= 1;

        let effect = ITEMS[item_id as usize];

        let now = Clock::get()?.unix_timestamp;
        let pet = &mut ctx.accounts.pet;
        apply_time_decay(pet, now)?;

        pet.hunger = apply_stat_delta(pet.hunger, effect.hunger_delta);
        pet.hygiene = apply_stat_delta(pet.hygiene, effect.hygiene_delta);
        pet.happiness = apply_stat_delta(pet.happiness, effect.happiness_delta);
        pet.tiredness = apply_stat_delta(pet.tiredness, effect.tiredness_delta);

        refresh_needs_and_health(pet);
        pet.last_interaction = now;

        emit!(ItemUsed {
            pet: pet.key(),
            item_id,
            hunger: pet.hunger,
            hygiene: pet.hygiene,
            happiness: pet.happiness,
            tiredness: pet.tiredness,
        });
        Ok(())
    }

    // ── R2 instructions ───────────────────────────────────────────────────────

    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        // 1. Cache bump
        let mint_authority = &mut ctx.accounts.mint_authority;
        mint_authority.bump = ctx.bumps.mint_authority;
        mint_authority.mint = ctx.accounts.petz_mint.key();
        mint_authority.total_minted = 0;

        // 2. Emit event
        let now = Clock::get()?.unix_timestamp;
        emit!(MintInitialized {
            mint: ctx.accounts.petz_mint.key(),
            authority: ctx.accounts.mint_authority.key(),
            decimals: PETZ_DECIMALS,
            timestamp: now,
        });
        Ok(())
    }

    pub fn init_claim_state(ctx: Context<InitClaimState>, pet_name: String) -> Result<()> {
        // 1. Validate pet exists and owner matches (enforced by has_one constraint)
        let claim_state = &mut ctx.accounts.claim_state;
        claim_state.owner = ctx.accounts.owner.key();
        claim_state.pet = ctx.accounts.pet.key();
        claim_state.last_claim_ts = 0;
        claim_state.total_claims = 0;
        claim_state.bump = ctx.bumps.claim_state;
        claim_state._padding = [0u8; 7];

        // 2. Emit event
        let now = Clock::get()?.unix_timestamp;
        emit!(ClaimStateInitialized {
            owner: ctx.accounts.owner.key(),
            pet: ctx.accounts.pet.key(),
            timestamp: now,
        });

        let _ = pet_name; // used in seeds derivation via #[instruction]
        Ok(())
    }

    pub fn claim_daily_reward(ctx: Context<ClaimDailyReward>, pet_name: String) -> Result<()> {
        // 1. Validate cooldown
        let now = Clock::get()?.unix_timestamp;
        let claim_state = &ctx.accounts.claim_state;
        let elapsed = now
            .checked_sub(claim_state.last_claim_ts)
            .ok_or(PetError::MathOverflow)?;
        require!(elapsed >= DAILY_CLAIM_COOLDOWN_SECS, PetError::ClaimCooldownActive);

        // 2. Validate pet is alive (enforced by constraint in accounts struct)
        let pet = &ctx.accounts.pet;

        // 3. Compute reward breakdown
        let happiness_bonus = if pet.happiness >= HAPPINESS_BONUS_THRESHOLD {
            HAPPINESS_BONUS
        } else {
            0u64
        };
        let health_bonus = if pet.health >= HEALTH_BONUS_THRESHOLD {
            HEALTH_BONUS
        } else {
            0u64
        };
        let perfect_care_bonus =
            if pet.hunger <= PERFECT_CARE_HUNGER_MAX && pet.hygiene >= PERFECT_CARE_HYGIENE_MIN {
                PERFECT_CARE_BONUS
            } else {
                0u64
            };

        let amount = BASE_REWARD
            .saturating_add(happiness_bonus)
            .saturating_add(health_bonus)
            .saturating_add(perfect_care_bonus)
            .min(MAX_REWARD_PER_CLAIM);

        // 4. CPI: mint_to with mint_authority PDA signer seeds
        let mint_authority_bump = ctx.accounts.mint_authority.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"mint_authority", &[mint_authority_bump]]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // 5. Update claim state
        let claim_state = &mut ctx.accounts.claim_state;
        claim_state.last_claim_ts = now;
        claim_state.total_claims = claim_state.total_claims.saturating_add(1);

        // 6. Update mint authority total_minted
        let mint_authority = &mut ctx.accounts.mint_authority;
        mint_authority.total_minted = mint_authority.total_minted.saturating_add(amount);

        // 7. Emit event
        emit!(DailyRewardClaimed {
            owner: ctx.accounts.owner.key(),
            pet: ctx.accounts.pet.key(),
            amount,
            base_amount: BASE_REWARD,
            happiness_bonus,
            health_bonus,
            perfect_care_bonus,
            total_claims: claim_state.total_claims,
            timestamp: now,
        });

        let _ = pet_name; // used in seeds derivation via #[instruction]
        Ok(())
    }

    pub fn create_pet(
        ctx: Context<CreatePet>,
        name: String,
        species: String,
        birth_date: i64,
    ) -> Result<()> {
        require!(!name.is_empty(), PetError::NameEmpty);
        require!(name.len() <= MAX_NAME_LEN, PetError::NameTooLong);
        require!(species.len() <= MAX_SPECIES_LEN, PetError::SpeciesTooLong);

        let now = Clock::get()?.unix_timestamp;
        let hunger = 30u8;
        let tiredness = 20u8;
        let hygiene = 80u8;
        let happiness = 70u8;

        let pet = &mut ctx.accounts.pet;
        pet.owner = ctx.accounts.owner.key();
        pet.name = name.clone();
        pet.species = species.clone();
        pet.birth_date = birth_date;
        pet.hunger = hunger;
        pet.tiredness = tiredness;
        pet.hygiene = hygiene;
        pet.happiness = happiness;
        pet.health = compute_health(hunger, tiredness, hygiene, happiness);
        pet.needs_meal = hunger > 70;
        pet.needs_walk = happiness < 60;
        pet.needs_bath = hygiene < 40;
        pet.is_alive = true;
        pet.last_interaction = now;
        pet.bump = ctx.bumps.pet;

        emit!(PetCreated {
            owner: pet.owner,
            name,
            species,
        });

        Ok(())
    }
}

// ── Item catalog ──────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct ItemEffect {
    pub hunger_delta:    i16,
    pub hygiene_delta:   i16,
    pub happiness_delta: i16,
    pub tiredness_delta: i16,
    pub price_lamports:  u64,
}

//                      hunger  hygiene  happiness  tiredness  price (lamports)
pub const ITEMS: [ItemEffect; 4] = [
    ItemEffect { hunger_delta: -30, hygiene_delta:   0, happiness_delta:  5, tiredness_delta:   0, price_lamports: 10_000_000 }, // 0: Apple
    ItemEffect { hunger_delta:   0, hygiene_delta:  60, happiness_delta:  0, tiredness_delta:   0, price_lamports: 10_000_000 }, // 1: Soap
    ItemEffect { hunger_delta:   0, hygiene_delta:   0, happiness_delta: 30, tiredness_delta:  10, price_lamports: 10_000_000 }, // 2: Toy
    ItemEffect { hunger_delta:   5, hygiene_delta:   0, happiness_delta:  0, tiredness_delta: -60, price_lamports: 10_000_000 }, // 3: Pillow
];

// ── Accounts ──────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreatePet<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = Pet::MAX_SIZE,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump,
    )]
    pub pet: Account<'info, Pet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CheckStatus<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
    )]
    pub pet: Account<'info, Pet>,
}

#[derive(Accounts)]
#[instruction(name: String)]
pub struct PetAction<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pet", owner.key().as_ref(), name.as_bytes()],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet.is_alive @ PetError::PetDeceased,
    )]
    pub pet: Account<'info, Pet>,
}

// ── Inventory accounts ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitInventory<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = Inventory::SIZE,
        seeds = [b"inventory", owner.key().as_ref()],
        bump,
    )]
    pub inventory: Account<'info, Inventory>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"inventory", owner.key().as_ref()],
        bump = inventory.bump,
        has_one = owner @ PetError::Unauthorized,
    )]
    pub inventory: Account<'info, Inventory>,
    /// CHECK: treasury PDA receives SOL; verified by seeds constraint
    #[account(
        mut,
        seeds = [b"treasury"],
        bump,
    )]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(item_id: u8, pet_name: String)]
pub struct UseItem<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"inventory", owner.key().as_ref()],
        bump = inventory.bump,
        has_one = owner @ PetError::Unauthorized,
    )]
    pub inventory: Account<'info, Inventory>,
    #[account(
        mut,
        seeds = [b"pet", owner.key().as_ref(), pet_name.as_bytes()],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet.is_alive @ PetError::PetDeceased,
    )]
    pub pet: Account<'info, Pet>,
}

// ── R2: Token account contexts ────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = MintAuthority::SIZE,
        seeds = [b"mint_authority"],
        bump,
    )]
    pub mint_authority: Account<'info, MintAuthority>,
    #[account(
        init,
        payer = authority,
        seeds = [b"petz_mint"],
        bump,
        mint::decimals = PETZ_DECIMALS,
        mint::authority = mint_authority,
        mint::freeze_authority = mint_authority,
    )]
    pub petz_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(pet_name: String)]
pub struct InitClaimState<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"pet", owner.key().as_ref(), pet_name.as_bytes()],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
    )]
    pub pet: Account<'info, Pet>,
    #[account(
        init,
        payer = owner,
        space = ClaimState::SIZE,
        seeds = [b"claim_state", owner.key().as_ref(), pet_name.as_bytes()],
        bump,
    )]
    pub claim_state: Account<'info, ClaimState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pet_name: String)]
pub struct ClaimDailyReward<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [b"pet", owner.key().as_ref(), pet_name.as_bytes()],
        bump = pet.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet.is_alive @ PetError::PetDeceased,
    )]
    pub pet: Account<'info, Pet>,
    #[account(
        mut,
        seeds = [b"claim_state", owner.key().as_ref(), pet_name.as_bytes()],
        bump = claim_state.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = claim_state.pet == pet.key() @ PetError::Unauthorized,
    )]
    pub claim_state: Account<'info, ClaimState>,
    #[account(
        mut,
        seeds = [b"mint_authority"],
        bump = mint_authority.bump,
        has_one = mint @ PetError::MintMismatch,
    )]
    pub mint_authority: Account<'info, MintAuthority>,
    #[account(
        mut,
        seeds = [b"petz_mint"],
        bump,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub user_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

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
    pub bump:          u8,       // 1
    pub mint:          Pubkey,   // 32
    pub total_minted:  u64,      // 8
}

impl MintAuthority {
    // 8 (disc) + 1 + 32 + 8 = 49 total (but disc counted separately) → SIZE = 8 + 49 = 57
    pub const SIZE: usize = 8 + 1 + 32 + 8; // 49 bytes data + 8 disc = 57
}

#[account]
pub struct ClaimState {
    pub owner:         Pubkey,   // 32
    pub pet:           Pubkey,   // 32
    pub last_claim_ts: i64,      // 8
    pub total_claims:  u32,      // 4
    pub bump:          u8,       // 1
    pub _padding:      [u8; 7],  // 7
}

impl ClaimState {
    // 8 (disc) + 32 + 32 + 8 + 4 + 1 + 7 = 92 total
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 4 + 1 + 7;
}

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
    pub owner:           Pubkey,
    pub item_id:         u8,
    pub qty:             u8,
    pub total_lamports:  u64,
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
    pub owner:               Pubkey,
    pub pet:                 Pubkey,
    pub amount:              u64,
    pub base_amount:         u64,
    pub happiness_bonus:     u64,
    pub health_bonus:        u64,
    pub perfect_care_bonus:  u64,
    pub total_claims:        u32,
    pub timestamp:           i64,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn apply_stat_delta(stat: u8, delta: i16) -> u8 {
    let result = (stat as i16).saturating_add(delta);
    result.clamp(0, 100) as u8
}

fn compute_health(hunger: u8, tiredness: u8, hygiene: u8, happiness: u8) -> u8 {
    let score = (100u16.saturating_sub(hunger as u16)
        + 100u16.saturating_sub(tiredness as u16)
        + hygiene as u16
        + happiness as u16)
        / 4;
    score as u8
}

fn apply_time_decay(pet: &mut Pet, now: i64) -> Result<()> {
    let elapsed_secs = now
        .checked_sub(pet.last_interaction)
        .ok_or(PetError::MathOverflow)?;

    if elapsed_secs <= 0 {
        return Ok(());
    }

    let hours = (elapsed_secs / 3600) as u16;

    // hunger +1 per 4 hours
    let hunger_gain = (hours / 4).min(100) as u8;
    pet.hunger = pet.hunger.saturating_add(hunger_gain).min(100);

    // tiredness −1 per 4 hours (natural rest)
    let tired_loss = (hours / 4).min(100) as u8;
    pet.tiredness = pet.tiredness.saturating_sub(tired_loss);

    // hygiene −1 per 6 hours
    let hygiene_loss = (hours / 6).min(100) as u8;
    pet.hygiene = pet.hygiene.saturating_sub(hygiene_loss);

    Ok(())
}

fn refresh_needs_and_health(pet: &mut Pet) {
    pet.health = compute_health(pet.hunger, pet.tiredness, pet.hygiene, pet.happiness);
    pet.needs_meal = pet.hunger > 70;
    pet.needs_walk = pet.happiness < 60;
    pet.needs_bath = pet.hygiene < 40;

    if pet.hunger > 95 || pet.hygiene < 10 || pet.happiness < 5 {
        pet.is_alive = false;
    }
}

