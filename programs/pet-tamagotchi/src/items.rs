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
