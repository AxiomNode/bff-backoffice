# Operations

## Scope

This section groups repository-local operational notes for `bff-backoffice`.

## Local run

1. `cd src`
2. `cp .env.example .env`
3. From the private `secrets` repository, run `node scripts/prepare-runtime-secrets.mjs dev` to generate `src/.env.secrets`
4. `npm install`
5. `npm run dev`

## Operational checks

After startup, validate:

- `GET /health`
- one monitor or leaderboard route
- one service-target read path
- one AI target or preset-management path when routing controls are enabled

## Runtime-state checks

When targeting behavior is inconsistent, verify:

- `BACKOFFICE_ROUTING_STATE_FILE`
- effective contents of persisted presets and service-target overrides
- reachability of the gateway synchronization endpoint
- allowlist behavior for generic service-target overrides

## Common failure patterns

- diagnostics healthy but control synchronization failing
- local state updated while gateway-effective AI target remains stale
- operator controls exposed but downstream target blocked by allowlist or auth hardening
