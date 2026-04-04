# bff-backoffice

Backend-for-Frontend service for AxiomNode backoffice operations.

## Responsibilities

- Expose admin-focused APIs for monitoring and control workflows.
- Aggregate and normalize data from internal services.
- Keep backoffice UI decoupled from domain-service internals.

## Repository structure

- `src/`: Fastify + TypeScript implementation.
- `docs/`: architecture, guides, and operations docs.
- `.github/workflows/ci.yml`: CI + deployment dispatch trigger.

## Local development

1. `cd src`
2. `cp .env.example .env`
3. `npm install`
4. `npm run dev`

## Main routes

- `GET /health`
- `GET /v1/backoffice/users/leaderboard`
- `GET /v1/backoffice/monitor/stats`

## CI/CD workflow behavior

- `ci.yml`
	- Trigger: push (`main`, `develop`), pull request, manual dispatch.
	- Job `build-test-lint`: install, build, test, and lint.
	- Job `trigger-platform-infra-build`:
		- Runs on push to `main`.
		- Dispatches `platform-infra/.github/workflows/build-push.yaml` with `service=bff-backoffice`.
		- Requires `PLATFORM_INFRA_DISPATCH_TOKEN` in this repo.

## Deployment automation chain

Push to `main` triggers image rebuild in `platform-infra`, then automatic Kubernetes deployment to `dev`.

## Internal dependencies

- `USERS_SERVICE_URL`
- `QUIZZ_SERVICE_URL`
- `WORDPASS_SERVICE_URL`
- `AI_ENGINE_STATS_URL`
