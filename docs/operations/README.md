# Operations

Last updated: 2026-11-14.

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
- `GET /v1/backoffice/ai-engine/target` when the llama target control is used

## Llama target checks

When llama target behavior is inconsistent, verify:

- effective llama target returned by `GET /v1/backoffice/ai-engine/target`
- reachability of `ai-engine-api` `/internal/admin/llama-target`
- `ALLOWED_ROUTING_TARGET_HOSTS` allowlist behavior for target changes

## Common failure patterns

- diagnostics healthy but the call to `ai-engine-api` `/internal/admin/llama-target` failing (target change reported as `400`)
- operator controls exposed but the target blocked by the allowlist or by `ai-engine-api` auth (`x-api-key`)
