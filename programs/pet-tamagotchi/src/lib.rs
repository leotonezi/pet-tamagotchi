#![allow(unexpected_cfgs, deprecated)]
use anchor_lang::prelude::*;

declare_id!("CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC");

// ── Constants ─────────────────────────────────────────────────────────────────

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SPECIES_LEN: usize = 16;
pub const INVENTORY_SLOTS: usize = 8;

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

