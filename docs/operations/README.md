# Operations

## Local run

1. `cd src`
2. `cp .env.example .env`
3. Desde el repositorio privado `secrets`, ejecutar `node scripts/prepare-runtime-secrets.mjs dev` para generar `src/.env.secrets`
4. `npm install`
5. `npm run dev`
