# Adapt AI Local Prototype

Local-first prototype for adapting social content across platforms with an AI workflow engine.

Supported platforms: `linkedin`, `x`, `instagram`, `facebook`.

## Start Everything (new machine)

Run one command:

```bash
./scripts/bootstrap_new_machine.sh
```

This script automatically:

- starts Docker infrastructure
- installs backend and frontend dependencies
- starts backend and frontend
- prepopulates starter data (voice, persona, rule sets, workflow)

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/health`
- Add API keys in `backend/.env` (or in-app Settings)

## How to Use

### 1) Configure integrations

1. Open `Settings` in the app.
2. Add your model/API keys (at minimum `Anthropic` and `OpenAI`).
3. Optionally configure OAuth app credentials for social platforms.

### 2) Connect source accounts (optional but recommended)

1. Open `Accounts`.
2. Add social profile URLs or OAuth-connected accounts.
3. Verify account data is visible.

### 3) Define intelligence profiles

1. Open `Intelligence Hub`.
2. Create:
   - Brand profiles
      - Infer from accounts
      - edit in-place
   - Writing personas
   - Rule sets
      - setup custom rules

### 4) Create and run a workflow

1. Open `Workflow Editor`.
2. Create or edit a workflow definition.
3. Select target platforms.
4. Start a new run with source content (and optional source images).
5. Open each platform's Adapt + Validate node and review A/B variants.

### 5) Review and finalize content

1. Compare generated variants per platform.
2. Accept or edit the best variant.
3. Use regenerate where needed.
4. Use validation feedback to tighten platform-native output.
