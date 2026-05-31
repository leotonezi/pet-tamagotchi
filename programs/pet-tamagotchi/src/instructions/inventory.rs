use anchor_lang::prelude::*;
use crate::constants::INVENTORY_SLOTS;
use crate::errors::PetError;
use crate::events::{ItemBought, ItemUsed};
use crate::helpers::{apply_stat_delta, apply_time_decay, refresh_needs_and_health};
use crate::items::ITEMS;
use crate::state::{Inventory, ItemSlot, Pet};

// ── InitInventory context ─────────────────────────────────────────────────────

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

// ── BuyItem context ───────────────────────────────────────────────────────────

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

// ── UseItem context ───────────────────────────────────────────────────────────

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

// ── Handlers ──────────────────────────────────────────────────────────────────

pub(crate) fn handle_init_inventory(ctx: Context<InitInventory>) -> Result<()> {
    let inv = &mut ctx.accounts.inventory;
    inv.owner = ctx.accounts.owner.key();
    inv.slots = [ItemSlot::default(); INVENTORY_SLOTS];
    inv.bump = ctx.bumps.inventory;
    Ok(())
}

pub(crate) fn handle_buy_item(ctx: Context<BuyItem>, item_id: u8, qty: u8) -> Result<()> {
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

pub(crate) fn handle_use_item(ctx: Context<UseItem>, item_id: u8, _pet_name: String) -> Result<()> {
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
