use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount},
};
use crate::constants::{
    BASE_REWARD, DAILY_CLAIM_COOLDOWN_SECS, DEPLOYER, HAPPINESS_BONUS, HAPPINESS_BONUS_THRESHOLD,
    HEALTH_BONUS, HEALTH_BONUS_THRESHOLD, MAX_REWARD_PER_CLAIM, PERFECT_CARE_BONUS,
    PERFECT_CARE_HUNGER_MAX, PERFECT_CARE_HYGIENE_MIN, PETZ_DECIMALS,
};
use crate::errors::PetError;
use crate::events::{ClaimStateInitialized, DailyRewardClaimed, MintInitialized};
use crate::state::{ClaimState, MintAuthority, Pet};

// ── InitializeMint context ────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeMint<'info> {
    // S-01: gate to hard-coded deployer — prevents any arbitrary signer from racing to init
    #[account(mut, constraint = authority.key() == DEPLOYER @ PetError::Unauthorized)]
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

// ── InitClaimState context ────────────────────────────────────────────────────

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

// ── ClaimDailyReward context ──────────────────────────────────────────────────

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
    // S-02: use cached bump instead of re-deriving on every claim
    #[account(
        mut,
        seeds = [b"petz_mint"],
        bump = mint_authority.mint_bump,
    )]
    pub mint: Account<'info, Mint>,
    // SECURITY: init_if_needed is safe here — ATA address is fully determined by (mint, owner),
    // preventing any attacker from substituting a pre-existing account at a different address.
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

// ── Handlers ──────────────────────────────────────────────────────────────────

pub(crate) fn handle_initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
    // 1. Cache bumps
    let mint_authority = &mut ctx.accounts.mint_authority;
    mint_authority.bump = ctx.bumps.mint_authority;
    mint_authority.mint_bump = ctx.bumps.petz_mint; // S-02: cache petz_mint bump
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

pub(crate) fn handle_init_claim_state(
    ctx: Context<InitClaimState>,
    pet_name: String,
) -> Result<()> {
    // 1. Validate pet exists and owner matches (enforced by has_one constraint)
    let claim_state = &mut ctx.accounts.claim_state;
    claim_state.owner = ctx.accounts.owner.key();
    claim_state.pet = ctx.accounts.pet.key();
    // SECURITY: last_claim_ts = 0 (Unix epoch) means first claim is immediately eligible.
    // now - 0 >> DAILY_CLAIM_COOLDOWN_SECS always, so no 24h wait on first claim.
    // Do NOT change to = now: that would force a 24h wait after account creation.
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

pub(crate) fn handle_claim_daily_reward(
    ctx: Context<ClaimDailyReward>,
    pet_name: String,
) -> Result<()> {
    // 1. Validate cooldown
    // SECURITY [S-05 P3]: last_claim_ts is initialized to 0 in init_claim_state, so the
    // first claim always passes the cooldown check regardless of current time (now - 0 >= 86400
    // is always true for any real clock value). This is intentional by design — first-claim
    // should not require a 24-hour wait — but should be explicitly documented here.
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
    // SECURITY [S-02 P2]: mint_authority.bump is loaded from on-chain state (correctly
    // cached at init). However the petz_mint `mint` account in ClaimDailyReward uses
    // `bump` (Anchor re-derives) rather than a cached bump, causing unnecessary re-derive
    // overhead. Low exploitability risk but inconsistent pattern — store petz_mint bump
    // in MintAuthority or use `bump = mint_authority.mint_bump` for clarity.
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

    // 5. Update claim state — use checked_add so audit counters error on overflow (S-03)
    let claim_state = &mut ctx.accounts.claim_state;
    claim_state.last_claim_ts = now;
    claim_state.total_claims = claim_state
        .total_claims
        .checked_add(1)
        .ok_or(PetError::MathOverflow)?;

    // 6. Update mint authority total_minted — checked_add for reliable audit counter (S-03)
    let mint_authority = &mut ctx.accounts.mint_authority;
    mint_authority.total_minted = mint_authority
        .total_minted
        .checked_add(amount)
        .ok_or(PetError::MathOverflow)?;

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
