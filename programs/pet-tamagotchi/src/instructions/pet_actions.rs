use anchor_lang::prelude::*;
use crate::errors::PetError;
use crate::events::{PetFed, PetWalked, PetBathed, PetSlept, PetPlayed, StatusChecked};
use crate::helpers::{apply_time_decay, refresh_needs_and_health};
use crate::state::Pet;

// ── PetAction context ─────────────────────────────────────────────────────────

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

// ── CheckStatus context ───────────────────────────────────────────────────────

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

// ── Handlers ──────────────────────────────────────────────────────────────────

pub(crate) fn handle_feed(ctx: Context<PetAction>, _name: String) -> Result<()> {
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

pub(crate) fn handle_walk(ctx: Context<PetAction>, _name: String) -> Result<()> {
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

pub(crate) fn handle_bathe(ctx: Context<PetAction>, _name: String) -> Result<()> {
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

pub(crate) fn handle_sleep(ctx: Context<PetAction>, _name: String) -> Result<()> {
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

pub(crate) fn handle_play(ctx: Context<PetAction>, _name: String) -> Result<()> {
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

pub(crate) fn handle_check_status(ctx: Context<CheckStatus>, _name: String) -> Result<()> {
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
