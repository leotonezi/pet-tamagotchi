use anchor_lang::prelude::*;
use crate::constants::{MAX_NAME_LEN, MAX_SPECIES_LEN};
use crate::errors::PetError;
use crate::events::PetBorn;
use crate::helpers::{compute_health, refresh_needs_and_health};
use crate::state::Pet;

// ── Breed context ─────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(name_a: String, name_b: String, offspring_name: String)]
pub struct Breed<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_a.as_bytes()],
        bump = pet_a.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_a.is_alive @ PetError::PetDeceased,
    )]
    pub pet_a: Account<'info, Pet>,

    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_b.as_bytes()],
        bump = pet_b.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_b.is_alive @ PetError::PetDeceased,
    )]
    pub pet_b: Account<'info, Pet>,

    #[account(
        init,
        seeds = [b"pet", owner.key().as_ref(), offspring_name.as_bytes()],
        bump,
        payer = owner,
        space = Pet::MAX_SIZE,
    )]
    pub offspring: Account<'info, Pet>,

    /// CHECK: verified by address constraint
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::id())]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

pub(crate) fn handle_breed(
    ctx: Context<Breed>,
    _name_a: String,
    _name_b: String,
    offspring_name: String,
) -> Result<()> {
    require!(
        ctx.accounts.pet_a.key() != ctx.accounts.pet_b.key(),
        PetError::SameParent
    );
    require!(!offspring_name.is_empty(), PetError::NameEmpty);
    require!(offspring_name.len() <= MAX_NAME_LEN, PetError::NameTooLong);

    let now = Clock::get()?.unix_timestamp;

    // Derive RNG from SlotHashes sysvar. Parents are non-mut so we use stored
    // stats directly — no decay applied.
    let rng_byte = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        if data.len() >= 21 {
            // SlotHashes layout: 8-byte count, then entries of (u64 slot, [u8;32] hash).
            // First hash starts at offset 16 (8 + 8).
            data[16]
        } else {
            // Localnet edge case: no slot hashes populated yet.
            Clock::get()?.slot.to_le_bytes()[0]
        }
    };

    let pet_a = &ctx.accounts.pet_a;
    let pet_b = &ctx.accounts.pet_b;

    let hunger    = if rng_byte & 0x01 == 0 { pet_a.hunger    } else { pet_b.hunger };
    let tiredness = if rng_byte & 0x02 == 0 { pet_a.tiredness } else { pet_b.tiredness };
    let hygiene   = if rng_byte & 0x04 == 0 { pet_a.hygiene   } else { pet_b.hygiene };
    let happiness = if rng_byte & 0x08 == 0 { pet_a.happiness } else { pet_b.happiness };

    let a_bytes = pet_a.species.as_bytes();
    let b_bytes = pet_b.species.as_bytes();
    let half_a = a_bytes.len() / 2;
    let mut species_bytes: Vec<u8> = a_bytes[..half_a].to_vec();
    species_bytes.extend_from_slice(&b_bytes[b_bytes.len() / 2..]);
    species_bytes.truncate(MAX_SPECIES_LEN);
    let blended_species = String::from_utf8(species_bytes)
        .unwrap_or_else(|_| pet_a.species.clone());
    let blended_species = if blended_species.is_empty() {
        pet_a.species.clone()
    } else {
        blended_species
    };

    let offspring = &mut ctx.accounts.offspring;
    offspring.owner            = ctx.accounts.owner.key();
    offspring.name             = offspring_name.clone();
    offspring.species          = blended_species.clone();
    offspring.birth_date       = now;
    offspring.hunger           = hunger;
    offspring.tiredness        = tiredness;
    offspring.hygiene          = hygiene;
    offspring.happiness        = happiness;
    offspring.health           = compute_health(hunger, tiredness, hygiene, happiness);
    offspring.needs_meal       = false;
    offspring.needs_walk       = false;
    offspring.needs_bath       = false;
    offspring.is_alive         = true;
    offspring.last_interaction = now;
    offspring.bump             = ctx.bumps.offspring;

    refresh_needs_and_health(offspring);

    emit!(PetBorn {
        owner:     ctx.accounts.owner.key(),
        parent_a:  ctx.accounts.pet_a.key(),
        parent_b:  ctx.accounts.pet_b.key(),
        offspring: ctx.accounts.offspring.key(),
        species:   blended_species,
        name:      offspring_name,
    });

    Ok(())
}
