# Operations

## Local run

1. `cd src`
2. `cp .env.example .env`
3. From the private `secrets` repository, run `node scripts/prepare-runtime-secrets.mjs dev` to generate `src/.env.secrets`
4. `npm install`
5. `npm run dev`
