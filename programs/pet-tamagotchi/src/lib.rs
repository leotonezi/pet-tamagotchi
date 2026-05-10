use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ── Constants ─────────────────────────────────────────────────────────────────

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SPECIES_LEN: usize = 16;

// ── Program ───────────────────────────────────────────────────────────────────

#[program]
pub mod pet_tamagotchi {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

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
}

impl Pet {
    // 8 (disc) + 32 + 36 + 20 + 8 + 5×u8 + 4×bool + 8 + 1 = 122
    pub const MAX_SIZE: usize = 8 + 32 + (4 + MAX_NAME_LEN) + (4 + MAX_SPECIES_LEN) + 8 + 5 + 4 + 8 + 1;
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
