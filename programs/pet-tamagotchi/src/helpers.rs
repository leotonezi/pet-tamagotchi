use anchor_lang::prelude::*;
use crate::errors::PetError;
use crate::state::Pet;

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn apply_stat_delta(stat: u8, delta: i16) -> u8 {
    let result = (stat as i16).saturating_add(delta);
    result.clamp(0, 100) as u8
}

pub fn compute_health(hunger: u8, tiredness: u8, hygiene: u8, happiness: u8) -> u8 {
    let score = (100u16.saturating_sub(hunger as u16)
        + 100u16.saturating_sub(tiredness as u16)
        + hygiene as u16
        + happiness as u16)
        / 4;
    score as u8
}

pub fn apply_time_decay(pet: &mut Pet, now: i64) -> Result<()> {
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

pub fn refresh_needs_and_health(pet: &mut Pet) {
    pet.health = compute_health(pet.hunger, pet.tiredness, pet.hygiene, pet.happiness);
    pet.needs_meal = pet.hunger > 70;
    pet.needs_walk = pet.happiness < 60;
    pet.needs_bath = pet.hygiene < 40;

    if pet.hunger > 95 || pet.hygiene < 10 || pet.happiness < 5 {
        pet.is_alive = false;
    }
}
