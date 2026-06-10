use anchor_lang::prelude::*;
use crate::constants::{MAX_NAME_LEN, MAX_SPECIES_LEN};
use crate::errors::PetError;
use crate::events::PetCreated;
use crate::helpers::compute_health;
use crate::state::Pet;

// ── CreatePet context ─────────────────────────────────────────────────────────

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

// ── Handler ───────────────────────────────────────────────────────────────────

pub(crate) fn handle_create_pet(
    ctx: Context<CreatePet>,
    name: String,
    species: String,
    birth_date: i64,
) -> Result<()> {
    require!(!name.is_empty(), PetError::NameEmpty);
    require!(name.len() <= MAX_NAME_LEN, PetError::NameTooLong);
    require!(!species.is_empty(), PetError::SpeciesTooLong);
    require!(species.len() <= MAX_SPECIES_LEN, PetError::SpeciesTooLong);
    require!(species.is_ascii(), PetError::SpeciesNotAscii);

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
