# Quickstart — 5 minutes to a live pet

## 1. Install dependencies

```bash
npm install
anchor build
```

## 2. Start a local validator

```bash
solana-test-validator -r
```

## 3. Deploy the program

In a new terminal:

```bash
anchor deploy
```

Expected output ends with:
```
Program Id: CWcAV2sS6BLjY953X92R7YXgYDZJsnomqcbE1Ru65CfC
Deploy success
```

## 4. Run the demo

```bash
npx ts-node client/example.ts
```

Output looks like:

```
Created pet tx: 4xK...
Fed pet tx: 3mZ...
Walked pet tx: 9pQ...
...
Pet Status: Biscuit the Corgi
Status:    Alive
Hunger:    [███░░░░░░░] 30%
Tiredness: [██░░░░░░░░] 20%
Hygiene:   [████████░░] 80%
Happiness: [███████░░░] 70%
Health:    [███████░░░] 75%
Needs:     nothing
```

## 5. Run tests

```bash
anchor test
```

All 10 tests should pass. No validator needed — tests use bankrun.

## What's next

- Read `ARCHITECTURE.md` for the full data model and decay math (same folder).
- Read `FEATURES.md` for the post-MVP roadmap (same folder).
- Import `PetTamagotchiClient` from `client/petClient.ts` to build your own UI.
