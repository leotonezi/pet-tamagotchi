use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use crate::constants::{MAX_NAME_LEN, MAX_SPECIES_LEN};
use crate::errors::PetError;
use crate::events::PetBorn;
use crate::helpers::{compute_health, refresh_needs_and_health};
use crate::state::Pet;

// ── Breed context ─────────────────────────────────────────────────────────────

// SECURITY [B-02 P2]: No `version = 0` constraint on either parent. The `Pet.version`
// field is reserved for R7 migration (state.rs:23). If a future migration writes
// version=1 to indicate a "migrated" layout, an older `breed` client can still load
// migrated parents without error, silently reading fields at wrong offsets (if layout
// changes). Until R7 ships this is latent; document and add `constraint = pet_a.version
// == 0` guards when the migration is introduced.

#[derive(Accounts)]
#[instruction(name_a: String, name_b: String, offspring_name: String)]
pub struct Breed<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    // SECURITY [B-01 P2 FIXED]: SameParent constraint moved to account level so
    // Anchor rejects aliased accounts before any handler code runs.
    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_a.as_bytes()],
        bump = pet_a.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_a.is_alive @ PetError::PetDeceased,
        constraint = pet_a.key() != pet_b.key() @ PetError::SameParent,
    )]
    pub pet_a: Account<'info, Pet>,

    #[account(
        seeds = [b"pet", owner.key().as_ref(), name_b.as_bytes()],
        bump = pet_b.bump,
        has_one = owner @ PetError::Unauthorized,
        constraint = pet_b.is_alive @ PetError::PetDeceased,
    )]
    pub pet_b: Account<'info, Pet>,

    // SECURITY [B-03 P1]: `init` (not `init_if_needed`) is used here; Solana runtime
    // will reject the tx with "account already in use" if the offspring PDA exists,
    // so re-initialization is blocked at the framework layer.
    #[account(
        init,
        seeds = [b"pet", owner.key().as_ref(), offspring_name.as_bytes()],
        bump,
        payer = owner,
        space = Pet::MAX_SIZE,
    )]
    pub offspring: Account<'info, Pet>,

    /// CHECK: verified by address constraint against the canonical SlotHashes sysvar id.
    // SECURITY [B-04 P3]: The `address =` constraint hard-pins this account to the
    // canonical SlotHashes sysvar pubkey, which is sufficient to prevent substitution
    // of an attacker-controlled account. However, the sysvar is read via
    // `try_borrow_data()` without using `sysvar::slot_hashes::SlotHashes::from_account_info`,
    // so any change to the sysvar serialization format would silently produce wrong bytes
    // rather than a deserialization error. The manual offset comment must be kept in sync
    // with the Solana runtime's actual layout.
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
    require!(!offspring_name.is_empty(), PetError::NameEmpty);
    require!(offspring_name.len() <= MAX_NAME_LEN, PetError::NameTooLong);

    // SECURITY [B-08 P2 FIXED]: Reject non-ASCII species before the byte-level blend
    // so multibyte UTF-8 sequences cannot silently produce an unblended offspring.
    require!(
        ctx.accounts.pet_a.species.is_ascii() && ctx.accounts.pet_b.species.is_ascii(),
        PetError::SpeciesNotAscii
    );

    let now = Clock::get()?.unix_timestamp;

    // SECURITY [B-05 P1 FIXED]: hashv over full 32-byte slot hash + tx-unique inputs
    // raises manipulation cost vs a raw single byte. A colluding block producer can
    // still iterate slot hashes to find a favorable output; a commit-reveal scheme is
    // the production fix (deferred R8+).
    //
    // SlotHashes layout: 8-byte count, then entries of (u64 slot, [u8;32] hash).
    // Minimum bytes to read the full first hash: 8 (count) + 8 (slot) + 32 (hash) = 48.
    const MIN_SLOT_HASHES_LEN: usize = 8 + 8 + 32;
    let rng_byte = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        let hash_bytes: &[u8] = if data.len() >= MIN_SLOT_HASHES_LEN {
            &data[16..48]
        } else {
            // SECURITY [B-06 P3]: localnet edge case — clock slot is publicly
            // predictable; remove or cfg-gate for production builds.
            &Clock::get()?.slot.to_le_bytes()[..]
        };
        hashv(&[
            hash_bytes,
            ctx.accounts.owner.key().as_ref(),
            ctx.accounts.pet_a.key().as_ref(),
            ctx.accounts.pet_b.key().as_ref(),
            offspring_name.as_bytes(),
        ])
        .to_bytes()[0]
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
    // ASCII-validated above, so from_utf8 cannot fail; unwrap_or_else is kept as
    // a belt-and-suspenders fallback.
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
    // NOTE: offspring.version intentionally left at default (0). Correct per R7 spec.

    refresh_needs_and_health(offspring);

    // Cache values that require the mutable borrow before releasing it.
    let offspring_key = offspring.key();
    let offspring_alive = offspring.is_alive;

    // SECURITY [B-09 P2 FIXED]: is_alive reflects the post-refresh state so callers
    // can detect a stillborn offspring without inspecting on-chain state separately.
    emit!(PetBorn {
        owner:     ctx.accounts.owner.key(),
        parent_a:  ctx.accounts.pet_a.key(),
        parent_b:  ctx.accounts.pet_b.key(),
        offspring: offspring_key,
        species:   blended_species,
        name:      offspring_name,
        is_alive:  offspring_alive,
    });

    Ok(())
}
